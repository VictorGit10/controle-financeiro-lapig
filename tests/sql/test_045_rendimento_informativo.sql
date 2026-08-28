-- ============================================================================
-- Roteiro de conferência da migração 045.
--
-- ⚠️  ESCREVE E APAGA DADOS. Roda só no container descartável do nível
--     sintético (`tools/replica-local/README.md`), NUNCA contra produção.
--
--   docker run -d --name cf-045 -e POSTGRES_PASSWORD=postgres postgres:17-alpine
--   docker exec cf-045 psql -U postgres -c 'create database cf'
--   docker exec -i cf-045 psql -U postgres -d cf < tools/replica-local/sintetico/stub.sql
--   docker exec -i cf-045 psql -U postgres -d cf < tools/replica-local/sintetico/stub-042.sql
--   docker exec -i cf-045 psql -U postgres -d cf < tools/replica-local/sintetico/stub-043.sql
--   docker exec -i cf-045 psql -U postgres -d cf < database/042_fix_saldos_project_id.sql
--   docker exec -i cf-045 psql -U postgres -d cf < database/043_saldo_do_balancete.sql
--   docker exec -i cf-045 psql -U postgres -d cf < tools/replica-local/sintetico/stub-045.sql
--   docker exec -i cf-045 psql -U postgres -d cf < database/045_rendimento_informativo.sql
--   docker exec -i cf-045 psql -U postgres -d cf < tests/sql/test_045_rendimento_informativo.sql
--
-- Todos os blocos devem imprimir PASSA.
--
-- O QUE MERECE ATENÇÃO. Os blocos 2, 4 e 6 são os que valem o arquivo:
--   • 2 — o saldo NÃO pode ter mudado. A migração inteira é sobre exibir uma
--     composição, e o jeito de estragar tudo é o rendimento voltar a ser somado.
--     Este bloco existe para reprovar essa regressão especificamente.
--   • 4 — NULL tem que continuar NULL. Balancete sem rendimento no rodapé não
--     pode virar "R$ 0,00 de rendimento": zero é uma afirmação, ausência não é.
--   • 6 — o backfill. É a diferença entre a composição valer para uploads
--     futuros e valer para a competência que as pessoas estão olhando hoje.
-- ============================================================================

\pset pager off

do $$ begin
  if not exists (select 1 from information_schema.columns
                  where table_name='project_balances' and column_name='rendimento_informativo')
  or not exists (select 1 from information_schema.columns
                  where table_name='projects' and column_name='rendimento_informativo') then
    raise exception 'Migração 045 não aplicada. Rode database/045_rendimento_informativo.sql antes deste roteiro.';
  end if;
end $$;

create or replace function pg_temp.chk(nome text, cond boolean) returns void
language plpgsql as $$ begin
  raise notice '%  %', case when cond then 'PASSA' else '>>> FALHA' end, nome;
end $$;

create or replace function pg_temp.pid(p_code text) returns uuid
language sql stable as $$ select id from public.projects where code = p_code $$;


-- ── Cenário ────────────────────────────────────────────────────────────────
-- Reexecutável: limpa o próprio rastro. O 99.015 (backfill) NÃO é recriado
-- aqui — ele vem do stub-045, de propósito, porque precisa existir ANTES da 045.
--
-- O `disable trigger` das limpezas é a mesma precaução do roteiro da 043: apagar
-- a última linha de saldo de um projeto estoura em `sync_project_balance`
-- (`initial_balance` é `not null` e o subselect devolve NULL). Bug pré-existente,
-- sem caminho pela interface; desligar o gatilho isola o roteiro dele.
alter table public.project_balances disable trigger trg_sync_project_balance;
delete from public.balancetes b using public.projects p
 where b.project_id = p.id and p.code in ('99.020','99.021','99.022','99.023');
delete from public.project_balances pb using public.projects p
 where pb.project_id = p.id and p.code in ('99.020','99.021','99.022','99.023');
delete from public.projects where code in ('99.020','99.021','99.022','99.023');
alter table public.project_balances enable trigger trg_sync_project_balance;

insert into public.projects (name, code, active) values
  ('ZZ Rend Simples',      '99.020', true),
  ('ZZ Rend Ausente',      '99.021', true),
  ('ZZ Rend Corrigido',    '99.022', true),
  ('ZZ Rend Digitado',     '99.023', true);


-- ── 1. O upload de balancete grava a composição ────────────────────────────
insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido)
values (pg_temp.pid('99.020'), date '2026-08-03', 1960650.04, 150383.77);

do $$
declare r record;
begin
  select initial_balance, yield_amount, rendimento_informativo, source
    into r from public.project_balances where project_id = pg_temp.pid('99.020');

  perform pg_temp.chk('1a. project_balances guardou o rendimento do PDF',
    r.rendimento_informativo = 150383.77);
  perform pg_temp.chk('1b. o saldo continua sendo o SALDO DISPONÍVEL cheio',
    r.initial_balance = 1960650.04);
  perform pg_temp.chk('1c. source segue balancete', r.source = 'balancete');
end $$;

do $$
declare r record;
begin
  select initial_balance, yield_amount, rendimento_informativo
    into r from public.projects where code = '99.020';

  perform pg_temp.chk('1d. a composição chegou até projects (é de lá que as telas leem)',
    r.rendimento_informativo = 150383.77);
  perform pg_temp.chk('1e. projects.initial_balance inalterado',
    r.initial_balance = 1960650.04);
end $$;


-- ── 2. O SALDO NÃO MUDOU — o rendimento continua fora da soma ─────────────
-- O app calcula `saldo = initial_balance + yield_amount`. Se a 045 tivesse
-- escrito o rendimento em `yield_amount` (o atalho óbvio e errado), o saldo
-- exibido inflaria em R$ 150.383,77 e ninguém veria diferença de plausibilidade.
do $$
declare r record; v_saldo_app numeric;
begin
  select initial_balance, yield_amount, rendimento_informativo
    into r from public.projects where code = '99.020';
  v_saldo_app := r.initial_balance + coalesce(r.yield_amount, 0);

  perform pg_temp.chk('2a. yield_amount continua 0 em linha de balancete',
    r.yield_amount = 0);
  perform pg_temp.chk('2b. saldo exibido = saldo do PDF, sem inflar',
    v_saldo_app = 1960650.04);
  perform pg_temp.chk('2c. e NÃO é saldo + rendimento (a duplicação que a 043 removeu)',
    v_saldo_app <> 1960650.04 + 150383.77);
  perform pg_temp.chk('2d. o rendimento é COMPONENTE, cabe dentro do saldo',
    r.rendimento_informativo < r.initial_balance);
end $$;


-- ── 3. get_balances_for_month devolve a composição ─────────────────────────
-- É por esta RPC que a aba Saldos enxerga. Confere junto que a correção da 042
-- (project_id sempre preenchido) sobreviveu ao drop+create desta migração.
do $$
declare r record;
begin
  select * into r
    from public.get_balances_for_month(8, 2026)
   where project_name = 'ZZ Rend Simples';

  perform pg_temp.chk('3a. RPC devolve rendimento_informativo',
    r.rendimento_informativo = 150383.77);
  perform pg_temp.chk('3b. RPC ainda devolve source (mig. 043)', r.source = 'balancete');
  perform pg_temp.chk('3c. project_id preenchido (correção da 042 preservada)',
    r.project_id = pg_temp.pid('99.020'));
end $$;

do $$
declare r record;
begin
  -- Projeto sem saldo na competência: a linha existe, o rendimento é NULL.
  select * into r
    from public.get_balances_for_month(1, 2020)
   where project_name = 'ZZ Rend Simples';

  perform pg_temp.chk('3d. mês sem saldo: project_id preenchido mesmo assim',
    r.project_id = pg_temp.pid('99.020'));
  perform pg_temp.chk('3e. mês sem saldo: rendimento é NULL, não 0',
    r.rendimento_informativo is null);
end $$;


-- ── 4. NULL É "NÃO SEI", NÃO É ZERO ───────────────────────────────────────
-- Balancete cujo rodapé foi lido só pela metade (saldo sim, rendimento não).
-- Gravar 0 aqui faria a tela afirmar "não houve rendimento" — que é uma
-- informação, e uma informação falsa.
insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido)
values (pg_temp.pid('99.021'), date '2026-08-04', 42000.00, null);

do $$
declare r record;
begin
  select pb.rendimento_informativo as pb_rend, p.rendimento_informativo as p_rend,
         pb.initial_balance
    into r
    from public.project_balances pb
    join public.projects p on p.id = pb.project_id
   where pb.project_id = pg_temp.pid('99.021');

  perform pg_temp.chk('4a. rendimento ausente no PDF fica NULL em project_balances',
    r.pb_rend is null);
  perform pg_temp.chk('4b. e NULL em projects', r.p_rend is null);
  perform pg_temp.chk('4c. o saldo foi gravado normalmente mesmo assim',
    r.initial_balance = 42000.00);
end $$;


-- ── 5. Reupload corrige a composição ──────────────────────────────────────
-- A regra de conflito da 043 é `>=` justamente para o reupload do mesmo
-- documento propagar correção. O rendimento tem que acompanhar.
--
-- O reupload é `on conflict do update`, e não um segundo INSERT, porque é isso
-- que acontece em produção: `balancetes` tem `unique (project_id,
-- data_referencia)` desde a mig. 026 e `upsert_balancete` grava por cima. O
-- gatilho é `after insert or update`, então dispara igual.
insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido)
values (pg_temp.pid('99.022'), date '2026-08-10', 300000.00, 1000.00);

insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido)
values (pg_temp.pid('99.022'), date '2026-08-10', 300000.00, 2500.00)
on conflict (project_id, data_referencia) do update set
  saldo_disponivel   = excluded.saldo_disponivel,
  rendimento_liquido = excluded.rendimento_liquido;

do $$
declare r record;
begin
  select pb.rendimento_informativo as pb_rend, p.rendimento_informativo as p_rend
    into r
    from public.project_balances pb
    join public.projects p on p.id = pb.project_id
   where pb.project_id = pg_temp.pid('99.022');

  perform pg_temp.chk('5a. reupload do mesmo dia corrige o rendimento',
    r.pb_rend = 2500.00);
  perform pg_temp.chk('5b. e a correção chega em projects', r.p_rend = 2500.00);
end $$;

-- Balancete mais VELHO chegando depois não pode rebobinar nem o saldo nem a
-- composição.
insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido)
values (pg_temp.pid('99.022'), date '2026-08-01', 111.00, 99.00);

do $$
declare r record;
begin
  select initial_balance, rendimento_informativo into r
    from public.project_balances where project_id = pg_temp.pid('99.022');

  perform pg_temp.chk('5c. balancete velho não rebobina o saldo',
    r.initial_balance = 300000.00);
  perform pg_temp.chk('5d. nem a composição', r.rendimento_informativo = 2500.00);
end $$;


-- ── 6. BACKFILL: a competência que já estava no banco ─────────────────────
-- O 99.015 vem do stub-045: balancete e saldo criados ANTES da migração, sem a
-- coluna. Se este bloco falhar, a 045 só vale para upload futuro — e a
-- competência que as pessoas estão olhando hoje continua sem a composição.
do $$
declare r record;
begin
  select pb.rendimento_informativo as pb_rend,
         pb.initial_balance        as pb_saldo,
         p.rendimento_informativo  as p_rend
    into r
    from public.project_balances pb
    join public.projects p on p.id = pb.project_id
   where pb.project_id = pg_temp.pid('99.015');

  perform pg_temp.chk('6a. backfill preencheu a composição de saldo pré-existente',
    r.pb_rend = 8500.00);
  perform pg_temp.chk('6b. backfill levou a composição até projects',
    r.p_rend = 8500.00);
  perform pg_temp.chk('6c. backfill NÃO mexeu no saldo', r.pb_saldo = 500000.00);
end $$;


-- ── 7. Linha digitada antes da 043 preserva o yield_amount ────────────────
-- As linhas manuais antigas guardam a composição no lugar antigo
-- (`yield_amount`, que ali é parcela a somar de verdade — veio de um extrato com
-- principal e rendimento em linhas separadas). O backfill não pode sobrescrevê-las.
do $$ begin
  perform public.upsert_project_balance(
    pg_temp.pid('99.023'), 7, 2026, 80000.00, 1200.00, date '2026-07-31', 'digitado do extrato');
end $$;

do $$
declare r record;
begin
  select source, initial_balance, yield_amount, rendimento_informativo
    into r from public.project_balances where project_id = pg_temp.pid('99.023');

  perform pg_temp.chk('7a. linha manual continua manual', r.source = 'manual');
  perform pg_temp.chk('7b. yield_amount da digitação preservado (ali É parcela a somar)',
    r.yield_amount = 1200.00);
  perform pg_temp.chk('7c. rendimento_informativo fica NULL em linha digitada',
    r.rendimento_informativo is null);
end $$;


-- ── 8. v_project_summary expõe a composição ao Dashboard ──────────────────
-- A Visão Geral lê a view, não a tabela. Confere também que o `create or
-- replace` preservou as colunas de que `get_panorama` (mig. 040) depende — se
-- alguma tivesse mudado de posição ou sumido, o replace teria recusado.
do $$
declare r record;
begin
  select rendimento_informativo, initial_balance, total_funding,
         active_scholarships, current_monthly_scholarships
    into r from public.v_project_summary where name = 'ZZ Rend Simples';

  perform pg_temp.chk('8a. view devolve rendimento_informativo',
    r.rendimento_informativo = 150383.77);
  perform pg_temp.chk('8b. view manteve initial_balance', r.initial_balance = 1960650.04);
  perform pg_temp.chk('8c. view manteve as colunas que get_panorama (040) consome',
    r.total_funding is not null
    and r.active_scholarships is not null
    and r.current_monthly_scholarships is not null);
end $$;

do $$
declare v_invoker boolean;
begin
  select 'security_invoker=true' = any(reloptions) into v_invoker
    from pg_class where relname = 'v_project_summary';

  perform pg_temp.chk('8d. view continua security_invoker (RLS da 033 vale nela)',
    coalesce(v_invoker, false));
end $$;


-- ── 9. Atributos das funções recriadas (lição da 036) ─────────────────────
-- `create or replace` reescreve os atributos junto com o corpo. As duas funções
-- de gatilho são `security definer`, e sem `search_path` fixo voltariam a
-- disparar o lint 0011 do Supabase.
do $$
declare r record;
begin
  for r in
    select proname, prosecdef, proconfig
      from pg_proc
     where proname in ('sync_balance_from_balancete', 'sync_project_balance')
       and pronamespace = 'public'::regnamespace
  loop
    perform pg_temp.chk('9. ' || r.proname || ' segue definer com search_path fixo',
      r.prosecdef
      and r.proconfig @> array['search_path=public, pg_temp']);
  end loop;
end $$;

do $$
declare r record;
begin
  select prosecdef, proconfig into r
    from pg_proc
   where proname = 'get_balances_for_month'
     and pronamespace = 'public'::regnamespace;

  perform pg_temp.chk('9b. get_balances_for_month recriada como invoker',
    not r.prosecdef and r.proconfig @> array['search_path=public, pg_temp']);
end $$;

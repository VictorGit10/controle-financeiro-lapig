-- ============================================================================
-- Roteiro de conferência da migração 043.
--
-- ⚠️  ESCREVE E APAGA DADOS. Roda só no container descartável do nível
--     sintético (`tools/replica-local/README.md`), NUNCA contra produção.
--
--   docker run -d --name cf-043 -e POSTGRES_PASSWORD=postgres postgres:17-alpine
--   docker exec cf-043 psql -U postgres -c 'create database cf'
--   docker exec -i cf-043 psql -U postgres -d cf < tools/replica-local/sintetico/stub.sql
--   docker exec -i cf-043 psql -U postgres -d cf < tools/replica-local/sintetico/stub-042.sql
--   docker exec -i cf-043 psql -U postgres -d cf < tools/replica-local/sintetico/stub-043.sql
--   docker exec -i cf-043 psql -U postgres -d cf < database/042_fix_saldos_project_id.sql
--   docker exec -i cf-043 psql -U postgres -d cf < database/043_saldo_do_balancete.sql
--   docker exec -i cf-043 psql -U postgres -d cf < tests/sql/test_043_saldo_do_balancete.sql
--
-- Todos os blocos devem imprimir PASSA.
--
-- O QUE MERECE ATENÇÃO. Os blocos 3, 5 e 6 são os que valem o arquivo:
--   • 3 — o rendimento NÃO entra duas vezes. É o erro mais fácil de cometer
--     aqui, porque `balancetes` tem uma coluna `rendimento_liquido` e `projects`
--     tem um campo `yield_amount`, e casar os dois pelo nome inflaria o saldo.
--   • 5 e 6 — a regra é "vence a observação mais recente", não "balancete
--     manda". Um PDF velho não pode apagar um saldo digitado ontem.
-- ============================================================================

\pset pager off

do $$ begin
  if to_regprocedure('public.sync_balance_from_balancete()') is null
  or not exists (select 1 from information_schema.columns
                  where table_name='project_balances' and column_name='source') then
    raise exception 'Migração 043 não aplicada. Rode database/043_saldo_do_balancete.sql antes deste roteiro.';
  end if;
end $$;

create or replace function pg_temp.chk(nome text, cond boolean) returns void
language plpgsql as $$ begin
  raise notice '%  %', case when cond then 'PASSA' else '>>> FALHA' end, nome;
end $$;

create or replace function pg_temp.pid(p_code text) returns uuid
language sql stable as $$ select id from public.projects where code = p_code $$;


-- ── Cenário ────────────────────────────────────────────────────────────────
-- Reexecutável: limpa o próprio rastro. O 99.014 (backfill) NÃO é recriado
-- aqui — ele vem do stub-043, de propósito, porque precisa existir ANTES da 043.
--
-- ⚠️ O `disable trigger` das limpezas não é preguiça: apagar a ÚLTIMA linha de
-- saldo de um projeto estoura em `sync_project_balance` (mig. 021), que faz
-- `update projects set initial_balance = (select ... limit 1)` — sem linha
-- restante o select devolve NULL e a coluna é `not null` (mig. 001). O bloco
-- `if not exists ... set initial_balance = 0` logo abaixo existe para esse caso,
-- mas é código morto: o UPDATE acima já abortou. É bug PRÉ-EXISTENTE, alheio à
-- 043, e sem caminho pela interface (a aba Saldos não exclui, e a FK da mig. 024
-- é ON DELETE RESTRICT). Desligar o gatilho aqui isola o roteiro dele em vez de
-- fingir que não existe.
alter table public.project_balances disable trigger trg_sync_project_balance;
delete from public.balancetes b using public.projects p
 where b.project_id = p.id and p.code in ('99.010','99.011','99.012','99.013');
delete from public.project_balances pb using public.projects p
 where pb.project_id = p.id and p.code in ('99.010','99.011','99.012','99.013');
delete from public.projects where code in ('99.010','99.011','99.012','99.013');
alter table public.project_balances enable trigger trg_sync_project_balance;

insert into public.projects (name, code, active) values
  ('ZZ Balancete Simples',   '99.010', true),
  ('ZZ Balancete Duplo',     '99.011', true),
  ('ZZ Digitado Recente',    '99.012', true),
  ('ZZ Balancete Sem Saldo', '99.013', true);


-- ── 1. Upload de balancete cria o saldo do mês ────────────────────────────
insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido)
values (pg_temp.pid('99.010'), date '2026-08-03', 1960650.04, 150383.77);

do $$
declare r record;
begin
  select * into r from public.project_balances
   where project_id = pg_temp.pid('99.010');

  perform pg_temp.chk('1a. balancete gerou linha em project_balances', r.id is not null);
  perform pg_temp.chk('1b. mês/ano vieram da data_referencia',
    r.reference_month = 8 and r.reference_year = 2026);
  perform pg_temp.chk('1c. balance_date = data_referencia', r.balance_date = date '2026-08-03');
  perform pg_temp.chk('1d. source = balancete', r.source = 'balancete');
end $$;


-- ── 2. A cadeia chega até projects.initial_balance ────────────────────────
-- É a ponta que importa: `calc_project_monthly` parte daqui.
do $$
declare r record;
begin
  select initial_balance, yield_amount, balance_date into r
    from public.projects where code = '99.010';

  perform pg_temp.chk('2a. projects.initial_balance recebeu o saldo do balancete',
    r.initial_balance = 1960650.04);
  perform pg_temp.chk('2b. projects.balance_date recebeu a data do balancete',
    r.balance_date = date '2026-08-03');
end $$;


-- ── 3. O RENDIMENTO NÃO É SOMADO DUAS VEZES ───────────────────────────────
-- O rodapé do PDF diz "SALDO DISPONÍVEL PÓS IR/IOF ESTIMADO S/ REND. APL.
-- FINANCEIRA": o rendimento já está dentro. Como o app calcula
-- `saldo = initial_balance + yield_amount`, yield tem que ficar em zero.
do $$
declare r record; v_saldo_app numeric;
begin
  select initial_balance, yield_amount into r from public.projects where code = '99.010';
  v_saldo_app := r.initial_balance + r.yield_amount;

  perform pg_temp.chk('3a. yield_amount = 0 (rendimento já está no saldo disponível)',
    r.yield_amount = 0);
  perform pg_temp.chk('3b. saldo que o app exibe = saldo do PDF, sem inflar',
    v_saldo_app = 1960650.04);
  perform pg_temp.chk('3c. e NÃO é saldo + rendimento_liquido',
    v_saldo_app <> 1960650.04 + 150383.77);
end $$;


-- ── 4. Balancete mais recente no mesmo mês sobrescreve ────────────────────
insert into public.balancetes (project_id, data_referencia, saldo_disponivel)
values (pg_temp.pid('99.011'), date '2026-08-05', 100.00);
insert into public.balancetes (project_id, data_referencia, saldo_disponivel)
values (pg_temp.pid('99.011'), date '2026-08-20', 200.00);

do $$
declare r record;
begin
  select initial_balance, balance_date into r
    from public.project_balances where project_id = pg_temp.pid('99.011');

  perform pg_temp.chk('4. balancete mais novo do mesmo mês vence',
    r.initial_balance = 200.00 and r.balance_date = date '2026-08-20');
end $$;


-- ── 5. Balancete mais VELHO chegando depois NÃO sobrescreve ───────────────
-- Reupload fora de ordem não pode rebobinar o saldo.
insert into public.balancetes (project_id, data_referencia, saldo_disponivel)
values (pg_temp.pid('99.011'), date '2026-08-11', 999.00);

do $$
declare r record;
begin
  select initial_balance, balance_date into r
    from public.project_balances where project_id = pg_temp.pid('99.011');

  perform pg_temp.chk('5. balancete mais velho subido depois NÃO rebobina o saldo',
    r.initial_balance = 200.00 and r.balance_date = date '2026-08-20');
end $$;


-- ── 6. Digitação mais recente sobrevive a balancete atrasado ──────────────
-- O balancete da FUNAPE sai com semanas de atraso; quem digitou ontem o saldo
-- do extrato tem número mais fresco que o documento.
do $$ begin
  perform public.upsert_project_balance(
    pg_temp.pid('99.012'), 8, 2026, 555000.00, 0, date '2026-08-25', 'digitado do extrato');
end $$;

do $$
declare r record;
begin
  select source, initial_balance into r
    from public.project_balances where project_id = pg_temp.pid('99.012');
  perform pg_temp.chk('6a. upsert_project_balance marca a linha como manual',
    r.source = 'manual' and r.initial_balance = 555000.00);
end $$;

insert into public.balancetes (project_id, data_referencia, saldo_disponivel)
values (pg_temp.pid('99.012'), date '2026-08-03', 111000.00);

do $$
declare r record;
begin
  select source, initial_balance, balance_date into r
    from public.project_balances where project_id = pg_temp.pid('99.012');

  perform pg_temp.chk('6b. balancete ATRASADO não apaga o saldo digitado mais novo',
    r.initial_balance = 555000.00 and r.balance_date = date '2026-08-25' and r.source = 'manual');
end $$;

-- ...mas um balancete mais novo que a digitação vence.
insert into public.balancetes (project_id, data_referencia, saldo_disponivel)
values (pg_temp.pid('99.012'), date '2026-08-28', 600000.00);

do $$
declare r record;
begin
  select source, initial_balance into r
    from public.project_balances where project_id = pg_temp.pid('99.012');

  perform pg_temp.chk('6c. balancete mais novo que a digitação vence',
    r.initial_balance = 600000.00 and r.source = 'balancete');
end $$;


-- ── 7. Balancete sem saldo legível não inventa número ─────────────────────
insert into public.balancetes (project_id, data_referencia, saldo_disponivel)
values (pg_temp.pid('99.013'), date '2026-08-03', null);

do $$
declare v_n integer; v_saldo numeric;
begin
  select count(*) into v_n from public.project_balances where project_id = pg_temp.pid('99.013');
  select initial_balance into v_saldo from public.projects where code = '99.013';

  perform pg_temp.chk('7a. balancete sem saldo_disponivel não cria linha', v_n = 0);
  perform pg_temp.chk('7b. e não grava 0 como se a conta estivesse zerada', v_saldo = 0 and v_n = 0);
end $$;


-- ── 8. Backfill: balancete que já existia antes da 043 ────────────────────
do $$
declare r record; p record;
begin
  select initial_balance, yield_amount, balance_date, source into r
    from public.project_balances where project_id = pg_temp.pid('99.014');
  select initial_balance into p from public.projects where code = '99.014';

  perform pg_temp.chk('8a. backfill pegou o balancete anterior à migração',
    r.initial_balance = 777777.77 and r.source = 'balancete');
  perform pg_temp.chk('8b. backfill também sem somar o rendimento', r.yield_amount = 0);
  perform pg_temp.chk('8c. backfill propagou até projects.initial_balance',
    p.initial_balance = 777777.77);
end $$;


-- ── 9. get_balances_for_month devolve project_id e source ─────────────────
do $$
declare r_com record; r_sem record;
begin
  select * into r_com from public.get_balances_for_month(8, 2026)
   where project_name = 'ZZ Balancete Simples';
  select * into r_sem from public.get_balances_for_month(8, 2026)
   where project_name = 'ZZ Balancete Sem Saldo';

  perform pg_temp.chk('9a. linha com saldo diz que veio do balancete',
    r_com.source = 'balancete' and r_com.project_id = pg_temp.pid('99.010'));
  perform pg_temp.chk('9b. correção da 042 preservada: project_id vem mesmo sem saldo',
    r_sem.project_id = pg_temp.pid('99.013') and r_sem.id is null and r_sem.source is null);
end $$;


-- ── 10. Atributos das funções sobreviveram ao create or replace ───────────
do $$
declare r record;
begin
  select bool_and(ok) into r from (
    select p.proname,
           (p.proname <> 'get_balances_for_month' or p.prosecdef = false)
       and (p.proname <> 'upsert_project_balance' or p.prosecdef = false)
       and (p.proname <> 'sync_balance_from_balancete' or p.prosecdef = true)
       and p.proconfig @> array['search_path=public, pg_temp'] as ok
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('get_balances_for_month','upsert_project_balance','sync_balance_from_balancete')
  ) t(proname, ok);

  perform pg_temp.chk('10. security e search_path corretos nas 3 funções tocadas', r.bool_and);
end $$;


-- ── 11. A ACL da 035 sobreviveu ao DROP de get_balances_for_month ─────────
-- O drop leva os GRANTs junto; a 043 os restaura à mão. Se a restauração sumir
-- num refactor, a função nasce executável por PUBLIC — e `anon` herda de PUBLIC.
do $$
declare v_pub boolean; v_anon boolean; v_auth boolean;
begin
  select has_function_privilege('public', 'public.get_balances_for_month(integer,integer)', 'execute')
    into v_pub;
  select has_function_privilege('anon', 'public.get_balances_for_month(integer,integer)', 'execute')
    into v_anon;
  select has_function_privilege('authenticated', 'public.get_balances_for_month(integer,integer)', 'execute')
    into v_auth;

  perform pg_temp.chk('11a. PUBLIC não executa',        v_pub  = false);
  perform pg_temp.chk('11b. anon não executa',          v_anon = false);
  perform pg_temp.chk('11c. authenticated executa',     v_auth = true);
end $$;


-- ── Limpeza ───────────────────────────────────────────────────────────────
-- Mesmo `disable trigger` do início — ver a nota lá em cima.
alter table public.project_balances disable trigger trg_sync_project_balance;
delete from public.balancetes b using public.projects p
 where b.project_id = p.id and p.code in ('99.010','99.011','99.012','99.013');
delete from public.project_balances pb using public.projects p
 where pb.project_id = p.id and p.code in ('99.010','99.011','99.012','99.013');
delete from public.projects where code in ('99.010','99.011','99.012','99.013');
alter table public.project_balances enable trigger trg_sync_project_balance;

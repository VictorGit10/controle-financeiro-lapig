-- ============================================================================
-- Roteiro de conferência da migração 044.
--
-- ⚠️  ESCREVE E APAGA DADOS. Roda só no container descartável do nível
--     sintético (`tools/replica-local/README.md`), NUNCA contra produção.
--
--   docker run -d --name cf-044 -e POSTGRES_PASSWORD=postgres postgres:17-alpine
--   docker exec cf-044 psql -U postgres -c 'create database cf'
--   docker exec -i cf-044 psql -U postgres -d cf < tools/replica-local/sintetico/stub.sql
--   docker exec -i cf-044 psql -U postgres -d cf < tools/replica-local/sintetico/stub-042.sql
--   docker exec -i cf-044 psql -U postgres -d cf < tools/replica-local/sintetico/stub-043.sql
--   docker exec -i cf-044 psql -U postgres -d cf < database/042_fix_saldos_project_id.sql
--   docker exec -i cf-044 psql -U postgres -d cf < database/043_saldo_do_balancete.sql
--   docker exec -i cf-044 psql -U postgres -d cf < tools/replica-local/sintetico/stub-044.sql
--   docker exec -i cf-044 psql -U postgres -d cf < database/044_saldo_somente_do_balancete.sql
--   docker exec -i cf-044 psql -U postgres -d cf < tests/sql/test_044_saldo_somente_do_balancete.sql
--
-- Todos os blocos devem imprimir PASSA.
--
-- O BLOCO QUE VALE O ARQUIVO É O 4. A 044 tira as policies de escrita de
-- `project_balances` — e é exatamente por ali que o gatilho da 043 grava. A
-- afirmação "gatilho `security definer` roda acima do RLS" é verdadeira, mas
-- verdadeira-por-raciocínio é como se quebra produção: basta a função ter outro
-- dono, ou a tabela ganhar `force row level security`, para o upload de
-- balancete parar de gravar saldo em silêncio. Aqui isso é medido, com RLS
-- ligado e `set role authenticated` de verdade.
-- ============================================================================

\pset pager off

do $$ begin
  if exists (select 1 from pg_policies
              where schemaname='public' and tablename='project_balances'
                and cmd in ('INSERT','UPDATE','DELETE')) then
    raise exception 'Migração 044 não aplicada (policies de escrita ainda existem).';
  end if;
  if not exists (select 1 from pg_tables
                  where schemaname='public' and tablename='project_balances' and rowsecurity) then
    raise exception 'RLS desligado em project_balances. Rode tools/replica-local/sintetico/stub-044.sql.';
  end if;
end $$;

create or replace function pg_temp.chk(nome text, cond boolean) returns void
language plpgsql as $$ begin
  raise notice '%  %', case when cond then 'PASSA' else '>>> FALHA' end, nome;
end $$;

create or replace function pg_temp.pid(p_code text) returns uuid
language sql stable as $$ select id from public.projects where code = p_code $$;


-- ── Cenário ────────────────────────────────────────────────────────────────
alter table public.project_balances disable trigger trg_sync_project_balance;
delete from public.balancetes b using public.projects p
 where b.project_id = p.id and p.code = '99.020';
delete from public.project_balances pb using public.projects p
 where pb.project_id = p.id and p.code = '99.020';
delete from public.projects where code = '99.020';
alter table public.project_balances enable trigger trg_sync_project_balance;

insert into public.projects (name, code, active) values ('ZZ Lockdown Saldo', '99.020', true);


-- ── 1. Superfície de escrita fechada, leitura preservada ──────────────────
do $$
declare v_w integer; v_r integer;
begin
  select count(*) into v_w from pg_policies
   where schemaname='public' and tablename='project_balances' and cmd in ('INSERT','UPDATE','DELETE');
  select count(*) into v_r from pg_policies
   where schemaname='public' and tablename='project_balances' and cmd in ('SELECT','ALL');

  perform pg_temp.chk('1a. nenhuma policy de escrita em project_balances', v_w = 0);
  perform pg_temp.chk('1b. a policy de leitura continua lá',               v_r >= 1);
  perform pg_temp.chk('1c. authenticated não executa upsert_project_balance',
    has_function_privilege('authenticated',
      'public.upsert_project_balance(uuid,integer,integer,numeric,numeric,date,text)', 'execute') = false);
  perform pg_temp.chk('1d. authenticated não tem INSERT na tabela',
    has_table_privilege('authenticated', 'public.project_balances', 'insert') = false);
  perform pg_temp.chk('1e. authenticated ainda tem SELECT (a aba Saldos lê)',
    has_table_privilege('authenticated', 'public.project_balances', 'select') = true);
end $$;


-- ── 2. Como authenticated: INSERT direto na tabela é recusado ─────────────
set role authenticated;

do $$
declare v_barrou boolean := false;
begin
  begin
    insert into public.project_balances
      (project_id, reference_month, reference_year, initial_balance, balance_date)
    values (pg_temp.pid('99.020'), 9, 2026, 12345.00, date '2026-09-10');
  exception when insufficient_privilege then
    v_barrou := true;
  end;

  perform pg_temp.chk('2. INSERT direto em project_balances é recusado', v_barrou);
end $$;


-- ── 3. Como authenticated: a RPC de digitação é recusada ──────────────────
do $$
declare v_barrou boolean := false;
begin
  begin
    perform public.upsert_project_balance(
      pg_temp.pid('99.020'), 9, 2026, 12345.00, 0, date '2026-09-10', null);
  exception when insufficient_privilege then
    v_barrou := true;
  end;

  perform pg_temp.chk('3. upsert_project_balance é recusada', v_barrou);
end $$;


-- ── 4. Como authenticated: subir balancete AINDA GRAVA o saldo ────────────
-- O caminho que tem que continuar vivo. Se este bloco falhar, a 044 quebrou o
-- Fechamento Mensal e o saldo para de existir em silêncio.
insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido)
values (pg_temp.pid('99.020'), date '2026-09-04', 888888.88, 9999.99);

do $$
declare r record;
begin
  select initial_balance, yield_amount, balance_date, source into r
    from public.project_balances where project_id = pg_temp.pid('99.020');

  perform pg_temp.chk('4a. o gatilho definer gravou apesar de não haver policy de escrita',
    r.initial_balance = 888888.88);
  perform pg_temp.chk('4b. marcado como vindo do balancete', r.source = 'balancete');
  perform pg_temp.chk('4c. rendimento não foi somado ao saldo', r.yield_amount = 0);
  perform pg_temp.chk('4d. data do saldo = data de referência', r.balance_date = date '2026-09-04');
end $$;


-- ── 5. A cadeia chegou em projects, que não tem policy de UPDATE ──────────
do $$
declare v_saldo numeric;
begin
  select initial_balance into v_saldo from public.projects where code = '99.020';
  perform pg_temp.chk('5. sync_project_balance atualizou projects sem policy de UPDATE',
    v_saldo = 888888.88);
end $$;


-- ── 6. A aba Saldos continua lendo ────────────────────────────────────────
do $$
declare r record;
begin
  select * into r from public.get_balances_for_month(9, 2026)
   where project_name = 'ZZ Lockdown Saldo';

  perform pg_temp.chk('6a. get_balances_for_month devolve a linha para authenticated',
    r.initial_balance = 888888.88 and r.source = 'balancete');
  perform pg_temp.chk('6b. e ainda traz project_id (correção da 042)',
    r.project_id = pg_temp.pid('99.020'));
end $$;

reset role;


-- ── Limpeza ───────────────────────────────────────────────────────────────
alter table public.project_balances disable trigger trg_sync_project_balance;
delete from public.balancetes b using public.projects p
 where b.project_id = p.id and p.code = '99.020';
delete from public.project_balances pb using public.projects p
 where pb.project_id = p.id and p.code = '99.020';
delete from public.projects where code = '99.020';
alter table public.project_balances enable trigger trg_sync_project_balance;

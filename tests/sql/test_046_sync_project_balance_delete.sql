-- ============================================================================
-- Roteiro de conferência da migração 046.
--
-- ⚠️ ESCREVE E APAGA DADOS. Rode somente no container sintético descartável.
-- Depois da cadeia stub → 042 → 043 → 044 → 045:
--
--   docker exec -i cf-046 psql -U postgres -d cf < database/046_fix_sync_project_balance_delete.sql
--   docker exec -i cf-046 psql -U postgres -d cf < tests/sql/test_046_sync_project_balance_delete.sql
--
-- Todos os blocos devem imprimir PASSA.
-- ============================================================================

\pset pager off

do $$ begin
  if position('mig. 046' in coalesce(
    obj_description('public.sync_project_balance()'::regprocedure, 'pg_proc'), ''
  )) = 0 then
    raise exception 'Migração 046 não aplicada.';
  end if;
end $$;

create or replace function pg_temp.chk(nome text, cond boolean) returns void
language plpgsql as $$ begin
  raise notice '%  %', case when cond then 'PASSA' else '>>> FALHA' end, nome;
end $$;

-- Reexecutável. Com a 046 aplicada, a própria limpeza exercita o caminho do
-- DELETE sem precisar desligar o gatilho — ao contrário do roteiro da 045.
delete from public.project_balances pb
using public.projects p
where pb.project_id = p.id and p.code = '99.024';
delete from public.projects where code = '99.024';

insert into public.projects (name, code, active)
values ('ZZ Delete Último Saldo', '99.024', true);

insert into public.project_balances (
  project_id, reference_month, reference_year,
  initial_balance, yield_amount, rendimento_informativo,
  balance_date, source
)
select id, 7, 2026, 100000.00, 500.00, 8000.00, date '2026-07-31', 'manual'
from public.projects where code = '99.024';

insert into public.project_balances (
  project_id, reference_month, reference_year,
  initial_balance, yield_amount, rendimento_informativo,
  balance_date, source
)
select id, 8, 2026, 120000.00, 0.00, 9000.00, date '2026-08-31', 'balancete'
from public.projects where code = '99.024';

do $$
declare r record;
begin
  select initial_balance, yield_amount, rendimento_informativo, balance_date
  into r from public.projects where code = '99.024';

  perform pg_temp.chk('1a. INSERT espelha o saldo mais recente',
    r.initial_balance = 120000.00 and r.yield_amount = 0.00);
  perform pg_temp.chk('1b. INSERT espelha a composição informativa',
    r.rendimento_informativo = 9000.00 and r.balance_date = date '2026-08-31');
end $$;

delete from public.project_balances
where project_id = (select id from public.projects where code = '99.024')
  and reference_month = 8 and reference_year = 2026;

do $$
declare r record;
begin
  select initial_balance, yield_amount, rendimento_informativo, balance_date
  into r from public.projects where code = '99.024';

  perform pg_temp.chk('2a. DELETE da mais recente recua para a anterior',
    r.initial_balance = 100000.00 and r.yield_amount = 500.00);
  perform pg_temp.chk('2b. DELETE recua também a composição e a data',
    r.rendimento_informativo = 8000.00 and r.balance_date = date '2026-07-31');
end $$;

delete from public.project_balances
where project_id = (select id from public.projects where code = '99.024');

do $$
declare r record;
begin
  select initial_balance, yield_amount, rendimento_informativo, balance_date
  into r from public.projects where code = '99.024';

  perform pg_temp.chk('3a. DELETE do último saldo não viola NOT NULL',
    r.initial_balance = 0 and r.yield_amount = 0);
  perform pg_temp.chk('3b. sem saldo, composição e data voltam a NULL',
    r.rendimento_informativo is null and r.balance_date is null);
end $$;

do $$
declare
  v_security text;
  v_search   text;
begin
  select prosecdef, array_to_string(proconfig, ',')
  into v_security, v_search
  from pg_proc
  where oid = 'public.sync_project_balance()'::regprocedure;

  perform pg_temp.chk('4a. função continua security definer', v_security::boolean);
  perform pg_temp.chk('4b. função continua com search_path fixo',
    v_search like '%search_path=public, pg_temp%');
end $$;

delete from public.projects where code = '99.024';

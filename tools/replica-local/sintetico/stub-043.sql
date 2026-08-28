-- Completa o stub sintético com o resto da cadeia de saldo, que a 043 percorre
-- inteira e o stub-042 só tinha pela metade: as colunas de saldo em `projects`
-- (mig. 017) e o gatilho `sync_project_balance` (mig. 017 + 021).
--
-- Sem o gatilho, o roteiro da 043 provaria só que `project_balances` recebeu a
-- linha — e o ponto da migração é a PONTA da cadeia, `projects.initial_balance`,
-- que é de onde `calc_project_monthly` parte.
--
-- Insere também um balancete PRÉ-EXISTENTE (projeto 99.014), para que o
-- backfill da seção E da 043 tenha o que encontrar. Testar backfill exige dado
-- anterior à migração; criado depois, quem age é o gatilho, e a seção E passaria
-- a vazio sem ninguém notar.
--
--   docker exec -i cf-043 psql -U postgres -d cf < tools/replica-local/sintetico/stub.sql
--   docker exec -i cf-043 psql -U postgres -d cf < tools/replica-local/sintetico/stub-042.sql
--   docker exec -i cf-043 psql -U postgres -d cf < tools/replica-local/sintetico/stub-043.sql
--   docker exec -i cf-043 psql -U postgres -d cf < database/042_fix_saldos_project_id.sql
--   docker exec -i cf-043 psql -U postgres -d cf < database/043_saldo_do_balancete.sql
--   docker exec -i cf-043 psql -U postgres -d cf < tests/sql/test_043_saldo_do_balancete.sql

alter table public.projects
  add column if not exists initial_balance numeric(14,2) not null default 0,
  add column if not exists yield_amount    numeric(14,2) not null default 0,
  add column if not exists balance_date    date;

-- Versão da mig. 021 (INSERT + UPDATE + DELETE).
create or replace function public.sync_project_balance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
begin
  v_project_id := coalesce(NEW.project_id, OLD.project_id);

  update public.projects
  set initial_balance = (
        select pb.initial_balance from public.project_balances pb
         where pb.project_id = v_project_id
         order by pb.reference_year desc, pb.reference_month desc limit 1),
      yield_amount = (
        select pb.yield_amount from public.project_balances pb
         where pb.project_id = v_project_id
         order by pb.reference_year desc, pb.reference_month desc limit 1),
      balance_date = (
        select pb.balance_date from public.project_balances pb
         where pb.project_id = v_project_id
         order by pb.reference_year desc, pb.reference_month desc limit 1)
  where id = v_project_id;

  if not exists (select 1 from public.project_balances pb where pb.project_id = v_project_id) then
    update public.projects
       set initial_balance = 0, yield_amount = 0, balance_date = null
     where id = v_project_id;
  end if;

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_sync_project_balance on public.project_balances;
create trigger trg_sync_project_balance
  after insert or update or delete on public.project_balances
  for each row execute function public.sync_project_balance();


-- ── Dado anterior à 043, para o backfill da seção E ────────────────────────
delete from public.balancetes b
 using public.projects p
 where b.project_id = p.id and p.code = '99.014';
delete from public.project_balances pb
 using public.projects p
 where pb.project_id = p.id and p.code = '99.014';
delete from public.projects where code = '99.014';

insert into public.projects (name, code, active)
values ('ZZ Backfill Pre Existente', '99.014', true);

insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido)
select id, date '2026-07-05', 777777.77, 11111.11
  from public.projects where code = '99.014';

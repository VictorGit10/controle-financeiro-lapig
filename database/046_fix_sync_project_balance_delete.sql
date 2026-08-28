-- ============================================================================
-- 046_fix_sync_project_balance_delete.sql
--
-- Corrige o DELETE da última linha de `project_balances`.
--
-- A função herdada da 021 e regravada pela 043/045 fazia primeiro um UPDATE em
-- `projects` com quatro subconsultas escalares. Ao apagar o último saldo, todas
-- devolviam NULL; `projects.initial_balance` é NOT NULL, então a operação
-- abortava ANTES de chegar ao ramo que deveria zerar o saldo.
--
-- A interface não expõe DELETE desde a 044, mas a função declara suportar
-- INSERT, UPDATE e DELETE e continua sendo acionada em correções administrativas
-- e manutenções. O conserto consulta a linha mais recente uma vez e decide antes
-- do UPDATE: se existe, copia seus quatro campos; se não existe, zera o saldo e
-- mantém `rendimento_informativo = NULL` (ausência de composição conhecida).
--
-- Não muda saldo existente, RLS, policies ou ACL. Depende da 045.
-- Roteiro: `tests/sql/test_046_sync_project_balance_delete.sql`.
-- ============================================================================

begin;

do $$ begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'projects'
       and column_name = 'rendimento_informativo'
  ) then
    raise exception 'Migração 045 não aplicada: projects.rendimento_informativo não existe.';
  end if;
end $$;

create or replace function public.sync_project_balance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_project_id uuid;
  v_latest record;
begin
  v_project_id := coalesce(NEW.project_id, OLD.project_id);

  select
    pb.initial_balance,
    pb.yield_amount,
    pb.rendimento_informativo,
    pb.balance_date
  into v_latest
  from public.project_balances pb
  where pb.project_id = v_project_id
  order by pb.reference_year desc, pb.reference_month desc
  limit 1;

  if found then
    update public.projects
    set initial_balance        = v_latest.initial_balance,
        yield_amount           = v_latest.yield_amount,
        rendimento_informativo = v_latest.rendimento_informativo,
        balance_date           = v_latest.balance_date
    where id = v_project_id;
  else
    update public.projects
    set initial_balance        = 0,
        yield_amount           = 0,
        rendimento_informativo = null,
        balance_date           = null
    where id = v_project_id;
  end if;

  return coalesce(NEW, OLD);
end;
$fn$;

comment on function public.sync_project_balance is
  'Sincroniza as colunas de saldo em projects com o registro mais recente de '
  'project_balances, inclusive a composição informativa do rendimento. Suporta '
  'INSERT, UPDATE e DELETE; ao excluir a última linha, zera o saldo sem violar '
  'projects.initial_balance NOT NULL (mig. 046).';

commit;

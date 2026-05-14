-- ============================================================
-- CONTROLE FINANCEIRO — Migração 021
-- Correções de integridade: start_date no trigger de active,
-- DELETE no trigger de project_balances, e ajustes de UI
-- ============================================================

-- 1. Corrigir sync_holder_active: considerar start_date
-- Um bolsista só é "ativo" se tiver bolsa com status='active'
-- E start_date <= current_date E end_date >= current_date
create or replace function public.sync_holder_active()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_holder_id uuid;
begin
  v_holder_id := coalesce(NEW.holder_id, OLD.holder_id);

  update public.scholarship_holders
  set active = exists (
    select 1 from public.scholarships s
    where s.holder_id = v_holder_id
      and s.status    = 'active'
      and s.start_date <= current_date
      and s.end_date   >= current_date
  )
  where id = v_holder_id;

  return coalesce(NEW, OLD);
end;
$$;

comment on function public.sync_holder_active is
  'Mantém scholarship_holders.active sincronizado com as bolsas ativas vinculadas. Considera start_date e end_date.';

-- Re-sincronizar holders existentes com a nova regra
update public.scholarship_holders sh
set active = exists (
  select 1 from public.scholarships s
  where s.holder_id = sh.id
    and s.status    = 'active'
    and s.start_date <= current_date
    and s.end_date   >= current_date
);

-- 2. Corrigir sync_project_balance: suportar DELETE
-- Quando um saldo é apagado, recalcular a partir dos registros restantes.
create or replace function public.sync_project_balance()
returns trigger as $$
declare
  v_project_id uuid;
begin
  v_project_id := coalesce(NEW.project_id, OLD.project_id);

  update public.projects
  set
    initial_balance = (
      select pb.initial_balance
      from public.project_balances pb
      where pb.project_id = v_project_id
      order by pb.reference_year desc, pb.reference_month desc
      limit 1
    ),
    yield_amount = (
      select pb.yield_amount
      from public.project_balances pb
      where pb.project_id = v_project_id
      order by pb.reference_year desc, pb.reference_month desc
      limit 1
    ),
    balance_date = (
      select pb.balance_date
      from public.project_balances pb
      where pb.project_id = v_project_id
      order by pb.reference_year desc, pb.reference_month desc
      limit 1
    )
  where id = v_project_id;

  -- Se não houver mais registros, zera os campos
  if not exists (select 1 from public.project_balances pb where pb.project_id = v_project_id) then
    update public.projects
    set initial_balance = 0, yield_amount = 0, balance_date = null
    where id = v_project_id;
  end if;

  return coalesce(NEW, OLD);
end;
$$ language plpgsql security definer;

comment on function public.sync_project_balance is
  'Sincroniza as colunas de saldo em projects com o registro mais recente de project_balances. Suporta INSERT, UPDATE e DELETE.';

-- Recriar trigger com DELETE incluído
drop trigger if exists trg_sync_project_balance on public.project_balances;
create trigger trg_sync_project_balance
  after insert or update or delete on public.project_balances
  for each row execute function public.sync_project_balance();
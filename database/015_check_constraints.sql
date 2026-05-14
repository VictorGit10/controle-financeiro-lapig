-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Check Constraints
-- Migração 015: Integridade de dados — valores positivos e datas
-- ============================================================
-- Remove registros inválidos e adiciona CHECK constraints
-- para garantir que valores monetários sejam positivos e
-- que datas de início sejam anteriores às de fim.

-- 1. Remover registros com valor <= 0 (placeholders sem valor real)
delete from public.funding_releases where amount <= 0;
delete from public.expenses where amount <= 0;
delete from public.scholarships where amount <= 0;

-- 2. Corrigir datas invertidas em scholarships
update public.scholarships
  set start_date = end_date,
      end_date = start_date
  where start_date > end_date;

-- 3. CHECK constraints — valores monetários positivos
alter table public.scholarships
  add constraint chk_scholarships_amount_positive
  check (amount > 0);

alter table public.funding_releases
  add constraint chk_funding_amount_positive
  check (amount > 0);

alter table public.expenses
  add constraint chk_expenses_amount_positive
  check (amount > 0);

-- 4. CHECK constraints — ordem das datas
alter table public.scholarships
  add constraint chk_scholarships_date_order
  check (start_date < end_date);

alter table public.projects
  add constraint chk_projects_date_order
  check (end_date is null or start_date is null or start_date < end_date);
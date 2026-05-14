-- ============================================================
-- AUDITORIA DE DADOS INVÁLIDOS
-- Rode ESTE script primeiro para ver os registros problemáticos.
-- Depois corrija manualmente ou rode a 014 (que aplica as constraints).
-- ============================================================

-- Funding releases com valor <= 0
select 'Funding <= 0' as tipo, id, project_id, description, release_date, amount
  from public.funding_releases where amount <= 0;

-- Expenses com valor <= 0
select 'Expense <= 0' as tipo, id, project_id, description, expense_date, amount
  from public.expenses where amount <= 0;

-- Scholarships com valor <= 0
select 'Scholarship <= 0' as tipo, id, holder_id, project_id, amount, start_date, end_date
  from public.scholarships where amount <= 0;

-- Scholarships com data invertida (start >= end)
select 'Scholarship datas invertidas' as tipo, id, holder_id, project_id, amount, start_date, end_date
  from public.scholarships where start_date >= end_date;

-- Projects com data invertida
select 'Project datas invertidas' as tipo, id, name, start_date, end_date
  from public.projects
  where end_date is not null and start_date is not null and start_date >= end_date;
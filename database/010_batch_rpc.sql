-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Migration 009
-- Adiciona função RPC batch para eliminar N+1 queries no dashboard
-- ============================================================

create or replace function public.calc_projects_batch(
  p_project_ids uuid[],
  p_start_date date default null,
  p_balance_status text default 'unpaid_current'
)
returns table (
  project_id         uuid,
  month_label        text,
  month_start        date,
  initial_balance    numeric,
  scholarship_expense numeric,
  funding_income     numeric,
  other_expense      numeric,
  net_balance        numeric
) as $$
declare
  v_start date;
begin
  v_start := coalesce(p_start_date, date_trunc('month', now())::date);

  return query
  select
    sub.project_id,
    sub.month_label,
    sub.month_start,
    sub.initial_balance,
    sub.scholarship_expense,
    sub.funding_income,
    sub.other_expense,
    sub.net_balance
  from (
    select
      p.id as project_id,
      calc.month_label,
      calc.month_start,
      calc.initial_balance,
      calc.scholarship_expense,
      calc.funding_income,
      calc.other_expense,
      calc.net_balance
    from unnest(p_project_ids) as proj_id
    join public.projects p on p.id = proj_id
    cross join lateral public.calc_project_monthly(
      p.id,
      v_start,
      null,
      p_balance_status
    ) as calc
  ) sub
  order by sub.project_id, sub.month_start;
end;
$$ language plpgsql stable security definer;
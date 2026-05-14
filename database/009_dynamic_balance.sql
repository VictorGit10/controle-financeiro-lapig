-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Migration 008
-- Adiciona parâmetros dinâmicos de status do saldo
-- ============================================================

-- ============================================================
-- FUNÇÃO RPC: Cálculo mensal de saldo por projeto
-- ============================================================
drop function if exists public.calc_project_monthly(uuid, date, date);

create or replace function public.calc_project_monthly(
  p_project_id uuid,
  p_start_date date default null,
  p_end_date   date default null,
  p_balance_status text default 'unpaid_current'
)
returns table (
  month_label     text,
  month_start     date,
  initial_balance numeric,
  scholarship_expense numeric,
  funding_income     numeric,
  other_expense      numeric,
  net_balance        numeric
) as $$
declare
  v_project       record;
  v_start         date;
  v_end           date;
  v_adjusted_balance numeric;
begin
  select p.* into v_project
  from public.projects p
  where p.id = p_project_id;

  if not found then
    raise exception 'Projeto não encontrado: %', p_project_id;
  end if;

  v_start := coalesce(p_start_date, date_trunc('month', now())::date);
  v_end   := coalesce(p_end_date, v_project.end_date, (date_trunc('year', now()) + interval '1 year' - interval '1 day')::date);

  -- Calcular o saldo inicial ajustado "por baixo dos panos"
  v_adjusted_balance := v_project.initial_balance + coalesce(v_project.yield_amount, 0);

  if p_balance_status = 'paid_current' then
    -- Se o mês atual já está pago no saldo, devemos "fingir" que o saldo antes do mês era maior,
    -- para que quando a função debitar as bolsas do mês atual, o saldo final bata com o digitado.
    v_adjusted_balance := v_adjusted_balance + coalesce((
      select sum(s.amount) from public.scholarships s
      where s.project_id = p_project_id and s.status = 'active'
        and s.start_date <= (v_start + interval '1 month' - interval '1 day')::date
        and s.end_date >= v_start
    ), 0);
  elsif p_balance_status = 'unpaid_previous' then
    -- Se nem o mês anterior foi pago, descontamos ele antecipadamente no saldo inicial.
    v_adjusted_balance := v_adjusted_balance - coalesce((
      select sum(s.amount) from public.scholarships s
      where s.project_id = p_project_id and s.status = 'active'
        and s.start_date <= (v_start - interval '1 day')::date
        and s.end_date >= (v_start - interval '1 month')::date
    ), 0);
  end if;

  return query
  with months as (
    select ms.month_start, ms.month_end
    from public.generate_month_series(v_start, v_end) ms
  ),
  monthly_data as (
    select
      m.month_start, m.month_end,
      coalesce((select sum(s.amount) from public.scholarships s
        where s.project_id = p_project_id and s.status = 'active'
          and s.start_date <= m.month_end and s.end_date >= m.month_start), 0) as scholarship_exp,
      coalesce((select sum(fr.amount) from public.funding_releases fr
        where fr.project_id = p_project_id
          and fr.release_date >= m.month_start and fr.release_date <= m.month_end), 0) as funding_inc,
      coalesce((select sum(e.amount) from public.expenses e
        where e.project_id = p_project_id
          and e.expense_date >= m.month_start and e.expense_date <= m.month_end), 0) as other_exp
    from months m
  ),
  with_balance as (
    select
      md.*,
      v_adjusted_balance + sum(md.funding_inc - md.scholarship_exp - md.other_exp) 
        over (order by md.month_start rows between unbounded preceding and current row) as running_balance
    from monthly_data md
  )
  select
    to_char(wb.month_start, 'Mon/YY') as month_label,
    wb.month_start,
    lag(wb.running_balance, 1, v_adjusted_balance) over (order by wb.month_start) as initial_balance,
    wb.scholarship_exp as scholarship_expense,
    wb.funding_inc as funding_income,
    wb.other_exp as other_expense,
    wb.running_balance as net_balance
  from with_balance wb
  order by wb.month_start;
end;
$$ language plpgsql stable security definer;


-- ============================================================
-- FUNÇÃO RPC: Cálculo mensal consolidado (vários projetos)
-- ============================================================
drop function if exists public.calc_general_dashboard(date, date);

create or replace function public.calc_general_dashboard(
  p_start_date date default null,
  p_end_date   date default null,
  p_balance_status text default 'unpaid_current'
)
returns table (
  month_label         text,
  month_start         date,
  total_initial       numeric,
  total_scholarships  numeric,
  total_funding       numeric,
  total_expenses      numeric,
  total_balance       numeric
) as $$
declare
  v_start date;
  v_end   date;
  v_total_adjusted_balance numeric := 0;
begin
  v_start := coalesce(p_start_date, date_trunc('month', now())::date);
  v_end   := coalesce(p_end_date, (date_trunc('year', now()) + interval '1 year' - interval '1 day')::date);

  -- Calcular o saldo inicial somado de todos os projetos contidos no dashboard
  select coalesce(sum(p.initial_balance + coalesce(p.yield_amount, 0)), 0)
  into v_total_adjusted_balance
  from public.projects p
  join public.dashboard_settings ds on ds.project_id = p.id
  where ds.include_in_general = true and p.active = true;

  if p_balance_status = 'paid_current' then
    v_total_adjusted_balance := v_total_adjusted_balance + coalesce((
      select sum(s.amount) from public.scholarships s
      where s.project_id in (select project_id from public.dashboard_settings where include_in_general = true)
        and s.status = 'active'
        and s.start_date <= (v_start + interval '1 month' - interval '1 day')::date
        and s.end_date >= v_start
    ), 0);
  elsif p_balance_status = 'unpaid_previous' then
    v_total_adjusted_balance := v_total_adjusted_balance - coalesce((
      select sum(s.amount) from public.scholarships s
      where s.project_id in (select project_id from public.dashboard_settings where include_in_general = true)
        and s.status = 'active'
        and s.start_date <= (v_start - interval '1 day')::date
        and s.end_date >= (v_start - interval '1 month')::date
    ), 0);
  end if;

  return query
  with included_projects as (
    select p.id from public.projects p
    join public.dashboard_settings ds on ds.project_id = p.id
    where ds.include_in_general = true and p.active = true
  ),
  months as (
    select ms.month_start, ms.month_end from public.generate_month_series(v_start, v_end) ms
  ),
  monthly_data as (
    select
      m.month_start, m.month_end,
      coalesce((select sum(s.amount) from public.scholarships s
        where s.project_id in (select id from included_projects) and s.status = 'active'
          and s.start_date <= m.month_end and s.end_date >= m.month_start), 0) as scholarship_exp,
      coalesce((select sum(fr.amount) from public.funding_releases fr
        where fr.project_id in (select id from included_projects)
          and fr.release_date >= m.month_start and fr.release_date <= m.month_end), 0) as funding_inc,
      coalesce((select sum(e.amount) from public.expenses e
        where e.project_id in (select id from included_projects)
          and e.expense_date >= m.month_start and e.expense_date <= m.month_end), 0) as other_exp
    from months m
  ),
  with_balance as (
    select md.*,
      v_total_adjusted_balance + sum(md.funding_inc - md.scholarship_exp - md.other_exp)
        over (order by md.month_start rows between unbounded preceding and current row) as running_balance
    from monthly_data md
  )
  select
    to_char(wb.month_start, 'Mon/YY'),
    wb.month_start,
    lag(wb.running_balance, 1, v_total_adjusted_balance) over (order by wb.month_start),
    wb.scholarship_exp, wb.funding_inc, wb.other_exp, wb.running_balance
  from with_balance wb
  order by wb.month_start;
end;
$$ language plpgsql stable security definer;

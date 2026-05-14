-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Migration 012
-- Correções: meses em pt-BR, batch alerts, stats RPCs
-- ============================================================

-- ============================================================
-- HELPER: Mês em português (substitui to_char 'Mon/YY')
-- Retorna "Mai/26" em vez de "May/26"
-- ============================================================

create or replace function public.fmt_month_pt(d date)
returns text as $$
  select
    case extract(month from d)
      when 1  then 'Jan'
      when 2  then 'Fev'
      when 3  then 'Mar'
      when 4  then 'Abr'
      when 5  then 'Mai'
      when 6  then 'Jun'
      when 7  then 'Jul'
      when 8  then 'Ago'
      when 9  then 'Set'
      when 10 then 'Out'
      when 11 then 'Nov'
      when 12 then 'Dez'
    end || '/' || to_char(d, 'YY');
$$ language sql immutable;

comment on function public.fmt_month_pt is
  'Retorna label de mês em português (ex: Mai/26). Substitui to_char com locale inglês.';


-- ============================================================
-- FUNÇÃO RPC: Cálculo mensal de saldo por projeto (com fmt_month_pt)
-- Drop+recreate da versão 008 para usar meses em pt-BR
-- ============================================================

drop function if exists public.calc_project_monthly(uuid, date, date, text);

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

  v_adjusted_balance := v_project.initial_balance + coalesce(v_project.yield_amount, 0);

  if p_balance_status = 'paid_current' then
    v_adjusted_balance := v_adjusted_balance + coalesce((
      select sum(s.amount) from public.scholarships s
      where s.project_id = p_project_id and s.status = 'active'
        and s.start_date <= (v_start + interval '1 month' - interval '1 day')::date
        and s.end_date >= v_start
    ), 0);
  elsif p_balance_status = 'unpaid_previous' then
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
    public.fmt_month_pt(wb.month_start) as month_label,
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
-- FUNÇÃO RPC: Dashboard consolidado (com fmt_month_pt)
-- Drop+recreate da versão 008
-- ============================================================

drop function if exists public.calc_general_dashboard(date, date, text);

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
    public.fmt_month_pt(wb.month_start),
    wb.month_start,
    lag(wb.running_balance, 1, v_total_adjusted_balance) over (order by wb.month_start),
    wb.scholarship_exp, wb.funding_inc, wb.other_exp, wb.running_balance
  from with_balance wb
  order by wb.month_start;
end;
$$ language plpgsql stable security definer;


-- ============================================================
-- FUNÇÃO RPC: Batch alerts para múltiplos projetos
-- Elimina N+1 no dashboard — uma chamada em vez de N
-- ============================================================

create or replace function public.get_alerts_for_projects(
  p_project_ids uuid[]
)
returns table (
  project_id   uuid,
  project_name text,
  alert_type   text,
  severity     text,
  message      text,
  details      text
) as $$
declare
  proj record;
begin
  for proj in
    select id, name from public.projects
    where id = any(p_project_ids) and active = true
  loop
    return query
    select
      proj.id,
      proj.name,
      a.alert_type,
      a.severity,
      a.message,
      a.details
    from public.get_project_alerts(proj.id) a;
  end loop;
end;
$$ language plpgsql stable security definer;

comment on function public.get_alerts_for_projects is
  'Retorna alertas de todos os projetos ativos em uma única chamada. Elimina N+1 no dashboard.';


-- ============================================================
-- FUNÇÃO RPC: Stats de desembolsos (funding)
-- Substitui query sem paginação no CrudPage
-- ============================================================

create or replace function public.funding_stats()
returns json as $$
  select json_build_object(
    'total', coalesce(sum(amount), 0),
    'count', count(*)
  ) from public.funding_releases;
$$ language sql stable security definer;

comment on function public.funding_stats is
  'Retorna {total, count} dos desembolsos. Usado pelo statsCards do CrudPage.';


-- ============================================================
-- FUNÇÃO RPC: Stats de gastos (expenses)
-- Substitui query sem paginação no CrudPage
-- ============================================================

create or replace function public.expenses_stats()
returns json as $$
  select json_build_object(
    'total', coalesce(sum(amount), 0),
    'count', count(*),
    'category_count', count(distinct case when category is not null and trim(category) != '' then category end)
  ) from public.expenses;
$$ language sql stable security definer;

comment on function public.expenses_stats is
  'Retorna {total, count, category_count} dos gastos. Usado pelo statsCards do CrudPage.';
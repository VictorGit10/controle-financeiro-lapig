-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Views e Funções de Cálculo
-- Migração 003: Lógica de negócio no banco
-- ============================================================
--
-- Essas views substituem as fórmulas SUMPRODUCT/SUMIFS da planilha.
-- A lógica de cálculo agora vive no banco, não em fórmulas frágeis.
-- ============================================================


-- ============================================================
-- EXTENSÃO: pg_trgm (busca por nome parcial)
-- Necessária para o índice GIN em scholarship_holders.full_name
-- ============================================================

create extension if not exists pg_trgm;


-- ============================================================
-- FUNÇÃO: gerar série de meses entre duas datas
-- Retorna uma tabela (month_start, month_end) para cada mês
-- ============================================================

create or replace function public.generate_month_series(
  p_start date,
  p_end date
)
returns table (
  month_start date,
  month_end   date
) as $$
begin
  return query
  select 
    d::date as month_start,
    (d + interval '1 month' - interval '1 day')::date as month_end
  from generate_series(
    date_trunc('month', p_start)::date,
    date_trunc('month', p_end)::date,
    interval '1 month'
  ) as d;
end;
$$ language plpgsql stable;

comment on function public.generate_month_series is 
  'Gera série de meses entre duas datas. Usado para cálculos mensais do dashboard.';


-- ============================================================
-- FUNÇÃO RPC: Cálculo mensal de saldo por projeto
-- Esta é a função principal que o frontend vai chamar.
-- Substitui toda a lógica de SUMPRODUCT da planilha.
-- ============================================================

create or replace function public.calc_project_monthly(
  p_project_id uuid,
  p_start_date date default null,
  p_end_date   date default null
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
begin
  -- Buscar dados do projeto
  select p.* into v_project
  from public.projects p
  where p.id = p_project_id;

  if not found then
    raise exception 'Projeto não encontrado: %', p_project_id;
  end if;

  -- Definir período de análise
  v_start := coalesce(p_start_date, v_project.start_date, date_trunc('year', now())::date);
  v_end   := coalesce(p_end_date, v_project.end_date, (date_trunc('year', now()) + interval '1 year' - interval '1 day')::date);

  return query
  with months as (
    select 
      ms.month_start,
      ms.month_end
    from public.generate_month_series(v_start, v_end) ms
  ),
  monthly_data as (
    select
      m.month_start,
      m.month_end,
      
      -- Bolsas ativas no mês (regra: início <= fim_do_mês AND fim >= início_do_mês)
      coalesce((
        select sum(s.amount)
        from public.scholarships s
        where s.project_id = p_project_id
          and s.status = 'active'
          and s.start_date <= m.month_end
          and s.end_date >= m.month_start
      ), 0) as scholarship_exp,
      
      -- Desembolsos no mês (por data pontual)
      coalesce((
        select sum(fr.amount)
        from public.funding_releases fr
        where fr.project_id = p_project_id
          and fr.release_date >= m.month_start
          and fr.release_date <= m.month_end
      ), 0) as funding_inc,
      
      -- Outros gastos no mês (por data pontual)
      coalesce((
        select sum(e.amount)
        from public.expenses e
        where e.project_id = p_project_id
          and e.expense_date >= m.month_start
          and e.expense_date <= m.month_end
      ), 0) as other_exp

    from months m
  ),
  with_balance as (
    select
      md.*,
      -- Saldo acumulado: saldo_inicial + sum(desembolsos - bolsas - gastos) até este mês
      v_project.initial_balance + coalesce(v_project.yield_amount, 0)
        + sum(md.funding_inc - md.scholarship_exp - md.other_exp) 
          over (order by md.month_start rows between unbounded preceding and current row)
      as running_balance
    from monthly_data md
  )
  select
    to_char(wb.month_start, 'Mon/YY') as month_label,
    wb.month_start,
    -- Saldo no início do mês = saldo acumulado até o mês anterior
    lag(wb.running_balance, 1, v_project.initial_balance + coalesce(v_project.yield_amount, 0))
      over (order by wb.month_start) as initial_balance,
    wb.scholarship_exp as scholarship_expense,
    wb.funding_inc as funding_income,
    wb.other_exp as other_expense,
    wb.running_balance as net_balance
  from with_balance wb
  order by wb.month_start;
end;
$$ language plpgsql stable security definer;

comment on function public.calc_project_monthly is 
  'Calcula saldo mensal de um projeto. Substitui os SUMPRODUCTs da planilha.
   Regras:
   - Bolsa entra no mês se start_date <= fim_do_mês AND end_date >= início_do_mês
   - Desembolsos e gastos entram pela data pontual
   - Saldo = saldo_anterior + desembolsos - bolsas - gastos';


-- ============================================================
-- FUNÇÃO RPC: Cálculo mensal consolidado (vários projetos)
-- Substitui a aba "Geral" da planilha
-- ============================================================

create or replace function public.calc_general_dashboard(
  p_start_date date default null,
  p_end_date   date default null
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
begin
  -- Período padrão: ano corrente
  v_start := coalesce(p_start_date, date_trunc('year', now())::date);
  v_end   := coalesce(p_end_date, (date_trunc('year', now()) + interval '1 year' - interval '1 day')::date);

  return query
  with included_projects as (
    select p.id, p.initial_balance, coalesce(p.yield_amount, 0) as yield_amount
    from public.projects p
    join public.dashboard_settings ds on ds.project_id = p.id
    where ds.include_in_general = true
      and p.active = true
  ),
  months as (
    select ms.month_start, ms.month_end
    from public.generate_month_series(v_start, v_end) ms
  ),
  monthly_data as (
    select
      m.month_start,
      m.month_end,
      
      coalesce((
        select sum(s.amount)
        from public.scholarships s
        where s.project_id in (select ip.id from included_projects ip)
          and s.status = 'active'
          and s.start_date <= m.month_end
          and s.end_date >= m.month_start
      ), 0) as scholarship_exp,
      
      coalesce((
        select sum(fr.amount)
        from public.funding_releases fr
        where fr.project_id in (select ip.id from included_projects ip)
          and fr.release_date >= m.month_start
          and fr.release_date <= m.month_end
      ), 0) as funding_inc,
      
      coalesce((
        select sum(e.amount)
        from public.expenses e
        where e.project_id in (select ip.id from included_projects ip)
          and e.expense_date >= m.month_start
          and e.expense_date <= m.month_end
      ), 0) as other_exp
    from months m
  ),
  totals as (
    select sum(ip.initial_balance + ip.yield_amount) as total_initial_balance
    from included_projects ip
  ),
  with_balance as (
    select
      md.*,
      t.total_initial_balance
        + sum(md.funding_inc - md.scholarship_exp - md.other_exp)
          over (order by md.month_start rows between unbounded preceding and current row)
      as running_balance
    from monthly_data md
    cross join totals t
  )
  select
    to_char(wb.month_start, 'Mon/YY'),
    wb.month_start,
    lag(wb.running_balance, 1, (select t.total_initial_balance from totals t))
      over (order by wb.month_start),
    wb.scholarship_exp,
    wb.funding_inc,
    wb.other_exp,
    wb.running_balance
  from with_balance wb
  order by wb.month_start;
end;
$$ language plpgsql stable security definer;

comment on function public.calc_general_dashboard is 
  'Dashboard consolidado — soma projetos marcados em dashboard_settings. Substitui aba Geral.';


-- ============================================================
-- FUNÇÃO RPC: Alertas do projeto
-- Substitui as regras de alerta da aba Projetos
-- ============================================================

create or replace function public.get_project_alerts(p_project_id uuid)
returns table (
  alert_type  text,
  severity    text,
  message     text,
  details     text
) as $$
declare
  v_project record;
begin
  select * into v_project from public.projects where id = p_project_id;
  
  if not found then
    return;
  end if;

  -- Alerta 1: Bolsa excedendo vigência do projeto
  return query
  select 
    'scholarship_exceeds_project'::text,
    'warning'::text,
    format('Bolsa de %s vai até %s, mas o projeto termina em %s', 
      sh.full_name, to_char(s.end_date, 'DD/MM/YYYY'), to_char(v_project.end_date, 'DD/MM/YYYY')),
    s.id::text
  from public.scholarships s
  join public.scholarship_holders sh on sh.id = s.holder_id
  where s.project_id = p_project_id
    and s.status = 'active'
    and v_project.end_date is not null
    and s.end_date > v_project.end_date;

  -- Alerta 2: Saldo negativo em algum mês
  return query
  select
    'negative_balance'::text,
    'danger'::text,
    format('Saldo fica negativo em %s: R$ %s', cm.month_label, to_char(cm.net_balance, 'FM999G999G999D00')),
    cm.month_start::text
  from public.calc_project_monthly(p_project_id) cm
  where cm.net_balance < 0
  limit 3;

  -- Alerta 3: Projeto sem vigência definida
  if v_project.end_date is null then
    return query
    select
      'no_end_date'::text,
      'info'::text,
      'Projeto sem data de vigência definida'::text,
      v_project.id::text;
  end if;

  -- Alerta 4: Gastos sem descrição
  return query
  select
    'expense_no_description'::text,
    'info'::text,
    format('Gasto de R$ %s em %s sem descrição', 
      to_char(e.amount, 'FM999G999G999D00'), to_char(e.expense_date, 'DD/MM/YYYY')),
    e.id::text
  from public.expenses e
  where e.project_id = p_project_id
    and (e.description is null or trim(e.description) = '')
  limit 5;
end;
$$ language plpgsql stable security definer;

comment on function public.get_project_alerts is 
  'Retorna alertas de inconsistência para um projeto (bolsa excedendo vigência, saldo negativo, etc.)';


-- ============================================================
-- VIEW: Resumo de bolsista (substitui Gráfico por Bolsista)
-- ============================================================

create or replace view public.v_scholarship_timeline as
select
  sh.id as holder_id,
  sh.full_name,
  s.id as scholarship_id,
  p.name as project_name,
  s.amount,
  s.start_date,
  s.end_date,
  s.status,
  -- Quantidade de meses ativos
  extract(year from age(s.end_date, s.start_date)) * 12 
    + extract(month from age(s.end_date, s.start_date)) + 1 as total_months,
  -- Valor total estimado
  s.amount * (
    extract(year from age(s.end_date, s.start_date)) * 12 
    + extract(month from age(s.end_date, s.start_date)) + 1
  ) as estimated_total
from public.scholarships s
join public.scholarship_holders sh on sh.id = s.holder_id
join public.projects p on p.id = s.project_id
order by sh.full_name, s.start_date;

comment on view public.v_scholarship_timeline is 
  'Timeline de bolsas por bolsista. Substitui aba Gráfico por Bolsista.';


-- ============================================================
-- VIEW: Resumo por projeto (útil para listagens)
-- ============================================================

create or replace view public.v_project_summary as
select
  p.id,
  p.name,
  p.start_date,
  p.end_date,
  p.initial_balance,
  p.yield_amount,
  p.active,
  coalesce(ds.include_in_general, false) as in_general_dashboard,
  
  -- Total de bolsas ativas
  (select count(*) from public.scholarships s 
   where s.project_id = p.id and s.status = 'active') as active_scholarships,
  
  -- Soma mensal das bolsas ativas hoje
  coalesce((
    select sum(s.amount) from public.scholarships s
    where s.project_id = p.id 
      and s.status = 'active'
      and s.start_date <= current_date
      and s.end_date >= current_date
  ), 0) as current_monthly_scholarships,
  
  -- Total de desembolsos recebidos
  coalesce((
    select sum(fr.amount) from public.funding_releases fr
    where fr.project_id = p.id
  ), 0) as total_funding,
  
  -- Total de outros gastos
  coalesce((
    select sum(e.amount) from public.expenses e
    where e.project_id = p.id
  ), 0) as total_expenses

from public.projects p
left join public.dashboard_settings ds on ds.project_id = p.id
order by p.active desc, p.name;

comment on view public.v_project_summary is 
  'Resumo consolidado de cada projeto com totais calculados.';

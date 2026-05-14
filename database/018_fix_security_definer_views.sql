-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Migração 018
-- Corrige aviso de segurança: views com SECURITY DEFINER
-- ============================================================
--
-- O Supabase sinaliza como erro views que herdam SECURITY DEFINER
-- da sessão de criação (superusuário postgres). A correção é
-- recriar cada view com SECURITY INVOKER, garantindo que a view
-- execute com as permissões de quem faz a consulta — o
-- comportamento esperado quando RLS está ativado.
--
-- Referência: https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view
-- ============================================================


-- ============================================================
-- 1. v_scholarship_timeline
-- ============================================================

drop view if exists public.v_scholarship_timeline;

create view public.v_scholarship_timeline
  with (security_invoker = true)
as
select
  sh.id as holder_id,
  sh.full_name,
  s.id as scholarship_id,
  coalesce(p.name, 'Externa: ' || s.funding_source) as project_name,
  s.amount,
  s.start_date,
  s.end_date,
  s.status,
  extract(year from age(s.end_date, s.start_date)) * 12
    + extract(month from age(s.end_date, s.start_date)) + 1 as total_months,
  s.amount * (
    extract(year from age(s.end_date, s.start_date)) * 12
    + extract(month from age(s.end_date, s.start_date)) + 1
  ) as estimated_total
from public.scholarships s
join public.scholarship_holders sh on sh.id = s.holder_id
left join public.projects p on p.id = s.project_id
order by sh.full_name, s.start_date;

comment on view public.v_scholarship_timeline is
  'Timeline de bolsas por bolsista. Substitui aba Gráfico por Bolsista.';


-- ============================================================
-- 2. v_project_summary
-- ============================================================

drop view if exists public.v_project_summary;

create view public.v_project_summary
  with (security_invoker = true)
as
select
  p.id,
  p.name,
  p.start_date,
  p.end_date,
  p.initial_balance,
  p.yield_amount,
  p.balance_date,
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

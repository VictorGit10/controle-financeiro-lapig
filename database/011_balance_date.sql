-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Migração 010
-- Adiciona coluna balance_date na tabela projects
-- e atualiza a view v_project_summary para incluí-la
-- ============================================================

-- 1. Adicionar coluna de data do saldo
alter table public.projects
  add column balance_date date;

comment on column public.projects.balance_date is
  'Data em que o saldo (initial_balance + yield_amount) foi informado pela FUNAPE';

-- 2. Recriar view incluindo balance_date
-- Deve dropar e recriar porque CREATE OR REPLACE VIEW não permite
-- inserir coluna no meio da lista de seleção
drop view if exists public.v_project_summary;

create view public.v_project_summary as
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
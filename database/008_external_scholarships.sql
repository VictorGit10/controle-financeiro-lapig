-- ============================================================
-- Migração 007: Bolsas externas (sem projeto)
-- Permite que scholarships tenham project_id NULL (bolsas de
-- fontes externas como CIAMB) e adiciona funding_source
-- ============================================================

-- Tornar project_id nullable
alter table public.scholarships
  alter column project_id drop not null;

-- Adicionar coluna de fonte de financiamento
alter table public.scholarships
  add column if not exists funding_source text;

comment on column public.scholarships.funding_source is
  'Fonte de financiamento externo (ex: CIAMB). Preenchido apenas quando project_id é NULL.';

-- Atualizar view v_scholarship_timeline para suportar bolsas sem projeto
create or replace view public.v_scholarship_timeline as
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

-- Atualizar view v_project_summary (não muda, já filtra por project_id)
-- Mas scholarships sem projeto não aparecem aqui, que é o comportamento correto
-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Schema Supabase
-- Migração 001: Estrutura base
-- ============================================================

-- Extensão para busca por nome parcial (usado no índice de bolsistas)
create extension if not exists pg_trgm;

-- ============================================================
-- 1. TABELA: projects (Nomenclaturas)
-- Cadastro mestre dos projetos
-- ============================================================

create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  code        text,
  start_date  date,
  end_date    date,
  initial_balance  numeric(14,2) not null default 0,
  yield_amount     numeric(14,2) default 0,
  report_dates     text,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.projects is 'Cadastro mestre dos projetos (antigo aba Nomenclaturas)';
comment on column public.projects.initial_balance is 'Saldo em conta / saldo inicial do projeto';
comment on column public.projects.yield_amount is 'Rendimentos acumulados';
comment on column public.projects.report_dates is 'Datas dos relatórios (texto livre)';


-- ============================================================
-- 2. TABELA: scholarship_holders (Bolsistas — pessoas)
-- Cadastro das pessoas que recebem bolsas
-- ============================================================

create table public.scholarship_holders (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  email       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.scholarship_holders is 'Cadastro de pessoas que recebem bolsas';

-- Índice para busca por nome (parcial, case insensitive)
create index idx_holders_name on public.scholarship_holders 
  using gin (full_name gin_trgm_ops);


-- ============================================================
-- 3. TABELA: scholarships (Bolsas — Tabela bolsistas)
-- Cada bolsa ativa ou histórica vinculada a pessoa + projeto
-- ============================================================

create table public.scholarships (
  id              uuid primary key default gen_random_uuid(),
  holder_id       uuid not null references public.scholarship_holders(id) on delete restrict,
  project_id      uuid not null references public.projects(id) on delete restrict,
  amount          numeric(14,2) not null,
  start_date      date not null,
  end_date        date not null,
  status          text not null default 'active' 
                    check (status in ('active', 'ended', 'cancelled')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.scholarships is 'Bolsas vinculadas a bolsista + projeto (antigo Tabela bolsistas)';
comment on column public.scholarships.amount is 'Valor mensal da bolsa';
comment on column public.scholarships.status is 'active = em vigor, ended = encerrada, cancelled = cancelada';

-- Índices para cálculos de vigência mensal
create index idx_scholarships_project on public.scholarships(project_id);
create index idx_scholarships_holder on public.scholarships(holder_id);
create index idx_scholarships_dates on public.scholarships(start_date, end_date);


-- ============================================================
-- 4. TABELA: funding_releases (Desembolsos — Tabela desembolso)
-- Entradas de recurso por projeto
-- ============================================================

create table public.funding_releases (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete restrict,
  description     text not null,
  release_date    date not null,
  amount          numeric(14,2) not null,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.funding_releases is 'Entradas de recurso / desembolsos (antigo Tabela desembolso)';

create index idx_releases_project on public.funding_releases(project_id);
create index idx_releases_date on public.funding_releases(release_date);


-- ============================================================
-- 5. TABELA: expenses (Outros gastos — Tabela outros gastos)
-- Despesas não relacionadas a bolsas
-- ============================================================

create table public.expenses (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete restrict,
  description     text not null,
  expense_date    date not null,
  amount          numeric(14,2) not null,
  category        text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.expenses is 'Outros gastos por projeto (antigo Tabela outros gastos)';

create index idx_expenses_project on public.expenses(project_id);
create index idx_expenses_date on public.expenses(expense_date);


-- ============================================================
-- 6. TABELA: dashboard_settings (Tabela recursos)
-- Controla quais projetos aparecem no dashboard geral
-- ============================================================

create table public.dashboard_settings (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null unique references public.projects(id) on delete cascade,
  include_in_general  boolean not null default false
);

comment on table public.dashboard_settings is 'Controle de quais projetos entram no dashboard consolidado (antigo Tabela recursos)';


-- ============================================================
-- 7. TRIGGER: atualizar updated_at automaticamente
-- ============================================================

create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_projects_updated_at
  before update on public.projects
  for each row execute function public.update_updated_at();

create trigger trg_holders_updated_at
  before update on public.scholarship_holders
  for each row execute function public.update_updated_at();

create trigger trg_scholarships_updated_at
  before update on public.scholarships
  for each row execute function public.update_updated_at();

create trigger trg_releases_updated_at
  before update on public.funding_releases
  for each row execute function public.update_updated_at();

create trigger trg_expenses_updated_at
  before update on public.expenses
  for each row execute function public.update_updated_at();

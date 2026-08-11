-- Stub mínimo para validar 038 + 039 num Postgres descartável.
-- NÃO faz parte do projeto: só recria o suficiente do schema real
-- para que as duas migrações criem e EXECUTEM.

-- roles são do cluster, não do banco: idempotente para permitir
-- reaplicar o stub num banco novo do mesmo container.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text,
  start_date date,
  end_date date,
  active boolean not null default true
);

create table public.scholarship_holders (
  id uuid primary key default gen_random_uuid(),
  full_name text not null
);

create table public.scholarships (
  id uuid primary key default gen_random_uuid(),
  holder_id uuid not null references public.scholarship_holders(id),
  project_id uuid not null references public.projects(id),
  amount numeric(14,2) not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'active'
);

create table public.rubricas (
  code text primary key,
  parent_code text references public.rubricas(code),
  name text not null,
  ordem integer not null default 0
);

create table public.planos_trabalho (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  ativo boolean not null default false
);

create table public.plano_rubricas (
  id uuid primary key default gen_random_uuid(),
  plano_id uuid not null references public.planos_trabalho(id),
  rubrica_code text not null references public.rubricas(code),
  valor_previsto numeric(14,2) not null default 0
);

create table public.plano_desembolsos (
  id uuid primary key default gen_random_uuid(),
  plano_id uuid not null references public.planos_trabalho(id),
  parcela integer not null,
  data_prevista date,
  valor numeric(14,2)
);

create table public.balancetes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  data_referencia date not null,
  saldo_disponivel numeric(14,2),
  rendimento_liquido numeric(14,2)
);

create table public.balancete_lancamentos (
  id uuid primary key default gen_random_uuid(),
  balancete_id uuid not null references public.balancetes(id),
  rubrica_code text references public.rubricas(code),
  saldo_atual numeric(14,2) not null default 0
);

-- helpers reais (003 / 033)
create or replace function public.generate_month_series(p_start date, p_end date)
returns table (month_start date, month_end date)
language plpgsql stable set search_path = public, pg_temp as $$
begin
  return query
  select d::date, (d + interval '1 month' - interval '1 day')::date
    from generate_series(date_trunc('month', p_start)::date,
                         date_trunc('month', p_end)::date,
                         interval '1 month') as d;
end; $$;

create or replace function public.is_admin() returns boolean
language sql stable set search_path = public, pg_temp as $$ select true $$;

create or replace function public.allowed_project_ids() returns uuid[]
language sql stable set search_path = public, pg_temp as $$ select '{}'::uuid[] $$;

create or replace function public.assert_project_allowed(p_project_id uuid) returns void
language plpgsql set search_path = public, pg_temp as $$ begin return; end; $$;

insert into public.rubricas (code, parent_code, name, ordem) values
  ('a',null,'Pessoal',10),
  ('a.colab','a','Colaboradores eventuais',11),
  ('a.enc','a','Encargos s/ CLT',12),
  ('a.cons','a','Consultorias',13),
  ('a.estag','a','Estagiários',14),
  ('a.bolsas','a','Bolsas',15),
  ('a.outros','a','Outros encargos',16),
  ('b',null,'Serviços de Terceiros PJ',20),
  ('c',null,'Passagens',30),
  ('d',null,'Diárias',40),
  ('e',null,'Material de Consumo',50),
  ('f',null,'Investimento',60),
  ('g',null,'Ganho econômico',70),
  ('cip_ufg',null,'CIP UFG',80),
  ('cip_ua',null,'CIP UA',81),
  ('dao',null,'DAO',90);

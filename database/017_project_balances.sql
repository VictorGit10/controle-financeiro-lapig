-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Migração 017
-- Tabela de histórico mensal de saldos (project_balances)
-- + trigger de sincronização com projects
-- + RPCs upsert_project_balance e get_balances_for_month
-- + atualização do save_project (remove campos de saldo)
-- ============================================================
-- Os saldos deixam de ser colunas únicas em projects e passam
-- a ter uma linha por projeto/mês, permitindo histórico e
-- futura automação (recebimento de saldos por e-mail).
-- As colunas initial_balance/yield_amount/balance_date em
-- projects são mantidas como cache denormalizado do saldo
-- mais recente, sincronizado por trigger.

-- 1. Criar tabela project_balances
create table public.project_balances (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  reference_month integer not null check (reference_month between 1 and 12),
  reference_year  integer not null check (reference_year >= 2000),
  initial_balance numeric(14,2) not null default 0,
  yield_amount    numeric(14,2) not null default 0,
  balance_date    date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint uq_project_balance_month unique (project_id, reference_month, reference_year),
  constraint chk_balance_date_matches_month check (
    balance_date is null
    or (extract(month from balance_date) = reference_month
        and extract(year from balance_date) = reference_year)
  )
);

comment on table public.project_balances is
  'Histórico mensal de saldos por projeto. Um registro por projeto por mês.';
comment on column public.project_balances.reference_month is
  'Mês de referência (1-12). Junto com reference_year, identifica unicamente o registro.';
comment on column public.project_balances.reference_year is
  'Ano de referência (>= 2000).';
comment on column public.project_balances.initial_balance is
  'Saldo em conta informado pela FUNAPE para este mês de referência.';
comment on column public.project_balances.yield_amount is
  'Rendimentos acumulados informados para este mês de referência.';
comment on column public.project_balances.balance_date is
  'Data em que o saldo foi informado. Deve corresponder ao mês/ano de referência.';

-- 2. Índices
create index idx_balances_project on public.project_balances(project_id);
create index idx_balances_period on public.project_balances(reference_year, reference_month);

-- 3. RLS
alter table public.project_balances enable row level security;

create policy "Autenticado lê saldos"
  on public.project_balances for select
  to authenticated using (true);

create policy "Autenticado insere saldos"
  on public.project_balances for insert
  to authenticated with check (true);

create policy "Autenticado edita saldos"
  on public.project_balances for update
  to authenticated using (true) with check (true);

create policy "Autenticado exclui saldos"
  on public.project_balances for delete
  to authenticated using (true);

-- 4. Trigger updated_at
create trigger trg_balances_updated_at
  before update on public.project_balances
  for each row execute function public.update_updated_at();

-- 5. Migrar dados existentes de projects → project_balances
insert into public.project_balances
  (project_id, reference_month, reference_year, initial_balance, yield_amount, balance_date)
select
  p.id,
  extract(month from coalesce(p.balance_date, current_date))::integer,
  extract(year from coalesce(p.balance_date, current_date))::integer,
  p.initial_balance,
  coalesce(p.yield_amount, 0),
  p.balance_date
from public.projects p
where p.initial_balance != 0 or p.yield_amount != 0 or p.balance_date is not null;

-- 6. Trigger de sincronização: project_balances → projects
-- Quando um saldo é inserido ou atualizado, o projects reflete
-- o saldo mais recente (maior reference_year, reference_month).
create or replace function public.sync_project_balance()
returns trigger as $$
begin
  update public.projects
  set
    initial_balance = (
      select pb.initial_balance
      from public.project_balances pb
      where pb.project_id = new.project_id
      order by pb.reference_year desc, pb.reference_month desc
      limit 1
    ),
    yield_amount = (
      select pb.yield_amount
      from public.project_balances pb
      where pb.project_id = new.project_id
      order by pb.reference_year desc, pb.reference_month desc
      limit 1
    ),
    balance_date = (
      select pb.balance_date
      from public.project_balances pb
      where pb.project_id = new.project_id
      order by pb.reference_year desc, pb.reference_month desc
      limit 1
    )
  where id = new.project_id;
  return new;
end;
$$ language plpgsql security definer;

comment on function public.sync_project_balance is
  'Sincroniza as colunas de saldo em projects com o registro mais recente de project_balances.';

create trigger trg_sync_project_balance
  after insert or update on public.project_balances
  for each row execute function public.sync_project_balance();

-- 7. RPC: upsert_project_balance (para uso manual e futura automação)
create or replace function public.upsert_project_balance(
  p_project_id      uuid,
  p_reference_month integer,
  p_reference_year  integer,
  p_initial_balance numeric default 0,
  p_yield_amount    numeric default 0,
  p_balance_date    date default null,
  p_notes           text default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_id uuid;
begin
  insert into public.project_balances
    (project_id, reference_month, reference_year, initial_balance, yield_amount, balance_date, notes)
  values
    (p_project_id, p_reference_month, p_reference_year, p_initial_balance, p_yield_amount, p_balance_date, p_notes)
  on conflict (project_id, reference_month, reference_year)
  do update set
    initial_balance = p_initial_balance,
    yield_amount    = p_yield_amount,
    balance_date    = p_balance_date,
    notes           = coalesce(p_notes, project_balances.notes),
    updated_at      = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.upsert_project_balance is
  'Insere ou atualiza o saldo de um projeto para um mês/ano de referência. Retorna o ID do registro.';

-- 8. RPC: get_balances_for_month (usado pela aba Saldos)
create or replace function public.get_balances_for_month(
  p_month integer,
  p_year  integer
)
returns table (
  id              uuid,
  project_id      uuid,
  project_name    text,
  project_active  boolean,
  reference_month integer,
  reference_year  integer,
  initial_balance numeric,
  yield_amount    numeric,
  balance_date    date,
  notes           text,
  created_at      timestamptz,
  updated_at      timestamptz
)
language plpgsql
security definer
as $$
begin
  return query
  select
    pb.id,
    pb.project_id,
    p.name as project_name,
    p.active as project_active,
    pb.reference_month,
    pb.reference_year,
    pb.initial_balance,
    pb.yield_amount,
    pb.balance_date,
    pb.notes,
    pb.created_at,
    pb.updated_at
  from public.projects p
  left join public.project_balances pb
    on pb.project_id = p.id
    and pb.reference_month = p_month
    and pb.reference_year = p_year
  order by p.active desc, p.name;
end;
$$;

comment on function public.get_balances_for_month is
  'Retorna todos os projetos com seus saldos para o mês/ano selecionado. Projetos sem saldo aparecem com campos null.';

-- 9. Atualizar save_project: remover campos de saldo
-- Os saldos agora são gerenciados exclusivamente via project_balances.
-- Drop the old function first (different signature) to avoid ambiguity.
drop function if exists public.save_project(
  text, uuid, text, date, date, numeric, numeric, date, text, text, boolean, boolean
);

create or replace function public.save_project(
  p_name                text,
  p_id                  uuid default null,
  p_code                text default null,
  p_start_date          date default null,
  p_end_date            date default null,
  p_report_dates        text default null,
  p_notes               text default null,
  p_active              boolean default true,
  p_include_in_general  boolean default false
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_project_id uuid;
begin
  if p_id is not null then
    update public.projects
    set
      name            = p_name,
      code            = p_code,
      start_date      = p_start_date,
      end_date        = p_end_date,
      report_dates    = p_report_dates,
      notes           = p_notes,
      active          = p_active
    where id = p_id
    returning id into v_project_id;

    if not found then
      raise exception 'Projeto não encontrado: %', p_id;
    end if;

    insert into public.dashboard_settings (project_id, include_in_general)
    values (v_project_id, p_include_in_general)
    on conflict (project_id) do update
      set include_in_general = p_include_in_general;

  else
    insert into public.projects (
      name, code, start_date, end_date,
      report_dates, notes, active
    ) values (
      p_name, p_code, p_start_date, p_end_date,
      p_report_dates, p_notes, p_active
    ) returning id into v_project_id;

    insert into public.dashboard_settings (project_id, include_in_general)
    values (v_project_id, p_include_in_general);
  end if;

  return v_project_id;
end;
$$;

comment on function public.save_project is
  'Cria ou atualiza um projeto e seu dashboard_settings em uma única transação. Saldos são gerenciados via project_balances.';
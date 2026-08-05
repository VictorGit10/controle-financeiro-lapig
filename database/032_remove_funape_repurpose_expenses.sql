-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Migração 032
-- Remover a distinção FUNAPE/não-FUNAPE + converter Gastos em Observações
-- ============================================================
-- Correção conceitual aprovada pelo usuário:
--   1. TODO projeto é da FUNAPE — a execução vem do balancete mensal
--      para todos. A flag projects.funape_managed deixa de existir,
--      assim como o trigger que bloqueava inserts em `expenses`.
--   2. A antiga "provisão temporária de gastos" (tabela `expenses`)
--      virou um registro leve de observações/monitoramento por projeto
--      (data + texto livre, sem valor/categoria). Nova tabela
--      `monitoramento` substitui `expenses`.
--
-- DESTRUTIVO para `expenses`: antes de dropar, o histórico textual
-- (description + notes) é copiado para `monitoramento`. Valor e
-- categoria são descartados (a execução financeira vem do balancete).
-- ============================================================

-- ============================================================
-- 1. TABELA: monitoramento (observações por projeto)
-- ============================================================

create table if not exists public.monitoramento (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete restrict,
  note_date    date not null,
  observacao   text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.monitoramento is
  'Observações/monitoramento por projeto (data + texto livre). Substitui a antiga provisão temporária de gastos (tabela expenses).';
comment on column public.monitoramento.note_date is
  'Data da observação. Não há valor: a execução financeira vem do balancete da FUNAPE.';
comment on column public.monitoramento.observacao is
  'Texto livre discriminando um acontecimento pontual (ex.: compra de equipamento entre dois saldos). Exclusão manual quando não for mais relevante.';

create index if not exists idx_monitoramento_project on public.monitoramento(project_id);
create index if not exists idx_monitoramento_date   on public.monitoramento(note_date desc);

-- Trigger updated_at (mesmo padrão da migração 025)
drop trigger if exists trg_monitoramento_updated_at on public.monitoramento;
create trigger trg_monitoramento_updated_at
  before update on public.monitoramento
  for each row execute function public.update_updated_at();

-- Auditoria (mesmo padrão da migração 023)
drop trigger if exists audit_monitoramento_trigger on public.monitoramento;
create trigger audit_monitoramento_trigger
  after insert or update or delete on public.monitoramento
  for each row execute function public.audit_trigger_function();


-- ============================================================
-- 2. RLS — autenticado tem acesso total
-- ============================================================

alter table public.monitoramento enable row level security;

drop policy if exists "Autenticado lê monitoramento"     on public.monitoramento;
drop policy if exists "Autenticado insere monitoramento" on public.monitoramento;
drop policy if exists "Autenticado edita monitoramento"  on public.monitoramento;
drop policy if exists "Autenticado exclui monitoramento" on public.monitoramento;

create policy "Autenticado lê monitoramento"     on public.monitoramento for select to authenticated using (true);
create policy "Autenticado insere monitoramento" on public.monitoramento for insert to authenticated with check (true);
create policy "Autenticado edita monitoramento"  on public.monitoramento for update to authenticated using (true) with check (true);
create policy "Autenticado exclui monitoramento" on public.monitoramento for delete to authenticated using (true);


-- ============================================================
-- 3. Migrar histórico textual de expenses → monitoramento
-- ============================================================
-- Valor e categoria são descartados. Mantém description (+ notes)
-- como texto da observação e expense_date como note_date.

-- Guardado em DO para ser seguro em re-execuções (se expenses já foi dropada, vira no-op).
do $$
begin
  if to_regclass('public.expenses') is not null then
    insert into public.monitoramento (project_id, note_date, observacao)
    select e.project_id,
           e.expense_date,
           e.description
             || coalesce(
                  case when nullif(trim(e.notes), '') is not null
                       then ' — ' || e.notes
                  end, '')
      from public.expenses e;
  end if;
end$$;


-- ============================================================
-- 4. Dropar consumidores de `expenses` (antes de dropar a tabela)
-- ============================================================

-- 4.1 Stats RPC (consumido só pela antiga página de Gastos)
drop function if exists public.expenses_stats();

-- 4.2 v_project_summary sem total_expenses (nenhum consumidor no frontend)
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
  ), 0) as total_funding

from public.projects p
left join public.dashboard_settings ds on ds.project_id = p.id
order by p.active desc, p.name;

comment on view public.v_project_summary is
  'Resumo consolidado de cada projeto com totais calculados.';


-- 4.3 calc_project_monthly sem other_expense (drop+recreate pela mudança de return type)
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
          and fr.release_date >= m.month_start and fr.release_date <= m.month_end), 0) as funding_inc
    from months m
  ),
  with_balance as (
    select
      md.*,
      v_adjusted_balance + sum(md.funding_inc - md.scholarship_exp)
        over (order by md.month_start rows between unbounded preceding and current row) as running_balance
    from monthly_data md
  )
  select
    public.fmt_month_pt(wb.month_start) as month_label,
    wb.month_start,
    lag(wb.running_balance, 1, v_adjusted_balance) over (order by wb.month_start) as initial_balance,
    wb.scholarship_exp as scholarship_expense,
    wb.funding_inc as funding_income,
    wb.running_balance as net_balance
  from with_balance wb
  order by wb.month_start;
end;
$$ language plpgsql stable security definer;


-- 4.4 calc_general_dashboard sem total_expenses
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
          and fr.release_date >= m.month_start and fr.release_date <= m.month_end), 0) as funding_inc
    from months m
  ),
  with_balance as (
    select md.*,
      v_total_adjusted_balance + sum(md.funding_inc - md.scholarship_exp)
        over (order by md.month_start rows between unbounded preceding and current row) as running_balance
    from monthly_data md
  )
  select
    public.fmt_month_pt(wb.month_start),
    wb.month_start,
    lag(wb.running_balance, 1, v_total_adjusted_balance) over (order by wb.month_start),
    wb.scholarship_exp, wb.funding_inc, wb.running_balance
  from with_balance wb
  order by wb.month_start;
end;
$$ language plpgsql stable security definer;


-- 4.5 calc_projects_batch sem other_expense (espelha calc_project_monthly via LATERAL)
drop function if exists public.calc_projects_batch(uuid[], date, text);

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
    sub.net_balance
  from (
    select
      p.id as project_id,
      calc.month_label,
      calc.month_start,
      calc.initial_balance,
      calc.scholarship_expense,
      calc.funding_income,
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


-- 4.5 get_project_alerts sem o alerta de gastos sem descrição
-- A versão da 003 consulta public.expenses no alerta
-- 'expense_no_description'. Sem recriar a função, ela — e
-- get_alerts_for_projects (013), que a chama — quebraria em runtime
-- após o drop da tabela (o frontend chama as duas: projetos.js e o
-- sino de alertas do Dashboard). Mantém os alertas 1–3 e preserva o
-- hardening da 019 (security invoker + search_path).

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
end;
$$ language plpgsql stable security invoker set search_path = public, pg_temp;

comment on function public.get_project_alerts is
  'Retorna alertas de inconsistência para um projeto (bolsa excedendo vigência, saldo negativo, sem vigência). O alerta de gasto sem descrição caiu junto com a tabela expenses (032).';


-- ============================================================
-- 5. Dropar a tabela expenses (triggers/índices/FK/RLS vão juntos)
-- ============================================================

drop table if exists public.expenses cascade;

-- A trigger trg_block_expenses_funape caiu com a tabela; agora a função pode
-- ser dropada sem dependência.
drop function if exists public.block_expenses_for_funape();


-- ============================================================
-- 6. Remover a flag funape_managed de projects
-- ============================================================

alter table public.projects drop column if exists funape_managed;


-- ============================================================
-- 7. save_project sem p_funape_managed
-- ============================================================
-- Recria a assinatura 9-arg (anterior à 025), sem a flag.

drop function if exists public.save_project(
  text, uuid, text, date, date, text, text, boolean, boolean, boolean
);

create or replace function public.save_project(
  p_name                text,
  p_id                  uuid    default null,
  p_code                text    default null,
  p_start_date          date    default null,
  p_end_date            date    default null,
  p_report_dates        text    default null,
  p_notes               text    default null,
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
       set name            = p_name,
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
  'Cria ou atualiza um projeto e seu dashboard_settings em uma única transação.';


-- ============================================================
-- 8. Stats RPC para a página de Observações
-- ============================================================

create or replace function public.monitoramento_stats()
returns json as $$
  select json_build_object('count', count(*))
    from public.monitoramento;
$$ language sql stable security definer;

comment on function public.monitoramento_stats is
  'Contagem de observações registradas (página Observações).';
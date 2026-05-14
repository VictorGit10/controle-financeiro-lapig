-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — RPC transacional
-- Migração 016: save_project — atomicidade projeto + dashboard_settings
-- ============================================================
-- Substitui as 2-3 chamadas separadas no frontend por uma única
-- transação, evitando dados inconsistentes se uma delas falhar.

create or replace function public.save_project(
  p_name            text,
  p_id              uuid default null,
  p_code            text default null,
  p_start_date      date default null,
  p_end_date        date default null,
  p_initial_balance numeric default 0,
  p_yield_amount    numeric default 0,
  p_balance_date    date default null,
  p_report_dates    text default null,
  p_notes           text default null,
  p_active          boolean default true,
  p_include_in_general boolean default false
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_project_id uuid;
begin
  -- Update existing project
  if p_id is not null then
    update public.projects
    set
      name            = p_name,
      code            = p_code,
      start_date      = p_start_date,
      end_date        = p_end_date,
      initial_balance = p_initial_balance,
      yield_amount    = p_yield_amount,
      balance_date    = p_balance_date,
      report_dates    = p_report_dates,
      notes           = p_notes,
      active          = p_active
    where id = p_id
    returning id into v_project_id;

    if not found then
      raise exception 'Projeto não encontrado: %', p_id;
    end if;

    -- Upsert dashboard_settings
    insert into public.dashboard_settings (project_id, include_in_general)
    values (v_project_id, p_include_in_general)
    on conflict (project_id) do update
      set include_in_general = p_include_in_general;

  -- Insert new project
  else
    insert into public.projects (
      name, code, start_date, end_date,
      initial_balance, yield_amount,
      balance_date, report_dates, notes, active
    ) values (
      p_name, p_code, p_start_date, p_end_date,
      p_initial_balance, p_yield_amount,
      p_balance_date, p_report_dates, p_notes, p_active
    ) returning id into v_project_id;

    insert into public.dashboard_settings (project_id, include_in_general)
    values (v_project_id, p_include_in_general);
  end if;

  return v_project_id;
end;
$$;

comment on function public.save_project is
  'Cria ou atualiza um projeto e seu dashboard_settings em uma única transação.';
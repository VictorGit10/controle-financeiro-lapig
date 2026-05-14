-- ============================================================
-- Migração 022: Auditoria Geral com Triggers
-- ============================================================
-- Cria uma tabela centralizada de logs de auditoria e triggers
-- para as tabelas principais (projects, scholarships, etc).
-- Substitui a auditoria parcial anterior.
-- ============================================================

-- 1. Cria a tabela de log de auditoria
create table if not exists public.audit_logs (
    id uuid primary key default gen_random_uuid(),
    table_name text not null,
    record_id uuid not null,
    action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
    old_data jsonb,
    new_data jsonb,
    performed_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

comment on table public.audit_logs is 'Log centralizado de auditoria gerado por triggers no banco de dados.';

-- 2. RLS para a tabela
alter table public.audit_logs enable row level security;

drop policy if exists "Admins can read audit_logs" on public.audit_logs;
create policy "Admins can read audit_logs" on public.audit_logs
  for select using (auth.role() = 'authenticated');

-- Não precisa de política de INSERT, pois a inserção é feita via trigger 
-- usando SECURITY DEFINER (com privilégios elevados do sistema).

-- 3. Índices para facilitar buscas
create index if not exists idx_audit_logs_table on public.audit_logs(table_name);
create index if not exists idx_audit_logs_record on public.audit_logs(record_id);
create index if not exists idx_audit_logs_date on public.audit_logs(created_at desc);

-- 4. Função genérica de trigger
create or replace function public.audit_trigger_function()
returns trigger
security definer
set search_path = public
as $$
declare
  old_row jsonb := null;
  new_row jsonb := null;
  rec_id uuid;
begin
  if (TG_OP = 'UPDATE') then
    old_row := to_jsonb(OLD);
    new_row := to_jsonb(NEW);
    rec_id := NEW.id;
  elsif (TG_OP = 'DELETE') then
    old_row := to_jsonb(OLD);
    rec_id := OLD.id;
  elsif (TG_OP = 'INSERT') then
    new_row := to_jsonb(NEW);
    rec_id := NEW.id;
  end if;

  insert into public.audit_logs (
    table_name,
    record_id,
    action,
    old_data,
    new_data,
    performed_by
  ) values (
    TG_TABLE_NAME::text,
    rec_id,
    TG_OP,
    old_row,
    new_row,
    auth.uid()
  );

  if (TG_OP = 'DELETE') then
    return OLD;
  end if;
  return NEW;
end;
$$ language plpgsql;

-- 5. Aplica a trigger nas tabelas principais
-- projects
drop trigger if exists audit_projects_trigger on public.projects;
create trigger audit_projects_trigger
  after insert or update or delete on public.projects
  for each row execute function public.audit_trigger_function();

-- scholarship_holders
drop trigger if exists audit_holders_trigger on public.scholarship_holders;
create trigger audit_holders_trigger
  after insert or update or delete on public.scholarship_holders
  for each row execute function public.audit_trigger_function();

-- scholarships
drop trigger if exists audit_scholarships_trigger on public.scholarships;
create trigger audit_scholarships_trigger
  after insert or update or delete on public.scholarships
  for each row execute function public.audit_trigger_function();

-- expenses
drop trigger if exists audit_expenses_trigger on public.expenses;
create trigger audit_expenses_trigger
  after insert or update or delete on public.expenses
  for each row execute function public.audit_trigger_function();

-- funding_releases
drop trigger if exists audit_funding_trigger on public.funding_releases;
create trigger audit_funding_trigger
  after insert or update or delete on public.funding_releases
  for each row execute function public.audit_trigger_function();

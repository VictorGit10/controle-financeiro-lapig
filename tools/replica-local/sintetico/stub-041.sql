-- Completa o stub sintético com o que a migração 041 toca e ele não tem:
-- `audit_logs` + `audit_trigger_function` (mig. 023) e `reconciliacoes` (mig. 031).
--
-- Corrige também a forma de `rubricas`: o stub a simplificou para
-- `code text primary key`, mas a tabela REAL (mig. 025) tem `id uuid primary key`.
-- Não é detalhe — `audit_trigger_function` faz `rec_id := NEW.id`, então testar
-- contra a forma errada dá um falso negativo (aconteceu na primeira rodada).
--
--   docker exec -i cf-041 psql -U postgres -d cf < tools/replica-local/sintetico/stub.sql
--   docker exec -i cf-041 psql -U postgres -d cf < tools/replica-local/sintetico/stub-041.sql
--   docker exec -i cf-041 psql -U postgres -d cf < database/041_drive_folder_e_auditoria.sql
--   docker exec -i cf-041 psql -U postgres -d cf < tests/sql/test_041_drive_folder.sql

create schema if not exists auth;
create or replace function auth.uid() returns uuid
  language sql stable as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;

create table if not exists public.audit_logs (
    id uuid primary key default gen_random_uuid(),
    table_name text not null,
    record_id uuid not null,
    action text not null check (action in ('INSERT','UPDATE','DELETE')),
    old_data jsonb,
    new_data jsonb,
    performed_by uuid,
    created_at timestamptz not null default now()
);

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
    old_row := to_jsonb(OLD); new_row := to_jsonb(NEW); rec_id := NEW.id;
  elsif (TG_OP = 'DELETE') then
    old_row := to_jsonb(OLD); rec_id := OLD.id;
  elsif (TG_OP = 'INSERT') then
    new_row := to_jsonb(NEW); rec_id := NEW.id;
  end if;
  insert into public.audit_logs (table_name, record_id, action, old_data, new_data, performed_by)
  values (TG_TABLE_NAME::text, rec_id, TG_OP, old_row, new_row, auth.uid());
  if (TG_OP = 'DELETE') then return OLD; end if;
  return NEW;
end;
$$ language plpgsql;

create table if not exists public.reconciliacoes (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects(id) on delete cascade,
  competencia           date not null,
  arquivo_nome          text,
  arquivo_storage_path  text,
  resumo                jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  created_by            uuid default auth.uid()
);

-- forma real da mig. 025 (o stub simplificou para code text primary key)
alter table public.rubricas add column if not exists id uuid not null default gen_random_uuid();

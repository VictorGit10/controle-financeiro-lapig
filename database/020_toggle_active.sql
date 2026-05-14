-- ============================================================
-- CONTROLE FINANCEIRO — Migração 020
-- Auto-sincronização de active para holders e projetos
-- ============================================================

-- ── 1. Trigger: sync_holder_active ───────────────────────────
-- Atualiza scholarship_holders.active automaticamente quando
-- qualquer bolsa do holder é inserida, alterada ou excluída.
-- Regra: holder fica ativo se tiver ao menos 1 bolsa com
-- status='active' E end_date >= hoje.

create or replace function public.sync_holder_active()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_holder_id uuid;
begin
  v_holder_id := coalesce(NEW.holder_id, OLD.holder_id);

  update public.scholarship_holders
  set active = exists (
    select 1 from public.scholarships s
    where s.holder_id = v_holder_id
      and s.status    = 'active'
      and s.end_date  >= current_date
  )
  where id = v_holder_id;

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_sync_holder_active on public.scholarships;
create trigger trg_sync_holder_active
  after insert or update or delete on public.scholarships
  for each row execute function public.sync_holder_active();

comment on function public.sync_holder_active is
  'Mantém scholarship_holders.active sincronizado com as bolsas ativas vinculadas.';


-- ── 2. Trigger: auto_reactivate_project ──────────────────────
-- Se end_date de um projeto for alterada para uma data futura,
-- o campo active é reativado automaticamente.

create or replace function public.auto_reactivate_project()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if NEW.end_date is not null and NEW.end_date >= current_date then
    NEW.active := true;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_auto_reactivate_project on public.projects;
create trigger trg_auto_reactivate_project
  before update on public.projects
  for each row
  when (old.end_date is distinct from new.end_date)
  execute function public.auto_reactivate_project();

comment on function public.auto_reactivate_project is
  'Reativa o projeto automaticamente quando end_date é estendido para o futuro.';


-- ── 3. Sincronização inicial dos holders existentes ──────────
-- Corrige o estado atual dos holders com base nas bolsas reais.

update public.scholarship_holders sh
set active = exists (
  select 1 from public.scholarships s
  where s.holder_id = sh.id
    and s.status    = 'active'
    and s.end_date  >= current_date
);

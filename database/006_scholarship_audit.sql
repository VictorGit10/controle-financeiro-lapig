-- ============================================================
-- CONTROLE FINANCEIRO — Auditoria de bolsas
-- Migração 005: Tabela de histórico de edições
-- ============================================================
-- Registra cada sessão de edição no Modo Editor de projetos.
-- O frontend insere um registro a cada "Salvar" no editor.
-- ============================================================

create table if not exists public.scholarship_audit (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid references public.projects(id) on delete set null,
  action          text not null default 'editor_save',
  changes_count   integer not null default 0,
  details         jsonb,
  performed_by    uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

comment on table public.scholarship_audit is 
  'Log de edições feitas via Modo Editor na tela de projetos. Cada registro representa uma sessão de salvamento.';

comment on column public.scholarship_audit.action is
  'Tipo: editor_save (salvar sessão do editor)';

comment on column public.scholarship_audit.details is
  'JSON com detalhes: { deleted: N, updated: N, inserted: N }';

-- RLS: apenas admin pode ler/inserir
alter table public.scholarship_audit enable row level security;

create policy "Admin can read audit" on public.scholarship_audit
  for select using (auth.role() = 'authenticated');

create policy "Admin can insert audit" on public.scholarship_audit
  for insert with check (auth.role() = 'authenticated');

-- Índice por projeto para consultas futuras
create index idx_audit_project on public.scholarship_audit(project_id);
create index idx_audit_date on public.scholarship_audit(created_at desc);

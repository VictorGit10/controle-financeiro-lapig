-- ============================================================
-- Migração 024: project_balances → ON DELETE RESTRICT
-- ============================================================
-- Política do projeto: projetos não são excluídos, apenas
-- inativados (ver active flag). Esta migração alinha
-- project_balances ao mesmo padrão das outras FKs (ver 022),
-- garantindo defesa em profundidade contra delete acidental.
-- ============================================================

alter table public.project_balances
  drop constraint project_balances_project_id_fkey,
  add constraint project_balances_project_id_fkey
    foreign key (project_id) references public.projects(id) on delete restrict;

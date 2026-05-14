-- ============================================================
-- Migração 022: Remover ON DELETE CASCADE das tabelas financeiras
-- ============================================================
-- Restaura o comportamento de bloqueio (RESTRICT) para evitar a
-- exclusão acidental de projetos que possuam histórico financeiro.
-- ============================================================

-- scholarships: cascade → restrict
alter table public.scholarships
  drop constraint scholarships_project_id_fkey,
  add constraint scholarships_project_id_fkey
    foreign key (project_id) references public.projects(id) on delete restrict;

-- funding_releases: cascade → restrict
alter table public.funding_releases
  drop constraint funding_releases_project_id_fkey,
  add constraint funding_releases_project_id_fkey
    foreign key (project_id) references public.projects(id) on delete restrict;

-- expenses: cascade → restrict
alter table public.expenses
  drop constraint expenses_project_id_fkey,
  add constraint expenses_project_id_fkey
    foreign key (project_id) references public.projects(id) on delete restrict;

-- ============================================================
-- Migração 006: Alterar FKs para ON DELETE CASCADE
-- Permite excluir projetos sem erro de constraint
-- ============================================================

-- scholarships: restrict → cascade
alter table public.scholarships
  drop constraint scholarships_project_id_fkey,
  add constraint scholarships_project_id_fkey
    foreign key (project_id) references public.projects(id) on delete cascade;

-- funding_releases: restrict → cascade
alter table public.funding_releases
  drop constraint funding_releases_project_id_fkey,
  add constraint funding_releases_project_id_fkey
    foreign key (project_id) references public.projects(id) on delete cascade;

-- expenses: restrict → cascade
alter table public.expenses
  drop constraint expenses_project_id_fkey,
  add constraint expenses_project_id_fkey
    foreign key (project_id) references public.projects(id) on delete cascade;
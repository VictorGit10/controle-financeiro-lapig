-- Complemento sintético do stub.sql + stub-051.sql, ANTES da 051.
-- Não usa dados reais. Não precisa da 053: tarefas não dependem de itens.
-- Reconstitui as colunas do balancete e RLS da 033 para executar a RPC real
-- da 051, e deixa um caminho definer sem guard para desafiar a nova barreira.
alter table public.balancetes
  add column data_emissao date, add column periodo_inicio date,
  add column total_debitos numeric, add column total_creditos numeric,
  add column arquivo_storage_path text, add column arquivo_nome text,
  add column observacoes text, add column raw_extraction jsonb,
  add column created_by uuid, add column updated_at timestamptz default now(),
  add unique(project_id,data_referencia);
alter table public.balancete_lancamentos
  add column conta_codigo text, add column conta_descricao text,
  add column valor_debito numeric default 0, add column valor_credito numeric default 0;
create table public.conta_rubrica_map (
  conta_prefix text primary key, rubrica_code text references public.rubricas(code),
  descricao text, ativo boolean default true
);
alter table public.projects enable row level security;
create policy escopo on public.projects for all to authenticated
  using(public.is_admin() or id=any(public.allowed_project_ids()))
  with check(public.is_admin() or id=any(public.allowed_project_ids()));
alter table public.balancetes enable row level security;
create policy escopo on public.balancetes for all to authenticated
  using(public.is_admin() or project_id=any(public.allowed_project_ids()))
  with check(public.is_admin() or project_id=any(public.allowed_project_ids()));
alter table public.scholarships enable row level security;
create policy escopo on public.scholarships for all to authenticated
  using(public.is_admin() or project_id=any(public.allowed_project_ids()))
  with check(public.is_admin() or project_id=any(public.allowed_project_ids()));
grant select,insert,update,delete on public.projects,public.balancetes,public.scholarships to authenticated;
alter table public.app_users enable row level security;
create policy perfil on public.app_users for select to authenticated
  using(user_id=auth.uid() or public.is_admin());
grant select on public.app_users to authenticated;
alter table public.user_projects enable row level security;
create policy escopo on public.user_projects for select to authenticated
  using(user_id=auth.uid() or public.is_admin());
grant select on public.user_projects to authenticated;
create function public.stub_escrita_sem_guard(p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin update public.projects set name=name where id=p_id; end $$;
revoke all on function public.stub_escrita_sem_guard(uuid) from public,anon;
grant execute on function public.stub_escrita_sem_guard(uuid) to authenticated;
insert into auth.users values
 ('00000000-0000-0000-0000-0000000000d1'), -- futuro vigia
 ('00000000-0000-0000-0000-0000000000e1'); -- professor escopo Y
insert into public.app_users(user_id,role) values
 ('00000000-0000-0000-0000-0000000000d1','professor'),
 ('00000000-0000-0000-0000-0000000000e1','professor');
insert into public.user_projects(user_id,project_id)
 select '00000000-0000-0000-0000-0000000000e1',id from public.projects where code='51.Y';
-- A conversão deve remover uma atribuição prévia do login dedicado.
insert into public.user_projects(user_id,project_id)
 select '00000000-0000-0000-0000-0000000000d1',id from public.projects where code='51.X';

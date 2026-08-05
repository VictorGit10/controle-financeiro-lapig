-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Migração 033
-- Multi-tenancy por centro de custo (login de professor)
-- ============================================================
-- Hoje qualquer usuário autenticado vê e edita tudo: o RLS é
-- permissivo (using true / auth.uid() is not null) e as RPCs de
-- cálculo são security definer (burlam o RLS). Não há noção de
-- dono/escopo por usuário. `projects` = centros de custo.
--
-- Esta migração introduz perfis (admin/professor) e centros de
-- custo permitidos por usuário, e move a segurança para o banco:
--   1. Tabelas app_users (papel) + user_projects (centros de custo).
--   2. Helpers is_admin()/allowed_project_ids()/assert_project_allowed()
--      (security definer — precisam burlar o RLS para não recursar).
--   3. Trigger que auto-cria app_users no cadastro de novo auth user.
--   4. Backfill dos usuários existentes (Laerte/Victor = admin).
--   5. Troca das policies permissivas por policies escopadas.
--   6. Hardening das RPCs security definer (guards) + conversão das
--      RPCs de cálculo/leitura para security invoker (RLS escopa sozinho).
--
-- A chave anon é PÚBLICA (vai no frontend) — o RLS é a única barreira
-- real. Filtro só no frontend seria contornável via console (F12).
-- Professores veem e editam APENAS os centros de custo atribuídos;
-- CRUD de projeto, atribuição de centros, reconciliação/merge e
-- fechamento mensal continuam admin-only.
-- ============================================================


-- ============================================================
-- 1. TABELAS: app_users + user_projects
-- ============================================================

create table if not exists public.app_users (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  role         text not null default 'professor'
                 check (role in ('admin','professor')),
  display_name text,
  email        text,
  created_at   timestamptz not null default now()
);

comment on table public.app_users is
  'Perfil de cada usuário autenticado. role = admin (acesso total) ou professor (apenas centros de custo atribuídos).';
comment on column public.app_users.role is
  'admin vê/edita tudo; professor só vê/edita os projetos em user_projects. CRUD de projeto, atribuição, reconciliação/merge e fechamento são admin-only.';

create table if not exists public.user_projects (
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  primary key (user_id, project_id)
);

comment on table public.user_projects is
  'Centros de custo (projects) que cada professor pode acessar. Admin ignora esta tabela (is_admin() libera tudo).';

alter table public.app_users     enable row level security;
alter table public.user_projects enable row level security;


-- ============================================================
-- 2. HELPERS (security definer, set search_path)
-- ============================================================
-- PRECISAM ser security definer: as policies de app_users/user_projects
-- as chamam; se fossem invoker, recursariam infinitamente nas próprias
-- policies. Como definer, burlam o RLS e leem direto.

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.app_users
     where user_id = auth.uid()
       and role = 'admin'
  );
$$;

create or replace function public.allowed_project_ids()
returns uuid[]
language sql
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(project_id), '{}'::uuid[])
    from public.user_projects
   where user_id = auth.uid();
$$;

create or replace function public.assert_project_allowed(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_admin() then
    return;
  end if;
  if not exists (
    select 1 from unnest(public.allowed_project_ids()) as id
     where id = p_project_id
  ) then
    raise exception 'Acesso negado ao projeto %', p_project_id;
  end if;
end;
$$;

comment on function public.is_admin is
  'True se o usuário autenticado é admin. Security definer para evitar recursão nas policies de app_users.';
comment on function public.allowed_project_ids is
  'Lista de centros de custo (project_id) permitidos ao usuário autenticado. Vazia para admins (que ignoram o escopo).';
comment on function public.assert_project_allowed is
  'Levanta exceção se o usuário não é admin e o projeto não está entre os permitidos. Usada como guard nas RPCs definer.';

-- Higiene: helpers não ficam expostos ao role anon.
revoke execute on function public.is_admin()                 from anon;
revoke execute on function public.allowed_project_ids()      from anon;
revoke execute on function public.assert_project_allowed(uuid) from anon;


-- ============================================================
-- 3. TRIGGER: auto-cria app_users no novo auth user
-- ============================================================
-- Quando um usuário é criado no painel do Supabase (Authentication →
-- Add user), esta trigger cria a linha em app_users com papel
-- 'professor' e sem centros de custo. O admin então atribui os
-- projetos na página "Usuários & Centros de Custo".

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.app_users (user_id, role, display_name, email)
  values (
    new.id,
    'professor',
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================
-- 4. BACKFILL dos usuários existentes
-- ============================================================
-- Laerte e Victor viram admin; qualquer outro auth user existente
-- vira professor (sem centros de custo — o admin atribui depois).

insert into public.app_users (user_id, role, email)
select id, 'admin', email from auth.users
 where email in ('[e-mail removido]','[e-mail removido]')
 on conflict (user_id) do nothing;

insert into public.app_users (user_id, role, email)
select a.id, 'professor', a.email
  from auth.users a
 where not exists (select 1 from public.app_users u where u.user_id = a.id)
 on conflict (user_id) do nothing;


-- ============================================================
-- 5. scholarship_holders: coluna created_by + trigger
-- ============================================================
-- scholarship_holders não tem project_id (1 pessoa = 1 registro
-- global). Para escopar o acesso sem vazar nomes/CPF/e-mail entre
-- centros de custo, um professor vê um holder se ele tem alguma
-- bolsa em um dos seus projetos, OU se ele mesmo o criou
-- (created_by). A trigger preenche created_by = auth.uid() no
-- INSERT, impedindo spoofing.

alter table public.scholarship_holders
  add column if not exists created_by uuid references auth.users(id) on delete set null;

comment on column public.scholarship_holders.created_by is
  'Usuário que cadastrou o bolsista. Usado pelo RLS: um professor vê holders que criou ou que têm bolsa em um dos seus projetos.';

create or replace function public.set_holder_created_by()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.created_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_holder_created_by on public.scholarship_holders;
create trigger trg_holder_created_by
  before insert on public.scholarship_holders
  for each row execute function public.set_holder_created_by();


-- ============================================================
-- 6. RLS — trocar policies permissivas por escopadas
-- ============================================================
-- Padrão para tabelas-filhas diretas com project_id:
--   SELECT  using (is_admin() or project_id = any(allowed_project_ids()))
--   INSERT  with check (is_admin() or project_id = any(allowed_project_ids()))
--   UPDATE  using (...) with check (...)
--   DELETE  using (is_admin() or project_id = any(allowed_project_ids()))
-- Casos especiais (projects, dashboard_settings, reconciliacoes,
-- tabelas-filhas de 2º nível, catálogos globais, holders, auditorias)
-- têm políticas próprias abaixo.

-- ---------- projects (CRUD de projeto é admin) ----------
drop policy if exists "Autenticado lê projetos"     on public.projects;
drop policy if exists "Autenticado insere projetos" on public.projects;
drop policy if exists "Autenticado edita projetos"  on public.projects;
drop policy if exists "Autenticado exclui projetos"  on public.projects;

create policy "Escopo lê projetos"     on public.projects for select to authenticated
  using (public.is_admin() or id = any(public.allowed_project_ids()));
create policy "Admin insere projetos"  on public.projects for insert to authenticated
  with check (public.is_admin());
create policy "Admin edita projetos"   on public.projects for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "Admin exclui projetos"  on public.projects for delete to authenticated
  using (public.is_admin());


-- ---------- scholarships (project_id nullable p/ bolsas externas) ----------
drop policy if exists "Autenticado lê bolsas"     on public.scholarships;
drop policy if exists "Autenticado insere bolsas" on public.scholarships;
drop policy if exists "Autenticado edita bolsas"  on public.scholarships;
drop policy if exists "Autenticado exclui bolsas" on public.scholarships;

create policy "Escopo lê bolsas"     on public.scholarships for select to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Escopo insere bolsas" on public.scholarships for insert to authenticated
  with check (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Escopo edita bolsas"  on public.scholarships for update to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()))
  with check (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Escopo exclui bolsas" on public.scholarships for delete to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()));


-- ---------- funding_releases ----------
drop policy if exists "Autenticado lê desembolsos"     on public.funding_releases;
drop policy if exists "Autenticado insere desembolsos" on public.funding_releases;
drop policy if exists "Autenticado edita desembolsos"  on public.funding_releases;
drop policy if exists "Autenticado exclui desembolsos" on public.funding_releases;

create policy "Escopo lê desembolsos"     on public.funding_releases for select to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Escopo insere desembolsos" on public.funding_releases for insert to authenticated
  with check (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Escopo edita desembolsos"  on public.funding_releases for update to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()))
  with check (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Escopo exclui desembolsos" on public.funding_releases for delete to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()));


-- ---------- monitoramento ----------
drop policy if exists "Autenticado lê monitoramento"     on public.monitoramento;
drop policy if exists "Autenticado insere monitoramento" on public.monitoramento;
drop policy if exists "Autenticado edita monitoramento"  on public.monitoramento;
drop policy if exists "Autenticado exclui monitoramento" on public.monitoramento;

create policy "Escopo lê monitoramento"     on public.monitoramento for select to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Escopo insere monitoramento" on public.monitoramento for insert to authenticated
  with check (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Escopo edita monitoramento"  on public.monitoramento for update to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()))
  with check (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Escopo exclui monitoramento" on public.monitoramento for delete to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()));


-- ---------- project_balances ----------
drop policy if exists "Autenticado lê saldos"     on public.project_balances;
drop policy if exists "Autenticado insere saldos" on public.project_balances;
drop policy if exists "Autenticado edita saldos"  on public.project_balances;
drop policy if exists "Autenticado exclui saldos" on public.project_balances;

create policy "Escopo lê saldos"     on public.project_balances for select to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Escopo insere saldos" on public.project_balances for insert to authenticated
  with check (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Escopo edita saldos"  on public.project_balances for update to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()))
  with check (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Escopo exclui saldos" on public.project_balances for delete to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()));


-- ---------- dashboard_settings (include_in_general é decisão admin) ----------
drop policy if exists "Autenticado lê config dashboard"     on public.dashboard_settings;
drop policy if exists "Autenticado insere config dashboard" on public.dashboard_settings;
drop policy if exists "Autenticado edita config dashboard"  on public.dashboard_settings;
drop policy if exists "Autenticado exclui config dashboard" on public.dashboard_settings;

create policy "Escopo lê config dashboard"     on public.dashboard_settings for select to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Admin insere config dashboard"  on public.dashboard_settings for insert to authenticated
  with check (public.is_admin());
create policy "Admin edita config dashboard"   on public.dashboard_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "Admin exclui config dashboard"  on public.dashboard_settings for delete to authenticated
  using (public.is_admin());


-- ---------- balancetes ----------
drop policy if exists "Autenticado lê balancetes"     on public.balancetes;
drop policy if exists "Autenticado insere balancetes" on public.balancetes;
drop policy if exists "Autenticado edita balancetes"  on public.balancetes;
drop policy if exists "Autenticado exclui balancetes" on public.balancetes;

create policy "Escopo lê balancetes"     on public.balancetes for select to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Escopo insere balancetes" on public.balancetes for insert to authenticated
  with check (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Escopo edita balancetes"  on public.balancetes for update to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()))
  with check (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Escopo exclui balancetes" on public.balancetes for delete to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()));


-- ---------- planos_trabalho ----------
drop policy if exists "Autenticado lê planos"     on public.planos_trabalho;
drop policy if exists "Autenticado insere planos" on public.planos_trabalho;
drop policy if exists "Autenticado edita planos"  on public.planos_trabalho;
drop policy if exists "Autenticado exclui planos" on public.planos_trabalho;

create policy "Escopo lê planos"     on public.planos_trabalho for select to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Escopo insere planos" on public.planos_trabalho for insert to authenticated
  with check (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Escopo edita planos"  on public.planos_trabalho for update to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()))
  with check (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Escopo exclui planos" on public.planos_trabalho for delete to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()));


-- ---------- reconciliacoes (escopo leitura; escrita admin-only) ----------
drop policy if exists "Autenticado lê reconciliacoes"     on public.reconciliacoes;
drop policy if exists "Autenticado insere reconciliacoes" on public.reconciliacoes;
drop policy if exists "Autenticado edita reconciliacoes"  on public.reconciliacoes;
drop policy if exists "Autenticado exclui reconciliacoes" on public.reconciliacoes;

create policy "Escopo lê reconciliacoes"     on public.reconciliacoes for select to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Admin insere reconciliacoes" on public.reconciliacoes for insert to authenticated
  with check (public.is_admin());
create policy "Admin edita reconciliacoes"  on public.reconciliacoes for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "Admin exclui reconciliacoes" on public.reconciliacoes for delete to authenticated
  using (public.is_admin());


-- ---------- balancete_lancamentos (sem project_id direto; admin-only) ----------
-- Professores acessam lançamentos só via RPCs guardadas
-- (get_balancete_detalhado, upsert_balancete).
drop policy if exists "Autenticado lê lancamentos"     on public.balancete_lancamentos;
drop policy if exists "Autenticado insere lancamentos" on public.balancete_lancamentos;
drop policy if exists "Autenticado edita lancamentos"  on public.balancete_lancamentos;
drop policy if exists "Autenticado exclui lancamentos" on public.balancete_lancamentos;

create policy "Admin lê lancamentos"     on public.balancete_lancamentos for select to authenticated
  using (public.is_admin());
create policy "Admin insere lancamentos" on public.balancete_lancamentos for insert to authenticated
  with check (public.is_admin());
create policy "Admin edita lancamentos"  on public.balancete_lancamentos for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "Admin exclui lancamentos" on public.balancete_lancamentos for delete to authenticated
  using (public.is_admin());


-- ---------- plano_rubricas + plano_desembolsos (sem project_id direto; admin-only) ----------
drop policy if exists "Autenticado lê plano_rubricas"     on public.plano_rubricas;
drop policy if exists "Autenticado insere plano_rubricas" on public.plano_rubricas;
drop policy if exists "Autenticado edita plano_rubricas"  on public.plano_rubricas;
drop policy if exists "Autenticado exclui plano_rubricas" on public.plano_rubricas;

create policy "Admin lê plano_rubricas"     on public.plano_rubricas for select to authenticated
  using (public.is_admin());
create policy "Admin insere plano_rubricas" on public.plano_rubricas for insert to authenticated
  with check (public.is_admin());
create policy "Admin edita plano_rubricas"  on public.plano_rubricas for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "Admin exclui plano_rubricas" on public.plano_rubricas for delete to authenticated
  using (public.is_admin());

drop policy if exists "Autenticado lê plano_desembolsos"     on public.plano_desembolsos;
drop policy if exists "Autenticado insere plano_desembolsos" on public.plano_desembolsos;
drop policy if exists "Autenticado edita plano_desembolsos"  on public.plano_desembolsos;
drop policy if exists "Autenticado exclui plano_desembolsos" on public.plano_desembolsos;

create policy "Admin lê plano_desembolsos"     on public.plano_desembolsos for select to authenticated
  using (public.is_admin());
create policy "Admin insere plano_desembolsos" on public.plano_desembolsos for insert to authenticated
  with check (public.is_admin());
create policy "Admin edita plano_desembolsos"  on public.plano_desembolsos for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "Admin exclui plano_desembolsos" on public.plano_desembolsos for delete to authenticated
  using (public.is_admin());


-- ---------- catálogos globais: conta_rubrica_map + rubricas ----------
-- Mantém SELECT/INSERT/UPDATE permissivos (professores precisam ler
-- o catálogo e cadastrar mapeamentos ao revisar balancete). Apenas
-- DELETE vira admin-only (remover item de catálogo é operação sensível).
drop policy if exists "Autenticado exclui mapeamento" on public.conta_rubrica_map;
create policy "Admin exclui mapeamento" on public.conta_rubrica_map for delete to authenticated
  using (public.is_admin());

drop policy if exists "Autenticado exclui rubricas" on public.rubricas;
create policy "Admin exclui rubricas" on public.rubricas for delete to authenticated
  using (public.is_admin());


-- ---------- scholarship_holders (sem project_id; usa created_by + scholarships) ----------
drop policy if exists "Autenticado lê bolsistas"     on public.scholarship_holders;
drop policy if exists "Autenticado insere bolsistas" on public.scholarship_holders;
drop policy if exists "Autenticado edita bolsistas"  on public.scholarship_holders;
drop policy if exists "Autenticado exclui bolsistas" on public.scholarship_holders;

-- Visível se: é admin, OU tem bolsa em um dos meus projetos, OU eu criei.
create policy "Escopo lê bolsistas" on public.scholarship_holders for select to authenticated
  using (
    public.is_admin()
    or created_by = auth.uid()
    or exists (
      select 1 from public.scholarships s
       where s.holder_id = scholarship_holders.id
         and s.project_id = any(public.allowed_project_ids())
    )
  );

-- Qualquer autenticado pode cadastrar holder (professor cadastra no seu projeto).
create policy "Autenticado insere bolsistas" on public.scholarship_holders for insert to authenticated
  with check (auth.uid() is not null);

-- Editável nas mesmas condições de visibilidade.
create policy "Escopo edita bolsistas" on public.scholarship_holders for update to authenticated
  using (
    public.is_admin()
    or created_by = auth.uid()
    or exists (
      select 1 from public.scholarships s
       where s.holder_id = scholarship_holders.id
         and s.project_id = any(public.allowed_project_ids())
    )
  )
  with check (
    public.is_admin()
    or created_by = auth.uid()
    or exists (
      select 1 from public.scholarships s
       where s.holder_id = scholarship_holders.id
         and s.project_id = any(public.allowed_project_ids())
    )
  );

-- Excluível se: é admin, OU criou o holder E ele não tem bolsa (visível a mim).
-- Holders com bolsa em outro projeto são protegidos pela FK RESTRICT.
create policy "Escopo exclui bolsistas" on public.scholarship_holders for delete to authenticated
  using (
    public.is_admin()
    or (created_by = auth.uid()
        and not exists (
          select 1 from public.scholarships s
           where s.holder_id = scholarship_holders.id
        ))
  );


-- ---------- scholarship_audit (project_id nullable) ----------
-- Corrige vazamento: hoje qualquer autenticado lê toda a auditoria.
drop policy if exists "Admin can read audit"  on public.scholarship_audit;
drop policy if exists "Admin can insert audit" on public.scholarship_audit;

create policy "Escopo lê audit" on public.scholarship_audit for select to authenticated
  using (
    public.is_admin()
    or (project_id is not null and project_id = any(public.allowed_project_ids()))
  );
-- INSERT permissivo: save_editor_changes (security invoker) grava aqui.
create policy "Autenticado insere audit" on public.scholarship_audit for insert to authenticated
  with check (auth.uid() is not null);
create policy "Admin edita audit"  on public.scholarship_audit for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "Admin exclui audit" on public.scholarship_audit for delete to authenticated
  using (public.is_admin());


-- ---------- audit_logs (sem project_id; admin-only) ----------
-- Corrige vazamento: hoje qualquer autenticado lê a trilha completa.
-- O trigger audit_trigger_function é security definer → continua
-- gravando (burla o RLS). Aqui apenas escopamos a leitura direta.
drop policy if exists "Admins can read audit_logs" on public.audit_logs;

create policy "Admin lê audit_logs"   on public.audit_logs for select to authenticated
  using (public.is_admin());
create policy "Admin insere audit_logs" on public.audit_logs for insert to authenticated
  with check (public.is_admin());
create policy "Admin edita audit_logs"  on public.audit_logs for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "Admin exclui audit_logs" on public.audit_logs for delete to authenticated
  using (public.is_admin());


-- ---------- app_users + user_projects ----------
-- Cada usuário lê a própria linha; admin lê tudo. Escrita é admin-only
-- (via RPC save_user_assignments, que é definer e burla o RLS).
create policy "Usuário lê próprio perfil" on public.app_users for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "Admin escreve perfil" on public.app_users for insert to authenticated
  with check (public.is_admin());
create policy "Admin edita perfil"   on public.app_users for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "Admin exclui perfil" on public.app_users for delete to authenticated
  using (public.is_admin());

create policy "Usuário lê próprios projetos" on public.user_projects for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "Admin escreve projetos do usuário" on public.user_projects for insert to authenticated
  with check (public.is_admin());
create policy "Admin edita projetos do usuário"   on public.user_projects for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "Admin exclui projetos do usuário"  on public.user_projects for delete to authenticated
  using (public.is_admin());


-- ============================================================
-- 7. RPCs — conversão para security invoker (RLS escopa sozinho)
-- ============================================================
-- Estas funções de cálculo/leitura viram invoker: o RLS nas tabelas
-- base (projects, scholarships, funding_releases, monitoramento,
-- dashboard_settings) escopa automaticamente todas as cláusulas.
-- Evita reproduzir WHERE à mão e vazar subqueries (ex.: o baseline
-- de bolsas do calc_general_dashboard).

alter function public.calc_project_monthly(uuid, date, date, text)
  security invoker set search_path = public, pg_temp;

alter function public.calc_general_dashboard(date, date, text)
  security invoker set search_path = public, pg_temp;

alter function public.calc_projects_batch(uuid[], date, text)
  security invoker set search_path = public, pg_temp;

alter function public.monitoramento_stats()
  security invoker set search_path = public, pg_temp;


-- ============================================================
-- 8. RPCs — security definer + guard por projeto
-- ============================================================
-- Estas tocam tabelas-filhas de 2º nível (plano_rubricas,
-- balancete_lancamentos...) que são admin-only direto, então precisam
-- continuar definer para que professores as usem via RPC. O guard
-- assert_project_allowed() no topo garante o escopo.

-- ---------- get_plano_ativo ----------
create or replace function public.get_plano_ativo(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform public.assert_project_allowed(p_project_id);

  select to_jsonb(pt.*)
       || jsonb_build_object(
            'rubricas', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', pr.id,
                  'rubrica_code', pr.rubrica_code,
                  'rubrica_name', r.name,
                  'parent_code',  r.parent_code,
                  'ordem',        r.ordem,
                  'valor_previsto', pr.valor_previsto,
                  'descricao_livre', pr.descricao_livre
                )
                order by r.ordem, pr.descricao_livre nulls first
              )
              from public.plano_rubricas pr
              join public.rubricas r on r.code = pr.rubrica_code
              where pr.plano_id = pt.id
            ), '[]'::jsonb),
            'desembolsos', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', pd.id,
                  'parcela', pd.parcela,
                  'data_prevista', pd.data_prevista,
                  'data_texto',    pd.data_texto,
                  'valor',         pd.valor,
                  'valor_texto',   pd.valor_texto
                )
                order by pd.parcela
              )
              from public.plano_desembolsos pd
              where pd.plano_id = pt.id
            ), '[]'::jsonb)
          )
    into v_result
    from public.planos_trabalho pt
   where pt.project_id = p_project_id
     and pt.ativo = true
   limit 1;

  return v_result;  -- null se o projeto ainda não tem plano
end;
$$;

comment on function public.get_plano_ativo is
  'Retorna o plano de trabalho ATIVO de um projeto, com rubricas e desembolsos inclusos. Guard: assert_project_allowed.';


-- ---------- get_planos_historico ----------
create or replace function public.get_planos_historico(p_project_id uuid)
returns table (
  id                uuid,
  versao            integer,
  tipo              text,
  data_documento    date,
  ativo             boolean,
  titulo            text,
  valor_total_plano numeric,
  arquivo_nome      text,
  created_at        timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_project_allowed(p_project_id);

  return query
    select pt.id, pt.versao, pt.tipo, pt.data_documento, pt.ativo,
           pt.titulo, pt.valor_total_plano, pt.arquivo_nome, pt.created_at
      from public.planos_trabalho pt
     where pt.project_id = p_project_id
     order by pt.versao desc;
end;
$$;

comment on function public.get_planos_historico is
  'Lista resumida de todas as versões do plano de trabalho de um projeto. Guard: assert_project_allowed.';


-- ---------- get_balancetes_by_project ----------
create or replace function public.get_balancetes_by_project(p_project_id uuid)
returns table (
  id                 uuid,
  data_referencia    date,
  data_emissao       date,
  saldo_disponivel   numeric,
  rendimento_liquido numeric,
  total_debitos      numeric,
  total_creditos     numeric,
  arquivo_nome       text,
  created_at         timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_project_allowed(p_project_id);

  return query
    select b.id, b.data_referencia, b.data_emissao,
           b.saldo_disponivel, b.rendimento_liquido,
           b.total_debitos, b.total_creditos,
           b.arquivo_nome, b.created_at
      from public.balancetes b
     where b.project_id = p_project_id
     order by b.data_referencia desc;
end;
$$;


-- ---------- get_balancete_detalhado ----------
-- null-check antes do guard: não vaza "não existe" vs "não permitido".
create or replace function public.get_balancete_detalhado(p_balancete_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_pid    uuid;
begin
  select project_id into v_pid from public.balancetes where id = p_balancete_id;
  if v_pid is null then
    return null;
  end if;
  perform public.assert_project_allowed(v_pid);

  select to_jsonb(b.*)
       || jsonb_build_object('lancamentos', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', l.id,
                'conta_codigo', l.conta_codigo,
                'conta_descricao', l.conta_descricao,
                'valor_debito', l.valor_debito,
                'valor_credito', l.valor_credito,
                'saldo_atual', l.saldo_atual,
                'rubrica_code', l.rubrica_code,
                'rubrica_name', r.name
              )
              order by l.conta_codigo
            )
            from public.balancete_lancamentos l
            left join public.rubricas r on r.code = l.rubrica_code
            where l.balancete_id = b.id
          ), '[]'::jsonb))
    into v_result
    from public.balancetes b
   where b.id = p_balancete_id;

  return v_result;
end;
$$;


-- ---------- get_previsto_vs_realizado ----------
create or replace function public.get_previsto_vs_realizado(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plano_id           uuid;
  v_balancete_id       uuid;
  v_balancete_data     date;
  v_balancete_saldo    numeric;
  v_balancete_rend     numeric;
  v_rubricas           jsonb;
  v_nao_mapeados       jsonb;
begin
  perform public.assert_project_allowed(p_project_id);

  -- Plano ativo
  select id into v_plano_id
    from public.planos_trabalho
   where project_id = p_project_id and ativo = true
   limit 1;

  -- Balancete mais recente
  select id, data_referencia, saldo_disponivel, rendimento_liquido
    into v_balancete_id, v_balancete_data, v_balancete_saldo, v_balancete_rend
    from public.balancetes
   where project_id = p_project_id
   order by data_referencia desc
   limit 1;

  if v_plano_id is null then
    return jsonb_build_object(
      'has_plano', false,
      'has_balancete', v_balancete_id is not null,
      'message', 'Sem plano de trabalho ativo para este projeto.'
    );
  end if;

  -- Por rubrica: soma previsto (do plano ativo) + soma realizado (do balancete)
  with previsto as (
    select rubrica_code, sum(valor_previsto) as total_previsto
      from public.plano_rubricas
     where plano_id = v_plano_id
     group by rubrica_code
  ),
  realizado as (
    select rubrica_code, sum(saldo_atual) as total_realizado
      from public.balancete_lancamentos
     where balancete_id = v_balancete_id and rubrica_code is not null
     group by rubrica_code
  ),
  todas as (
    select r.code as rubrica_code, r.name, r.parent_code, r.ordem,
           coalesce(p.total_previsto, 0)  as previsto,
           coalesce(rr.total_realizado, 0) as realizado
      from public.rubricas r
      left join previsto  p  on p.rubrica_code  = r.code
      left join realizado rr on rr.rubrica_code = r.code
     where coalesce(p.total_previsto, 0) > 0
        or coalesce(rr.total_realizado, 0) > 0
     order by r.ordem
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'rubrica_code',  rubrica_code,
      'rubrica_name',  name,
      'parent_code',   parent_code,
      'previsto',      previsto,
      'realizado',     realizado,
      'saldo',         (previsto - realizado),
      'perc_executado', case when previsto > 0 then round((realizado / previsto) * 100, 2) else null end
    )
  ), '[]'::jsonb)
    into v_rubricas
    from todas;

  -- Lançamentos não mapeados (rubrica_code null) — geralmente despesas tributárias
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'conta_codigo',    conta_codigo,
      'conta_descricao', conta_descricao,
      'saldo_atual',     saldo_atual
    ) order by conta_codigo
  ), '[]'::jsonb)
    into v_nao_mapeados
    from public.balancete_lancamentos
   where balancete_id = v_balancete_id and rubrica_code is null and saldo_atual > 0;

  return jsonb_build_object(
    'has_plano',          true,
    'has_balancete',      v_balancete_id is not null,
    'balancete_id',       v_balancete_id,
    'data_referencia',    v_balancete_data,
    'saldo_disponivel',   v_balancete_saldo,
    'rendimento_liquido', v_balancete_rend,
    'rubricas',           coalesce(v_rubricas, '[]'::jsonb),
    'nao_mapeados',       v_nao_mapeados
  );
end;
$$;

comment on function public.get_previsto_vs_realizado is
  'Cruza o plano ativo do projeto com o balancete mais recente. Guard: assert_project_allowed.';


-- ---------- upsert_plano_trabalho ----------
-- Guard após o null-check + CORREÇÃO DE FURO no path de UPDATE:
-- o where id = v_plano_id passou a exigir project_id = v_project_id,
-- impedindo que um professor sobrescreva plano alheio passando
-- id alheio + project_id próprio.
create or replace function public.upsert_plano_trabalho(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plano_id   uuid;
  v_project_id uuid;
  v_versao     integer;
  v_is_new     boolean;
  r_rubrica    jsonb;
  r_desemb     jsonb;
begin
  v_plano_id   := nullif(p_payload->>'id', '')::uuid;
  v_project_id := (p_payload->>'project_id')::uuid;
  v_is_new     := v_plano_id is null;

  if v_project_id is null then
    raise exception 'project_id é obrigatório no payload';
  end if;

  perform public.assert_project_allowed(v_project_id);

  if v_is_new then
    select coalesce(max(versao), -1) + 1
      into v_versao
      from public.planos_trabalho
     where project_id = v_project_id;

    insert into public.planos_trabalho (
      project_id, versao, tipo, data_documento,
      arquivo_storage_path, arquivo_nome, ativo,
      titulo, coordenador, prazo_inicio, prazo_fim,
      valor_total_plano, valor_despesas_projeto, valor_cip, valor_dao,
      receita_origem, observacoes, raw_extraction, created_by
    ) values (
      v_project_id,
      v_versao,
      coalesce(p_payload->>'tipo', case when v_versao = 0 then 'original' else 'remanejamento' end),
      nullif(p_payload->>'data_documento','')::date,
      p_payload->>'arquivo_storage_path',
      p_payload->>'arquivo_nome',
      coalesce((p_payload->>'ativo')::boolean, true),
      p_payload->>'titulo',
      p_payload->>'coordenador',
      nullif(p_payload->>'prazo_inicio','')::date,
      nullif(p_payload->>'prazo_fim','')::date,
      nullif(p_payload->>'valor_total_plano','')::numeric,
      nullif(p_payload->>'valor_despesas_projeto','')::numeric,
      nullif(p_payload->>'valor_cip','')::numeric,
      nullif(p_payload->>'valor_dao','')::numeric,
      p_payload->>'receita_origem',
      p_payload->>'observacoes',
      p_payload->'raw_extraction',
      auth.uid()
    )
    returning id into v_plano_id;
  else
    update public.planos_trabalho
       set tipo                   = coalesce(p_payload->>'tipo', tipo),
           data_documento         = nullif(p_payload->>'data_documento','')::date,
           arquivo_storage_path   = coalesce(p_payload->>'arquivo_storage_path', arquivo_storage_path),
           arquivo_nome           = coalesce(p_payload->>'arquivo_nome', arquivo_nome),
           titulo                 = p_payload->>'titulo',
           coordenador            = p_payload->>'coordenador',
           prazo_inicio           = nullif(p_payload->>'prazo_inicio','')::date,
           prazo_fim              = nullif(p_payload->>'prazo_fim','')::date,
           valor_total_plano      = nullif(p_payload->>'valor_total_plano','')::numeric,
           valor_despesas_projeto = nullif(p_payload->>'valor_despesas_projeto','')::numeric,
           valor_cip              = nullif(p_payload->>'valor_cip','')::numeric,
           valor_dao              = nullif(p_payload->>'valor_dao','')::numeric,
           receita_origem         = p_payload->>'receita_origem',
           observacoes            = p_payload->>'observacoes',
           raw_extraction         = coalesce(p_payload->'raw_extraction', raw_extraction)
     where id = v_plano_id
       and project_id = v_project_id
    returning id into v_plano_id;

    if not found then
      raise exception 'Plano não encontrado para este projeto';
    end if;
  end if;

  -- Substitui rubricas e desembolsos por completo (mais simples e idempotente).
  delete from public.plano_rubricas    where plano_id = v_plano_id;
  delete from public.plano_desembolsos where plano_id = v_plano_id;

  if jsonb_typeof(p_payload->'rubricas') = 'array' then
    for r_rubrica in select * from jsonb_array_elements(p_payload->'rubricas')
    loop
      insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto, descricao_livre)
      values (
        v_plano_id,
        r_rubrica->>'rubrica_code',
        coalesce((r_rubrica->>'valor_previsto')::numeric, 0),
        nullif(r_rubrica->>'descricao_livre', '')
      );
    end loop;
  end if;

  if jsonb_typeof(p_payload->'desembolsos') = 'array' then
    for r_desemb in select * from jsonb_array_elements(p_payload->'desembolsos')
    loop
      insert into public.plano_desembolsos (plano_id, parcela, data_prevista, data_texto, valor, valor_texto)
      values (
        v_plano_id,
        (r_desemb->>'parcela')::integer,
        nullif(r_desemb->>'data_prevista','')::date,
        r_desemb->>'data_texto',
        nullif(r_desemb->>'valor','')::numeric,
        r_desemb->>'valor_texto'
      );
    end loop;
  end if;

  return v_plano_id;
end;
$$;

comment on function public.upsert_plano_trabalho is
  'Cria ou atualiza um plano de trabalho a partir do JSON revisado. Guard: assert_project_allowed. O UPDATE exige project_id correto (impede sobrescrever plano alheio).';


-- ---------- ativar_plano_trabalho ----------
create or replace function public.ativar_plano_trabalho(p_plano_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pid uuid;
begin
  select project_id into v_pid from public.planos_trabalho where id = p_plano_id;
  if not found then
    raise exception 'Plano não encontrado: %', p_plano_id;
  end if;
  perform public.assert_project_allowed(v_pid);

  update public.planos_trabalho
     set ativo = true
   where id = p_plano_id;

  if not found then
    raise exception 'Plano não encontrado: %', p_plano_id;
  end if;
end;
$$;

comment on function public.ativar_plano_trabalho is
  'Torna a versão indicada o plano ativo do projeto. Guard: assert_project_allowed.';


-- ---------- upsert_balancete ----------
-- Guard após o null-check. O bloco new_mappings escreve em
-- conta_rubrica_map (catálogo permissivo) — ok para professores.
create or replace function public.upsert_balancete(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id           uuid;
  v_project_id   uuid;
  v_data_ref     date;
  r_lanc         jsonb;
  r_map          jsonb;
begin
  v_project_id := (p_payload->>'project_id')::uuid;
  v_data_ref   := (p_payload->>'data_referencia')::date;

  if v_project_id is null or v_data_ref is null then
    raise exception 'project_id e data_referencia são obrigatórios.';
  end if;

  perform public.assert_project_allowed(v_project_id);

  -- Novos mapeamentos cadastrados pelo usuário durante a revisão.
  -- Inseridos ANTES dos lançamentos para que o trigger auto-resolve
  -- já encontre a rubrica correta.
  if jsonb_typeof(p_payload->'new_mappings') = 'array' then
    for r_map in select * from jsonb_array_elements(p_payload->'new_mappings')
    loop
      if r_map->>'conta_prefix' is not null and r_map->>'rubrica_code' is not null then
        insert into public.conta_rubrica_map (conta_prefix, rubrica_code, descricao)
        values (
          r_map->>'conta_prefix',
          r_map->>'rubrica_code',
          coalesce(r_map->>'descricao', 'Cadastrado via revisão do balancete')
        )
        on conflict (conta_prefix) do update set
          rubrica_code = excluded.rubrica_code,
          ativo        = true;
      end if;
    end loop;
  end if;

  insert into public.balancetes (
    project_id, data_referencia, data_emissao, periodo_inicio,
    saldo_disponivel, rendimento_liquido, total_debitos, total_creditos,
    arquivo_storage_path, arquivo_nome, observacoes, raw_extraction, created_by
  ) values (
    v_project_id, v_data_ref,
    nullif(p_payload->>'data_emissao','')::date,
    nullif(p_payload->>'periodo_inicio','')::date,
    nullif(p_payload->>'saldo_disponivel','')::numeric,
    nullif(p_payload->>'rendimento_liquido','')::numeric,
    nullif(p_payload->>'total_debitos','')::numeric,
    nullif(p_payload->>'total_creditos','')::numeric,
    p_payload->>'arquivo_storage_path',
    p_payload->>'arquivo_nome',
    p_payload->>'observacoes',
    p_payload->'raw_extraction',
    auth.uid()
  )
  on conflict (project_id, data_referencia) do update set
    data_emissao         = excluded.data_emissao,
    periodo_inicio       = excluded.periodo_inicio,
    saldo_disponivel     = excluded.saldo_disponivel,
    rendimento_liquido   = excluded.rendimento_liquido,
    total_debitos        = excluded.total_debitos,
    total_creditos       = excluded.total_creditos,
    arquivo_storage_path = coalesce(excluded.arquivo_storage_path, balancetes.arquivo_storage_path),
    arquivo_nome         = coalesce(excluded.arquivo_nome,         balancetes.arquivo_nome),
    observacoes          = excluded.observacoes,
    raw_extraction       = coalesce(excluded.raw_extraction,       balancetes.raw_extraction),
    updated_at           = now()
  returning id into v_id;

  -- Substitui os lançamentos (idempotente)
  delete from public.balancete_lancamentos where balancete_id = v_id;

  if jsonb_typeof(p_payload->'lancamentos') = 'array' then
    for r_lanc in select * from jsonb_array_elements(p_payload->'lancamentos')
    loop
      insert into public.balancete_lancamentos
        (balancete_id, conta_codigo, conta_descricao, valor_debito, valor_credito, saldo_atual)
      values (
        v_id,
        r_lanc->>'conta_codigo',
        r_lanc->>'conta_descricao',
        coalesce((r_lanc->>'valor_debito')::numeric, 0),
        coalesce((r_lanc->>'valor_credito')::numeric, 0),
        coalesce((r_lanc->>'saldo_atual')::numeric, 0)
      );
      -- rubrica_code é setado pelo trigger trg_auto_resolve_rubrica,
      -- que já enxerga os mapeamentos recém-inseridos acima.
    end loop;
  end if;

  return v_id;
end;
$$;

comment on function public.upsert_balancete is
  'Cria ou atualiza um balancete a partir do JSON revisado. Guard: assert_project_allowed. Aceita new_mappings opcional (catálogo permissivo).';


-- ============================================================
-- 9. RPCs — security definer + guard admin-only
-- ============================================================

-- ---------- save_project (CRUD de projeto é admin) ----------
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
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem criar ou editar projetos.';
  end if;

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
  'Cria ou atualiza um projeto e seu dashboard_settings em uma única transação. Admin-only.';


-- ---------- apply_reconciliation (workflow operacional global) ----------
-- Atualiza holders globais por holder_id arbitrário → admin-only é
-- mais seguro que assert_project_allowed.
create or replace function public.apply_reconciliation(
  p_project_id  uuid,
  p_actions     jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item       jsonb;
  v_holder_id  uuid;
  v_total      integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem aplicar reconciliação de bolsas.';
  end if;

  -- Creates / vínculos
  for v_item in select * from jsonb_array_elements(coalesce(p_actions->'creates', '[]'::jsonb))
  loop
    if (v_item->>'holder_id') is not null and (v_item->>'holder_id') <> '' then
      -- Holder JÁ existe (encontrado na resolução global) → vincula nova bolsa
      -- e faz backfill. Nome da planilha FUNAPE sobrescreve o cadastrado.
      v_holder_id := (v_item->>'holder_id')::uuid;
      update public.scholarship_holders
      set
        full_name       = coalesce(nullif(v_item->>'nome', ''), full_name),
        cpf             = coalesce(nullif(v_item->>'cpf', ''), cpf),
        email           = coalesce(nullif(v_item->>'email', ''), email),
        education_level = coalesce(nullif(v_item->>'formacao', ''), education_level),
        updated_at      = now()
      where id = v_holder_id;

    elsif (v_item->>'cpf') is not null and (v_item->>'cpf') <> '' then
      insert into public.scholarship_holders (full_name, cpf, email, education_level)
      values (
        v_item->>'nome',
        v_item->>'cpf',
        nullif(v_item->>'email', ''),
        nullif(v_item->>'formacao', '')
      )
      on conflict (cpf) do update set
        full_name       = excluded.full_name,
        email           = coalesce(nullif(excluded.email, ''), scholarship_holders.email),
        education_level = coalesce(nullif(excluded.education_level, ''), scholarship_holders.education_level)
      returning id into v_holder_id;

    else
      insert into public.scholarship_holders (full_name, email, education_level)
      values (
        v_item->>'nome',
        nullif(v_item->>'email', ''),
        nullif(v_item->>'formacao', '')
      )
      returning id into v_holder_id;
    end if;

    insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status, scholarship_type, notes)
    values (
      v_holder_id,
      p_project_id,
      (v_item->>'valor')::numeric,
      (v_item->>'inicio')::date,
      (v_item->>'fim')::date,
      'active',
      nullif(v_item->>'tipo', ''),
      null
    );

    v_total := v_total + 1;
  end loop;

  -- Updates: altera bolsa existente + backfill do holder
  for v_item in select * from jsonb_array_elements(coalesce(p_actions->'updates', '[]'::jsonb))
  loop
    update public.scholarships
    set
      amount          = (v_item->>'amount')::numeric,
      start_date      = (v_item->>'start_date')::date,
      end_date        = (v_item->>'end_date')::date,
      scholarship_type = nullif(v_item->>'scholarship_type', ''),
      updated_at      = now()
    where id = (v_item->>'scholarship_id')::uuid
      and project_id = p_project_id;

    if (v_item->>'holder_id') is not null then
      update public.scholarship_holders
      set
        cpf            = coalesce(nullif(v_item->>'cpf', ''), cpf),
        full_name      = coalesce(nullif(v_item->>'full_name', ''), full_name),
        education_level = coalesce(nullif(v_item->>'education_level', ''), education_level),
        updated_at     = now()
      where id = (v_item->>'holder_id')::uuid;
    end if;

    v_total := v_total + 1;
  end loop;

  -- Ends: encerra bolsas que não constam mais na planilha
  for v_item in select * from jsonb_array_elements(coalesce(p_actions->'ends', '[]'::jsonb))
  loop
    update public.scholarships
    set status = 'ended',
        updated_at = now()
    where id = (v_item->>'scholarship_id')::uuid
      and project_id = p_project_id;

    v_total := v_total + 1;
  end loop;

  insert into public.scholarship_audit (project_id, action, changes_count, details)
  values (
    p_project_id,
    'reconciliation',
    v_total,
    jsonb_build_object(
      'created', jsonb_array_length(coalesce(p_actions->'creates', '[]'::jsonb)),
      'updated', jsonb_array_length(coalesce(p_actions->'updates', '[]'::jsonb)),
      'ended',   jsonb_array_length(coalesce(p_actions->'ends', '[]'::jsonb))
    )
  );

  return v_total;
end;
$$;

comment on function public.apply_reconciliation(uuid, jsonb) is
  'Aplica reconciliação de bolsas. Admin-only. creates aceita holder_id (vincula bolsa a holder existente, evitando duplicados); nome da planilha FUNAPE é fonte da verdade.';


-- ---------- merge_holders (opera em holders globalmente) ----------
create or replace function public.merge_holders(
  p_canonical_id   uuid,
  p_duplicate_ids  uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_moved  integer := 0;
  v_cpf    text;
  v_email  text;
  v_edu    text;
  v_active boolean;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem mesclar bolsistas.';
  end if;

  if p_canonical_id is null then
    raise exception 'holder canônico não informado';
  end if;

  -- Campos consolidados: canônico tem precedência; preenche nulos
  -- com o primeiro valor não-nulo encontrado nos duplicados.
  select
    coalesce(c.cpf,             (select d.cpf             from public.scholarship_holders d where d.id = any(p_duplicate_ids) and d.id <> p_canonical_id and d.cpf             is not null limit 1)),
    coalesce(c.email,           (select d.email           from public.scholarship_holders d where d.id = any(p_duplicate_ids) and d.id <> p_canonical_id and d.email           is not null limit 1)),
    coalesce(c.education_level, (select d.education_level  from public.scholarship_holders d where d.id = any(p_duplicate_ids) and d.id <> p_canonical_id and d.education_level is not null limit 1)),
    -- Holder fica ativo se o canônico OU qualquer duplicado estiver ativo
    (c.active or coalesce((select bool_or(d.active) from public.scholarship_holders d where d.id = any(p_duplicate_ids) and d.id <> p_canonical_id), false))
  into v_cpf, v_email, v_edu, v_active
  from public.scholarship_holders c
  where c.id = p_canonical_id;

  -- Repointa as bolsas dos duplicados para o canônico
  update public.scholarships
  set holder_id = p_canonical_id, updated_at = now()
  where holder_id = any(p_duplicate_ids)
    and holder_id <> p_canonical_id;
  get diagnostics v_moved = row_count;

  -- Remove duplicados (libera o cpf para o canônico)
  delete from public.scholarship_holders
  where id = any(p_duplicate_ids)
    and id <> p_canonical_id;

  -- Aplica campos consolidados ao canônico
  update public.scholarship_holders
  set cpf = v_cpf, email = v_email, education_level = v_edu, active = v_active, updated_at = now()
  where id = p_canonical_id;

  insert into public.scholarship_audit (project_id, action, changes_count, details)
  values (
    null,
    'merge_holders',
    v_moved,
    jsonb_build_object(
      'canonical', p_canonical_id,
      'duplicates', to_jsonb(p_duplicate_ids),
      'scholarships_moved', v_moved
    )
  );

  return v_moved;
end;
$$;

comment on function public.merge_holders(uuid, uuid[]) is
  'Mescla bolsistas duplicados no holder canônico. Admin-only. Repointa bolsas, consolida cpf/email/formação/ativo e remove os duplicados.';


-- ============================================================
-- 10. NOVA RPC: save_user_assignments (admin-only)
-- ============================================================
-- Usada pela página "Usuários & Centros de Custo": define o papel
-- e os centros de custo permitidos de um usuário em uma transação.
create or replace function public.save_user_assignments(
  p_user_id     uuid,
  p_role        text,
  p_project_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem gerenciar atribuições de usuários.';
  end if;

  if p_role not in ('admin','professor') then
    raise exception 'Papel inválido: %', p_role;
  end if;

  update public.app_users
     set role = p_role
   where user_id = p_user_id;

  delete from public.user_projects where user_id = p_user_id;

  if p_project_ids is not null then
    insert into public.user_projects (user_id, project_id)
    select p_user_id, id from unnest(p_project_ids) as id
    on conflict (user_id, project_id) do nothing;
  end if;
end;
$$;

revoke execute on function public.save_user_assignments(uuid, text, uuid[]) from anon;

comment on function public.save_user_assignments is
  'Define o papel (admin/professor) e os centros de custo permitidos de um usuário. Admin-only. Usada pela página Usuários & Centros de Custo.';
-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Row Level Security
-- Migração 002: Políticas de segurança
-- ============================================================
-- 
-- MODELO DE SEGURANÇA:
-- A chave "anon" do Supabase é PÚBLICA por design.
-- Ela vai no frontend e isso é SEGURO, desde que RLS esteja ativo.
-- 
-- Como funciona:
-- 1. Usuário não logado → anon key → RLS bloqueia TUDO
-- 2. Usuário logado → JWT com auth.uid() → RLS libera acesso
-- 3. service_role key → NUNCA vai no frontend (bypassa RLS)
--
-- Para o cenário atual (equipe pequena, todos com acesso total):
-- Qualquer usuário autenticado pode ler e escrever tudo.
-- Quando precisar de perfis (admin vs. leitor), basta ajustar as policies.
-- ============================================================


-- ============================================================
-- Habilitar RLS em todas as tabelas
-- ============================================================

alter table public.projects enable row level security;
alter table public.scholarship_holders enable row level security;
alter table public.scholarships enable row level security;
alter table public.funding_releases enable row level security;
alter table public.expenses enable row level security;
alter table public.dashboard_settings enable row level security;


-- ============================================================
-- Policies: Usuário autenticado pode tudo
-- ============================================================

-- projects
create policy "Autenticado lê projetos"
  on public.projects for select
  to authenticated
  using (true);

create policy "Autenticado insere projetos"
  on public.projects for insert
  to authenticated
  with check (true);

create policy "Autenticado edita projetos"
  on public.projects for update
  to authenticated
  using (true)
  with check (true);

create policy "Autenticado exclui projetos"
  on public.projects for delete
  to authenticated
  using (true);


-- scholarship_holders
create policy "Autenticado lê bolsistas"
  on public.scholarship_holders for select
  to authenticated
  using (true);

create policy "Autenticado insere bolsistas"
  on public.scholarship_holders for insert
  to authenticated
  with check (true);

create policy "Autenticado edita bolsistas"
  on public.scholarship_holders for update
  to authenticated
  using (true)
  with check (true);

create policy "Autenticado exclui bolsistas"
  on public.scholarship_holders for delete
  to authenticated
  using (true);


-- scholarships
create policy "Autenticado lê bolsas"
  on public.scholarships for select
  to authenticated
  using (true);

create policy "Autenticado insere bolsas"
  on public.scholarships for insert
  to authenticated
  with check (true);

create policy "Autenticado edita bolsas"
  on public.scholarships for update
  to authenticated
  using (true)
  with check (true);

create policy "Autenticado exclui bolsas"
  on public.scholarships for delete
  to authenticated
  using (true);


-- funding_releases
create policy "Autenticado lê desembolsos"
  on public.funding_releases for select
  to authenticated
  using (true);

create policy "Autenticado insere desembolsos"
  on public.funding_releases for insert
  to authenticated
  with check (true);

create policy "Autenticado edita desembolsos"
  on public.funding_releases for update
  to authenticated
  using (true)
  with check (true);

create policy "Autenticado exclui desembolsos"
  on public.funding_releases for delete
  to authenticated
  using (true);


-- expenses
create policy "Autenticado lê gastos"
  on public.expenses for select
  to authenticated
  using (true);

create policy "Autenticado insere gastos"
  on public.expenses for insert
  to authenticated
  with check (true);

create policy "Autenticado edita gastos"
  on public.expenses for update
  to authenticated
  using (true)
  with check (true);

create policy "Autenticado exclui gastos"
  on public.expenses for delete
  to authenticated
  using (true);


-- dashboard_settings
create policy "Autenticado lê config dashboard"
  on public.dashboard_settings for select
  to authenticated
  using (true);

create policy "Autenticado insere config dashboard"
  on public.dashboard_settings for insert
  to authenticated
  with check (true);

create policy "Autenticado edita config dashboard"
  on public.dashboard_settings for update
  to authenticated
  using (true)
  with check (true);

create policy "Autenticado exclui config dashboard"
  on public.dashboard_settings for delete
  to authenticated
  using (true);

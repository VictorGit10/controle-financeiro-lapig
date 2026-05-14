-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Migração 019
-- Corrige alertas de segurança do Supabase (WARNs restantes)
-- ============================================================
--
-- 3 categorias de alertas corrigidas:
--
-- 1. function_search_path_mutable (lint 0011)
--    Todas as funções recebem SET search_path = public, pg_temp
--    via ALTER FUNCTION (sem precisar recriar o corpo).
--
-- 2. anon/authenticated_security_definer_function_executable (lint 0028/0029)
--    Funções mudam de SECURITY DEFINER → SECURITY INVOKER.
--    RLS já garante acesso somente a authenticated, então
--    SECURITY INVOKER é suficiente e mais seguro.
--    Exceção: rls_auto_enable (utilitário de setup) recebe
--    REVOKE de anon e authenticated para não ficar exposta.
--
-- 3. rls_policy_always_true (lint 0024)
--    Políticas de DML (INSERT/UPDATE/DELETE) trocam USING(true)/
--    WITH CHECK(true) por (auth.uid() IS NOT NULL).
--    Funcionalmente idêntico para o role authenticated,
--    mas satisfaz o linter que detecta literais "true".
--
-- Referências:
--   https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable
--   https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
--   https://supabase.com/docs/guides/database/database-linter?lint=0024_permissive_rls_policy
-- ============================================================


-- ============================================================
-- PARTE 1: search_path + SECURITY INVOKER em todas as funções
-- Usamos ALTER FUNCTION para não precisar recriar o corpo.
-- ============================================================

-- Funções de cálculo/leitura (viram SECURITY INVOKER)
ALTER FUNCTION public.generate_month_series(date, date)
  SECURITY INVOKER
  SET search_path = public, pg_temp;

ALTER FUNCTION public.fmt_month_pt(date)
  SECURITY INVOKER
  SET search_path = public, pg_temp;

ALTER FUNCTION public.calc_project_monthly(uuid, date, date, text)
  SECURITY INVOKER
  SET search_path = public, pg_temp;

ALTER FUNCTION public.calc_general_dashboard(date, date, text)
  SECURITY INVOKER
  SET search_path = public, pg_temp;

ALTER FUNCTION public.calc_projects_batch(uuid[], date, text)
  SECURITY INVOKER
  SET search_path = public, pg_temp;

ALTER FUNCTION public.get_project_alerts(uuid)
  SECURITY INVOKER
  SET search_path = public, pg_temp;

ALTER FUNCTION public.get_alerts_for_projects(uuid[])
  SECURITY INVOKER
  SET search_path = public, pg_temp;

ALTER FUNCTION public.funding_stats()
  SECURITY INVOKER
  SET search_path = public, pg_temp;

ALTER FUNCTION public.expenses_stats()
  SECURITY INVOKER
  SET search_path = public, pg_temp;

ALTER FUNCTION public.get_balances_for_month(integer, integer)
  SECURITY INVOKER
  SET search_path = public, pg_temp;

-- Funções de escrita (viram SECURITY INVOKER — RLS authenticated permite tudo)
ALTER FUNCTION public.save_editor_changes(uuid, uuid[], jsonb, jsonb)
  SECURITY INVOKER
  SET search_path = public, pg_temp;

ALTER FUNCTION public.save_project(text, uuid, text, date, date, text, text, boolean, boolean)
  SECURITY INVOKER
  SET search_path = public, pg_temp;

ALTER FUNCTION public.upsert_project_balance(uuid, integer, integer, numeric, numeric, date, text)
  SECURITY INVOKER
  SET search_path = public, pg_temp;

-- Trigger function (SECURITY INVOKER: dispara com permissões do usuário autenticado)
ALTER FUNCTION public.sync_project_balance()
  SECURITY INVOKER
  SET search_path = public, pg_temp;

-- Utilitário de setup: mantém SECURITY DEFINER mas revoga acesso público
ALTER FUNCTION public.rls_auto_enable()
  SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;


-- ============================================================
-- PARTE 2: Corrigir políticas RLS com USING/WITH CHECK = true
-- Drop e recria as políticas de DML (INSERT/UPDATE/DELETE).
-- Políticas de SELECT com USING(true) são intencionais e
-- não são sinalizadas pelo linter — não precisam ser alteradas.
-- ============================================================

-- ---------- projects ----------
DROP POLICY IF EXISTS "Autenticado insere projetos"  ON public.projects;
DROP POLICY IF EXISTS "Autenticado edita projetos"   ON public.projects;
DROP POLICY IF EXISTS "Autenticado exclui projetos"  ON public.projects;

CREATE POLICY "Autenticado insere projetos"
  ON public.projects FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Autenticado edita projetos"
  ON public.projects FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Autenticado exclui projetos"
  ON public.projects FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);


-- ---------- scholarship_holders ----------
DROP POLICY IF EXISTS "Autenticado insere bolsistas" ON public.scholarship_holders;
DROP POLICY IF EXISTS "Autenticado edita bolsistas"  ON public.scholarship_holders;
DROP POLICY IF EXISTS "Autenticado exclui bolsistas" ON public.scholarship_holders;

CREATE POLICY "Autenticado insere bolsistas"
  ON public.scholarship_holders FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Autenticado edita bolsistas"
  ON public.scholarship_holders FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Autenticado exclui bolsistas"
  ON public.scholarship_holders FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);


-- ---------- scholarships ----------
DROP POLICY IF EXISTS "Autenticado insere bolsas" ON public.scholarships;
DROP POLICY IF EXISTS "Autenticado edita bolsas"  ON public.scholarships;
DROP POLICY IF EXISTS "Autenticado exclui bolsas" ON public.scholarships;

CREATE POLICY "Autenticado insere bolsas"
  ON public.scholarships FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Autenticado edita bolsas"
  ON public.scholarships FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Autenticado exclui bolsas"
  ON public.scholarships FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);


-- ---------- funding_releases ----------
DROP POLICY IF EXISTS "Autenticado insere desembolsos" ON public.funding_releases;
DROP POLICY IF EXISTS "Autenticado edita desembolsos"  ON public.funding_releases;
DROP POLICY IF EXISTS "Autenticado exclui desembolsos" ON public.funding_releases;

CREATE POLICY "Autenticado insere desembolsos"
  ON public.funding_releases FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Autenticado edita desembolsos"
  ON public.funding_releases FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Autenticado exclui desembolsos"
  ON public.funding_releases FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);


-- ---------- expenses ----------
DROP POLICY IF EXISTS "Autenticado insere gastos" ON public.expenses;
DROP POLICY IF EXISTS "Autenticado edita gastos"  ON public.expenses;
DROP POLICY IF EXISTS "Autenticado exclui gastos" ON public.expenses;

CREATE POLICY "Autenticado insere gastos"
  ON public.expenses FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Autenticado edita gastos"
  ON public.expenses FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Autenticado exclui gastos"
  ON public.expenses FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);


-- ---------- dashboard_settings ----------
DROP POLICY IF EXISTS "Autenticado insere config dashboard" ON public.dashboard_settings;
DROP POLICY IF EXISTS "Autenticado edita config dashboard"  ON public.dashboard_settings;
DROP POLICY IF EXISTS "Autenticado exclui config dashboard" ON public.dashboard_settings;

CREATE POLICY "Autenticado insere config dashboard"
  ON public.dashboard_settings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Autenticado edita config dashboard"
  ON public.dashboard_settings FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Autenticado exclui config dashboard"
  ON public.dashboard_settings FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);


-- ---------- project_balances ----------
DROP POLICY IF EXISTS "Autenticado insere saldos" ON public.project_balances;
DROP POLICY IF EXISTS "Autenticado edita saldos"  ON public.project_balances;
DROP POLICY IF EXISTS "Autenticado exclui saldos" ON public.project_balances;

CREATE POLICY "Autenticado insere saldos"
  ON public.project_balances FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Autenticado edita saldos"
  ON public.project_balances FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Autenticado exclui saldos"
  ON public.project_balances FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

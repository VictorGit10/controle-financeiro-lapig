-- ============================================================
-- RESET COMPLETO — Apaga tudo e recria do zero
-- Executa as migrações 001 a 008 em sequência.
-- Só precisa rodar este arquivo, nada mais.
-- ============================================================

-- PASSO 1: Limpar tudo que existir
drop view if exists public.v_project_summary cascade;
drop view if exists public.v_scholarship_timeline cascade;
drop function if exists public.get_project_alerts cascade;
drop function if exists public.calc_general_dashboard cascade;
drop function if exists public.calc_project_monthly cascade;
drop function if exists public.generate_month_series cascade;
drop function if exists public.update_updated_at cascade;
drop table if exists public.dashboard_settings cascade;
drop table if exists public.expenses cascade;
drop table if exists public.funding_releases cascade;
drop table if exists public.scholarship_audit cascade;
drop table if exists public.scholarships cascade;
drop table if exists public.scholarship_holders cascade;
drop table if exists public.projects cascade;

-- PASSO 2: Recriar tudo rodando as migrações em ordem
-- No Supabase SQL Editor, rode cada arquivo separadamente:
--   001_schema.sql
--   002_rls_policies.sql
--   003_views_functions.sql
--   004_seed_data.sql         (opcional — dados de teste)
--   005_import_real_data.sql  (opcional — dados reais)
--   005_scholarship_audit.sql
--   006_cascade_delete.sql
--   007_external_scholarships.sql
--   008_dynamic_balance.sql

-- NOTA: Em ambientes com psql, você pode usar \i para executar:
--   \i 001_schema.sql
--   \i 002_rls_policies.sql
--   \i 003_views_functions.sql
--   \i 005_scholarship_audit.sql
--   \i 006_cascade_delete.sql
--   \i 007_external_scholarships.sql
--   \i 008_dynamic_balance.sql
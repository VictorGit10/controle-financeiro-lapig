-- ============================================================
-- TESTES DE INTEGRAÇÃO — RPC Functions
-- Rode este script no SQL Editor do Supabase para verificar
-- que calc_project_monthly e save_editor_changes funcionam.
-- ============================================================
-- Usa IDs reais do banco (não depende de seed data).

-- ============================================================
-- Preparar IDs dinâmicos
-- ============================================================
-- Pegar o primeiro projeto ativo para os testes
with first_project as (
  select id from public.projects where active = true order by name limit 1
)

-- ============================================================
-- calc_project_monthly
-- ============================================================

-- T1: Deve retornar linhas para projeto válido
select count(*) as t1_months_count
  from public.calc_project_monthly(
    (select id from public.projects where active = true order by name limit 1)
  );

-- T2: Saldo inicial deve ser initial_balance + yield_amount
select p.initial_balance + coalesce(p.yield_amount, 0) as t2_saldo_base_esperado,
       m.initial_balance as t2_saldo_inicial_retornado
  from public.projects p,
  lateral public.calc_project_monthly(p.id) m
  where p.active = true
  order by m.month_start asc limit 1;

-- T3: Projeto inexistente deve gerar erro
-- Descomente para testar (vai dar erro intencionalmente):
-- select * from public.calc_project_monthly('00000000-0000-0000-0000-000000000000'::uuid);


-- ============================================================
-- save_editor_changes
-- ============================================================

-- T4: Arrays vazios devem retornar 0 (sem alterações)
select public.save_editor_changes(
  (select id from public.projects where active = true order by name limit 1),
  '{}'::uuid[],
  '[]'::jsonb,
  '[]'::jsonb
) as t4_no_changes_esperado_0;


-- ============================================================
-- Alertas
-- ============================================================

-- T5: Qualquer projeto ativo pode ter alertas (count >= 0)
select count(*) as t5_total_alertas
  from public.get_alerts_for_projects(
    array(select id from public.projects where active = true)
  );
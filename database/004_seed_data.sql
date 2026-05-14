-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Seed Data (exemplo)
-- Migração 004: Dados de teste
-- ============================================================
-- 
-- Estes dados servem para testar as views e funções.
-- Na migração real, vamos importar da planilha Google Sheets.
-- ============================================================


-- ============================================================
-- Projetos (baseados na planilha original)
-- ============================================================

insert into public.projects (id, name, start_date, end_date, initial_balance, yield_amount) values
  ('11111111-1111-1111-1111-111111111111', 'Projeto Alpha', '2025-01-01', '2026-12-31', 500000.00, 12500.00),
  ('22222222-2222-2222-2222-222222222222', 'Projeto Beta',  '2025-03-01', '2026-06-30', 300000.00, 8000.00),
  ('33333333-3333-3333-3333-333333333333', 'Projeto Gamma', '2025-06-01', '2027-05-31', 750000.00, 0.00);

-- Incluir Alpha e Gamma no dashboard geral
insert into public.dashboard_settings (project_id, include_in_general) values
  ('11111111-1111-1111-1111-111111111111', true),
  ('22222222-2222-2222-2222-222222222222', false),
  ('33333333-3333-3333-3333-333333333333', true);


-- ============================================================
-- Bolsistas (pessoas)
-- ============================================================

insert into public.scholarship_holders (id, full_name, email) values
  ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Maria Silva', 'maria@email.com'),
  ('aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'João Santos', 'joao@email.com'),
  ('aaaa3333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ana Oliveira', null);


-- ============================================================
-- Bolsas (vinculações pessoa → projeto)
-- ============================================================

insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status) values
  -- Maria no Projeto Alpha: R$ 3.000/mês de jan/2025 a dez/2025
  ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 3000.00, '2025-01-01', '2025-12-31', 'active'),
  -- Maria no Projeto Gamma: R$ 2.500/mês de jul/2025 a jun/2026
  ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 2500.00, '2025-07-01', '2026-06-30', 'active'),
  -- João no Projeto Alpha: R$ 4.000/mês de mar/2025 a fev/2026
  ('aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 4000.00, '2025-03-01', '2026-02-28', 'active'),
  -- João no Projeto Beta: R$ 3.500/mês de abr/2025 a jun/2026
  ('aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 3500.00, '2025-04-01', '2026-06-30', 'active'),
  -- Ana no Projeto Gamma: R$ 2.000/mês de jun/2025 a mai/2027 (excede vigência do projeto!)
  ('aaaa3333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 2000.00, '2025-06-01', '2027-05-31', 'active');


-- ============================================================
-- Desembolsos (entradas de recurso)
-- ============================================================

insert into public.funding_releases (project_id, description, release_date, amount) values
  ('11111111-1111-1111-1111-111111111111', '1ª parcela FUNAPE', '2025-02-15', 150000.00),
  ('11111111-1111-1111-1111-111111111111', '2ª parcela FUNAPE', '2025-07-10', 100000.00),
  ('22222222-2222-2222-2222-222222222222', 'Repasse inicial',   '2025-03-20',  80000.00),
  ('33333333-3333-3333-3333-333333333333', '1ª parcela CNPq',   '2025-06-01', 200000.00),
  ('33333333-3333-3333-3333-333333333333', '2ª parcela CNPq',   '2026-01-15', 180000.00);


-- ============================================================
-- Outros gastos
-- ============================================================

insert into public.expenses (project_id, description, expense_date, amount, category) values
  ('11111111-1111-1111-1111-111111111111', 'Material de escritório',   '2025-01-20', 1500.00, 'material'),
  ('11111111-1111-1111-1111-111111111111', 'Passagem aérea congresso', '2025-04-05', 3200.00, 'viagem'),
  ('11111111-1111-1111-1111-111111111111', 'Inscrição congresso',      '2025-04-05', 800.00,  'evento'),
  ('22222222-2222-2222-2222-222222222222', 'Licença software',         '2025-05-10', 2400.00, 'software'),
  ('33333333-3333-3333-3333-333333333333', 'Equipamento laboratorio',  '2025-08-15', 15000.00, 'equipamento'),
  ('33333333-3333-3333-3333-333333333333', 'Manutenção equipamento',   '2025-11-20', 3500.00, 'manutenção');


-- ============================================================
-- TESTES: Verificar se as funções funcionam
-- ============================================================

-- Teste 1: Cálculo mensal do Projeto Alpha
-- select * from public.calc_project_monthly('11111111-1111-1111-1111-111111111111');

-- Teste 2: Dashboard geral consolidado
-- select * from public.calc_general_dashboard();

-- Teste 3: Alertas do Projeto Gamma (deve retornar alerta de bolsa excedendo vigência)
-- select * from public.get_project_alerts('33333333-3333-3333-3333-333333333333');

-- Teste 4: Timeline da Maria Silva
-- select * from public.v_scholarship_timeline where holder_id = 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- Teste 5: Resumo dos projetos
-- select * from public.v_project_summary;

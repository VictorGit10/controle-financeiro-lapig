-- Cenário de conferência: 4 centros de custo, cada um exercitando
-- uma das restrições.

insert into public.scholarship_holders (id, full_name) values
  ('11111111-1111-1111-1111-111111111111', 'Bolsista Um');

-- ---- P1 Alfa: pequeno, vence logo, tem pessoal e caixa. Deve liderar.
insert into public.projects (id, name, code, end_date) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Alfa', 'A1', '2026-12-31');
insert into public.planos_trabalho (id, project_id, ativo) values
  ('aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', true);
insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto) values
  ('aaaaaaaa-1111-0000-0000-000000000001', 'a', 100000),
  ('aaaaaaaa-1111-0000-0000-000000000001', 'f',  20000);
insert into public.balancetes (id, project_id, data_referencia, saldo_disponivel, rendimento_liquido) values
  ('aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-06-30', 80000, 0);
insert into public.balancete_lancamentos (balancete_id, rubrica_code, saldo_atual) values
  ('aaaaaaaa-2222-0000-0000-000000000001', 'a.bolsas', 40000);
insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 2000, '2026-01-01', '2026-12-31', 'active');

-- ---- P2 Beta: grande, longo. Mais dinheiro, menos urgência.
insert into public.projects (id, name, code, end_date) values
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Beta', 'B2', '2029-07-31');
insert into public.planos_trabalho (id, project_id, ativo) values
  ('bbbbbbbb-1111-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', true);
insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto) values
  ('bbbbbbbb-1111-0000-0000-000000000002', 'a', 300000),
  ('bbbbbbbb-1111-0000-0000-000000000002', 'e', 100000);
insert into public.balancetes (id, project_id, data_referencia, saldo_disponivel, rendimento_liquido) values
  ('bbbbbbbb-2222-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', '2026-06-30', 250000, 0);
insert into public.balancete_lancamentos (balancete_id, rubrica_code, saldo_atual) values
  ('bbbbbbbb-2222-0000-0000-000000000002', 'a.bolsas', 50000);

-- ---- P3 Gama: plano sem letra de pessoal. Portão duro.
insert into public.projects (id, name, code, end_date) values
  ('cccccccc-0000-0000-0000-000000000003', 'Gama', 'C3', '2027-06-30');
insert into public.planos_trabalho (id, project_id, ativo) values
  ('cccccccc-1111-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000003', true);
insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto) values
  ('cccccccc-1111-0000-0000-000000000003', 'f', 50000);
insert into public.balancetes (id, project_id, data_referencia, saldo_disponivel, rendimento_liquido) values
  ('cccccccc-2222-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000003', '2026-06-30', 50000, 0);

-- ---- P4 Delta: orçamento sobra, caixa não. Parcela só entra em 2027.
insert into public.projects (id, name, code, end_date) values
  ('dddddddd-0000-0000-0000-000000000004', 'Delta', 'D4', '2028-12-31');
insert into public.planos_trabalho (id, project_id, ativo) values
  ('dddddddd-1111-0000-0000-000000000004', 'dddddddd-0000-0000-0000-000000000004', true);
insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto) values
  ('dddddddd-1111-0000-0000-000000000004', 'a', 200000);
insert into public.balancetes (id, project_id, data_referencia, saldo_disponivel, rendimento_liquido) values
  ('dddddddd-2222-0000-0000-000000000004', 'dddddddd-0000-0000-0000-000000000004', '2026-06-30', 3000, 0);
insert into public.plano_desembolsos (plano_id, parcela, data_prevista, valor) values
  ('dddddddd-1111-0000-0000-000000000004', 2, '2027-01-15', 150000),
  ('dddddddd-1111-0000-0000-000000000004', 3, null, null);

-- ---- P5 Epsilon: sem plano ativo.
insert into public.projects (id, name, code, end_date) values
  ('eeeeeeee-0000-0000-0000-000000000005', 'Epsilon', 'E5', '2027-12-31');

-- Stub para validar a migração 048 num Postgres descartável.
-- Complementa `stub.sql` + `database/038_saldo_livre.sql` (rode-os antes).
-- NÃO faz parte do projeto.
--
-- Reproduz o 30.068 em 2026-08-31 com os números reais:
--   • plano ativo com a.bolsas = 1.468.800
--   • balancete de 2026-08-03 (ANTES do dia 07 — é esse o ponto) com
--     BOLSA DOAÇÃO = 1.284.800
--   • as 7 bolsas ativas de verdade, mais uma ENCERRADA dentro da
--     janela e uma CANCELADA, para exercitar a parte (B).
--
-- Com a 038 o resultado é compromissos 91.400 / saldo livre 92.600.
-- Com a 048 vira 126.000 / 58.000. A diferença de 34.600 é uma folha.

do $$
declare
  v_proj  uuid;
  v_plano uuid;
  v_bal   uuid;
begin
  insert into public.projects (name, code, start_date, end_date)
  values ('Stub 048 CEMPA', '30.068-S048', '2021-12-13', '2026-12-13')
  returning id into v_proj;

  insert into public.planos_trabalho (project_id, ativo) values (v_proj, true)
  returning id into v_plano;

  insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto) values
    (v_plano, 'a.bolsas', 1468800.00);

  insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido)
  values (v_proj, '2026-08-03', 1960650.04, 150383.77)
  returning id into v_bal;

  insert into public.balancete_lancamentos (balancete_id, rubrica_code, saldo_atual)
  values (v_bal, 'a.bolsas', 1284800.00);

  -- As 7 ativas (nomes fictícios: o stub não carrega PII).
  insert into public.scholarship_holders (full_name) values
    ('Bolsista A1'), ('Bolsista A2'), ('Bolsista A3'), ('Bolsista A4'),
    ('Bolsista A5'), ('Bolsista A6'), ('Bolsista A7'),
    ('Bolsista Encerrado'), ('Bolsista Cancelado');

  insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status)
  select h.id, v_proj, v.amount, v.ini, v.fim, v.st
    from (values
      ('Bolsista A1', 6200.00, date '2025-12-01', date '2026-11-30', 'active'),
      ('Bolsista A2', 6200.00, date '2025-10-01', date '2026-11-30', 'active'),
      ('Bolsista A3', 6200.00, date '2026-04-01', date '2026-09-30', 'active'),
      ('Bolsista A4', 4000.00, date '2025-02-01', date '2026-11-30', 'active'),
      ('Bolsista A5', 4000.00, date '2024-11-01', date '2026-11-30', 'active'),
      ('Bolsista A6', 4000.00, date '2024-11-01', date '2026-11-30', 'active'),
      ('Bolsista A7', 4000.00, date '2024-11-01', date '2026-11-30', 'active'),
      -- (B): encerrou DENTRO da janela nova (agosto). O pagamento de
      -- 07/08 nao esta no balancete de 03/08, entao tem de contar.
      ('Bolsista Encerrado', 3000.00, date '2025-01-01', date '2026-08-31', 'ended'),
      -- Cancelada nunca conta, esteja onde estiver.
      ('Bolsista Cancelado', 5000.00, date '2026-01-01', date '2026-11-30', 'cancelled')
    ) as v(nome, amount, ini, fim, st)
    join public.scholarship_holders h on h.full_name = v.nome;
end $$;

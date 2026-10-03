-- Stub para validar a migração 053 num Postgres descartável.
-- Ordem: stub.sql -> stub-047.sql -> 047 -> stub-049.sql -> stub-050.sql
--        -> 049 -> 050 -> stub-051.sql -> 051 -> stub-052.sql -> 052
--        -> stub-053.sql -> 053 -> test_053
-- NÃO faz parte do projeto.
--
-- Traz um centro com o CÓDIGO REAL '30.068' (a semente da 053 o procura
-- por código), o plano ativo com as descrições reais — algumas com as
-- aspas e o espaço sobrando que existem no banco, para exercitar a
-- normalização — e o grupo 7 do balancete de 03/08/2026 no estado de
-- produção pós-050 (redutoras e estornos já negativos), gravado ANTES da
-- 053: quem atribui o item é o backfill. A conferência é a tabela mandada
-- ao professor em 2026-09-30.

insert into public.conta_rubrica_map (conta_prefix, rubrica_code, descricao) values
  ('7.1.3.01.02', 'a.enc', 'ENCARGOS'),
  ('7.1.3.05.01.00042', 'c', 'PASSAGENS')
on conflict (conta_prefix) do nothing;

do $$
declare
  v_proj  uuid;
  v_plano uuid;
  v_bal   uuid;
begin
  insert into public.projects (name, code, start_date, end_date)
  values ('CEMPA FAPEG (stub 053)', '30.068', '2021-12-13', '2026-12-13')
  returning id into v_proj;

  insert into public.planos_trabalho (project_id, ativo) values (v_proj, true)
  returning id into v_plano;

  insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto, descricao_livre) values
    (v_plano, 'a.bolsas', 1468800.00, 'Bolsas'),
    (v_plano, 'b',         132444.77, '"Serviços técnicos especializaos "'),
    (v_plano, 'b',          35000.00, 'Pagamento inscrição para participação de congressos, eventos, simpósios entre outros'),
    (v_plano, 'b',           7314.00, 'Manutenção de máquinas e equipamentos'),
    (v_plano, 'c',         135000.00, 'Passagens e Despesas com Locomoção'),
    (v_plano, 'd',         290800.00, 'Despesas com diárias'),
    (v_plano, 'e',          33000.00, 'Componentes eletronicos Manutenção de máquinas e equipamentos'),
    (v_plano, 'e',          10000.00, '"Impressão de material gráfico para divulgação do CEMPA-Cerrado"'),
    (v_plano, 'e',           8905.00, 'Componentes eletronicos Peças de informática'),
    (v_plano, 'f',        1584230.60, 'Bens permanentes (clusters e equipamentos)'),
    (v_plano, 'f',         172411.00, 'Serviços de transporte de equipamentos e taxas de importação'),
    (v_plano, 'dao',       204100.28, 'DAO Funape');

  insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido)
  values (v_proj, '2026-08-03', 1960650.04, 150383.77)
  returning id into v_bal;

  -- o gatilho (versão pré-053) resolve a letra pelo mapa global
  insert into public.balancete_lancamentos (balancete_id, conta_codigo, conta_descricao, valor_debito, valor_credito, saldo_atual)
  values
    (v_bal, '7.1.1.01.02.96789', '( + ) APROPRIACAO DE RECEITA CON',      0, 2874532.60,  2874532.60),
    (v_bal, '7.1.1.08.20.99553', 'RECUPERACAO DESPESAS BANCARIAS',          0,     519.24,     -519.24),
    (v_bal, '7.1.1.08.22.98672', 'RECUPERACAO DESP APAR. EQUIP/UTE',        0,  559665.48,  -559665.48),
    (v_bal, '7.1.1.08.22.98772', 'RECUPERACAO DESP EQUIP DE INFORM',        0,  835061.78,  -835061.78),
    (v_bal, '7.1.1.08.50.97012', '( + ) TRANSF ADTO IMPORT DE DESP',        0,  491778.58,  -491778.58),
    (v_bal, '7.1.3.02.01.00001', 'DESPESAS C/ DIARIAS NO PAIS',      54895.00,    5865.00,    49030.00),
    (v_bal, '7.1.3.02.01.00002', 'DIARIAS NO EXTERIOR',              17985.70,       0,       17985.70),
    (v_bal, '7.1.3.03.01.00009', 'MATERIAL DE INFORMATICA',           9001.60,       0,        9001.60),
    (v_bal, '7.1.3.03.01.91999', 'MATERIAL MANUTENCAO MAQ. E EQUIP', 23700.00,       0,       23700.00),
    (v_bal, '7.1.3.04.01.09142', 'BOLSA DOACAO',                   1284800.00,       0,     1284800.00),
    (v_bal, '7.1.3.05.01.00004', 'SERVICOS TECNICOS PROFISSIONAIS',   3050.00,       0,        3050.00),
    (v_bal, '7.1.3.05.01.00014', 'EXPOSICAO, CONGRESSO, OFICINA E',   8252.33,       0,        8252.33),
    (v_bal, '7.1.3.05.01.00027', 'SERVICOS ANALISE PESQU CIENTIFI',   5666.63,       0,        5666.63),
    (v_bal, '7.1.3.05.01.00035', 'SERVICOS GRAFICOS',                  450.00,       0,         450.00),
    (v_bal, '7.1.3.05.01.00039', 'CONFECCAO UNIFORMES, BAND. FLAMU',  9320.00,       0,        9320.00),
    (v_bal, '7.1.3.05.01.00042', 'PASSAGENS E DEPESAS COM LOCOMOCA',117612.63,    1325.22,   116287.41),
    (v_bal, '7.1.3.05.01.00043', 'FRETES, TRANSP. CARGAS E ENCOMEN', 34500.54,       0,       34500.54),
    (v_bal, '7.1.3.05.01.00051', 'DESPESA ADM E OPERACIONAL (DAO)', 132797.56,     201.87,   132595.69),
    (v_bal, '7.1.3.05.01.00054', 'DESPESA SERVICOS BANCARIOS',         896.39,     377.15,      519.24),
    (v_bal, '7.1.3.05.01.00069', 'DESPESAS ACESSORIAS COM IMPORTAC', 65646.26,   22319.13,    43327.13),
    (v_bal, '7.1.3.05.01.00099', 'OUTROS SERVICOS TERCEIROS PJ',       360.00,       0,         360.00),
    (v_bal, '7.1.3.05.01.00129', '( - ) FRETES E TRANSP S/ IMPORTA',      0,      19531.30,   -19531.30),
    (v_bal, '7.1.3.05.01.00130', '( - ) DESPESAS ACESSORIAS COM IM',      0,      20837.50,   -20837.50),
    (v_bal, '7.1.3.05.01.93482', 'REALIZACAO DE EVENTOS (CONGRESSO',   600.00,       0,         600.00),
    (v_bal, '7.1.3.20.50.00003', 'APAR. EQUIPAMENTOS/ UTENSILIOS',  559665.48,       0,      559665.48),
    (v_bal, '7.1.3.20.50.00009', 'EQUIPAMENTOS DE INFORMATICA - PR', 835061.78,      0,      835061.78),
    (v_bal, '7.1.3.20.50.00017', 'EQUIPAMENTOS DIVERSOS',           147997.68,  147997.68,          0),
    (v_bal, '7.1.3.20.50.09869', 'IMPORTACAO EM ANDAMENTO - BENS P',1155895.45, 664116.87,   491778.58),
    (v_bal, '7.1.3.20.51.00002', '( - ) VARIACAO CAMBIAL NEGATIVA',       0,      22362.35,   -22362.35),
    (v_bal, '7.1.3.50.02.94664', 'DOACOES DE BENS ENTRE C.C',       117061.96,       0,      117061.96),
    (v_bal, '7.1.3.50.06.08942', 'DOACOES DE BENS DE PROJETOS',    1425662.98,       0,     1425662.98);

  -- o professor do 30.068 (o mesmo b1 do stub-051)
  insert into public.user_projects (user_id, project_id)
  values ('00000000-0000-0000-0000-0000000000b1', v_proj)
  on conflict do nothing;
end $$;

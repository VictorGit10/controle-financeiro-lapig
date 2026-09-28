-- Stub para validar a migração 049 num Postgres descartável.
-- Ordem: stub.sql -> stub-047.sql -> 047 -> stub-049.sql -> 049.
-- NÃO faz parte do projeto.
--
-- Traz de propósito o estado COM O DEFEITO: o grupo 7 inteiro do
-- balancete real do 30.068 (03/08/2026) gravado como o parser antigo
-- gravava — redutoras "( - )" e recuperações 7.1.1.08 POSITIVAS, e as
-- contas de doação/estorno sem rubrica. Sem isso o roteiro test_049
-- passaria por acidente.

do $$
declare
  v_proj  uuid;
  v_plano uuid;
  v_bal   uuid;
begin
  insert into public.projects (name, code, start_date, end_date)
  values ('Stub 049 CEMPA', '30.068-STUB49', '2021-12-13', '2026-12-13')
  returning id into v_proj;

  insert into public.planos_trabalho (project_id, ativo) values (v_proj, true)
  returning id into v_plano;

  -- Plano ativo real do 30.068.
  insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto, descricao_livre) values
    (v_plano, 'a.bolsas', 1468800.00, 'Bolsas'),
    (v_plano, 'b',         132444.77, 'Servicos tecnicos especializados'),
    (v_plano, 'b',          35000.00, 'Inscricao em congressos'),
    (v_plano, 'b',           7314.00, 'Manutencao de maquinas e equipamentos'),
    (v_plano, 'c',         135000.00, 'Passagens e Despesas com Locomocao'),
    (v_plano, 'd',         290800.00, 'Despesas com diarias'),
    (v_plano, 'e',          33000.00, 'Componentes eletronicos - manutencao'),
    (v_plano, 'e',          10000.00, 'Impressao de material grafico'),
    (v_plano, 'e',           8905.00, 'Componentes eletronicos - pecas de informatica'),
    (v_plano, 'f',        1584230.60, 'Bens permanentes'),
    (v_plano, 'f',         172411.00, 'Transporte de equipamentos e taxas de importacao'),
    (v_plano, 'dao',       204100.28, 'DAO Funape');

  insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido)
  values (v_proj, '2026-08-03', 1960650.04, 150383.77)
  returning id into v_bal;

  insert into public.balancete_lancamentos (balancete_id, conta_codigo, conta_descricao, saldo_atual, rubrica_code)
  select v_bal, c.codigo, c.descr, c.valor, public.resolve_rubrica_for_conta(c.codigo)
    from (values
      ('7.1.1.01.02.00006', '( + ) APROPRIACAO DE RENDIMENTO',     47668.73),
      ('7.1.1.01.02.96789', '( + ) APROPRIACAO DE RECEITA CON',  2874532.60),
      ('7.1.1.01.07.00001', '( + ) APROPRIACAO DE RENDIMENTO',     77761.04),
      ('7.1.1.01.07.00005', 'GANHO VAR CAMBIAL S/ IMPORT BENS',     9175.70),
      ('7.1.1.08.20.99553', 'RECUPERACAO DESPESAS BANCARIAS',        519.24),
      ('7.1.1.08.22.98672', 'RECUPERACAO DESP APAR. EQUIP/UTE',   559665.48),
      ('7.1.1.08.22.98772', 'RECUPERACAO DESP EQUIP DE INFORM',   835061.78),
      ('7.1.1.08.50.97012', '( + ) TRANSF ADTO IMPORT DE DESP',   491778.58),
      ('7.1.3.02.01.00001', 'DESPESAS C/ DIARIAS NO PAIS',         49030.00),
      ('7.1.3.02.01.00002', 'DIARIAS NO EXTERIOR',                 17985.70),
      ('7.1.3.03.01.00009', 'MATERIAL DE INFORMATICA',              9001.60),
      ('7.1.3.03.01.91999', 'MATERIAL MANUTENCAO MAQ. E EQUIP',    23700.00),
      ('7.1.3.04.01.09142', 'BOLSA DOACAO',                      1284800.00),
      ('7.1.3.05.01.00004', 'SERVICOS TECNICOS PROFISSIONAIS',      3050.00),
      ('7.1.3.05.01.00014', 'EXPOSICAO, CONGRESSO, OFICINA E',      8252.33),
      ('7.1.3.05.01.00027', 'SERVICOS ANALISE PESQU CIENTIFI',      5666.63),
      ('7.1.3.05.01.00035', 'SERVICOS GRAFICOS',                     450.00),
      ('7.1.3.05.01.00039', 'CONFECCAO UNIFORMES, BAND. FLAMU',     9320.00),
      ('7.1.3.05.01.00042', 'PASSAGENS E DEPESAS COM LOCOMOCA',   116287.41),
      ('7.1.3.05.01.00043', 'FRETES, TRANSP. CARGAS E ENCOMEN',    34500.54),
      ('7.1.3.05.01.00051', 'DESPESA ADM E OPERACIONAL (DAO)',    132595.69),
      ('7.1.3.05.01.00054', 'DESPESA SERVICOS BANCARIOS',            519.24),
      ('7.1.3.05.01.00069', 'DESPESAS ACESSORIAS COM IMPORTAC',    43327.13),
      ('7.1.3.05.01.00099', 'OUTROS SERVICOS TERCEIROS PJ',          360.00),
      ('7.1.3.05.01.00129', '( - ) FRETES E TRANSP S/ IMPORTA',    19531.30),
      ('7.1.3.05.01.00130', '( - ) DESPESAS ACESSORIAS COM IM',    20837.50),
      ('7.1.3.05.01.93482', 'REALIZACAO DE EVENTOS (CONGRESSO',      600.00),
      ('7.1.3.20.50.00003', 'APAR. EQUIPAMENTOS/ UTENSILIOS',     559665.48),
      ('7.1.3.20.50.00009', 'EQUIPAMENTOS DE INFORMATICA - PR',   835061.78),
      ('7.1.3.20.50.00017', 'EQUIPAMENTOS DIVERSOS',                   0.00),
      ('7.1.3.20.50.09869', 'IMPORTACAO EM ANDAMENTO - BENS P',   491778.58),
      ('7.1.3.20.51.00002', '( - ) VARIACAO CAMBIAL NEGATIVA',     22362.35),
      ('7.1.3.50.02.94664', 'DOACOES DE BENS ENTRE C.C',          117061.96),
      ('7.1.3.50.06.08942', 'DOACOES DE BENS DE PROJETOS',       1425662.98)
    ) as c(codigo, descr, valor);
end $$;

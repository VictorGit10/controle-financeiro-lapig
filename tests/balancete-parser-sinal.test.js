import { describe, it, expect } from 'vitest';
import { parseBalanceteText } from '../frontend/js/parsers/balancete-parser.js';

/* ============================================================
   Sinal das redutoras "( - )" e das recuperações de despesa
   (mig. 049). Fixture: grupo 7 do balancete real do 30.068 de
   03/08/2026, linha por linha como o pdf.js extrai. As contas-mãe
   de 4 níveis estão presentes de propósito — são elas que o parser
   usa para conferir o sinal das folhas.
   ============================================================ */

const FIX_30068 = `FUNDACAO DE APOIO A PESQUISA - CNPJ 00.799.205/0001-89 Balancete Contábil Analítico 01/01/2000 a 03/08/2026 Pág.: 1
00.799.205/0001-89 Emissão: 05/08/2026 15:29
Conta Reduzido Descrição Anterior Débitos Créditos Movimento Saldo Atual
1.1.1.02.03.92411 92411 30.068 20899-X BB/FU SIMP SOLIDE 0,00 4.416.979,47 (3.234.838,51) 1.182.140,96 1.182.140,96
7.1.1.01 2592170 ( + ) RECEITAS DE RECURSOS C/ RE 0,00 0,00 3.009.138,07 3.009.138,07 3.009.138,07
7.1.1.01.02.00006 2512006 ( + ) APROPRIACAO DE RENDIMENTO 0,00 0,00 47.668,73 47.668,73 47.668,73
7.1.1.01.02.96789 2596789 ( + ) APROPRIACAO DE RECEITA CON 0,00 0,00 2.874.532,60 2.874.532,60 2.874.532,60
7.1.1.01.07.00001 258422 ( + ) APROPRIACAO DE RENDIMENTO 0,00 0,00 77.761,04 77.761,04 77.761,04
7.1.1.01.07.00005 2597681 GANHO VAR CAMBIAL S/ IMPORT BENS 0,00 0,00 9.175,70 9.175,70 9.175,70
7.1.1.08 96804 ( + ) RECUPERACAO DE DESPESA 0,00 0,00 1.887.025,08 1.887.025,08 1.887.025,08
7.1.1.08.20.99553 71199553 RECUPERACAO DESPESAS BANCARIAS 0,00 0,00 519,24 519,24 519,24
7.1.1.08.22.98672 71198672 RECUPERACAO DESP APAR. EQUIP/UTE 0,00 0,00 559.665,48 559.665,48 559.665,48
7.1.1.08.22.98772 71198772 RECUPERACAO DESP EQUIP DE INFORM 0,00 0,00 835.061,78 835.061,78 835.061,78
7.1.1.08.50.97012 71197012 ( + ) TRANSF ADTO IMPORT DE DESP 0,00 0,00 491.778,58 491.778,58 491.778,58
7.1.3.02 2521323 DIÁRIAS 0,00 72.880,70 (5.865,00) 67.015,70 67.015,70
7.1.3.02.01.00001 2503001 DESPESAS C/ DIARIAS NO PAIS 0,00 54.895,00 (5.865,00) 49.030,00 49.030,00
7.1.3.02.01.00002 2503002 DIÁRIAS NO EXTERIOR 0,00 17.985,70 0,00 17.985,70 17.985,70
7.1.3.04 2521325 SERVIÇOS TERCEIROS PESSOA FISICA 0,00 1.284.800,00 0,00 1.284.800,00 1.284.800,00
7.1.3.04.01.09142 2579142 BOLSA DOAÇÃO 0,00 1.284.800,00 0,00 1.284.800,00 1.284.800,00
7.1.3.05 2521326 SERVIÇOS TERCEIROS PESSOA JURIDI 0,00 379.152,34 (64.592,17) 314.560,17 314.560,17
7.1.3.05.01.00004 2506004 SERVIÇOS TECNICOS PROFISSIONAIS 0,00 3.050,00 0,00 3.050,00 3.050,00
7.1.3.05.01.00014 2506014 EXPOSIÇÃO, CONGRESSO, OFICINA E 0,00 8.252,33 0,00 8.252,33 8.252,33
7.1.3.05.01.00027 2506027 SERVIÇOS ANALISE PESQU CIENTIFI 0,00 5.666,63 0,00 5.666,63 5.666,63
7.1.3.05.01.00035 2506035 SERVIÇOS GRAFICOS 0,00 450,00 0,00 450,00 450,00
7.1.3.05.01.00039 2506039 CONFECÇÃO UNIFORMES, BAND. FLAMU 0,00 9.320,00 0,00 9.320,00 9.320,00
7.1.3.05.01.00042 2506042 PASSAGENS E DEPESAS COM LOCOMOÇÃ 0,00 117.612,63 (1.325,22) 116.287,41 116.287,41
7.1.3.05.01.00043 2506043 FRETES, TRANSP. CARGAS E ENCOMEN 0,00 34.500,54 0,00 34.500,54 34.500,54
7.1.3.05.01.00051 252475 DESPESA ADM E OPERACIONAL (DAO) 0,00 132.797,56 (201,87) 132.595,69 132.595,69
7.1.3.05.01.00054 2506054 DESPESA SERVIÇOS BANCÁRIOS 0,00 896,39 (377,15) 519,24 519,24
7.1.3.05.01.00069 2506069 DESPESAS ACESSORIAS COM IMPORTAC 0,00 65.646,26 (22.319,13) 43.327,13 43.327,13
7.1.3.05.01.00099 2506099 OUTROS SERVIÇOS TERCEIROS PJ 0,00 360,00 0,00 360,00 360,00
7.1.3.05.01.00129 2599524 ( - ) FRETES E TRANSP S/ IMPORTA 0,00 0,00 19.531,30 19.531,30 19.531,30
7.1.3.05.01.00130 2599525 ( - ) DESPESAS ACESSORIAS COM IM 0,00 0,00 20.837,50 20.837,50 20.837,50
7.1.3.05.01.93482 2593482 REALIZAÇÃO DE EVENTOS (CONGRESSO 0,00 600,00 0,00 600,00 600,00
7.1.3.20 2521327 DESPESAS DE CAPITAL (OBRAS E PER 0,00 2.698.620,39 (834.476,90) 1.864.143,49 1.864.143,49
7.1.3.20.50.00003 2508003 APAR. EQUIPAMENTOS/ UTENSILIOS 0,00 559.665,48 0,00 559.665,48 559.665,48
7.1.3.20.50.00009 2508009 EQUIPAMENTOS DE INFORMATICA - PR 0,00 835.061,78 0,00 835.061,78 835.061,78
7.1.3.20.50.00017 2508017 EQUIPAMENTOS DIVERSOS 0,00 147.997,68 (147.997,68) 0,00 0,00
7.1.3.20.50.09869 2599869 IMPORTAÇÃO EM ANDAMENTO - BENS P 0,00 1.155.895,45 (664.116,87) 491.778,58 491.778,58
7.1.3.20.51 253758 VARIACAO CAMBIAL S/ AQUISICAO DE 0,00 0,00 (22.362,35) (22.362,35) (22.362,35)
7.1.3.20.51.00002 2595092 ( - ) VARIAÇÃO CAMBIAL NEGATIVA 0,00 0,00 22.362,35 22.362,35 22.362,35
7.1.3.50 2521331 AUXILIOS, DOAÇÕES, APOIOS E CONT 0,00 1.542.724,94 0,00 1.542.724,94 1.542.724,94
7.1.3.50.02.94664 2594664 DOAÇÕES DE BENS ENTRE C.C 0,00 117.061,96 0,00 117.061,96 117.061,96
7.1.3.50.06.08942 258942 DOAÇÕES DE BENS DE PROJETOS 0,00 1.425.662,98 0,00 1.425.662,98 1.425.662,98
7.1.3.62 7135153 DESPESAS FINANCEIRAS(C/ RESTRICA 0,00 22.362,35 0,00 22.362,35 22.362,35
7.1.3.62.01.94123 94123 PERDA COM VARIACAO CAMBIAL S/ IM 0,00 22.362,35 0,00 22.362,35 22.362,35
TOTAL DE DÉBITOS : 24.409.792,33
TOTAL DE CRÉDITOS: 24.409.792,33
SALDO DISPONÍVEL PÓS IR/IOF ESTIMADO S/ REND. APL. FINANCEIRA == >> R$ 1.960.650,04
RENDIMENTO LÍQUIDO APURADO ==>> R$ 150.383,77`;

const lancs = () => parseBalanceteText(FIX_30068).data.lancamentos;
const valor = (conta) => lancs().find(l => l.conta_codigo === conta)?.saldo_atual;
const somaPor = (prefixos, excluir = []) => Math.round(lancs()
  .filter(l => prefixos.some(p => l.conta_codigo.startsWith(p))
            && !excluir.some(p => l.conta_codigo.startsWith(p)))
  .reduce((s, l) => s + l.saldo_atual, 0) * 100) / 100;

describe('parseBalanceteText — redutoras "( - )" de 7.1.3', () => {
  it('grava as redutoras negativas, embora a linha as imprima sem parênteses', () => {
    expect(valor('7.1.3.05.01.00129')).toBeCloseTo(-19531.30, 2);
    expect(valor('7.1.3.05.01.00130')).toBeCloseTo(-20837.50, 2);
    expect(valor('7.1.3.20.51.00002')).toBeCloseTo(-22362.35, 2);
  });

  it('não mexe em conta comum, nem em descrição com parênteses no meio', () => {
    expect(valor('7.1.3.05.01.00069')).toBeCloseTo(43327.13, 2);
    expect(valor('7.1.3.05.01.00051')).toBeCloseTo(132595.69, 2);  // "(DAO)"
  });

  it('as folhas de 7.1.3.05 fecham com a conta-mãe impressa', () => {
    expect(somaPor(['7.1.3.05.'])).toBeCloseTo(314560.17, 2);
  });
});

describe('parseBalanceteText — recuperação de despesa (7.1.1.08)', () => {
  it('grava o estorno negativo', () => {
    expect(valor('7.1.1.08.22.98672')).toBeCloseTo(-559665.48, 2);
    expect(valor('7.1.1.08.22.98772')).toBeCloseTo(-835061.78, 2);
    expect(valor('7.1.1.08.50.97012')).toBeCloseTo(-491778.58, 2);
    expect(valor('7.1.1.08.20.99553')).toBeCloseTo(-519.24, 2);
  });

  it('receita (7.1.1.01) continua como está', () => {
    expect(valor('7.1.1.01.02.96789')).toBeCloseTo(2874532.60, 2);
  });
});

describe('parseBalanceteText — realizado por rubrica com o mapa da mig. 049', () => {
  // Os prefixos repetem conta_rubrica_map (026/047/049). É a conta que
  // as RPCs fazem: soma de saldo_atual por rubrica.
  it('f = capital + doação de bens − estornos = 1.520.362,59', () => {
    expect(somaPor(['7.1.3.20.', '7.1.3.50.06.', '7.1.3.50.02.94664',
                    '7.1.1.08.22.', '7.1.1.08.50.'])).toBeCloseTo(1520362.59, 2);
  });

  it('b = 7.1.3.05 sem passagens e DAO, menos a tarifa recuperada = 65.157,83', () => {
    expect(somaPor(['7.1.3.05.', '7.1.1.08.20.'],
                   ['7.1.3.05.01.00042', '7.1.3.05.01.00051'])).toBeCloseTo(65157.83, 2);
  });
});

describe('parseBalanceteText — conferência contra a conta-mãe', () => {
  it('sem aviso quando todas as contas-mãe fecham', () => {
    const { warnings } = parseBalanceteText(FIX_30068);
    expect(warnings.filter(w => w.startsWith('Conta 7.'))).toEqual([]);
  });

  it('avisa quando uma folha não fecha com a mãe', () => {
    // Uma linha que não casa com o padrão some da soma — a conferência
    // tem de apontar a conta-mãe em vez de gravar o total menor calado.
    const quebrado = FIX_30068.replace(
      '7.1.3.05.01.00129 2599524 ( - ) FRETES E TRANSP S/ IMPORTA 0,00 0,00 19.531,30 19.531,30 19.531,30',
      '7.1.3.05.01.00129 2599524 ( - ) FRETES E TRANSP S/ IMPORTA 0,00 0,00 19.531,30');
    const { warnings } = parseBalanceteText(quebrado);
    expect(warnings.some(w => w.startsWith('Conta 7.1.3.05:'))).toBe(true);
  });
});

describe('parseBalanceteText — "( - )" no nome não é redutora', () => {
  // Pessoal CLT do 30.111 (2026-09): "( - ) 13º SALARIO", "( - ) FÉRIAS"
  // e os encargos "( - )" são DÉBITOS — gasto normal, somado pela mãe.
  // A mig. 049 decidia pelo nome e os gravava negativos.
  const FIX_CLT = `FUNDACAO DE APOIO A PESQUISA Balancete Contábil Analítico 01/01/2000 a 07/09/2026 Pág.: 1
00.799.205/0001-89 Emissão: 09/09/2026 10:55
1.1.1.02.02.99999 99999 30.111 00000-0 BB/FU PROJETO 0,00 1,00 (1,00) 0,00 0,00
7.1.1.01 2592170 ( + ) RECEITAS DE RECURSOS C/ RE 0,00 (45.670,75) 45.670,75 0,00 0,00
7.1.1.01.09.91281 2591281 ( + ) TRANSF. NUM ENTRE CENTRO D 0,00 0,00 45.670,75 45.670,75 45.670,75
7.1.1.01.09.91282 2591282 ( - ) TRANSF. NUM ENTRE CENTRO D 0,00 45.670,75 0,00 45.670,75 45.670,75
7.1.3.01 7.1.3.01 CUSTOS C/ PESSOAL - REC. RESTRI 0,00 15.811,44 (10,01) 15.801,43 15.801,43
7.1.3.01.01.00001 2501001 SALARIOS 0,00 9.110,00 0,00 9.110,00 9.110,00
7.1.3.01.01.00007 2501007 ( - ) 13º SALARIO 0,00 759,16 0,00 759,16 759,16
7.1.3.01.01.00016 2501016 ( - ) FÉRIAS 0,00 1.012,23 0,00 1.012,23 1.012,23
7.1.3.01.02.00001 2502001 DESPESA C/ FGTS S/FOLHA (PRJ) 0,00 870,50 0,00 870,50 870,50
7.1.3.01.02.00002 2502002 CONTRIBUIÇÃO PREVIDENCIARIA - IN 0,00 2.910,53 0,00 2.910,53 2.910,53
7.1.3.01.02.00004 2502004 ( - ) PIS S/ FOLHA 0,00 108,82 (0,01) 108,81 108,81
7.1.3.01.02.00010 2502010 ( - ) FGTS S/FÉRIAS PRJ 0,00 0,02 0,00 0,02 0,02
7.1.3.01.02.00014 2502014 ( - ) INSS S/FÉRIAS PRJ 0,00 0,01 0,00 0,01 0,01
7.1.3.01.02.00015 2502015 ( - ) INSS S/13º SALARIO PRJ 0,00 0,01 0,00 0,01 0,01
7.1.3.01.03.00005 2503005 VALE ALIMENTAÇÃO FUNCIONÁRIOS 0,00 1.040,16 (10,00) 1.030,16 1.030,16
TOTAL DE DÉBITOS : 1,00
TOTAL DE CRÉDITOS: 1,00
SALDO DISPONÍVEL PÓS IR/IOF ESTIMADO S/ REND. APL. FINANCEIRA == >> R$ 469.259,97
RENDIMENTO LÍQUIDO APURADO ==>> R$ 21.637,70`;

  it('encargo "( - )" com débito entra positivo', () => {
    const l = parseBalanceteText(FIX_CLT).data.lancamentos;
    expect(l.find(x => x.conta_codigo === '7.1.3.01.01.00016').saldo_atual).toBeCloseTo(1012.23, 2);
    expect(l.find(x => x.conta_codigo === '7.1.3.01.02.00004').saldo_atual).toBeCloseTo(108.81, 2);
  });

  it('as contas-mãe de pessoal e de receita fecham', () => {
    const { warnings } = parseBalanceteText(FIX_CLT);
    expect(warnings.filter(w => w.startsWith('Conta 7.'))).toEqual([]);
  });

  it('a despesa financeira ignorada também é conferida, mas não é gravada', () => {
    expect(valor('7.1.3.62.01.94123')).toBeUndefined();
    const { warnings } = parseBalanceteText(FIX_30068);
    expect(warnings.some(w => w.startsWith('Conta 7.1.3.62'))).toBe(false);
  });
});

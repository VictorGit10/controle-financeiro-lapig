import { describe, it, expect } from 'vitest';
import { parseBalanceteText } from '../frontend/js/parsers/balancete-parser.js';

/* ============================================================
   Fixtures sintéticas reproduzindo o texto que pdf.js extrai dos
   PDFs reais em Registro_e_automatizações/. As linhas mantêm
   espaçamento simples (já normalizado, como sai do extractor).
   ============================================================ */

// FIX_30113 cobre as 3 hierarquias do PDF real:
//   nível 4: 7.1.3.04 (categoria — agregador, IGNORAR)
//   nível 5: 7.1.3.04.01 (subgrupo — agregador, IGNORAR)
//   nível 6: 7.1.3.04.01.09142 (linha real — FOLHA)
// Os valores das 3 batem (R$ 158.000) — salvar mais que a folha duplica.
const FIX_30113 = `FUNDACAO DE APOIO A PESQUISA - CNPJ 00.799.205/0001-89 Balancete Contábil Analítico 01/01/2000 a 13/04/2026 Pág.: 1
00.799.205/0001-89 Emissão: 15/04/2026 11:44
Conta Reduzido Descrição Anterior Débitos Créditos Movimento Saldo Atual
1 1 A T I V O 0,00 837.793,60 (655.992,51) 181.801,09 181.801,09
1.1.1.02.02 3224 BANCOS CONTA MOVIMENTO - PROJETO 0,00 496.182,96 (496.182,96) 0,00 0,00
1.1.1.02.02.98491 98491 30.113 24036-2 BB/FU PROJ CIRAND 0,00 496.182,96 (496.182,96) 0,00 0,00
7 2592167 RESULTADO DE RECURSOS COM RESTRI 0,00 (197.530,40) 0,00 (197.530,40) (197.530,40)
7.1.3 25213222 CUSTOS/DESPESAS RECURSOS C/ REST 0,00 197.530,40 0,00 197.530,40 197.530,40
7.1.3.03 2521324 MATERIAL DE CONSUMO 0,00 225,80 0,00 225,80 225,80
7.1.3.03.01 25213241 MATERIAL DE CONSUMO 0,00 225,80 0,00 225,80 225,80
7.1.3.03.01.00006 2504006 MATERIAL DE CONSUMO 0,00 225,80 0,00 225,80 225,80
7.1.3.04 2521325 SERVIÇOS TERCEIROS PESSOA FISICA 0,00 158.000,00 0,00 158.000,00 158.000,00
7.1.3.04.01 25213251 SERVIÇOS TERCEIROS PESSOA FISICA 0,00 158.000,00 0,00 158.000,00 158.000,00
7.1.3.04.01.09142 2579142 BOLSA DOAÇÃO 0,00 158.000,00 0,00 158.000,00 158.000,00
7.1.3.05 2521326 SERVIÇOS TERCEIROS PESSOA JURIDI 0,00 38.293,53 0,00 38.293,53 38.293,53
7.1.3.05.01 25213261 SERVIÇOS TERCEIROS PESSOA JURIDI 0,00 38.293,53 0,00 38.293,53 38.293,53
7.1.3.05.01.00027 2506027 SERVIÇOS ANALISE PESQU CIENTIFI 0,00 345,00 0,00 345,00 345,00
7.1.3.05.01.00051 252475 DESPESA ADM E OPERACIONAL (DAO) 0,00 19.678,48 0,00 19.678,48 19.678,48
7.1.3.05.01.00054 2506054 DESPESA SERVIÇOS BANCÁRIOS 0,00 126,28 0,00 126,28 126,28
7.1.3.05.01.99520 2599520 FUNDO LOCAL CIP 0,00 6.036,56 0,00 6.036,56 6.036,56
7.1.3.05.01.99521 2599521 FUNDO INSTITUCIONAL CIP 0,00 12.107,21 0,00 12.107,21 12.107,21
7.1.3.60 2599328 DESPESAS TRIBUTARIAS 0,00 461,07 0,00 461,07 461,07
7.1.3.60.01.00001 2599330 IR S/APLICAÇÃO FINANCEIRA 0,00 296,74 0,00 296,74 296,74
7.1.3.60.01.00002 2599331 IOF S/APLICAÇÃO FINANCEIRA 0,00 164,33 0,00 164,33 164,33
7.1.3.62.01.98298 2598298 DESPESA COM IOF S/ RECEBIMENTO D 0,00 550,00 0,00 550,00 550,00
TOTAL DE DÉBITOS : 1.194.120,60
TOTAL DE CRÉDITOS: 1.194.120,60
SALDO DISPONÍVEL PÓS IR/IOF ESTIMADO S/ REND. APL. FINANCEIRA == >> R$ 143.260,76
RENDIMENTO LÍQUIDO APURADO ==>> R$ 4.213,69
GOIÂNIA, 15 de Abril de 2026`;

// PDF 30.076 — tem estornos (créditos > 0) e o caso 7.1.3.05.01.00062 FUNDO INSTITUCIONAL (sem CIP no nome)
const FIX_30076 = `FUNDACAO DE APOIO A PESQUISA Balancete Contábil Analítico 01/01/2000 a 10/05/2026 Pág.: 1
00.799.205/0001-89 Emissão: 12/05/2026 08:20
Conta Reduzido Descrição Anterior Débitos Créditos Movimento Saldo Atual
1.1.1.02.02 3224 BANCOS CONTA MOVIMENTO - PROJETO 0,00 1.238.314,65 (1.238.314,65) 0,00 0,00
1.1.1.02.02.93627 93627 30.076 21258-X BB/FU LAPIG/HOLAN 0,00 1.238.314,65 (1.238.314,65) 0,00 0,00
7.1.3.04.01.09142 2579142 BOLSA DOAÇÃO 0,00 292.650,00 0,00 292.650,00 292.650,00
7.1.3.05.01.00017 2506017 PROGRAMA ALIMENTAÇÃO TRABALHADOR 0,00 520,08 (5,00) 515,08 515,08
7.1.3.05.01.00042 2506042 PASSAGENS E DEPESAS COM LOCOMOÇÃ 0,00 20.255,80 0,00 20.255,80 20.255,80
7.1.3.05.01.00051 252475 DESPESA ADM E OPERACIONAL (DAO) 0,00 28.742,75 (76,62) 28.666,13 28.666,13
7.1.3.05.01.00062 252476 FUNDO INSTITUCIONAL 0,00 8.444,94 0,00 8.444,94 8.444,94
7.1.3.05.01.99521 2599521 FUNDO INSTITUCIONAL CIP 0,00 508,60 (19,26) 489,34 489,34
TOTAL DE DÉBITOS : 3.631.397,10
TOTAL DE CRÉDITOS: 3.631.397,10
SALDO DISPONÍVEL PÓS IR/IOF ESTIMADO S/ REND. APL. FINANCEIRA == >> R$ 278.735,05
RENDIMENTO LÍQUIDO APURADO ==>> R$ 48.808,00
GOIÂNIA, 12 de Maio de 2026`;

describe('parseBalanceteText — extração básica', () => {
  it('extrai project_code a partir de 1.1.1.02.02.XXXXX', () => {
    expect(parseBalanceteText(FIX_30113).data.project_code).toBe('30.113');
    expect(parseBalanceteText(FIX_30076).data.project_code).toBe('30.076');
  });

  it('extrai data_referencia (data final do período) em ISO', () => {
    expect(parseBalanceteText(FIX_30113).data.data_referencia).toBe('2026-04-13');
    expect(parseBalanceteText(FIX_30076).data.data_referencia).toBe('2026-05-10');
  });

  it('extrai data_emissao em ISO', () => {
    expect(parseBalanceteText(FIX_30113).data.data_emissao).toBe('2026-04-15');
    expect(parseBalanceteText(FIX_30076).data.data_emissao).toBe('2026-05-12');
  });

  it('extrai periodo_inicio em ISO (01/01/2000 sempre)', () => {
    expect(parseBalanceteText(FIX_30113).data.periodo_inicio).toBe('2000-01-01');
  });

  it('extrai SALDO DISPONÍVEL e RENDIMENTO LÍQUIDO do rodapé', () => {
    const a = parseBalanceteText(FIX_30113).data;
    expect(a.saldo_disponivel).toBeCloseTo(143260.76, 2);
    expect(a.rendimento_liquido).toBeCloseTo(4213.69, 2);

    const b = parseBalanceteText(FIX_30076).data;
    expect(b.saldo_disponivel).toBeCloseTo(278735.05, 2);
    expect(b.rendimento_liquido).toBeCloseTo(48808.00, 2);
  });

  it('extrai TOTAL DE DÉBITOS e TOTAL DE CRÉDITOS', () => {
    const a = parseBalanceteText(FIX_30113).data;
    expect(a.total_debitos).toBeCloseTo(1194120.60, 2);
    expect(a.total_creditos).toBeCloseTo(1194120.60, 2);
  });
});

describe('parseBalanceteText — filtragem de lançamentos', () => {
  it('inclui APENAS folhas com 6+ níveis começando em 7.', () => {
    const lancs = parseBalanceteText(FIX_30113).data.lancamentos;
    // Não pode ter agregadoras (nível 1-5)
    expect(lancs.find(l => l.conta_codigo === '7')).toBeUndefined();
    expect(lancs.find(l => l.conta_codigo === '7.1.3')).toBeUndefined();
    expect(lancs.find(l => l.conta_codigo === '7.1.3.03')).toBeUndefined();
    expect(lancs.find(l => l.conta_codigo === '7.1.3.04')).toBeUndefined();
    expect(lancs.find(l => l.conta_codigo === '7.1.3.05')).toBeUndefined();
    expect(lancs.find(l => l.conta_codigo === '7.1.3.60')).toBeUndefined();
    // CRÍTICO: também não pode ter os subagregadores de nível 5
    // (esses TINHAM o mesmo valor da folha e causariam duplicação).
    expect(lancs.find(l => l.conta_codigo === '7.1.3.03.01')).toBeUndefined();
    expect(lancs.find(l => l.conta_codigo === '7.1.3.04.01')).toBeUndefined();
    expect(lancs.find(l => l.conta_codigo === '7.1.3.05.01')).toBeUndefined();
    // Não pode ter conta de balanço (1.x)
    expect(lancs.find(l => l.conta_codigo.startsWith('1.'))).toBeUndefined();
    // Todas as folhas devem ter exatamente 6+ níveis (5+ pontos)
    lancs.forEach(l => {
      expect(l.conta_codigo.split('.').length).toBeGreaterThanOrEqual(6);
      expect(l.conta_codigo.startsWith('7.')).toBe(true);
    });
  });

  it('ignora tributos sobre rendimento financeiro (7.1.3.60.* e 7.1.3.62.*)', () => {
    const lancs = parseBalanceteText(FIX_30113).data.lancamentos;
    expect(lancs.find(l => l.conta_codigo.startsWith('7.1.3.60'))).toBeUndefined();
    expect(lancs.find(l => l.conta_codigo.startsWith('7.1.3.62'))).toBeUndefined();
  });

  it('não duplica BOLSA DOAÇÃO entre nível 4, 5 e 6', () => {
    // O fixture tem TRÊS linhas com R$ 158.000:
    //   7.1.3.04           SERVIÇOS TERCEIROS PESSOA FISICA  (categoria)
    //   7.1.3.04.01        SERVIÇOS TERCEIROS PESSOA FISICA  (subgrupo)
    //   7.1.3.04.01.09142  BOLSA DOAÇÃO                       (FOLHA)
    // Apenas a folha deve ser salva; somar as três daria R$ 474.000.
    const bolsas = parseBalanceteText(FIX_30113).data.lancamentos
      .filter(l => l.conta_codigo.startsWith('7.1.3.04'));
    expect(bolsas).toHaveLength(1);
    expect(bolsas[0].conta_codigo).toBe('7.1.3.04.01.09142');
    expect(bolsas[0].saldo_atual).toBeCloseTo(158000, 2);
  });

  it('captura BOLSA DOAÇÃO em 7.1.3.04.01.09142', () => {
    const bolsa = parseBalanceteText(FIX_30113).data.lancamentos
      .find(l => l.conta_codigo === '7.1.3.04.01.09142');
    expect(bolsa).toBeDefined();
    expect(bolsa.conta_descricao).toBe('BOLSA DOAÇÃO');
    expect(bolsa.saldo_atual).toBeCloseTo(158000, 2);
  });

  it('captura DAO em 7.1.3.05.01.00051 com descrição contendo parênteses', () => {
    const dao = parseBalanceteText(FIX_30113).data.lancamentos
      .find(l => l.conta_codigo === '7.1.3.05.01.00051');
    expect(dao).toBeDefined();
    expect(dao.conta_descricao).toBe('DESPESA ADM E OPERACIONAL (DAO)');
    expect(dao.saldo_atual).toBeCloseTo(19678.48, 2);
  });

  it('captura FUNDO LOCAL CIP e FUNDO INSTITUCIONAL CIP separadamente', () => {
    const lancs = parseBalanceteText(FIX_30113).data.lancamentos;
    const cipUa = lancs.find(l => l.conta_codigo === '7.1.3.05.01.99520');
    const cipUfg = lancs.find(l => l.conta_codigo === '7.1.3.05.01.99521');
    expect(cipUa.saldo_atual).toBeCloseTo(6036.56, 2);
    expect(cipUfg.saldo_atual).toBeCloseTo(12107.21, 2);
  });

  it('captura FUNDO INSTITUCIONAL (sem CIP) em 7.1.3.05.01.00062', () => {
    const f = parseBalanceteText(FIX_30076).data.lancamentos
      .find(l => l.conta_codigo === '7.1.3.05.01.00062');
    expect(f).toBeDefined();
    expect(f.conta_descricao).toBe('FUNDO INSTITUCIONAL');
    expect(f.saldo_atual).toBeCloseTo(8444.94, 2);
  });
});

describe('parseBalanceteText — estornos (créditos > 0)', () => {
  it('saldo_atual reflete débito líquido (Débitos − Créditos)', () => {
    const lancs = parseBalanceteText(FIX_30076).data.lancamentos;

    const prog = lancs.find(l => l.conta_codigo === '7.1.3.05.01.00017');
    expect(prog.valor_debito).toBeCloseTo(520.08, 2);
    expect(prog.valor_credito).toBeCloseTo(5.00, 2);
    expect(prog.saldo_atual).toBeCloseTo(515.08, 2); // bruto 520,08 − estorno 5,00

    const dao = lancs.find(l => l.conta_codigo === '7.1.3.05.01.00051');
    expect(dao.valor_debito).toBeCloseTo(28742.75, 2);
    expect(dao.valor_credito).toBeCloseTo(76.62, 2);
    expect(dao.saldo_atual).toBeCloseTo(28666.13, 2);

    const cipUfg = lancs.find(l => l.conta_codigo === '7.1.3.05.01.99521');
    expect(cipUfg.saldo_atual).toBeCloseTo(489.34, 2); // 508,60 − 19,26
  });
});

describe('parseBalanceteText — warnings', () => {
  it('avisa quando project_code não encontrado', () => {
    const text = `Balancete Contábil 01/01/2000 a 13/04/2026
Emissão: 15/04/2026 11:44
7.1.3.04.01.09142 X BOLSA DOAÇÃO 0,00 100,00 0,00 100,00 100,00
SALDO DISPONÍVEL PÓS IR/IOF ESTIMADO == >> R$ 100,00
RENDIMENTO LÍQUIDO APURADO ==>> R$ 0,00`;
    const r = parseBalanceteText(text);
    expect(r.warnings.some(w => w.includes('projeto'))).toBe(true);
  });

  it('avisa quando texto muito curto', () => {
    const r = parseBalanceteText('curto');
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.data.lancamentos).toEqual([]);
  });

  it('avisa quando nenhum lançamento 7.x', () => {
    const text = `Balancete 01/01/2000 a 13/04/2026
Emissão: 15/04/2026 11:44
1.1.1.02.02.98491 X 30.113 BB 0,00 100,00 0,00 0,00 0,00
SALDO DISPONÍVEL == >> R$ 100,00`;
    const r = parseBalanceteText(text);
    expect(r.warnings.some(w => w.includes('Nenhum lançamento'))).toBe(true);
  });

  it('sem warnings críticos quando fixture completa', () => {
    const r = parseBalanceteText(FIX_30113);
    // pode haver warning trivial mas project_code, data e lançamentos devem estar OK
    expect(r.warnings.some(w => w.includes('projeto'))).toBe(false);
    expect(r.warnings.some(w => w.includes('Nenhum lançamento'))).toBe(false);
    expect(r.warnings.some(w => w.includes('referência'))).toBe(false);
  });
});

describe('parseBalanceteText — formato BalanceteExtraido', () => {
  it('retorna objeto com a forma esperada por upsert_balancete', () => {
    const { data } = parseBalanceteText(FIX_30113);
    expect(data).toMatchObject({
      project_code: expect.any(String),
      data_referencia: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      data_emissao: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      periodo_inicio: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      saldo_disponivel: expect.any(Number),
      rendimento_liquido: expect.any(Number),
      total_debitos: expect.any(Number),
      total_creditos: expect.any(Number),
      lancamentos: expect.any(Array),
    });
    data.lancamentos.forEach(l => {
      expect(l).toMatchObject({
        conta_codigo: expect.any(String),
        valor_debito: expect.any(Number),
        valor_credito: expect.any(Number),
        saldo_atual: expect.any(Number),
      });
    });
  });
});

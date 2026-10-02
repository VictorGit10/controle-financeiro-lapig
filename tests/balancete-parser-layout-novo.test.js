import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseBalanceteText, classificarContaCortada } from '../frontend/js/parsers/balancete-parser.js';
import { FUNAPE_CONTAS } from '../frontend/js/parsers/funape-contas.js';

/* ============================================================
   Layout da FUNAPE de 2026-09: cabeçalho "Folha:", coluna Conta
   CORTADA em 14 caracteres ("7.1.3.05.01.00042" → "7.1.3.05.01.00"),
   contas-mãe intermediárias de 5 níveis, rodapé terminado em ponto.
   Fixture: texto do 30.068 (02/09/2026) como o pdf.js o entrega —
   espaçamento original, grupo 7 inteiro, inclusive a linha repetida
   na quebra de página. Assinaturas fora.
   ============================================================ */

const aqui = path.dirname(fileURLToPath(import.meta.url));
const FIX = fs.readFileSync(path.join(aqui, 'fixtures/balancete/30068-2026-09-layout-novo.txt'), 'utf8');
const r = () => parseBalanceteText(FIX);
const lanc = (conta) => r().data.lancamentos.find(l => l.conta_codigo === conta);
const soma = (prefixos) => Math.round(r().data.lancamentos
  .filter(l => prefixos.some(p => l.conta_codigo.startsWith(p)))
  .reduce((s, l) => s + l.saldo_atual, 0) * 100) / 100;

describe('layout 2026-09 — cabeçalho e rodapé', () => {
  it('lê projeto e datas', () => {
    const d = r().data;
    expect(d.project_code).toBe('30.068');
    expect(d.data_referencia).toBe('2026-09-02');
    expect(d.data_emissao).toBe('2026-09-03');
  });

  it('o ponto final do rodapé não entra no número', () => {
    expect(r().data.saldo_disponivel).toBeCloseTo(1107372.93, 2);
    expect(r().data.rendimento_liquido).toBeCloseTo(274937.32, 2);
  });
});

describe('layout 2026-09 — código reconstruído pelo reduzido', () => {
  it('passagens, DAO e as redutoras recuperam o código inteiro', () => {
    expect(lanc('7.1.3.05.01.00042').saldo_atual).toBeCloseTo(116287.41, 2);
    expect(lanc('7.1.3.05.01.00051').saldo_atual).toBeCloseTo(132595.69, 2);
    expect(lanc('7.1.3.05.01.00129').saldo_atual).toBeCloseTo(-19531.30, 2);
    expect(lanc('7.1.3.05.01.00130').saldo_atual).toBeCloseTo(-20837.50, 2);
  });

  it('nenhum código cortado sobra, exceto a conta nova', () => {
    const cortadas = r().data.lancamentos.filter(l => l.conta_incompleta);
    expect(cortadas.map(l => l.conta_reduzido)).toEqual(['2597096']);
    expect(cortadas[0].conta_codigo).toBe('7.1.3.05.01.97');
    expect(cortadas[0].saldo_atual).toBeCloseTo(1400, 2);
    expect(r().warnings.some(w => w.includes('2597096'))).toBe(true);
  });

  it('a repetição da quebra de página não duplica, e contas com o mesmo código cortado não se apagam', () => {
    const l = r().data.lancamentos;
    expect(new Set(l.map(x => x.conta_reduzido)).size).toBe(l.length);
    // 13 folhas sob 7.1.3.05.01.00…, todas presentes
    expect(l.filter(x => x.conta_codigo.startsWith('7.1.3.05.01.00')).length).toBe(13);
  });
});

describe('layout 2026-09 — valores do 30.068 (conferidos à mão no PDF)', () => {
  it('fecham por rubrica', () => {
    expect(soma(['7.1.3.04.'])).toBeCloseTo(1319400.00, 2);   // bolsas
    expect(soma(['7.1.3.02.'])).toBeCloseTo(69265.70, 2);     // diárias
    expect(soma(['7.1.3.03.'])).toBeCloseTo(32701.60, 2);     // material de consumo
    expect(lanc('7.1.3.05.01.00014').saldo_atual).toBeCloseTo(10019.03, 2);  // congressos
    // Investimento igual a agosto (mapa da mig. 049)
    expect(soma(['7.1.3.20.', '7.1.3.50.06.', '7.1.3.50.02.94664',
                 '7.1.1.08.22.', '7.1.1.08.50.'])).toBeCloseTo(1520362.59, 2);
  });

  it('todas as contas-mãe fecham com a soma das folhas', () => {
    expect(r().warnings.filter(w => w.startsWith('Conta 7.'))).toEqual([]);
  });
});

describe('classificarContaCortada', () => {
  const MAPA = [
    { conta_prefix: '7.1.3.03',          rubrica_code: 'e' },
    { conta_prefix: '7.1.3.05',          rubrica_code: 'b' },
    { conta_prefix: '7.1.3.05.01.00042', rubrica_code: 'c' },
    { conta_prefix: '7.1.3.05.01.00051', rubrica_code: 'dao' },
    { conta_prefix: '7.1.3.20',          rubrica_code: 'f' },
  ];

  it('sem regra escondida no pedaço cortado, a rubrica é certa', () => {
    expect(classificarContaCortada('7.1.3.03.01.0', MAPA)).toEqual({ rubrica: 'e', ambigua: false });
    expect(classificarContaCortada('7.1.3.20.50.0', MAPA)).toEqual({ rubrica: 'f', ambigua: false });
    // 7.1.3.05.01.97… não pode ser 00042 nem 00051: é `b`, sem palpite
    expect(classificarContaCortada('7.1.3.05.01.97', MAPA)).toEqual({ rubrica: 'b', ambigua: false });
  });

  it('com regra escondida, pergunta', () => {
    expect(classificarContaCortada('7.1.3.05.01.0', MAPA)).toEqual({ rubrica: null, ambigua: true });
    expect(classificarContaCortada('7.1.3.05.01.00', MAPA)).toEqual({ rubrica: null, ambigua: true });
  });

  it('sem regra nenhuma, rubrica nula (a revisão também pergunta)', () => {
    expect(classificarContaCortada('7.1.3.50.02.0', MAPA)).toEqual({ rubrica: null, ambigua: false });
  });
});

describe('funape-contas.js', () => {
  it('todo código está completo e começa pelo grupo 7', () => {
    for (const [red, [conta]] of Object.entries(FUNAPE_CONTAS)) {
      expect(red).toMatch(/^\d+$/);
      expect(conta).toMatch(/^7(\.\d+){4}\.\d{5}$/);
    }
  });
});

/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { parsePtFromHtml, PtFormatError } from '../frontend/js/parsers/pt-parser.js';
import { lookupRubrica, normalizeForLookup } from '../frontend/js/parsers/pt-rubrica-lookup.js';

const FIX_DIR = resolve(process.cwd(), 'tests', 'fixtures', 'pt-html');

async function loadFixture(name) {
  return fs.readFile(resolve(FIX_DIR, name), 'utf8');
}

describe('normalizeForLookup', () => {
  it('remove acentos e normaliza espaços', () => {
    expect(normalizeForLookup('Bolsas  de Pesquisa')).toBe('bolsas de pesquisa');
    expect(normalizeForLookup('Encargos s/ CLT')).toBe('encargos s/ clt');
    expect(normalizeForLookup('Estagiários')).toBe('estagiarios');
  });
  it('retorna string vazia para entrada vazia', () => {
    expect(normalizeForLookup(null)).toBe('');
    expect(normalizeForLookup('')).toBe('');
  });
});

describe('lookupRubrica — aliases canônicos', () => {
  it('mapeia Bolsas → a.bolsas', () => {
    expect(lookupRubrica('Bolsas', 'a').rubrica_code).toBe('a.bolsas');
  });
  it('mapeia Colaboradores eventuais → a.colab', () => {
    expect(lookupRubrica('Colaboradores eventuais (pessoal CLT)', 'a').rubrica_code).toBe('a.colab');
  });
  it('mapeia Estagiários → a.estag', () => {
    expect(lookupRubrica('Estagiários', 'a').rubrica_code).toBe('a.estag');
  });
  it('mapeia Encargos s/ CLT → a.enc', () => {
    expect(lookupRubrica('Encargos s/ CLT (≈ 83 %)', 'a').rubrica_code).toBe('a.enc');
  });
  it('sub livre de b → b com descricao_livre', () => {
    const r = lookupRubrica('Serviços de transporte', 'b');
    expect(r.rubrica_code).toBe('b');
    expect(r.descricao_livre).toBe('Serviços de transporte');
  });
  it('sub livre de e → e com descricao_livre', () => {
    const r = lookupRubrica('Material de expediente', 'e');
    expect(r.rubrica_code).toBe('e');
    expect(r.descricao_livre).toBe('Material de expediente');
  });
  it('mapeia D.A.O → dao mesmo sem pai', () => {
    expect(lookupRubrica('D.A.O. da Fundação', null).rubrica_code).toBe('dao');
  });
});

describe('parsePtFromHtml — DOCX reais', () => {
  it('extrai rubricas do Plano Acelen', async () => {
    const html = await loadFixture('Plano de Trabalho Acelen.html');
    const { data, warnings } = parsePtFromHtml(html);

    // Total do plano declarado é R$ 693.000, mas a tabela de rubricas só
    // soma a..f (g é "------"). 396000 + 10000 + 20000 + 26820 + 20000 + 40000 = 512820.
    const total = data.rubricas.reduce((s, r) => s + r.valor_previsto, 0);
    expect(total).toBeCloseTo(512820, 0);
    // Mas as rubricas individuais com valor existem:
    const bolsas = data.rubricas.find(r => r.rubrica_code === 'a.bolsas');
    expect(bolsas?.valor_previsto).toBeCloseTo(396000, 2);
    const d = data.rubricas.find(r => r.rubrica_code === 'd' && !r.descricao_livre);
    expect(d?.valor_previsto).toBeCloseTo(26820, 2);
    const c = data.rubricas.find(r => r.rubrica_code === 'c' && !r.descricao_livre);
    expect(c?.valor_previsto).toBeCloseTo(20000, 2);

    // Sub-rubrica genérica de 'b'
    const bSub = data.rubricas.find(r => r.rubrica_code === 'b' && r.descricao_livre);
    expect(bSub?.descricao_livre).toMatch(/Servi[çc]os/i);
    expect(bSub?.valor_previsto).toBeCloseTo(10000, 2);

    expect(warnings.length).toBeLessThan(5);
  });

  it('extrai rubricas do Plano WRI/GMH com 5 sub-rubricas de b', async () => {
    const html = await loadFixture('Plano de Trabalho WRI_GMH atualizado 08.12.html');
    const { data } = parsePtFromHtml(html);

    // 5 sub-rubricas de b: serviços de transporte, gráficos, manutenção, hospedagem, outros
    const bSubs = data.rubricas.filter(r => r.rubrica_code === 'b' && r.descricao_livre);
    expect(bSubs.length).toBeGreaterThanOrEqual(4);
    const sumB = bSubs.reduce((s, r) => s + r.valor_previsto, 0);
    expect(sumB).toBeCloseTo(123810.67, 2); // total de b

    // Bolsas R$ 1.100.000
    const bolsas = data.rubricas.find(r => r.rubrica_code === 'a.bolsas');
    expect(bolsas?.valor_previsto).toBeCloseTo(1100000, 2);

    // Diárias R$ 144.914,42 (linha 'd' isolada, sem sub)
    const d = data.rubricas.find(r => r.rubrica_code === 'd' && !r.descricao_livre);
    expect(d?.valor_previsto).toBeCloseTo(144914.42, 2);
  });

  it('extrai do 1º Remanejamento (mesma estrutura WRI)', async () => {
    const html = await loadFixture('1º Remanejamento 20.03.26.html');
    const { data } = parsePtFromHtml(html);
    const bolsas = data.rubricas.find(r => r.rubrica_code === 'a.bolsas');
    expect(bolsas?.valor_previsto).toBeCloseTo(1100000, 2);
  });

  it('extrai do 2º Remanejamento', async () => {
    const html = await loadFixture('2º Carta de Remanejamento.html');
    const { data } = parsePtFromHtml(html);
    const bolsas = data.rubricas.find(r => r.rubrica_code === 'a.bolsas');
    expect(bolsas?.valor_previsto).toBeCloseTo(400000, 2);
  });

  it('aceita o modelo padrão UFG vazio (sem valores)', async () => {
    const html = await loadFixture('Novo Modelo Plano de Trabalho - UFG (1).html');
    const { data, warnings } = parsePtFromHtml(html);
    // Sem valores preenchidos, ainda assim deve achar a tabela e devolver rubricas vazias.
    expect(Array.isArray(data.rubricas)).toBe(true);
    expect(warnings.some(w => w.includes('nenhuma rubrica'))).toBe(true);
  });
});

describe('parsePtFromHtml — falha-rápido', () => {
  it('lança PtFormatError quando a tabela canônica está ausente', () => {
    const html = '<html><body><p>Documento sem a tabela canônica</p><table><tr><td>X</td><td>1</td></tr></table></body></html>';
    expect(() => parsePtFromHtml(html)).toThrow(PtFormatError);
  });

  it('lança PtFormatError para HTML vazio', () => {
    expect(() => parsePtFromHtml('')).toThrow(PtFormatError);
  });
});

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { montarPropostaBalancete } from '../mcp/src/buriti-proposta.js';
import { parseBalanceteText } from '../frontend/js/parsers/balancete-parser.js';

/* ============================================================
   A proposta do Buriti (mig. 051) sobre o balancete do 30.068 de
   2026-09 (layout novo). O que importa: o Buriti lê EXATAMENTE o que
   o site lê — o payload carrega o resultado do mesmo parser, e a
   revisão no site recebe esse objeto sem reprocessar.
   ============================================================ */

const aqui = path.dirname(fileURLToPath(import.meta.url));
const TEXTO = fs.readFileSync(path.join(aqui, 'fixtures/balancete/30068-2026-09-layout-novo.txt'), 'utf8');
const MAPA = [
  { conta_prefix: '7.1.3.05',          rubrica_code: 'b' },
  { conta_prefix: '7.1.3.05.01.00042', rubrica_code: 'c' },
];

describe('montarPropostaBalancete', () => {
  const p = montarPropostaBalancete({ texto: TEXTO, arquivoNome: 'x.pdf', mapa: MAPA });

  it('identifica o centro e a chave da proposta', () => {
    expect(p.ok).toBe(true);
    expect(p.project_code).toBe('30.068');
    expect(p.chave).toBe('2026-09-02');
  });

  it('carrega o resultado do MESMO parser do site, sem transformação', () => {
    expect(p.payload.extraido).toEqual(parseBalanceteText(TEXTO));
  });

  it('a conta nova vira pergunta com sugestão e justificativa', () => {
    expect(p.payload.perguntas).toHaveLength(1);
    const q = p.payload.perguntas[0];
    expect(q.reduzido).toBe('2597096');
    expect(q.valor).toBeCloseTo(1400, 2);
    expect(q.sugestao.rubrica).toBe('e');
    expect(q.sugestao.fonte).toBe('semente');
    expect(q.sugestao.justificativa.length).toBeGreaterThan(20);
  });

  it('o resumo diz o que o humano precisa saber antes de abrir', () => {
    expect(p.resumo).toContain('30.068');
    expect(p.resumo).toContain('02/09/2026');
    expect(p.resumo).toContain('contas-mãe conferidas');
    expect(p.resumo).toContain('1 pergunta');
    expect(p.payload.conferencias.contas_mae_fecham).toBe(true);
  });

  it('sem semente, a dica pelo prefixo só aparece quando não é ambígua', () => {
    const semSemente = TEXTO.replace(/2597096/g, '2599999');
    const q = montarPropostaBalancete({ texto: semSemente, arquivoNome: 'x.pdf', mapa: MAPA }).payload.perguntas[0];
    expect(q.sugestao).toEqual(expect.objectContaining({ rubrica: 'b', fonte: 'prefixo' }));
  });

  it('PDF sem código de projeto não gera proposta', () => {
    const r = montarPropostaBalancete({ texto: TEXTO.replace(/30\.068/g, 'XX'), arquivoNome: 'x.pdf' });
    expect(r.ok).toBe(false);
    expect(r.problemas.join(' ')).toMatch(/centro de custo/);
  });
});

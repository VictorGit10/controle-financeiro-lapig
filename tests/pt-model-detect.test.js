import { describe, it, expect } from 'vitest';
import { detectPtModel, normalizeDocText } from '../frontend/js/parsers/pt-model-detect.js';

// Trechos curtos e SEM PII, transcritos dos modelos reais que apareceram
// (ver docs/planos-fora-do-padrao.md). O objetivo é fixar o comportamento
// do roteamento e da mensagem, não reproduzir os documentos.

const PROAD = `
  II.d. Plano de Aplicação dos Recursos Financeiros
  1 - Receita Total 1.000.000,00
  a- Pessoal Total 864.000,00
`;

const FAPEG_ADEQUACAO = `
  TÍTULO: CUSTEIO Código: FOR – 005
  ADEQUAÇÃO DE PLANO DE TRABALHO
  RECURSOS / ITENS SOLICITADOS – CUSTEIO PARA PESQUISA
`;

const PREFEITURA = `
  PLANO DE TRABALHO - TERMO DE FOMENTO/TERMO DE COLABORAÇÃO
  Nº da(s) Emenda(s) Impositiva(s)
  10. Custos
  16. Cronograma de Desembolso
`;

const FAPEG_PLANO = `
  ESTADO DE GOIÁS
  FUNDAÇÃO DE AMPARO A PESQUISA DO ESTADO DE GOIÁS
  PLANO DE TRABALHO
  I. Justificativa
`;

// Balancete da FUNAPE: o que NÃO pode ser confundido com plano, senão o
// roteamento por conteúdo desviaria balancetes de verdade.
const BALANCETE = `
  BALANCETE ANALITICO
  Periodo de 01/07/2025 a 31/07/2025
  7.1.3.01.01.00001 BOLSAS DE ESTUDO 12.000,00
  SALDO DISPONIVEL 45.678,90
`;

describe('normalizeDocText', () => {
  it('remove acentos, baixa a caixa e colapsa espaços', () => {
    expect(normalizeDocText('  Adequação   DE\nPlano  ')).toBe('adequacao de plano');
  });

  it('trata null/undefined sem lançar', () => {
    expect(normalizeDocText(null)).toBe('');
    expect(normalizeDocText(undefined)).toBe('');
  });
});

describe('detectPtModel', () => {
  it('reconhece o padrão PROAD pela tabela canônica', () => {
    expect(detectPtModel(PROAD).id).toBe('proad');
  });

  it('reconhece a Adequação da FAPEG pelo código FOR-00x', () => {
    expect(detectPtModel(FAPEG_ADEQUACAO).id).toBe('fapeg-adequacao');
  });

  it('reconhece o Termo de Fomento da Prefeitura', () => {
    expect(detectPtModel(PREFEITURA).id).toBe('prefeitura-fomento');
  });

  it('reconhece um plano FAPEG sem a tabela canônica', () => {
    expect(detectPtModel(FAPEG_PLANO).id).toBe('fapeg-plano');
  });

  it('dá precedência ao PROAD quando o plano é FAPEG mas usa a tabela canônica', () => {
    // Caso real: plano FAPEG/SECTI com FUNAPE interveniente — a estrutura
    // financeira é a nossa, então tem de ser tratado como legível.
    expect(detectPtModel(FAPEG_PLANO + PROAD).id).toBe('proad');
  });

  it('NÃO confunde balancete com plano (protege o roteamento do PDF)', () => {
    const m = detectPtModel(BALANCETE);
    expect(m.id).toBe('desconhecido');
    expect(m.isPlano).toBe(false);
  });

  it('não casa "for" de prosa com o código FOR-00x', () => {
    const prosa = 'o pagamento sera feito quando for 001 vez aprovado pelo comite';
    expect(detectPtModel(prosa).id).toBe('desconhecido');
  });

  it('devolve desconhecido para texto vazio, sem lançar', () => {
    expect(detectPtModel('').id).toBe('desconhecido');
    expect(detectPtModel(null).id).toBe('desconhecido');
  });

  it('todo modelo reconhecido traz label e mensagem acionável', () => {
    for (const txt of [PROAD, FAPEG_ADEQUACAO, PREFEITURA, FAPEG_PLANO]) {
      const m = detectPtModel(txt);
      expect(m.isPlano).toBe(true);
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.message).toContain('Preencher manualmente');
    }
  });
});

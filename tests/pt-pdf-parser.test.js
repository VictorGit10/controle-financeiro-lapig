import { describe, it, expect } from 'vitest';
import { parsePtFromPdfText, __internal } from '../frontend/js/parsers/pt-pdf-parser.js';
import { PtFormatError } from '../frontend/js/parsers/pt-parser.js';

// Fixture sintética que reproduz o formato que o pdf.js entrega para um
// Plano de Trabalho PROAD/UFG assinado — inclusive os espaços múltiplos e o
// caso do valor que escapa para a linha seguinte. Valores redondos e nenhum
// dado pessoal: o documento real fica em NãoColocarNoGit/ (ver
// docs/planos-fora-do-padrao.md).
const PDF_OK = `
 PLANO DE TRABALHO
  Título do Projeto:
  Projeto de Exemplo para Teste do Parser de PDF
  Identificação dos Partícipes do Projeto
  Coordenador(a):   Fulano de Tal   CPF: 000.000.000-00
  I.b. Número do Processo no SEI Goiás   I.c. Prazo de Execução
  202500000000000
  Início   Final
  Novembro/2025   Novembro/2027
 II – RECURSOS FINANCEIROS E APLICAÇÃO
  Valor Total do Plano: R$ 1.000.000,00
  II.d. Plano de Aplicação dos Recursos Financeiros
  Item   Valor ( R$)
  1 - Receita   Total   1.000.000,00
  2 - Previsão de Despesas ( a+b+c+d+e+f+g)   Total   1.000.000,00
  a- Pessoal   Total   864.000,00
  Bolsas   864.000,00
  b – Serviços de Terceiros P. Jurídica   Total   73.000,00
  D.A.O. da FAP**   50.000,00
  Outros serviços
  Inscrição em eventos
 8.000,00
  Publicação em revistas científicas
 15.000,00
  c – Passagens e Despesas com Locomoção   Total   32.000,00
  Despesas com locomoção, passagens aéreas e terrestres, incluindo
 ressarcimento de gastos com combustível
  d - Despesas com diárias   Total   31.000,00
  e – Material de Consumo   Total   0,00
  h- Ganho econômico****   Total   0,00
  Detalhamento   DAO
  Rubrica   Percentual   Valor
  Pessoal   32,30%   R$   16.150,00
`;

const byCode = (rubricas, code) => rubricas.filter(r => r.rubrica_code === code);

describe('parsePtFromPdfText — plano PROAD em PDF', () => {
  const { data, warnings } = parsePtFromPdfText(PDF_OK);

  it('soma exatamente o total declarado no documento', () => {
    const soma = data.rubricas.reduce((s, r) => s + r.valor_previsto, 0);
    expect(soma).toBe(1000000);
    expect(data.valor_despesas_projeto).toBe(1000000);
    // Sem aviso de divergência: a conferência bateu.
    expect(warnings.some(w => w.includes('não bate'))).toBe(false);
  });

  it('usa as folhas quando elas somam o total da letra', () => {
    expect(byCode(data.rubricas, 'a.bolsas')[0].valor_previsto).toBe(864000);
    expect(byCode(data.rubricas, 'dao')[0].valor_previsto).toBe(50000);
  });

  it('recupera o valor que o pdf.js jogou para a linha seguinte', () => {
    // "Inscrição em eventos" e "8.000,00" saem em linhas separadas.
    const b = byCode(data.rubricas, 'b');
    expect(b.map(r => [r.descricao_livre, r.valor_previsto])).toEqual([
      ['Inscrição em eventos', 8000],
      ['Publicação em revistas científicas', 15000],
    ]);
  });

  it('não cria rubrica a partir de rótulo de grupo sem valor', () => {
    expect(data.rubricas.some(r => r.descricao_livre === 'Outros serviços')).toBe(false);
  });

  it('emite a letra sozinha quando ela não tem folhas', () => {
    expect(byCode(data.rubricas, 'c')).toEqual([
      { rubrica_code: 'c', descricao_livre: null, valor_previsto: 32000 },
    ]);
    expect(byCode(data.rubricas, 'd')[0].valor_previsto).toBe(31000);
  });

  it('descarta letras zeradas', () => {
    expect(byCode(data.rubricas, 'e')).toHaveLength(0);
    expect(byCode(data.rubricas, 'g')).toHaveLength(0);   // h- Ganho econômico → g
  });

  it('não confunde texto corrido dentro da letra com rubrica', () => {
    expect(data.rubricas.some(r => /ressarcimento/i.test(r.descricao_livre || ''))).toBe(false);
  });

  it('lê vigência escrita como Mês/Ano (o DOCX só entende dd/mm/aaaa)', () => {
    expect(data.prazo_inicio).toBe('2025-11-01');
    expect(data.prazo_fim).toBe('2027-11-30');       // último dia do mês
  });

  it('lê título, coordenador e DAO do cabeçalho', () => {
    expect(data.titulo).toBe('Projeto de Exemplo para Teste do Parser de PDF');
    expect(data.coordenador).toBe('Fulano de Tal');
    expect(data.valor_dao).toBe(50000);
  });

  it('avisa que não achou CIP em vez de inventar um', () => {
    expect(data.valor_cip).toBeNull();
    expect(warnings.some(w => w.includes('CIP'))).toBe(true);
  });
});

describe('parsePtFromPdfText — proteção contra plano silenciosamente errado', () => {
  it('prefere o total da letra quando as folhas não somam, e avisa', () => {
    // Cenário perigoso: uma folha se perdeu na extração. Confiar nas folhas
    // deixaria o plano 23.000 abaixo do total sem ninguém perceber.
    const perdidas = ['Inscrição em eventos', '8.000,00', 'Publicação em revistas científicas', '15.000,00'];
    const texto = PDF_OK.split('\n').filter(l => !perdidas.includes(l.trim())).join('\n');
    const { data, warnings } = parsePtFromPdfText(texto);

    const b = byCode(data.rubricas, 'b');
    expect(b).toHaveLength(1);
    expect(b[0].valor_previsto).toBe(73000);          // total declarado, não 50.000
    expect(byCode(data.rubricas, 'dao')).toHaveLength(0);
    expect(warnings.some(w => w.includes('itens detalhados somam'))).toBe(true);

    const soma = data.rubricas.reduce((s, r) => s + r.valor_previsto, 0);
    expect(soma).toBe(1000000);                       // total global preservado
  });

  it('avisa quando a soma não bate com o total declarado', () => {
    const texto = PDF_OK.replace('d - Despesas com diárias   Total   31.000,00', 'd - Despesas com diárias   Total   99.000,00');
    const { warnings } = parsePtFromPdfText(texto);
    expect(warnings.some(w => w.includes('não bate com o total declarado'))).toBe(true);
  });
});

describe('parsePtFromPdfText — falha-rápido', () => {
  it('lança PtFormatError quando não há a seção II.d', () => {
    const balancete = 'BALANCETE ANALITICO\n'.repeat(20) + 'SALDO DISPONIVEL 45.678,90';
    expect(() => parsePtFromPdfText(balancete)).toThrow(PtFormatError);
  });

  it('lança PtFormatError para texto vazio', () => {
    expect(() => parsePtFromPdfText('')).toThrow(PtFormatError);
    expect(() => parsePtFromPdfText(null)).toThrow(PtFormatError);
  });

  it('nomeia o modelo detectado no erro', () => {
    const outroModelo = 'PLANO DE TRABALHO - TERMO DE FOMENTO/TERMO DE COLABORAÇÃO\n'.repeat(10);
    try {
      parsePtFromPdfText(outroModelo);
      expect.unreachable('deveria ter lançado');
    } catch (e) {
      expect(e.modelo).toBe('prefeitura-fomento');
    }
  });
});

describe('__internal', () => {
  it('mergeValoresOrfaos só junta quando a próxima linha é só número', () => {
    const { mergeValoresOrfaos } = __internal;
    expect(mergeValoresOrfaos(['Rótulo', '8.000,00'])).toEqual(['Rótulo 8.000,00']);
    expect(mergeValoresOrfaos(['Rótulo A', 'Rótulo B'])).toEqual(['Rótulo A', 'Rótulo B']);
    // Linha que já tem valor não absorve a seguinte.
    expect(mergeValoresOrfaos(['Bolsas 864.000,00', '15.000,00']))
      .toEqual(['Bolsas 864.000,00', '15.000,00']);
  });

  it('parseMesAno entende os meses em pt-BR', () => {
    const { parseMesAno } = __internal;
    expect(parseMesAno('Novembro/2025')).toEqual({ ano: 2025, mes: 11 });
    expect(parseMesAno('março/2026')).toEqual({ ano: 2026, mes: 3 });
    expect(parseMesAno('Brumário/2025')).toBeNull();
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatBRL, parseBRL, escapeAttr, escapeAttrJs, formatDate, toInputDate, localISODate, inferBalanceStatus, formatRendimento, summarizeRendimento } from '../frontend/js/pure-fns.js';

describe('formatBRL', () => {
  it('formata valor positivo', () => {
    expect(formatBRL(1500.5)).toMatch(/1\.500/);
  });

  it('formata zero', () => {
    expect(formatBRL(0)).toMatch(/0/);
  });

  it('formata null como zero', () => {
    expect(formatBRL(null)).toMatch(/0/);
  });

  it('formata undefined como zero', () => {
    expect(formatBRL(undefined)).toMatch(/0/);
  });

  it('formata valor negativo', () => {
    expect(formatBRL(-200)).toMatch(/-/);
  });

  it('formata valor grande', () => {
    expect(formatBRL(1000000)).toContain('1');
  });
});

describe('parseBRL', () => {
  it('faz parse de string BRL com R$, pontos e vírgula', () => {
    expect(parseBRL('R$ 138.600,00')).toBe(138600);
  });

  it('faz parse de string com decimais', () => {
    expect(parseBRL('R$ 1.234,56')).toBeCloseTo(1234.56, 2);
  });

  it('aceita string sem R$ nem separadores', () => {
    expect(parseBRL('500')).toBe(500);
  });

  it('aceita formato US (ponto decimal sem vírgula)', () => {
    expect(parseBRL('1500.75')).toBeCloseTo(1500.75, 2);
  });

  it('trata múltiplos pontos como separadores de milhar', () => {
    expect(parseBRL('1.234.567')).toBe(1234567);
  });

  it('retorna número diretamente quando recebe número', () => {
    expect(parseBRL(42.5)).toBe(42.5);
  });

  it('retorna null para entrada vazia', () => {
    expect(parseBRL('')).toBeNull();
    expect(parseBRL(null)).toBeNull();
    expect(parseBRL(undefined)).toBeNull();
  });

  it('retorna null para entrada sem dígitos', () => {
    expect(parseBRL('R$ ---')).toBeNull();
  });

  it('respeita sinal negativo', () => {
    expect(parseBRL('-200,50')).toBeCloseTo(-200.5, 2);
  });
});

describe('escapeAttrJs — XSS em onclick', () => {
  // Simula o que o navegador faz: decodifica as entidades HTML do atributo
  // ANTES de o JavaScript ser interpretado.
  const decodeHtml = (s) => s
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

  // Reproduz o caminho real: monta o onclick, deixa o navegador decodificar
  // as entidades e executa o resultado. Devolve o argumento que chegou na
  // função — ou lança, se o payload quebrou a sintaxe da string.
  function runOnclick(escaped) {
    let captured = null;
    const f = (v) => { captured = v; };
    // eslint-disable-next-line no-eval
    eval(decodeHtml(`f('${escaped}')`));
    return captured;
  }

  const PAYLOAD = "x'); alert(document.cookie); //";

  it('escapeAttr sozinho quebra o contexto JS (regressao do bug corrigido)', () => {
    // O apostrofo volta no decode e fecha a string: o que sobra vira codigo.
    // Aqui isso estoura em ReferenceError (alert nao existe no Node) — prova
    // de que deixou de ser texto e passou a ser instrucao.
    expect(() => runOnclick(escapeAttr(PAYLOAD))).toThrow();
  });

  it('escapeAttrJs entrega o texto literal, sem executar nada', () => {
    expect(runOnclick(escapeAttrJs(PAYLOAD))).toBe(PAYLOAD);
  });

  it('sobrevive a barra invertida, aspas e quebra de linha', () => {
    const tricky = 'a\\b \'c\' "d"\ne';
    expect(runOnclick(escapeAttrJs(tricky))).toBe(tricky);
  });

  it('trata null/undefined', () => {
    expect(escapeAttrJs(null)).toBe('');
    expect(escapeAttrJs(undefined)).toBe('');
  });
});

describe('escapeAttr', () => {
  it('escapa aspas duplas', () => {
    expect(escapeAttr('a"b')).toBe('a&quot;b');
  });

  it('escapa aspas simples', () => {
    expect(escapeAttr("a'b")).toBe('a&#39;b');
  });

  it('escapa &', () => {
    expect(escapeAttr('a&b')).toBe('a&amp;b');
  });

  it('escapa < e >', () => {
    expect(escapeAttr('<script>')).toBe('&lt;script&gt;');
  });

  it('retorna string vazia para null', () => {
    expect(escapeAttr(null)).toBe('');
  });

  it('retorna string vazia para undefined', () => {
    expect(escapeAttr(undefined)).toBe('');
  });

  it('nao altera string segura', () => {
    expect(escapeAttr('Hello World')).toBe('Hello World');
  });

  it('converte numeros para string', () => {
    expect(escapeAttr(42)).toBe('42');
  });

  it('escapa XSS completo', () => {
    expect(escapeAttr('"><script>alert(1)</script>')).toBe('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('formatDate', () => {
  it('formata data ISO', () => {
    const result = formatDate('2026-01-15');
    expect(result).toContain('15');
  });

  it('retorna — para null', () => {
    expect(formatDate(null)).toBe('—');
  });

  it('retorna — para undefined', () => {
    expect(formatDate(undefined)).toBe('—');
  });

  it('retorna — para string vazia', () => {
    expect(formatDate('')).toBe('—');
  });
});

describe('toInputDate', () => {
  it('extrai parte da data', () => {
    expect(toInputDate('2026-03-15T10:30:00')).toBe('2026-03-15');
  });

  it('retorna string vazia para null', () => {
    expect(toInputDate(null)).toBe('');
  });

  it('retorna string vazia para undefined', () => {
    expect(toInputDate(undefined)).toBe('');
  });

  it('retorna data curta como está', () => {
    expect(toInputDate('2026-01-01')).toBe('2026-01-01');
  });
});

describe('localISODate', () => {
  it('retorna data local no formato YYYY-MM-DD', () => {
    const d = new Date(2026, 4, 5); // May 5, 2026 local time
    expect(localISODate(d)).toBe('2026-05-05');
  });

  it('retorna data de hoje quando chamada sem argumento', () => {
    const now = new Date();
    const expected = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
    expect(localISODate()).toBe(expected);
  });
});

describe('inferBalanceStatus', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retorna unpaid_current para null', () => {
    expect(inferBalanceStatus(null)).toBe('unpaid_current');
  });

  it('retorna unpaid_current para undefined', () => {
    expect(inferBalanceStatus(undefined)).toBe('unpaid_current');
  });

  it('retorna unpaid_current para string vazia', () => {
    expect(inferBalanceStatus('')).toBe('unpaid_current');
  });

  it('retorna paid_current para saldo do mês corrente registrado após o dia 7', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00'));
    expect(inferBalanceStatus('2026-07-15')).toBe('paid_current');
  });

  it('retorna unpaid_current para saldo do mês corrente registrado até o dia 7', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00'));
    expect(inferBalanceStatus('2026-07-05')).toBe('unpaid_current');
  });

  it('retorna unpaid_current para saldo de mês anterior, mesmo com dia atual > 7', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00'));
    expect(inferBalanceStatus('2026-01-01')).toBe('unpaid_current');
  });
});

describe('formatRendimento', () => {
  it('descreve o rendimento como componente do saldo', () => {
    const texto = formatRendimento(8500);
    expect(texto).toMatch(/^inclui /);
    expect(texto).toMatch(/8\.500/);
    expect(texto).toMatch(/de rendimento$/);
  });

  // A distinção que a migração 045 existe para preservar: rodapé de balancete
  // não lido é ausência de dado, não afirmação de que não houve rendimento.
  it('null é ausência de dado, não zero', () => {
    expect(formatRendimento(null)).toBeNull();
    expect(formatRendimento(undefined)).toBeNull();
    expect(formatRendimento('')).toBeNull();
  });

  it('zero não vira legenda — não há composição a mostrar', () => {
    expect(formatRendimento(0)).toBeNull();
    expect(formatRendimento('0')).toBeNull();
  });

  it('ignora valor não numérico em vez de escrever NaN na tela', () => {
    expect(formatRendimento('abc')).toBeNull();
  });

  it('aceita número em string (vem assim do PostgREST em numeric)', () => {
    expect(formatRendimento('8500.00')).toMatch(/8\.500/);
  });

  it('valor negativo não vira legenda', () => {
    expect(formatRendimento(-10)).toBeNull();
  });
});

describe('summarizeRendimento', () => {
  it('soma os valores conhecidos e conta os projetos sem informação', () => {
    expect(summarizeRendimento([
      { rendimento_informativo: '8500.00' },
      { rendimento_informativo: null },
      { rendimento_informativo: 1500 },
      { rendimento_informativo: '' },
    ])).toEqual({ total: 10000, knownCount: 2, unknownCount: 2 });
  });

  it('distingue zero conhecido de rendimento desconhecido', () => {
    expect(summarizeRendimento([
      { rendimento_informativo: 0 },
      { rendimento_informativo: undefined },
    ])).toEqual({ total: 0, knownCount: 1, unknownCount: 1 });
  });

  it('trata valor inválido como desconhecido', () => {
    expect(summarizeRendimento([
      { rendimento_informativo: 'valor inválido' },
    ])).toEqual({ total: 0, knownCount: 0, unknownCount: 1 });
  });
});

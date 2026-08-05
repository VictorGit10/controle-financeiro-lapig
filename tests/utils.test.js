import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatBRL, parseBRL, escapeAttr, formatDate, toInputDate, localISODate, inferBalanceStatus } from '../frontend/js/pure-fns.js';

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
import { describe, it, expect } from 'vitest';
import { generateMonthSeries, calcProjectMonthly, diffProjections } from '../frontend/js/pure-fns.js';

describe('generateMonthSeries', () => {
  it('gera meses entre duas datas', () => {
    const months = generateMonthSeries('2026-01-01', '2026-03-31');
    expect(months).toHaveLength(3);
  });

  it('inclui mes de inicio e fim', () => {
    const months = generateMonthSeries('2026-06-01', '2026-06-30');
    expect(months).toHaveLength(1);
    expect(months[0].month_start).toBe('2026-06-01');
    expect(months[0].month_end).toBe('2026-06-30');
  });

  it('cobre ano completo', () => {
    const months = generateMonthSeries('2026-01-01', '2026-12-31');
    expect(months).toHaveLength(12);
  });

  it('corta mes parcial no inicio', () => {
    const months = generateMonthSeries('2026-02-15', '2026-04-30');
    expect(months).toHaveLength(3);
    expect(months[0].month_start).toBe('2026-02-01');
  });
});

describe('calcProjectMonthly', () => {
  const baseProject = {
    initial_balance: 10000,
    yield_amount: 0,
    end_date: '2026-06-30',
  };

  const baseScholarships = [
    { status: 'active', amount: 2000, start_date: '2026-01-01', end_date: '2026-06-30' },
  ];

  it('calcula saldo mensal com desembolso', () => {
    const funding = [
      { amount: 10000, release_date: '2026-01-15' },
    ];
    const result = calcProjectMonthly(baseProject, baseScholarships, funding, [], {
      startDateParam: '2026-01-01',
      balanceStatus: 'unpaid_current',
    });
    expect(result).toHaveLength(6);
    // Jan: initial=10000, funding=+10000, scholarship=-2000, net=18000
    expect(result[0].initial_balance).toBe(10000);
    expect(result[0].funding_income).toBe(10000);
    expect(result[0].scholarship_expense).toBe(2000);
    expect(result[0].net_balance).toBe(18000);
  });

  it('calcula saldo acumulativo', () => {
    const result = calcProjectMonthly(baseProject, baseScholarships, [], [], {
      startDateParam: '2026-01-01',
      balanceStatus: 'unpaid_current',
    });
    // Jan: 10000 - 2000 = 8000
    expect(result[0].net_balance).toBe(8000);
    // Feb: 8000 - 2000 = 6000
    expect(result[1].net_balance).toBe(6000);
    // Mar: 6000 - 2000 = 4000
    expect(result[2].net_balance).toBe(4000);
  });

  it('deduz despesas do saldo', () => {
    const expenses = [
      { amount: 500, expense_date: '2026-02-10' },
    ];
    const result = calcProjectMonthly(baseProject, baseScholarships, [], expenses, {
      startDateParam: '2026-01-01',
      balanceStatus: 'unpaid_current',
    });
    // Feb: 8000 - 2000 (bolsa) - 500 (despesa) = 5500
    expect(result[1].other_expense).toBe(500);
    expect(result[1].net_balance).toBe(5500);
  });

  it('ignora bolsas canceladas', () => {
    const scholarships = [
      { status: 'active', amount: 2000, start_date: '2026-01-01', end_date: '2026-06-30' },
      { status: 'cancelled', amount: 5000, start_date: '2026-01-01', end_date: '2026-06-30' },
    ];
    const result = calcProjectMonthly(baseProject, scholarships, [], [], {
      startDateParam: '2026-01-01',
      balanceStatus: 'unpaid_current',
    });
    expect(result[0].scholarship_expense).toBe(2000);
  });

  it('bolsa parcial afeta apenas meses de vigencia', () => {
    const scholarships = [
      { status: 'active', amount: 3000, start_date: '2026-03-01', end_date: '2026-04-30' },
    ];
    const result = calcProjectMonthly(baseProject, scholarships, [], [], {
      startDateParam: '2026-01-01',
      balanceStatus: 'unpaid_current',
    });
    // Jan: sem bolsa
    expect(result[0].scholarship_expense).toBe(0);
    // Mar: bolsa ativa
    expect(result[2].scholarship_expense).toBe(3000);
    // May: bolsa encerrou
    expect(result[4].scholarship_expense).toBe(0);
  });

  it('inclui yield_amount no saldo base', () => {
    const project = { ...baseProject, yield_amount: 1500 };
    const result = calcProjectMonthly(project, baseScholarships, [], [], {
      startDateParam: '2026-01-01',
      balanceStatus: 'unpaid_current',
    });
    // Saldo base = 10000 + 1500 = 11500
    expect(result[0].initial_balance).toBe(11500);
  });

  it('balanceStatus paid_current adiciona bolsa ao saldo', () => {
    const result = calcProjectMonthly(baseProject, baseScholarships, [], [], {
      startDateParam: '2026-01-01',
      balanceStatus: 'paid_current',
    });
    // Saldo base = 10000 + 2000 (bolsa do mes corrente) = 12000
    expect(result[0].initial_balance).toBe(12000);
  });

  it('balanceStatus unpaid_previous subtrai bolsa anterior', () => {
    const result = calcProjectMonthly(baseProject, baseScholarships, [], [], {
      startDateParam: '2026-02-01',
      balanceStatus: 'unpaid_previous',
    });
    // Saldo base = 10000 - 2000 (bolsa do mes anterior) = 8000
    expect(result[0].initial_balance).toBe(8000);
  });

  it('projeto sem end_date vai ate dezembro', () => {
    const project = { initial_balance: 5000, yield_amount: 0, end_date: null };
    const result = calcProjectMonthly(project, [], [], [], {
      startDateParam: '2026-01-01',
    });
    const monthsUntilDec = 12 - new Date('2026-01-01T00:00:00').getMonth();
    expect(result).toHaveLength(monthsUntilDec);
  });
});

describe('diffProjections', () => {
  it('detecta diferencas entre projecoes', () => {
    const original = [
      { month_label: 'Jan', net_balance: 8000 },
      { month_label: 'Fev', net_balance: 6000 },
    ];
    const simulated = [
      { month_label: 'Jan', net_balance: 9000 },
      { month_label: 'Fev', net_balance: 6000 },
    ];
    const diffs = diffProjections(original, simulated);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].delta).toBe(1000);
  });

  it('retorna array vazio quando nao ha diferencas', () => {
    const original = [
      { month_label: 'Jan', net_balance: 8000 },
    ];
    const simulated = [
      { month_label: 'Jan', net_balance: 8000 },
    ];
    expect(diffProjections(original, simulated)).toHaveLength(0);
  });
});
/* ============================================================
   Pure utility functions — single source of truth for tests
   These are also defined as globals in supabase-config.js
   for browser <script> tag compatibility.
   ============================================================ */

export function formatBRL(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value || 0);
}

export function parseBRL(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value).trim();
  if (!s) return null;
  s = s.replace(/[R$\s ]/g, '');
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '');
  }
  s = s.replace(/[^\d.-]/g, '');
  if (s === '' || s === '-' || s === '.') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function escapeAttr(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('pt-BR');
}

export function toInputDate(dateStr) {
  if (!dateStr) return '';
  return dateStr.substring(0, 10);
}

export function localISODate(d) {
  if (!d) d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

export function inferBalanceStatus(balanceDate) {
  if (!balanceDate) return 'unpaid_current';
  const bd = new Date(balanceDate + 'T00:00:00');
  const now = new Date();
  if (now.getDate() > 7) return 'paid_current';
  if (bd.getFullYear() === now.getFullYear() &&
      bd.getMonth() === now.getMonth() &&
      bd.getDate() > 7) {
    return 'paid_current';
  }
  return 'unpaid_current';
}

export function generateMonthSeries(startDate, endDate) {
  const months = [];
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  while (cursor <= end) {
    const monthStart = new Date(cursor);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    months.push({
      month_start: localISODate(monthStart),
      month_end: localISODate(monthEnd),
      month_label: monthStart.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

export function calcProjectMonthly(project, scholarships, fundingReleases, expenses, options = {}) {
  const { startDateParam = null, balanceStatus = 'unpaid_current' } = options;

  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearEnd = new Date(now.getFullYear(), 11, 31);

  let startD = startDateParam ? new Date(startDateParam + 'T00:00:00') : defaultStart;
  let endD = project.end_date ? new Date(project.end_date + 'T00:00:00') : yearEnd;

  const startDate = localISODate(startD);
  const endDate = localISODate(endD);

  const months = generateMonthSeries(startDate, endDate);
  let baseBalance = Number(project.initial_balance || 0) + Number(project.yield_amount || 0);

  const activeScholarships = scholarships.filter(s => s.status === 'active');

  if (balanceStatus === 'paid_current') {
    const monthEndD = new Date(startD.getFullYear(), startD.getMonth() + 1, 0);
    const mEnd = localISODate(monthEndD);
    const mStart = localISODate(startD);
    const paidExp = activeScholarships.reduce((sum, s) => {
      if (s.start_date <= mEnd && s.end_date >= mStart) return sum + Number(s.amount);
      return sum;
    }, 0);
    baseBalance += paidExp;
  } else if (balanceStatus === 'unpaid_previous') {
    const prevStartD = new Date(startD.getFullYear(), startD.getMonth() - 1, 1);
    const prevEndD = new Date(startD.getFullYear(), startD.getMonth(), 0);
    const pStart = localISODate(prevStartD);
    const pEnd = localISODate(prevEndD);
    const unpaidPrevExp = activeScholarships.reduce((sum, s) => {
      if (s.start_date <= pEnd && s.end_date >= pStart) return sum + Number(s.amount);
      return sum;
    }, 0);
    baseBalance -= unpaidPrevExp;
  }

  let runningBalance = baseBalance;
  const result = [];

  months.forEach((m) => {
    const scholarshipExp = activeScholarships.reduce((sum, s) => {
      if (s.start_date <= m.month_end && s.end_date >= m.month_start) {
        return sum + Number(s.amount);
      }
      return sum;
    }, 0);

    const fundingInc = fundingReleases.reduce((sum, f) => {
      if (f.release_date >= m.month_start && f.release_date <= m.month_end) {
        return sum + Number(f.amount);
      }
      return sum;
    }, 0);

    const otherExp = expenses.reduce((sum, e) => {
      if (e.expense_date >= m.month_start && e.expense_date <= m.month_end) {
        return sum + Number(e.amount);
      }
      return sum;
    }, 0);

    const initialBalance = runningBalance;
    runningBalance = runningBalance + fundingInc - scholarshipExp - otherExp;

    result.push({
      month_label: m.month_label,
      month_start: m.month_start,
      initial_balance: initialBalance,
      scholarship_expense: scholarshipExp,
      funding_income: fundingInc,
      other_expense: otherExp,
      net_balance: runningBalance,
    });
  });

  return result;
}

export function diffProjections(original, simulated) {
  const diffs = [];
  simulated.forEach((sim, i) => {
    const orig = original[i];
    if (!orig) return;
    if (Math.abs(sim.net_balance - orig.net_balance) > 0.01) {
      diffs.push({
        month_label: sim.month_label,
        original_balance: orig.net_balance,
        simulated_balance: sim.net_balance,
        delta: sim.net_balance - orig.net_balance,
      });
    }
  });
  return diffs;
}

// ── Browser bridge ──────────────────────────────────────────
// Carregado em index.html como <script type="module">. Expõe
// as funções no window para scripts clássicos (supabase-config,
// simulation, pages/*) que não são módulos ES.
if (typeof window !== 'undefined') {
  Object.assign(window, {
    formatBRL, parseBRL, escapeAttr, formatDate, toInputDate, localISODate,
    inferBalanceStatus, generateMonthSeries, calcProjectMonthly,
    diffProjections,
  });
}
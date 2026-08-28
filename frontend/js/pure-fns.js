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

/**
 * Legenda da composição do saldo: quanto dele é rendimento de aplicação.
 *
 * O rendimento tem regra de uso própria, então precisa aparecer — mas ele já
 * está DENTRO do saldo disponível (ver o cabeçalho da migração 043). Esta
 * função só descreve; quem somar `rendimento_informativo` ao saldo reintroduz
 * a duplicação que a 043 removeu.
 *
 * Devolve `null` (nada a exibir) para ausência de dado. `null` e `0` são casos
 * diferentes de propósito: balancete cujo rodapé não foi lido por inteiro não
 * sabe o rendimento, e "R$ 0,00 de rendimento" seria uma afirmação falsa.
 * Zero explícito também não vira legenda — não há composição a mostrar.
 *
 * @param {number|null|undefined} valor  project_balances/projects.rendimento_informativo
 * @returns {string|null}
 */
export function formatRendimento(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `inclui ${formatBRL(n)} de rendimento`;
}

/**
 * Consolida a composição informativa de vários saldos sem transformar ausência
 * de dado em zero. O total devolvido contém apenas valores conhecidos; por isso
 * quem o exibe também precisa consultar `unknownCount`.
 */
export function summarizeRendimento(projects = []) {
  return projects.reduce((summary, project) => {
    const raw = project?.rendimento_informativo;
    const value = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);

    if (!Number.isFinite(value)) {
      summary.unknownCount += 1;
      return summary;
    }

    summary.knownCount += 1;
    summary.total += value;
    return summary;
  }, { total: 0, knownCount: 0, unknownCount: 0 });
}

/**
 * Converte texto monetário em número.
 *
 * AMBIGUIDADE DELIBERADA: um ponto único sem vírgula é lido como DECIMAL,
 * não como separador de milhar. Ou seja, `'1500.75'` → 1500.75 e, como
 * consequência inevitável, `'R$ 1.500'` → 1.5.
 *
 * As duas leituras de `1.500` (mil e quinhentos, à brasileira; um e meio, à
 * americana) são mutuamente exclusivas — nenhuma heurística acerta as duas —
 * e o projeto escolheu a decimal. Texto digitado à mão em pt-BR usa vírgula
 * (`'1.500,00'`), que cai no primeiro ramo e resolve certo; e mais de um
 * ponto (`'1.234.567'`) só pode ser milhar, o que o segundo ramo trata.
 * Sobra o caso de ponto único, que fica intocado e vira decimal.
 *
 * Fixado por `tests/utils.test.js:44`. Foi relatado como Crítico #4 no
 * bug-hunt de 2026-07-16 e reclassificado como trade-off em 2026-08-12 —
 * mudar o comportamento exige mudar aquele teste, de propósito.
 */
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

/**
 * Escapa um valor que vai DENTRO de uma string JS entre aspas simples
 * que por sua vez vive num atributo HTML — o caso de onclick="f('...')".
 *
 * escapeAttr sozinho NÃO resolve aqui. Ele troca ' por &#39;, mas o parser
 * HTML decodifica a entidade ANTES de o JavaScript ser interpretado: o
 * apóstrofo volta e fecha a string. Um nome de bolsista como
 *     x'); alert(document.cookie); //
 * viraria código executável no navegador de quem abrisse a lista.
 *
 * A ordem correta é escapar para JS primeiro e para atributo depois, que é
 * o que esta função faz — por isso ela existe em vez de compor as duas na
 * mão em cada chamada.
 */
export function escapeAttrJs(str) {
  if (str == null) return '';
  const js = String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
  return escapeAttr(js);
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
  // paid_current só quando o saldo foi registrado no mês corrente e
  // depois do dia 7 (dia em que as bolsas do mês são debitadas): um
  // saldo de mês anterior não reflete o pagamento do mês atual.
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

export function calcProjectMonthly(project, scholarships, fundingReleases, options = {}) {
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

    const initialBalance = runningBalance;
    runningBalance = runningBalance + fundingInc - scholarshipExp;

    result.push({
      month_label: m.month_label,
      month_start: m.month_start,
      initial_balance: initialBalance,
      scholarship_expense: scholarshipExp,
      funding_income: fundingInc,
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
    formatBRL, parseBRL, escapeAttr, escapeAttrJs, formatDate, toInputDate, localISODate,
    inferBalanceStatus, generateMonthSeries, calcProjectMonthly,
    diffProjections, formatRendimento, summarizeRendimento,
  });
}

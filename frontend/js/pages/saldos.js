/* ============================================================
   Saldos Page — Monthly balance entry per project
   Historico mensal de saldos via project_balances
   ============================================================ */

Router.register('saldos', {
  title: 'Saldos',

  actions(container) {
    // No action button — all projects shown automatically
  },

  async render(container) {
    await SaldosPage.load(container);
  }
});


const SaldosPage = (() => {

  let containerEl    = null;
  let allRows         = [];   // result from get_balances_for_month
  let dirtyRows      = new Set(); // project_id set for rows that changed
  let currentMonth   = new Date().getMonth() + 1;
  let currentYear    = new Date().getFullYear();

  const MONTH_NAMES = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  /* ── Load ────────────────────────────────────────────────── */

  async function load(container) {
    containerEl = container;
    containerEl.innerHTML = '<div class="skeleton skeleton--card" style="height:200px;"></div>';
    await refresh();
  }

  async function refresh() {
    const { data, error } = await supabaseClient.rpc('get_balances_for_month', {
      p_month: currentMonth,
      p_year:  currentYear
    });

    if (error) {
      showToast('Erro ao carregar saldos: ' + error.message, 'error');
      return;
    }

    allRows    = data || [];
    dirtyRows  = new Set();
    renderPage();
  }

  /* ── Month Navigation ────────────────────────────────────── */

  async function changeMonth(month, year) {
    if (dirtyRows.size > 0) {
      const ok = await confirmAction('Alterações não salvas serão perdidas. Continuar?');
      if (!ok) return;
    }
    currentMonth = month;
    currentYear  = year;
    await refresh();
  }

  function prevMonth() {
    let m = currentMonth - 1;
    let y = currentYear;
    if (m < 1) { m = 12; y--; }
    changeMonth(m, y);
  }

  function nextMonth() {
    let m = currentMonth + 1;
    let y = currentYear;
    if (m > 12) { m = 1; y++; }
    changeMonth(m, y);
  }

  function onMonthSelect() {
    const sel = document.getElementById('saldos-month-sel');
    if (sel) changeMonth(parseInt(sel.value, 10), currentYear);
  }

  function onYearSelect() {
    const sel = document.getElementById('saldos-year-sel');
    if (sel) changeMonth(currentMonth, parseInt(sel.value, 10));
  }

  /* ── Render Page ─────────────────────────────────────────── */

  function renderPage() {
    const totalBalance  = allRows.reduce((s, r) => s + (Number(r.initial_balance) + Number(r.yield_amount || 0)), 0);
    const withBalance   = allRows.filter(r => r.id !== null).length;
    const pending       = allRows.filter(r => r.id === null && r.project_active).length;

    containerEl.innerHTML = `
      <!-- Month Selector -->
      <div class="saldos-month-selector fade-in">
        <button class="btn btn--ghost btn--sm" onclick="SaldosPage.prevMonth()" title="Mês anterior">
          <i data-lucide="chevron-left"></i>
        </button>
        <span class="saldos-month-selector__label">Referência:</span>
        <select id="saldos-month-sel" class="form-input" style="min-width:140px;" onchange="SaldosPage.onMonthSelect()">
          ${MONTH_NAMES.map((n, i) => `<option value="${i + 1}" ${i + 1 === currentMonth ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
        <select id="saldos-year-sel" class="form-input" style="min-width:100px;" onchange="SaldosPage.onYearSelect()">
          ${yearOptions(currentYear)}
        </select>
        <button class="btn btn--ghost btn--sm" onclick="SaldosPage.nextMonth()" title="Próximo mês">
          <i data-lucide="chevron-right"></i>
        </button>
      </div>

      <!-- KPI Cards -->
      <div class="stats-grid fade-in" style="margin-top:20px;">
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--success">
            <i data-lucide="landmark"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Total FUNAPE</div>
            <div class="stat-card__value currency">${formatBRL(totalBalance)}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--accent">
            <i data-lucide="check-circle"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Com Saldo</div>
            <div class="stat-card__value">${withBalance}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--warning">
            <i data-lucide="alert-circle"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Pendentes</div>
            <div class="stat-card__value">${pending}</div>
          </div>
        </div>
      </div>

      <!-- Balance Table -->
      <div class="card fade-in" style="animation-delay:0.1s;margin-top:24px;">
        <div class="card__header">
          <div>
            <h3 class="card__title">Saldos — ${MONTH_NAMES[currentMonth - 1]}/${currentYear}</h3>
            <p class="card__subtitle">Informe o saldo FUNAPE e rendimentos de cada projeto para este mês</p>
          </div>
        </div>

        ${allRows.length > 0 ? `
          <div class="data-table-wrapper">
            <table class="data-table balance-table">
              <thead>
                <tr>
                  <th>Projeto</th>
                  <th>Status</th>
                  <th style="min-width:140px;">Saldo FUNAPE (R$)</th>
                  <th style="min-width:130px;">Rendimentos (R$)</th>
                  <th style="min-width:140px;">Data do Saldo</th>
                </tr>
              </thead>
              <tbody>
                ${allRows.map(row => renderRow(row)).join('')}
              </tbody>
            </table>
          </div>

          ${dirtyRows.size > 0 ? `
          <div class="saldos-batch-actions">
            <button class="btn btn--primary btn--sm" onclick="SaldosPage.saveAllChanges()">
              <i data-lucide="save"></i> Salvar Alterações
            </button>
            <button class="btn btn--ghost btn--sm" onclick="SaldosPage.discardChanges()">
              <i data-lucide="rotate-ccw"></i> Descartar
            </button>
          </div>
          ` : ''}
        ` : `
          <div class="empty-state" style="padding:32px;">
            <i data-lucide="folder-plus" class="empty-state__icon"></i>
            <h3 class="empty-state__title">Nenhum projeto cadastrado</h3>
            <p class="empty-state__text">Crie um projeto na aba Projetos para informar saldos.</p>
          </div>
        `}
      </div>
    `;

    lucide.createIcons();
  }

  function renderRow(row) {
    const hasBalance  = row.id !== null;
    const isDirty     = dirtyRows.has(row.project_id);
    const rowClass    = isDirty ? 'row--dirty' : (!hasBalance && row.project_active ? 'row--empty' : '');

    return `
      <tr class="${rowClass}" data-project-id="${row.project_id}">
        <td style="font-weight:600;color:var(--text-primary);">
          ${escapeAttr(row.project_name)}
        </td>
        <td>
          <span class="badge badge--${row.project_active ? 'active' : 'ended'}">
            ${row.project_active ? 'Ativo' : 'Inativo'}
          </span>
        </td>
        <td>
          <input type="number" step="0.01" class="form-input form-input--inline"
            value="${hasBalance ? row.initial_balance : ''}"
            placeholder="0,00"
            data-field="initial_balance"
            data-project-id="${row.project_id}"
            onchange="SaldosPage.markDirty('${row.project_id}', this)"
            style="width:130px;">
        </td>
        <td>
          <input type="number" step="0.01" class="form-input form-input--inline"
            value="${hasBalance ? row.yield_amount : ''}"
            placeholder="0,00"
            data-field="yield_amount"
            data-project-id="${row.project_id}"
            onchange="SaldosPage.markDirty('${row.project_id}', this)"
            style="width:120px;">
        </td>
        <td>
          <input type="date" class="form-input form-input--inline"
            value="${hasBalance && row.balance_date ? toInputDate(row.balance_date) : ''}"
            data-field="balance_date"
            data-project-id="${row.project_id}"
            onchange="SaldosPage.markDirty('${row.project_id}', this)"
            style="width:150px;">
        </td>
      </tr>
    `;
  }

  function yearOptions(selected) {
    const current = new Date().getFullYear();
    const years = [];
    for (let y = current - 2; y <= current + 1; y++) {
      years.push(`<option value="${y}" ${y === selected ? 'selected' : ''}>${y}</option>`);
    }
    return years.join('');
  }

  /* ── Dirty Tracking ──────────────────────────────────────── */

  function markDirty(projectId, inputEl) {
    dirtyRows.add(projectId);

    // Update the row class
    const tr = inputEl.closest('tr');
    if (tr) {
      tr.classList.remove('row--empty');
      tr.classList.add('row--dirty');
    }

    // Show batch actions if this is the first dirty row
    if (dirtyRows.size === 1) {
      const actionsDiv = containerEl.querySelector('.saldos-batch-actions');
      if (!actionsDiv) {
        const tableWrapper = containerEl.querySelector('.data-table-wrapper');
        if (tableWrapper) {
          const html = `
            <div class="saldos-batch-actions">
              <button class="btn btn--primary btn--sm" onclick="SaldosPage.saveAllChanges()">
                <i data-lucide="save"></i> Salvar Alterações
              </button>
              <button class="btn btn--ghost btn--sm" onclick="SaldosPage.discardChanges()">
                <i data-lucide="rotate-ccw"></i> Descartar
              </button>
            </div>`;
          tableWrapper.insertAdjacentHTML('afterend', html);
          lucide.createIcons();
        }
      }
    }
  }

  /* ── Save ────────────────────────────────────────────────── */

  async function saveAllChanges() {
    if (dirtyRows.size === 0) {
      showToast('Nenhuma alteração para salvar.', 'info');
      return;
    }

    const promises = [];

    dirtyRows.forEach(projectId => {
      const balanceInput  = containerEl.querySelector(`input[data-field="initial_balance"][data-project-id="${projectId}"]`);
      const yieldInput    = containerEl.querySelector(`input[data-field="yield_amount"][data-project-id="${projectId}"]`);
      const dateInput     = containerEl.querySelector(`input[data-field="balance_date"][data-project-id="${projectId}"]`);

      const rawBalance = balanceInput?.value.trim();
      const rawYield   = yieldInput?.value.trim();
      const initialBalance = rawBalance !== '' ? parseFloat(rawBalance) : null;
      const yieldAmount    = rawYield !== '' ? parseFloat(rawYield) : null;
      const balanceDate    = dateInput?.value || null;

      // Skip rows with no balance, no yield, and no date — nothing to save
      if (initialBalance === null && yieldAmount === null && !balanceDate) return;

      // If we have balance/yield but no date, default to 1st of reference month
      const resolvedDate = balanceDate
        ? balanceDate
        : (initialBalance !== null || yieldAmount !== null)
          ? `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`
          : null;

      promises.push(
        supabaseClient.rpc('upsert_project_balance', {
          p_project_id:      projectId,
          p_reference_month:  currentMonth,
          p_reference_year:   currentYear,
          p_initial_balance:  initialBalance ?? 0,
          p_yield_amount:     yieldAmount ?? 0,
          p_balance_date:     resolvedDate,
        })
      );
    });

    const results = await Promise.allSettled(promises);
    const failures = results.filter(r => r.status === 'rejected' || r.value?.error);

    if (failures.length > 0) {
      const firstError = failures[0].reason || failures[0].value?.error;
      showToast('Erro ao salvar alguns saldos: ' + (firstError?.message || 'Erro desconhecido'), 'error');
      return;
    }

    showToast('Saldos salvos com sucesso!', 'success');
    await refresh();
  }

  /* ── Discard ─────────────────────────────────────────────── */

  async function discardChanges() {
    if (dirtyRows.size === 0) return;
    const ok = await confirmAction('Descartar todas as alterações não salvas?');
    if (!ok) return;
    await refresh();
  }

  return {
    load,
    prevMonth,
    nextMonth,
    onMonthSelect,
    onYearSelect,
    markDirty,
    saveAllChanges,
    discardChanges,
  };
})();
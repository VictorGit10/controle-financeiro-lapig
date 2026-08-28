/* ============================================================
   Saldos Page — registro mensal de saldos (SOMENTE LEITURA)

   Esta tela já foi um formulário de digitação. Deixou de ser na
   migração 043: o saldo do projeto é o SALDO DISPONÍVEL do
   balancete, e digitá-lo de novo aqui era retrabalho — dois
   lugares para o mesmo número, que divergem no dia em que
   alguém atualiza um e esquece o outro.

   O que sobrou é o registro: qual saldo cada centro de custo
   tinha em cada competência, de onde veio e em que data. Para
   ATUALIZAR um saldo, sobe-se o balancete (Fechamento Mensal);
   o gatilho da 043 faz o resto até projects.initial_balance.

   Sem estado editável, esta página não tem mais o que perder ao
   trocar de rota — por isso não registra guard nem dirtyChecker
   no Router (só projetos.js o faz agora).
   ============================================================ */

Router.register('saldos', {
  title: 'Saldos',

  actions(container) {
    // Somente leitura — nada a acionar aqui.
  },

  async render(container) {
    await SaldosPage.load(container);
  }
});


const SaldosPage = (() => {

  let containerEl  = null;
  let allRows      = [];   // resultado de get_balances_for_month
  let currentMonth = new Date().getMonth() + 1;
  let currentYear  = new Date().getFullYear();

  // Projeto atual do app. Esta tela é por competência (todos os projetos de
  // uma vez), então o contexto que vem do botão "Abrir Saldos" da Visão do
  // Projeto não vira filtro — vira destaque: a linha dele fica marcada e a
  // página rola até ela. Filtrar aqui destruiria o "Total em Conta", que é
  // justamente a soma de todo mundo.
  const PROJECT_KEY = 'cf_selected_project_id';
  let highlightProjectId = null;

  const MONTH_NAMES = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  /* ── Load ────────────────────────────────────────────────── */

  async function load(container) {
    containerEl = container;
    highlightProjectId = localStorage.getItem(PROJECT_KEY) || null;
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

    allRows = data || [];
    renderPage();

    // Depois do render, leva a linha destacada para a área visível. Sem isto o
    // destaque existiria fora da tela em quem tem muitos centros de custo.
    if (highlightProjectId) {
      containerEl.querySelector('.balance-row--atual')
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  /* ── Navegação de mês ────────────────────────────────────── */

  async function changeMonth(month, year) {
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

  function abrirFechamento() {
    Router.navigate('fechamento');
  }

  /* ── Saldo de uma linha ──────────────────────────────────── */

  // Mesma conta do resto do app (`saldoAtual` em projetos.js e hub.js):
  // é a soma que alimenta calc_project_monthly, não só initial_balance.
  // Em linha vinda do balancete o yield é sempre 0 — o rodapé do PDF já
  // dá o valor "PÓS IR/IOF ESTIMADO S/ REND. APL. FINANCEIRA", com o
  // rendimento dentro (ver o cabeçalho da migração 043).
  function saldoDaLinha(row) {
    return Number(row.initial_balance || 0) + Number(row.yield_amount || 0);
  }

  /* ── Render ──────────────────────────────────────────────── */

  function renderPage() {
    const comSaldo = allRows.filter(r => r.id !== null);
    const total    = comSaldo.reduce((s, r) => s + saldoDaLinha(r), 0);
    const pendente = allRows.filter(r => r.id === null && r.project_active).length;

    containerEl.innerHTML = `
      <!-- Como se atualiza um saldo -->
      <div class="fade-in" style="margin-bottom:16px;display:flex;gap:10px;align-items:center;padding:12px 16px;border-radius:10px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.25);color:var(--text-secondary);font-size:0.85rem;">
        <i data-lucide="info" style="width:18px;height:18px;color:var(--info,#3b82f6);flex-shrink:0;"></i>
        <div style="flex:1;">
          Registro somente leitura. O saldo vem do <strong>SALDO DISPONÍVEL</strong> do balancete —
          para atualizar, suba o PDF no Fechamento Mensal.
        </div>
        <button class="btn btn--ghost btn--sm" onclick="SaldosPage.abrirFechamento()" style="flex-shrink:0;">
          <i data-lucide="calendar-check"></i> Abrir Fechamento
        </button>
      </div>

      <!-- Seletor de mês -->
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

      <!-- KPIs -->
      <div class="stats-grid fade-in" style="margin-top:20px;">
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--success">
            <i data-lucide="landmark"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Total em Conta</div>
            <div class="stat-card__value currency">${formatBRL(total)}</div>
            <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">soma dos ${comSaldo.length} com registro</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--accent">
            <i data-lucide="check-circle"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Com Saldo</div>
            <div class="stat-card__value">${comSaldo.length}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--warning">
            <i data-lucide="alert-circle"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Sem Balancete</div>
            <div class="stat-card__value">${pendente}</div>
            <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">ativos, nesta competência</div>
          </div>
        </div>
      </div>

      <!-- Tabela -->
      <div class="card fade-in" style="animation-delay:0.1s;margin-top:24px;">
        <div class="card__header">
          <div>
            <h3 class="card__title">Saldos — ${MONTH_NAMES[currentMonth - 1]}/${currentYear}</h3>
            <p class="card__subtitle">Saldo registrado de cada centro de custo nesta competência</p>
          </div>
        </div>

        ${allRows.length > 0 ? `
          <div class="data-table-wrapper">
            <table class="data-table balance-table">
              <thead>
                <tr>
                  <th>Projeto</th>
                  <th>Status</th>
                  <th style="min-width:160px;">Saldo em Conta</th>
                  <th style="min-width:130px;">Data do Saldo</th>
                  <th style="min-width:120px;">Origem</th>
                </tr>
              </thead>
              <tbody>
                ${allRows.map(row => renderRow(row)).join('')}
              </tbody>
            </table>
          </div>
        ` : `
          <div class="empty-state" style="padding:32px;">
            <i data-lucide="folder-plus" class="empty-state__icon"></i>
            <h3 class="empty-state__title">Nenhum projeto cadastrado</h3>
            <p class="empty-state__text">Crie um projeto na aba <strong>Gestão de Projetos</strong>.</p>
          </div>
        `}
      </div>
    `;

    lucide.createIcons();
  }

  function renderRow(row) {
    const temSaldo = row.id !== null;

    const atual = row.project_id && row.project_id === highlightProjectId;

    if (!temSaldo) {
      return `
        <tr class="${row.project_active ? 'row--empty' : ''} ${atual ? 'balance-row--atual' : ''}">
          <td style="font-weight:600;color:var(--text-primary);">${escapeAttr(row.project_name)}</td>
          <td>
            <span class="badge badge--${row.project_active ? 'active' : 'ended'}">
              ${row.project_active ? 'Ativo' : 'Inativo'}
            </span>
          </td>
          <td colspan="3" style="color:var(--text-muted);font-size:0.8rem;">
            Sem balancete nesta competência
          </td>
        </tr>`;
    }

    const doBalancete = row.source === 'balancete';
    // Duas origens para a mesma legenda, porque são duas eras do dado:
    //   • linha do balancete (043 em diante): a composição está em
    //     `rendimento_informativo`, que a mig. 045 acrescentou — o rendimento
    //     está DENTRO do saldo e não pode ser somado;
    //   • linha digitada antes da 043: está em `yield_amount`, que ali É
    //     parcela a somar (veio de extrato com principal e rendimento em
    //     linhas separadas), e `saldoDaLinha` já a soma.
    // `null` continua diferente de `0`: rodapé não lido não vira "sem rendimento".
    const rendimento = row.rendimento_informativo != null
      ? row.rendimento_informativo
      : row.yield_amount;

    return `
      <tr class="${atual ? 'balance-row--atual' : ''}">
        <td style="font-weight:600;color:var(--text-primary);">${escapeAttr(row.project_name)}</td>
        <td>
          <span class="badge badge--${row.project_active ? 'active' : 'ended'}">
            ${row.project_active ? 'Ativo' : 'Inativo'}
          </span>
        </td>
        <td>
          <span class="currency" style="font-weight:600;">${formatBRL(saldoDaLinha(row))}</span>
          ${rendimentoLegendaHTML(rendimento)}
        </td>
        <td>${row.balance_date ? formatDate(row.balance_date) : '—'}</td>
        <td>
          <span class="badge badge--${doBalancete ? 'active' : 'ended'}" title="${doBalancete
            ? 'Derivado do SALDO DISPONÍVEL do balancete'
            : 'Digitado à mão, antes de a aba virar somente leitura'}">
            ${doBalancete ? 'Balancete' : 'Digitado'}
          </span>
        </td>
      </tr>`;
  }

  function yearOptions(selected) {
    const current = new Date().getFullYear();
    const years = [];
    for (let y = current - 2; y <= current + 1; y++) {
      years.push(`<option value="${y}" ${y === selected ? 'selected' : ''}>${y}</option>`);
    }
    return years.join('');
  }

  return {
    load,
    prevMonth,
    nextMonth,
    onMonthSelect,
    onYearSelect,
    abrirFechamento,
  };
})();

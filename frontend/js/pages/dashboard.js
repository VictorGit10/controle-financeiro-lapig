/* ============================================================
   Dashboard Page — Consolidated financial overview
   With dynamic project filter + notification bell + monthly chart
   ============================================================ */

Router.register('dashboard', {
  title: 'Visão Geral',

  actions(container) {
    const btn = document.createElement('button');
    btn.className = 'btn btn--secondary btn--sm';
    btn.id = 'dash-filter-toggle';
    btn.innerHTML = '<i data-lucide="filter"></i> Filtrar Projetos';
    btn.addEventListener('click', () => DashboardPage.toggleFilter());
    container.appendChild(btn);
  },

  async render(container) {
    await DashboardPage.load(container);
  }
});


const DashboardPage = (() => {

  let containerEl  = null;
  let allProjects  = [];
  let selectedIds  = new Set();
  let filterOpen   = false;
  let _chartInstance = null;
  let currentBalanceStatus = 'unpaid_current';
  let _autoSelected = false;
  let _bellInited = false;

  const STORAGE_KEY = 'cf_dashboard_selected_projects';

  /* ── Load ────────────────────────────────────────────────── */

  async function load(container) {
    containerEl = container;
    _initBell();

    const { data: projects, error } = await supabaseClient
      .from('v_project_summary')
      .select('*');

    if (error) {
      showToast('Erro ao carregar projetos: ' + error.message, 'error');
      return;
    }

    allProjects = projects || [];

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const ids = JSON.parse(stored);
        selectedIds = new Set(ids.filter(id => allProjects.some(p => p.id === id)));
      } catch {
        selectedIds = new Set();
      }
    }

    if (selectedIds.size === 0) {
      allProjects.forEach(p => {
        if (p.in_general_dashboard && p.active) selectedIds.add(p.id);
      });
    }

    if (selectedIds.size === 0) {
      allProjects.filter(p => p.active).forEach(p => selectedIds.add(p.id));
    }

    // Auto-select balance status based on the most recent balance_date
    if (!_autoSelected) {
      const repDate = allProjects.filter(p => p.active && p.balance_date)
        .map(p => p.balance_date).sort().pop() || null;
      currentBalanceStatus = inferBalanceStatus(repDate);
      _autoSelected = true;
    }

    await renderFull();
  }

  /* ── Notification Bell ───────────────────────────────────── */

  function _initBell() {
    // O sino vive no topbar estático: registrar os listeners uma única
    // vez, senão cada visita ao Dashboard empilha um par de handlers e
    // o toggle de panel.hidden vira no-op.
    if (_bellInited) return;
    const btn   = document.getElementById('notif-bell-btn');
    const panel = document.getElementById('notif-dropdown');
    if (!btn || !panel) return;
    _bellInited = true;

    btn.addEventListener('click', e => {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
    });

    document.addEventListener('click', e => {
      if (!document.getElementById('notif-bell-wrapper')?.contains(e.target)) {
        if (panel) panel.hidden = true;
      }
    });
  }

  function _updateBell(alerts) {
    const badge = document.getElementById('notif-badge');
    const count = document.getElementById('notif-count');
    const list  = document.getElementById('notif-list');
    if (!badge || !count || !list) return;

    if (alerts.length === 0) {
      badge.hidden = true;
      count.textContent = 'Nenhum alerta';
      list.innerHTML = '<p class="notif-dropdown__empty">Tudo certo! Nenhum alerta ativo.</p>';
      return;
    }

    badge.hidden = false;
    badge.textContent = alerts.length;
    count.textContent = `${alerts.length} alerta${alerts.length > 1 ? 's' : ''}`;

    list.innerHTML = alerts.map(a => {
      const color = a.severity === 'danger' ? 'var(--danger)'
                  : a.severity === 'warning' ? 'var(--warning)'
                  : 'var(--info)';
      const icon  = a.severity === 'danger' ? 'alert-triangle' : 'alert-circle';
      return `
        <div class="notif-item" style="border-left-color:${color};">
          <i data-lucide="${icon}" style="color:${color};width:14px;height:14px;flex-shrink:0;"></i>
          <div class="notif-item__body">
            <span class="notif-item__project">${escapeAttr(a.project_name)}</span>
            <span class="notif-item__msg">${escapeAttr(a.message)}</span>
          </div>
        </div>`;
    }).join('');

    lucide.createIcons({ nodes: [list] });
  }

  /* ── Persist & Toggle ────────────────────────────────────── */

  function persistSelection() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...selectedIds]));
  }

  function toggleFilter() {
    filterOpen = !filterOpen;
    const panel = containerEl.querySelector('#dash-filter-panel');
    if (panel) panel.classList.toggle('dash-filter--open', filterOpen);
    const btn = document.getElementById('dash-filter-toggle');
    if (btn) {
      btn.classList.toggle('btn--primary', filterOpen);
      btn.classList.toggle('btn--secondary', !filterOpen);
    }
  }

  /* ── Render ─────────────────────────────────────────────── */

  async function renderFull() {
    const selectedProjects = allProjects.filter(p => selectedIds.has(p.id));

    // KPIs
    // "Saldo Atual" = initial_balance (valor atualizado da FUNAPE) + yield_amount
    const totalSaldoAtual    = selectedProjects.reduce((s, p) =>
      s + Number(p.initial_balance) + Number(p.yield_amount || 0), 0);
    const totalScholarships  = selectedProjects.reduce((s, p) =>
      s + Number(p.current_monthly_scholarships || 0), 0);
    const activeCount        = selectedProjects.filter(p => p.active).length;

    // Data representativa do saldo (mais recente entre projetos selecionados)
    const repBalanceDate = selectedProjects
      .filter(p => p.balance_date).map(p => p.balance_date).sort().pop() || null;

    // Monthly projection chart data
    let monthlyData = [];
    if (selectedIds.size > 0) {
      monthlyData = await calcAggregatedMonthly([...selectedIds]);
    }

    // Active holders in selected projects
    let activeHolders = [];
    if (selectedIds.size > 0) {
      const projectIdList = [...selectedIds];
      const { data: scholarships, error: schError } = await supabaseClient
        .from('scholarships')
        .select(`
          id, amount, start_date, end_date, status, project_id,
          projects:project_id(name),
          holder:holder_id(id, full_name)
        `)
        .in('project_id', projectIdList)
        .eq('status', 'active')
        .lte('start_date', localISODate())
        .gte('end_date', localISODate())
        .order('amount', { ascending: false });

      if (schError) showToast('Erro ao carregar bolsistas ativos: ' + schError.message, 'error');
      activeHolders = scholarships || [];
    }

    // Unique active holders count
    const uniqueHolders = new Set(activeHolders.map(s => s.holder?.id).filter(Boolean)).size;

    // Alerts for notification bell (batch — single RPC call)
    let allAlerts = [];
    if (selectedProjects.length > 0) {
      const activeIds = selectedProjects.filter(p => p.active).map(p => p.id);
      if (activeIds.length > 0) {
        const { data: alertsData, error: alertsError } = await supabaseClient.rpc('get_alerts_for_projects', {
          p_project_ids: activeIds
        });
        if (alertsError) showToast('Erro ao carregar alertas: ' + alertsError.message, 'error');
        allAlerts = alertsData || [];
      }
    }

    _updateBell(allAlerts);

    containerEl.innerHTML = `
      <!-- Filter Panel -->
      <div id="dash-filter-panel" class="dash-filter ${filterOpen ? 'dash-filter--open' : ''}">
        <div class="dash-filter__header">
          <h4 class="dash-filter__title">
            <i data-lucide="layers" style="width:18px;height:18px;"></i>
            Projetos no Consolidado
          </h4>
          <div class="dash-filter__actions">
            <button class="btn btn--ghost btn--sm" onclick="DashboardPage.selectAll()">Todos</button>
            <button class="btn btn--ghost btn--sm" onclick="DashboardPage.selectNone()">Nenhum</button>
          </div>
        </div>
        <div class="dash-filter__grid">
          ${allProjects.map(p => `
            <label class="dash-filter__item ${!p.active ? 'dash-filter__item--inactive' : ''}" for="df-${p.id}">
              <input type="checkbox" id="df-${p.id}" class="dash-filter__check"
                ${selectedIds.has(p.id) ? 'checked' : ''}
                onchange="DashboardPage.onFilterChange('${p.id}', this.checked)">
              <div class="dash-filter__info">
                <span class="dash-filter__name">${escapeAttr(p.name)}</span>
                <span class="dash-filter__meta">${formatBRL(p.initial_balance)} · ${p.active ? 'Ativo' : 'Inativo'}</span>
              </div>
            </label>
          `).join('')}
        </div>
      </div>

      <!-- Balance Status Control -->
      <div class="dash-balance-control fade-in">
        <div class="dash-balance-control__label">
          <i data-lucide="calendar-check" style="width:18px;height:18px;"></i>
          <span>Desconto de Bolsas:</span>
        </div>
        <select id="dash-balance-status" class="form-input" style="min-width:260px;"
                onchange="DashboardPage.setBalanceStatus(this.value)">
          <option value="unpaid_current" ${currentBalanceStatus === 'unpaid_current' ? 'selected' : ''}>Descontar: Mês Atual</option>
          <option value="paid_current" ${currentBalanceStatus === 'paid_current' ? 'selected' : ''}>Já Pago no Mês Atual</option>
          <option value="unpaid_previous" ${currentBalanceStatus === 'unpaid_previous' ? 'selected' : ''}>Descontar: Atual + Anterior</option>
        </select>
        <span class="dash-balance-control__hint" id="dash-auto-hint"></span>
      </div>

      <!-- KPI Cards — 4 cards -->
      <div class="stats-grid fade-in">

        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--accent">
            <i data-lucide="folder-kanban"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Projetos Ativos</div>
            <div class="stat-card__value">${activeCount}</div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--success">
            <i data-lucide="landmark"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Saldo Atual</div>
            <div class="stat-card__value currency">${formatBRL(totalSaldoAtual)}</div>
            ${repBalanceDate
              ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">em ${formatDate(repBalanceDate)}</div>`
              : `<div style="font-size:0.7rem;color:var(--warning);margin-top:2px;">Data do saldo não informada</div>`
            }
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--info">
            <i data-lucide="users"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Bolsistas Ativos</div>
            <div class="stat-card__value">${uniqueHolders}</div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--warning">
            <i data-lucide="wallet"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Bolsas / Mês Atual</div>
            <div class="stat-card__value currency">${formatBRL(totalScholarships)}</div>
          </div>
        </div>

      </div>

      <!-- Monthly Chart -->
      <div class="card fade-in" style="animation-delay: 0.1s;">
        <div class="card__header">
          <div>
            <h3 class="card__title">Projeção Mensal Consolidada</h3>
            <p class="card__subtitle">Evolução do saldo acumulado partindo do mês atual</p>
          </div>
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <div class="dash-legend-item"><span style="background:rgba(42,157,143,0.8);"></span>Desembolsos</div>
            <div class="dash-legend-item"><span style="background:rgba(196,147,63,0.8);"></span>Bolsas</div>
            <div class="dash-legend-item"><span style="background:var(--accent);border-radius:50%;"></span>Saldo</div>
          </div>
        </div>

        ${monthlyData.length > 0 ? `
          <div style="position:relative;height:320px;">
            <canvas id="dash-monthly-chart"></canvas>
          </div>
        ` : `
          <div class="empty-state" style="padding:32px;">
            <i data-lucide="calendar" class="empty-state__icon"></i>
            <h3 class="empty-state__title">Nenhuma projeção calculada</h3>
            <p class="empty-state__text">Selecione projetos com vigência para ver a projeção mensal.</p>
          </div>
        `}
      </div>

      <!-- Active Holders Panel -->
      <div class="card fade-in" style="animation-delay: 0.2s; margin-top: 24px;">
        <div class="card__header">
          <div>
            <h3 class="card__title">Bolsistas Ativos nos Projetos Selecionados</h3>
            <p class="card__subtitle">${activeHolders.length} bolsa(s) ativa(s) · ${uniqueHolders} bolsista(s)</p>
          </div>
        </div>

        ${activeHolders.length > 0 ? `
          <div class="data-table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Bolsista</th>
                  <th>Projeto</th>
                  <th>Valor Mensal</th>
                  <th>Vigência da Bolsa</th>
                </tr>
              </thead>
              <tbody>
                ${activeHolders.map(s => {
                  const today     = localISODate();
                  const isLate    = s.end_date < today;
                  return `
                    <tr>
                      <td style="font-weight:600;color:var(--text-primary);">
                        ${escapeAttr(s.holder?.full_name || '—')}
                      </td>
                      <td>
                        <span class="badge badge--active" style="font-size:0.7rem;">
                          ${escapeAttr(s.projects?.name || '—')}
                        </span>
                      </td>
                      <td class="currency currency--positive" style="font-weight:700;">
                        ${formatBRL(s.amount)}
                      </td>
                      <td style="font-size:0.8125rem;color:${isLate ? 'var(--danger)' : 'var(--text-secondary)'};">
                        ${formatDate(s.start_date)} — ${formatDate(s.end_date)}
                        ${isLate ? '<span class="badge badge--cancelled" style="margin-left:6px;font-size:0.65rem;">Vencida</span>' : ''}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : `
          <div class="empty-state" style="padding:24px;">
            <i data-lucide="user-x" class="empty-state__icon"></i>
            <h3 class="empty-state__title">Nenhum bolsista ativo</h3>
            <p class="empty-state__text">Não há bolsas ativas nos projetos selecionados.</p>
          </div>
        `}
      </div>
    `;

    lucide.createIcons();

    // Populate auto-hint with balance date info
    const autoHint = document.getElementById('dash-auto-hint');
    if (autoHint) {
      const dates = allProjects.filter(p => selectedIds.has(p.id) && p.balance_date);
      if (dates.length > 0) {
        const latest = dates.map(p => p.balance_date).sort().pop();
        autoHint.textContent = 'Saldo de ' + formatDate(latest);
      } else {
        autoHint.textContent = '';
      }
    }

    if (monthlyData.length > 0) {
      setTimeout(() => {
        _chartInstance = ChartBuilder.buildFinancialChart('dash-monthly-chart', monthlyData, {
          existingChart: _chartInstance,
        });
      }, 50);
    }
  }

  /* ── Aggregate Monthly ───────────────────────────────────── */

  async function calcAggregatedMonthly(projectIds) {
    const todayStartStr = localISODate().slice(0, 8) + '01';

    // Try batch RPC first (single query), fallback to N+1 if not available
    const { data: batchData, error: batchError } = await supabaseClient.rpc('calc_projects_batch', {
      p_project_ids: projectIds,
      p_start_date: todayStartStr,
      p_balance_status: currentBalanceStatus
    });

    const monthMap = new Map();

    if (!batchError && batchData) {
      // Batch path: single RPC call
      batchData.forEach(row => {
        const key = row.month_start;
        if (!monthMap.has(key)) {
          monthMap.set(key, {
            month_label: row.month_label, month_start: row.month_start,
            initial_balance: 0, scholarship_expense: 0,
            funding_income: 0, net_balance: 0,
          });
        }
        const agg = monthMap.get(key);
        agg.initial_balance     += Number(row.initial_balance || 0);
        agg.scholarship_expense += Number(row.scholarship_expense || 0);
        agg.funding_income      += Number(row.funding_income || 0);
        agg.net_balance         += Number(row.net_balance || 0);
      });
    } else {
      // Fallback: N+1 queries
      const results = await Promise.all(
        projectIds.map(id => supabaseClient.rpc('calc_project_monthly', {
          p_project_id: id,
          p_start_date: todayStartStr,
          p_balance_status: currentBalanceStatus
        }))
      );
      results.forEach(res => {
        if (res.error || !res.data) return;
        res.data.forEach(row => {
          const key = row.month_start;
          if (!monthMap.has(key)) {
            monthMap.set(key, {
              month_label: row.month_label, month_start: row.month_start,
              initial_balance: 0, scholarship_expense: 0,
              funding_income: 0, net_balance: 0,
            });
          }
          const agg = monthMap.get(key);
          agg.initial_balance     += Number(row.initial_balance || 0);
          agg.scholarship_expense += Number(row.scholarship_expense || 0);
          agg.funding_income      += Number(row.funding_income || 0);
          agg.net_balance         += Number(row.net_balance || 0);
        });
      });
    }

    return Array.from(monthMap.values()).sort((a, b) =>
      a.month_start.localeCompare(b.month_start)
    );
  }

  /* ── Filter Handlers ────────────────────────────────────── */

  function onFilterChange(id, checked) {
    checked ? selectedIds.add(id) : selectedIds.delete(id);
    persistSelection();
    _autoSelected = false;
    _reinferAndRender();
  }

  function selectAll() {
    allProjects.forEach(p => selectedIds.add(p.id));
    persistSelection();
    _autoSelected = false;
    _reinferAndRender();
  }

  function selectNone() {
    selectedIds.clear();
    persistSelection();
    _autoSelected = false;
    _reinferAndRender();
  }

  async function _reinferAndRender() {
    const repDate = allProjects.filter(p => p.active && p.balance_date && selectedIds.has(p.id))
      .map(p => p.balance_date).sort().pop() || null;
    currentBalanceStatus = inferBalanceStatus(repDate);
    await renderFull();
  }

  async function setBalanceStatus(val) {
    currentBalanceStatus = val;
    _autoSelected = true;
    await renderFull();
  }

  return { load, toggleFilter, onFilterChange, selectAll, selectNone, setBalanceStatus };
})();

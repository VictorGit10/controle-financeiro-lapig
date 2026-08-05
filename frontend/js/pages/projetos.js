/* ============================================================
   Projetos Page — Dropdown selector + Chart + Holders panel
   + Simulation Mode for scholarship editing
   ============================================================ */

Router.register('projetos', {
  title: 'Projetos',

  async render(container) {
    await ProjetosPage.load(container);
  }
});


const ProjetosPage = (() => {

  let containerEl          = null;
  let allProjects          = [];
  let selectedProjectId    = null;

  // Project data for selected project
  let projectData          = null;
  let fundingData          = [];

  // Simulation mode state
  let editorMode           = false;
  let draftScholarships    = [];
  let originalScholarships = [];

  let scholarshipSearchTerm = '';

  // Chart
  let _chartInstance       = null;

  const STORAGE_KEY = 'cf_selected_project_id';

  // Chart Projection Context
  let currentBalanceStatus = 'unpaid_current';
  let _userSetBalanceStatus = false;

  /* ── Load ────────────────────────────────────────────────── */

  async function load(container) {
    containerEl = container;
    editorMode  = false;

    // Show skeleton while loading
    containerEl.innerHTML = '<div class="skeleton skeleton--card" style="height:200px;"></div>';

    const { data: projects, error } = await supabaseClient
      .from('projects')
      .select('*')
      .order('active', { ascending: false })
      .order('name');

    if (error) {
      showToast('Erro ao carregar projetos: ' + error.message, 'error');
      return;
    }

    allProjects = projects || [];

    if (allProjects.length === 0) {
      const isAdminUser = typeof Auth !== 'undefined' && Auth.isAdmin();
      containerEl.innerHTML = `
        <div class="empty-state">
          <i data-lucide="folder-plus" class="empty-state__icon"></i>
          <h3 class="empty-state__title">${isAdminUser ? 'Nenhum projeto ainda' : 'Nenhum centro de custo vinculado'}</h3>
          <p class="empty-state__text">${isAdminUser
            ? 'Cadastre projetos na aba <strong>Gestão de Projetos</strong>.'
            : 'Crie um novo na aba <strong>Gestão de Projetos</strong>, ou peça ao administrador para atribuir um existente.'}</p>
        </div>`;
      lucide.createIcons();
      return;
    }

    // Restore last selected project from localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && allProjects.some(p => p.id === stored)) {
      selectedProjectId = stored;
    } else {
      selectedProjectId = allProjects.find(p => p.active)?.id || allProjects[0].id;
    }

    await renderFull();
  }

  /* ── Persist selection ──────────────────────────────────── */

  function persistSelection(id) {
    selectedProjectId = id;
    localStorage.setItem(STORAGE_KEY, id);
  }

  /* ── On dropdown change ─────────────────────────────────── */

  async function onProjectChange(id) {
    if (editorMode) {
      const ok = await confirmAction('Trocar de projeto? As alterações não salvas serão descartadas.');
      if (!ok) {
        // Revert select element
        const sel = document.getElementById('project-selector');
        if (sel) sel.value = selectedProjectId;
        return;
      }
      editorMode = false;
    }
    _userSetBalanceStatus = false;
    scholarshipSearchTerm = '';
    persistSelection(id);
    await renderFull();
  }

  /* ── Full render ─────────────────────────────────────────── */

  async function renderFull() {
    if (!selectedProjectId) return;

    // Skeleton while fetching
    containerEl.innerHTML = `
      <div class="proj-selector-bar fade-in">
        <div class="skeleton" style="height:44px;border-radius:10px;width:100%;max-width:420px;"></div>
      </div>
      <div class="skeleton skeleton--card" style="height:120px;margin-top:20px;"></div>
      <div class="skeleton skeleton--card" style="height:320px;margin-top:20px;"></div>
    `;

    const todayStartStr = localISODate().slice(0, 8) + '01';

    // Fetch all data in parallel
    const [projectRes, scholarshipsRes, fundingRes, alertsRes, monthlyRes] = await Promise.all([
      supabaseClient.from('projects').select('*').eq('id', selectedProjectId).single(),
      supabaseClient.from('scholarships')
        .select('*, holder:holder_id(id, full_name)')
        .eq('project_id', selectedProjectId)
        .order('start_date'),
      supabaseClient.from('funding_releases').select('*').eq('project_id', selectedProjectId).order('release_date'),
      supabaseClient.rpc('get_project_alerts', { p_project_id: selectedProjectId }),
      supabaseClient.rpc('calc_project_monthly', {
        p_project_id: selectedProjectId,
        p_start_date: todayStartStr,
        p_balance_status: currentBalanceStatus
      }),
    ]);

    if (projectRes.error) {
      showToast('Erro ao carregar projeto', 'error');
      return;
    }

    const suppErrors = [scholarshipsRes, fundingRes, alertsRes, monthlyRes].filter(r => r.error);
    if (suppErrors.length) {
      console.warn('Partial load errors:', suppErrors.map(r => r.error.message));
    }

    projectData          = projectRes.data;
    draftScholarships    = (scholarshipsRes.data || []).map(s => ({ ...s }));
    originalScholarships = draftScholarships.map(s => ({ ...s }));
    fundingData          = fundingRes.data || [];
    const alerts         = alertsRes.data || [];
    const monthlyData    = monthlyRes.data || [];

    // Auto-select balance status based on balance date
    if (!_userSetBalanceStatus) {
      currentBalanceStatus = inferBalanceStatus(projectData.balance_date);
    }

    renderView(alerts, monthlyData);
  }

  /* ── Render view (also called by simulation mode refresh) ── */

  function renderView(alerts = [], monthlyDataFromDB = null) {
    const todayStartStr = localISODate().slice(0, 8) + '01';
    let monthlyData;
    let originalMonthlyData = [];
    if (editorMode) {
      monthlyData         = SimulationEngine.calcProjectMonthly(projectData, draftScholarships, fundingData, { startDateParam: todayStartStr, balanceStatus: currentBalanceStatus });
      originalMonthlyData = SimulationEngine.calcProjectMonthly(projectData, originalScholarships, fundingData, { startDateParam: todayStartStr, balanceStatus: currentBalanceStatus });
    } else {
      // Always use SimulationEngine so that balance status changes reflect immediately.
      // monthlyDataFromDB (from the RPC) is used only as a reference when there is no
      // user-driven balance-status selection and the local data mirrors the DB perfectly.
      // Using SimulationEngine here ensures the selector always triggers a visible update.
      monthlyData = SimulationEngine.calcProjectMonthly(projectData, draftScholarships, fundingData, { startDateParam: todayStartStr, balanceStatus: currentBalanceStatus });
    }

    // KPI calculations
    const today              = localISODate();
    const activeScholarships = draftScholarships.filter(s =>
      s.status === 'active' && s.start_date <= today && s.end_date >= today
    );
    const totalMonthly       = activeScholarships.reduce((sum, s) => sum + Number(s.amount), 0);
    const saldoAtual         = Number(projectData.initial_balance) + Number(projectData.yield_amount || 0);
    const lastMonth          = monthlyData.length > 0 ? monthlyData[monthlyData.length - 1] : null;

    let holdersToShow = editorMode ? draftScholarships : draftScholarships.filter(s => s.status === 'active' && s.start_date <= today && s.end_date >= today);

    // Sort alphabetically by name
    holdersToShow.sort((a, b) => {
      const nameA = (a.holder?.full_name || a._holderName || '').toLowerCase();
      const nameB = (b.holder?.full_name || b._holderName || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });

    const uniqueHolders = new Set(holdersToShow.map(s => s.holder?.id).filter(Boolean)).size;

    const visibleHoldersCount = holdersToShow.filter(s => {
      const name = (s.holder?.full_name || s._holderName || '').toLowerCase();
      return !scholarshipSearchTerm || name.includes(scholarshipSearchTerm);
    }).length;

    containerEl.innerHTML = `

      <!-- ── Project Selector Bar ── -->
      <div class="proj-selector-bar fade-in">

        <div class="proj-selector-wrap">
          <i data-lucide="folder-kanban" class="proj-selector-wrap__icon"></i>
          <select id="project-selector" class="proj-selector"
            onchange="ProjetosPage.onProjectChange(this.value)">
            ${(() => {
              const active   = allProjects.filter(p =>  p.active);
              const inactive = allProjects.filter(p => !p.active);
              const renderOpt = p => `<option value="${p.id}" ${p.id === selectedProjectId ? 'selected' : ''}>${escapeAttr(p.name)}</option>`;
              return [
                ...active.map(renderOpt),
                inactive.length
                  ? `<optgroup label="— Inativos —">${inactive.map(renderOpt).join('')}</optgroup>`
                  : ''
              ].join('');
            })()}
          </select>
          <span class="badge badge--${projectData.active ? 'active' : 'ended'}" style="flex-shrink:0;">
            ${projectData.active ? 'Ativo' : 'Inativo'}
          </span>
        </div>

        <div class="proj-selector-bar__actions">
          ${editorMode ? `
            <div class="sim-mode-badge">
              <i data-lucide="flask-conical" style="width:14px;height:14px;"></i>
              <span>Simulação</span>
            </div>
            <button class="btn btn--primary btn--sm" onclick="ProjetosPage.saveEditorChanges()">
              <i data-lucide="save"></i> Salvar
            </button>
            <button class="btn btn--danger btn--sm" onclick="ProjetosPage.cancelEditorMode()">
              <i data-lucide="x"></i> Cancelar
            </button>
          ` : `
            <button class="btn btn--secondary btn--sm" onclick="ProjetosPage.enterEditorMode()">
              <i data-lucide="pencil-ruler"></i> Simulação
            </button>
          `}
        </div>
      </div>

      <!-- Balance Status Control -->
      <div class="dash-balance-control fade-in" style="margin-top:16px;">
        <div class="dash-balance-control__label">
          <i data-lucide="calendar-check" style="width:18px;height:18px;"></i>
          <span>Desconto de Bolsas:</span>
        </div>
        <select id="proj-balance-status" class="form-input" style="min-width:260px;"
                onchange="ProjetosPage.setBalanceStatus(this.value)">
          <option value="unpaid_current" ${currentBalanceStatus === 'unpaid_current' ? 'selected' : ''}>Descontar: Mês Atual</option>
          <option value="paid_current" ${currentBalanceStatus === 'paid_current' ? 'selected' : ''}>Já Pago no Mês Atual</option>
          <option value="unpaid_previous" ${currentBalanceStatus === 'unpaid_previous' ? 'selected' : ''}>Descontar: Atual + Anterior</option>
        </select>
        <span class="dash-balance-control__hint" id="proj-auto-hint"></span>
      </div>

      <!-- ── KPI Cards ── -->
      <div class="stats-grid fade-in" style="margin-top:20px;">

        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--success">
            <i data-lucide="landmark"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Saldo Atual</div>
            <div class="stat-card__value currency">${formatBRL(saldoAtual)}</div>
            ${projectData.balance_date
              ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">em ${formatDate(projectData.balance_date)}</div>`
              : `<div style="font-size:0.7rem;color:var(--warning);margin-top:2px;">Data do saldo não informada</div>`
            }
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--warning">
            <i data-lucide="wallet"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Bolsas / Mês Atual</div>
            <div class="stat-card__value currency">${formatBRL(totalMonthly)}</div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--accent">
            <i data-lucide="calendar-range"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Vigência</div>
            <div class="stat-card__value" style="font-size:0.95rem;">
              ${formatDate(projectData.start_date)} — ${formatDate(projectData.end_date)}
            </div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-card__icon ${lastMonth && lastMonth.net_balance < 0 ? 'stat-card__icon--danger' : 'stat-card__icon--info'}">
            <i data-lucide="trending-up"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Saldo Projetado ${editorMode ? '(Simulação)' : '(Último Mês)'}</div>
            <div class="stat-card__value currency ${lastMonth && lastMonth.net_balance < 0 ? 'currency--negative' : ''}">
              ${lastMonth ? formatBRL(lastMonth.net_balance) : '—'}
            </div>
          </div>
        </div>

      </div>

      <!-- ── Monthly Chart ── -->
      <div class="card fade-in" style="animation-delay:0.1s;margin-top:24px;">
        <div class="card__header">
          <div>
            <h3 class="card__title">Projeção Mensal ${editorMode ? '<span class="badge badge--warning" style="margin-left:8px;font-size:0.7rem;">SIMULAÇÃO</span>' : ''}</h3>
            <p class="card__subtitle">Evolução do saldo partindo do mês atual</p>
          </div>
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <div class="dash-legend-item"><span style="background:rgba(42,157,143,0.8);"></span>Desembolsos</div>
            <div class="dash-legend-item"><span style="background:rgba(196,147,63,0.8);"></span>Bolsas</div>
            <div class="dash-legend-item"><span style="background:rgba(217,67,67,0.7);"></span>Outros</div>
            <div class="dash-legend-item"><span style="background:var(--accent);border-radius:50%;"></span>Saldo</div>
          </div>
        </div>

        ${monthlyData.length > 0 ? `
          <div style="position:relative;height:300px;">
            <canvas id="proj-monthly-chart"></canvas>
          </div>
        ` : `
          <div class="empty-state" style="padding:32px;">
            <i data-lucide="calendar" class="empty-state__icon"></i>
            <h3 class="empty-state__title">Sem projeção disponível</h3>
            <p class="empty-state__text">Defina a vigência do projeto para ver a projeção mensal.</p>
          </div>
        `}
      </div>

      <!-- ── Holders / Simulation Panel ── -->
      <div class="card fade-in" style="animation-delay:0.2s;margin-top:24px;">
        <div class="card__header" style="flex-wrap: wrap; gap: 16px;">
          <div>
            <h3 class="card__title">
              ${editorMode ? 'Bolsas do Projeto (Simulação)' : 'Bolsistas Ativos neste Projeto'}
            </h3>
            <p class="card__subtitle">
              <span id="visible-holders-count">${visibleHoldersCount}</span> bolsa(s) listada(s) · ${uniqueHolders} total${editorMode ? ' — alterações refletem no gráfico acima em tempo real' : ''}
            </p>
          </div>
          <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
            <div style="position: relative; min-width: 240px;">
              <i data-lucide="search" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: var(--text-muted);"></i>
              <input type="text" class="form-input" style="padding-left: 36px; width: 100%;" placeholder="Buscar bolsista..."
                value="${escapeAttr(scholarshipSearchTerm)}"
                oninput="ProjetosPage.onScholarshipSearch(this.value)">
            </div>
          ${editorMode ? `
            <button class="btn btn--primary btn--sm" onclick="ProjetosPage.addDraftScholarship()">
              <i data-lucide="user-plus"></i> Adicionar Bolsa
            </button>
          ` : ''}
          </div>
        </div>

        ${holdersToShow.length > 0 ? `
          <div class="data-table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Bolsista</th>
                  <th>Valor Mensal</th>
                  <th>Início</th>
                  <th>Fim</th>
                  <th>Status</th>
                  ${editorMode ? '<th>Ações</th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${holdersToShow.map((s, idx) => {
                  const isNew      = s._isNew;
                  const isModified = s._modified;
                  const rowClass   = isNew ? 'editor-row--new' : (isModified ? 'editor-row--modified' : '');
                  const isLate     = !isNew && s.end_date < today;
                  const holderNameStr = s.holder?.full_name || s._holderName || '—';
                  const isMatch    = !scholarshipSearchTerm || holderNameStr.toLowerCase().includes(scholarshipSearchTerm);
                  const display    = isMatch ? '' : 'display: none;';
                  return `
                    <tr class="${rowClass}" data-name="${escapeAttr(holderNameStr.toLowerCase())}" style="${display}">
                      <td style="font-weight:600;color:var(--text-primary);">
                        ${escapeAttr(holderNameStr)}
                        ${isNew      ? '<span class="badge badge--warning" style="margin-left:6px;font-size:0.65rem;">NOVA</span>' : ''}
                        ${isModified ? '<span class="badge badge--warning" style="margin-left:6px;font-size:0.65rem;">EDITADA</span>' : ''}
                      </td>
                      <td class="currency">
                        ${editorMode ? `
                          <input type="number" step="0.01" class="form-input form-input--inline"
                            value="${s.amount}"
                            onchange="ProjetosPage.updateDraftField(${idx}, 'amount', this.value)"
                            style="width:120px;">
                        ` : `<span style="font-weight:700;color:var(--success);">${formatBRL(s.amount)}</span>`}
                      </td>
                      <td>
                        ${editorMode ? `
                          <input type="date" class="form-input form-input--inline"
                            value="${toInputDate(s.start_date)}"
                            onchange="ProjetosPage.updateDraftField(${idx}, 'start_date', this.value)">
                        ` : formatDate(s.start_date)}
                      </td>
                      <td>
                        ${editorMode ? `
                          <input type="date" class="form-input form-input--inline"
                            value="${toInputDate(s.end_date)}"
                            onchange="ProjetosPage.updateDraftField(${idx}, 'end_date', this.value)">
                        ` : `<span style="color:${isLate ? 'var(--danger)' : 'inherit'};">${formatDate(s.end_date)}</span>`}
                      </td>
                      <td>
                        ${editorMode ? `
                          <select class="form-input form-input--inline" style="width:110px;"
                            onchange="ProjetosPage.updateDraftField(${idx}, 'status', this.value)">
                            <option value="active"    ${s.status === 'active'    ? 'selected' : ''}>Ativa</option>
                            <option value="ended"     ${s.status === 'ended'     ? 'selected' : ''}>Encerrada</option>
                            <option value="cancelled" ${s.status === 'cancelled' ? 'selected' : ''}>Cancelada</option>
                          </select>
                        ` : `
                          <span class="badge badge--${s.status === 'active' ? 'active' : (s.status === 'ended' ? 'ended' : 'cancelled')}">
                            ${s.status === 'active' ? 'Ativa' : (s.status === 'ended' ? 'Encerrada' : 'Cancelada')}
                          </span>
                          ${isLate ? '<span class="badge badge--cancelled" style="margin-left:4px;font-size:0.65rem;">Vencida</span>' : ''}
                        `}
                      </td>
                      ${editorMode ? `
                        <td>
                          <button class="btn btn--ghost btn--sm" onclick="ProjetosPage.removeDraftScholarship(${idx})" title="Remover">
                            <i data-lucide="trash-2" style="width:15px;height:15px;color:var(--danger);"></i>
                          </button>
                        </td>
                      ` : ''}
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : `
          <div class="empty-state" style="padding:24px;">
            <i data-lucide="user-x" class="empty-state__icon"></i>
            <h3 class="empty-state__title">${editorMode ? 'Nenhuma bolsa registrada' : 'Nenhum bolsista ativo'}</h3>
            <p class="empty-state__text">
              ${editorMode ? 'Clique em "Adicionar Bolsa" para criar a primeira.' : 'Não há bolsas ativas neste projeto no período atual.'}
            </p>
          </div>
        `}
      </div>
    `;

    lucide.createIcons();

    // Populate auto-hint with balance date info
    const autoHint = document.getElementById('proj-auto-hint');
    if (autoHint) {
      if (projectData.balance_date) {
        autoHint.textContent = 'Saldo de ' + formatDate(projectData.balance_date);
      } else {
        autoHint.textContent = 'Informe o saldo na aba Saldos';
      }
    }

    if (monthlyData.length > 0) {
      setTimeout(() => {
        _chartInstance = ChartBuilder.buildFinancialChart('proj-monthly-chart', monthlyData, {
          originalData: editorMode ? originalMonthlyData : null,
          existingChart: _chartInstance,
        });
      }, 50);
    }
  }

  /* ── Simulation Mode ───────────────────────────────────── */

  function enterEditorMode() {
    editorMode           = true;
    originalScholarships = draftScholarships.map(s => ({ ...s }));
    renderView();
  }

  async function cancelEditorMode() {
    const ok = await confirmAction('Cancelar edição? Todas as alterações não salvas serão descartadas.');
    if (!ok) return;
    editorMode        = false;
    draftScholarships = originalScholarships.map(s => ({ ...s }));
    renderView();
  }

  async function saveEditorChanges() {
    const ok = await confirmAction('Salvar todas as alterações? As bolsas editadas e novas serão gravadas no banco.');
    if (!ok) return;

    const draftIds   = new Set(draftScholarships.filter(s => !s._isNew).map(s => s.id));
    const deletedIds = originalScholarships.filter(s => !draftIds.has(s.id)).map(s => s.id);

    const updates = draftScholarships
      .filter(s => s._modified && !s._isNew)
      .map(s => ({
        id:         s.id,
        amount:     parseFloat(s.amount),
        start_date: s.start_date,
        end_date:   s.end_date,
        status:     s.status,
      }));

    const inserts = draftScholarships
      .filter(s => s._isNew)
      .map(s => ({
        holder_id:  s.holder_id,
        amount:     parseFloat(s.amount),
        start_date: s.start_date,
        end_date:   s.end_date,
        status:     s.status,
        notes:      s.notes || null,
      }));

    const { error } = await supabaseClient.rpc('save_editor_changes', {
      p_project_id: selectedProjectId,
      p_deletes:    deletedIds.length > 0 ? deletedIds : null,
      p_updates:    updates.length > 0 ? updates : null,
      p_inserts:    inserts.length > 0 ? inserts : null,
    });

    if (error) {
      showToast('Erro ao salvar: ' + error.message, 'error');
      return;
    }

    showToast('Alterações salvas com sucesso!', 'success');
    editorMode = false;
    await renderFull();
  }

  /* ── Draft Manipulation ──────────────────────────────────── */

  function updateDraftField(idx, field, value) {
    if (idx < 0 || idx >= draftScholarships.length) return;
    draftScholarships[idx][field] = field === 'amount' ? (parseFloat(value) || 0) : value;
    if (!draftScholarships[idx]._isNew) draftScholarships[idx]._modified = true;
    renderView();
  }

  async function addDraftScholarship() {
    const { data: holders } = await supabaseClient
      .from('scholarship_holders').select('id, full_name').eq('active', true).order('full_name');

    if (!holders || holders.length === 0) {
      showToast('Nenhum bolsista cadastrado. Cadastre um primeiro na aba Bolsistas.', 'error');
      return;
    }

    createModal({
      title: 'Adicionar Bolsa (Simulação)',
      bodyHTML: `
        <div class="form-group">
          <label class="form-label">Bolsista *</label>
          <select class="form-input" id="fld-draft-holder" required>
            <option value="">Selecione...</option>
            ${holders.map(h => `<option value="${h.id}">${h.full_name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Valor Mensal (R$) *</label>
          <input class="form-input" type="number" step="0.01" id="fld-draft-amount" placeholder="0.00" required>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Data Início *</label>
            <input class="form-input" type="date" id="fld-draft-start" required>
          </div>
          <div class="form-group">
            <label class="form-label">Data Fim *</label>
            <input class="form-input" type="date" id="fld-draft-end" required>
          </div>
        </div>`,
      saveLabel: 'Adicionar à Simulação',
      onSave: async () => {
        const holderId  = document.getElementById('fld-draft-holder').value;
        const amount    = parseFloat(document.getElementById('fld-draft-amount').value);
        const startDate = document.getElementById('fld-draft-start').value;
        const endDate   = document.getElementById('fld-draft-end').value;

        if (!holderId)               throw new Error('Selecione um bolsista.');
        if (!amount || amount <= 0)  throw new Error('Valor deve ser positivo.');
        if (!startDate || !endDate)  throw new Error('Datas são obrigatórias.');

        const holderName = holders.find(h => h.id === holderId)?.full_name || '—';

        draftScholarships.push({
          id: 'draft_' + Date.now(),
          holder_id: holderId,
          holder: { id: holderId, full_name: holderName },
          _holderName: holderName,
          project_id: selectedProjectId,
          amount, start_date: startDate, end_date: endDate,
          status: 'active', _isNew: true,
        });

        renderView();
      },
    });
  }

  async function removeDraftScholarship(idx) {
    const s   = draftScholarships[idx];
    const msg = s._isNew ? 'Remover esta bolsa simulada?' : 'Remover esta bolsa? Ela será excluída ao salvar.';
    const ok  = await confirmAction(msg);
    if (!ok) return;
    draftScholarships.splice(idx, 1);
    renderView();
  }

  /* ── Filter / Search ─────────────────────────────────────── */

  function onScholarshipSearch(val) {
    scholarshipSearchTerm = val.toLowerCase();
    
    const tbody = containerEl.querySelector('.data-table tbody');
    if (!tbody) return;
    
    let visibleCount = 0;
    const rows = tbody.querySelectorAll('tr');
    rows.forEach(row => {
       const name = row.getAttribute('data-name') || '';
       if (!scholarshipSearchTerm || name.includes(scholarshipSearchTerm)) {
         row.style.display = '';
         visibleCount++;
       } else {
         row.style.display = 'none';
       }
    });

    const countEl = document.getElementById('visible-holders-count');
    if (countEl) {
      countEl.textContent = visibleCount;
    }
  }

  /* ── Balance Status ──────────────────────────────────────── */

  function setBalanceStatus(val) {
    currentBalanceStatus = val;
    _userSetBalanceStatus = true;
    // Use renderView() directly — all project data is already in memory.
    // This guarantees the chart and KPIs update immediately without a new
    // round-trip to the database.
    renderView();
  }

  function hasDraftChanges() {
    if (!editorMode) return false;
    if (draftScholarships.length !== originalScholarships.length) return true;
    return draftScholarships.some(s => s._isNew || s._modified);
  }

  function isDirty() {
    return hasDraftChanges();
  }

  function discardSimulationChanges() {
    editorMode = false;
    draftScholarships = originalScholarships.map(s => ({ ...s }));
  }

  Router.registerGuard(async (from, to) => {
    if (!hasDraftChanges()) return true;
    const ok = await confirmAction('Sair da simulação? As alterações não salvas serão descartadas.');
    if (ok) discardSimulationChanges();
    return ok;
  });

  Router.registerDirtyChecker(isDirty);

  return {
    load,
    onProjectChange,
    enterEditorMode,
    cancelEditorMode,
    saveEditorChanges,
    updateDraftField,
    addDraftScholarship,
    removeDraftScholarship,
    setBalanceStatus,
    onScholarshipSearch,
    isDirty,
  };
})();
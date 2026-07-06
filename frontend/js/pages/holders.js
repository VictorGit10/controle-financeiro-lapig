/* ============================================================
   Holders Page — CRUD for scholarship holders (Bolsistas)
   ============================================================ */

Router.register('holders', {
  title: 'Bolsistas',

  actions(container) {
    const btn = document.createElement('button');
    btn.id = 'holders-action-btn';
    btn.className = 'btn btn--primary btn--sm';
    btn.innerHTML = '<i data-lucide="user-plus"></i> Novo Bolsista';
    btn.addEventListener('click', () => HoldersPage.openForm());
    container.appendChild(btn);
  },

  async render(container) {
    await HoldersPage.load(container);
  }
});


const HoldersPage = (() => {

  let containerEl = null;
  let allHolders  = [];
  let allProjects = [];
  let searchQuery = '';
  let filterProjectId = '';
  const ALERT_DAYS = 90;
  let filterShowInactive = false;

  // ── Abas ────────────────────────────────────────────────────
  const TABS = [
    { id: 'bolsistas',    label: 'Bolsistas',     icon: 'users' },
    { id: 'reconciliacao', label: 'Reconciliação', icon: 'file-spreadsheet' },
  ];
  let currentTab = localStorage.getItem('cf_holders_tab') || 'bolsistas';

  function switchTab(tabId) {
    currentTab = tabId;
    localStorage.setItem('cf_holders_tab', tabId);
    renderPage();
    updateActionButton();
  }

  function updateActionButton() {
    const btn = document.querySelector('#page-actions button');
    if (!btn) return;
    if (currentTab === 'reconciliacao') {
      btn.innerHTML = '<i data-lucide="upload"></i> Importar Planilha FUNAPE';
      btn.onclick = () => openImportReconciliacao();
    } else {
      btn.innerHTML = '<i data-lucide="user-plus"></i> Novo Bolsista';
      btn.onclick = () => HoldersPage.openForm();
    }
    lucide.createIcons();
  }

  async function load(container) {
    containerEl = container;
    await refresh();
  }

  async function refresh() {
    const [holdersRes, projectsRes] = await Promise.all([
      supabaseClient
        .from('scholarship_holders')
        .select(`
          *,
          scholarships(id, amount, status, project_id, funding_source, start_date, end_date,
            scholarship_type,
            projects:project_id(name)
          )
        `)
        .order('full_name'),
      supabaseClient.from('projects').select('id, name').order('name'),
    ]);

    if (holdersRes.error) {
      showToast('Erro ao carregar bolsistas: ' + holdersRes.error.message, 'error');
      return;
    }
    if (projectsRes.error) {
      showToast('Erro ao carregar projetos: ' + projectsRes.error.message, 'error');
      return;
    }

    allHolders  = holdersRes.data || [];
    allProjects = projectsRes.data || [];

    renderPage();
  }

  function projName(s) {
    return s.projects?.name || ('Externa: ' + (s.funding_source || '?'));
  }

  function isActiveScholarshipInPeriod(scholarship, today) {
    return scholarship.status === 'active'
      && scholarship.start_date <= today
      && scholarship.end_date >= today;
  }

  function getActiveScholarshipsInPeriod(holder, today) {
    return (holder.scholarships || []).filter(s => isActiveScholarshipInPeriod(s, today));
  }

  function getScholarshipDaysLeft(scholarship, baseDate) {
    const todayDate = baseDate || new Date(localISODate() + 'T00:00:00');
    const endDate = new Date(scholarship.end_date + 'T00:00:00');
    return Math.ceil((endDate - todayDate) / 86400000);
  }

  function formatScholarshipAlert(daysLeft) {
    if (daysLeft < 0) {
      const overdueDays = Math.abs(daysLeft);
      return `vencida há ${overdueDays} dia${overdueDays === 1 ? '' : 's'}`;
    }
    if (daysLeft === 0) return 'vence hoje';
    return `encerra em ${daysLeft} dia${daysLeft === 1 ? '' : 's'}`;
  }

  function getEndingScholarships() {
    const ending = [];
    const todayDate = new Date(localISODate() + 'T00:00:00');

    allHolders.forEach(h => {
      (h.scholarships || []).forEach(s => {
        if (s.status !== 'active') return;
        const daysLeft = getScholarshipDaysLeft(s, todayDate);
        if (daysLeft <= ALERT_DAYS) {
          ending.push({ holderName: h.full_name, scholarship: s, daysLeft });
        }
      });
    });
    return ending.sort((a, b) => a.daysLeft - b.daysLeft);
  }

  function groupEndingByProject() {
    const groups = {};
    getEndingScholarships().forEach(e => {
      const name = projName(e.scholarship);
      if (!groups[name]) groups[name] = [];
      groups[name].push(e);
    });
    return groups;
  }

  // Custo total das bolsas (não-canceladas) dentro do ano-calendário corrente.
  // Soma amount × nº de meses do ano em que a bolsa esteve/estará vigente (jan–dez).
  function getYearCommitted(holder, yearMonths) {
    let total = 0;
    (holder.scholarships || []).forEach(s => {
      if (s.status === 'cancelled') return;
      const activeMonths = yearMonths.filter(m => s.start_date <= m.month_end && s.end_date >= m.month_start);
      total += Number(s.amount) * activeMonths.length;
    });
    return total;
  }

  function computeKPIs() {
    const today = localISODate();
    const currentYear = new Date().getFullYear();
    const yearMonths = generateMonthSeries(currentYear + '-01-01', currentYear + '-12-31');
    let holdersWithActiveScholarshipCount = 0;
    let activeScholarshipCount = 0;
    let totalMonthlyAll = 0;
    let totalYearCommitted = 0;
    let inactiveHolderCount = 0;

    allHolders.forEach(h => {
      const activeScholarships = getActiveScholarshipsInPeriod(h, today);
      const holderTotal = activeScholarships.reduce((sum, s) => sum + Number(s.amount), 0);

      if (activeScholarships.length > 0) {
        holdersWithActiveScholarshipCount++;
      }

      activeScholarshipCount += activeScholarships.length;
      totalMonthlyAll += holderTotal;
      totalYearCommitted += getYearCommitted(h, yearMonths);

      if (!h.active) {
        inactiveHolderCount++;
      }
    });

    return {
      holdersWithActiveScholarshipCount,
      activeScholarshipCount,
      totalMonthlyAll,
      totalYearCommitted,
      currentYear,
      inactiveHolderCount
    };
  }

  function toggleProjectGroup(btn) {
    const list = btn.nextElementSibling;
    const icon = btn.querySelector('.alert-banner__toggle-icon');
    const collapsed = list.style.maxHeight === '0px';
    if (collapsed) {
      list.style.maxHeight = list.scrollHeight + 'px';
      list.style.opacity = '1';
      icon.textContent = '▼';
    } else {
      list.style.maxHeight = '0px';
      list.style.opacity = '0';
      icon.textContent = '▶';
    }
  }

  function applyFilters(holders) {
    let result = holders;
    if (!filterShowInactive) {
      result = result.filter(h => h.active);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(h => h.full_name.toLowerCase().includes(q));
    }
    if (filterProjectId) {
      const today = localISODate();
      result = result.filter(h =>
        (h.scholarships || []).some(s =>
          s.project_id === filterProjectId
          && s.status === 'active'
          && s.start_date <= today
          && s.end_date >= today
        )
      );
    }
    return result;
  }


  // ── Detecção de bolsistas duplicados (mesmo nome normalizado) ──
  function normName(raw) {
    return String(raw || '')
      .trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  // Agrupa holders por nome normalizado, retornando apenas grupos com 2+.
  function findDuplicateHolderGroups() {
    const map = new Map();
    allHolders.forEach(h => {
      const k = normName(h.full_name);
      if (!k) return;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(h);
    });
    return [...map.values()].filter(g => g.length > 1);
  }

  function renderPage() {
    // ── Barra de abas ──────────────────────────────────────
    const tabsBarHTML = `
      <div class="page-tabs" style="margin-bottom:var(--sp-4);">
        ${TABS.map(t => `
          <button class="page-tab ${currentTab === t.id ? 'page-tab--active' : ''}"
            onclick="HoldersPage.switchTab('${t.id}')">
            <i data-lucide="${t.icon}" style="width:16px;height:16px;"></i>
            ${t.label}
          </button>
        `).join('')}
      </div>
    `;

    // ── Renderizar conteúdo da aba ativa ────────────────────
    if (currentTab === 'reconciliacao') {
      containerEl.innerHTML = tabsBarHTML;
      renderReconciliacaoTab();
      lucide.createIcons();
      updateActionButton();
      return;
    }

    // ── Aba Bolsistas (conteúdo original) ──────────────────
    if (!allHolders.length) {
      containerEl.innerHTML = tabsBarHTML + `
        <div class="empty-state">
          <i data-lucide="users" class="empty-state__icon"></i>
          <h3 class="empty-state__title">Nenhum bolsista cadastrado</h3>
          <p class="empty-state__text">Clique em "Novo Bolsista" para começar.</p>
        </div>
      `;
      lucide.createIcons();
      updateActionButton();
      return;
    }

    const ending = getEndingScholarships();
    const groupedEnding = groupEndingByProject();
    const kpis = computeKPIs();
    const overdueCount = ending.filter(e => e.daysLeft < 0).length;
    const endingSoonCount = ending.length - overdueCount;
    const alertHeadline = overdueCount > 0 && endingSoonCount > 0
      ? `${ending.length} bolsa${ending.length === 1 ? '' : 's'} com vigência crítica`
      : overdueCount > 0
        ? `${overdueCount} bolsa${overdueCount === 1 ? '' : 's'} vencida${overdueCount === 1 ? '' : 's'} com status ativo`
        : `${endingSoonCount} bolsa${endingSoonCount === 1 ? '' : 's'} encerrando nos próximos ${ALERT_DAYS} dias`;
    const alertSummary = overdueCount > 0 && endingSoonCount > 0
      ? `${overdueCount} vencida${overdueCount === 1 ? '' : 's'} com status ativo · ${endingSoonCount} encerrando nos próximos ${ALERT_DAYS} dias`
      : overdueCount > 0
        ? 'Revise as vigências ou atualize o status das bolsas.'
        : '';

    const bannerHTML = ending.length ? `
      <div class="alert-banner alert-banner--warning">
        <i data-lucide="alert-triangle" class="alert-banner__icon"></i>
        <div class="alert-banner__body">
          <strong>${alertHeadline}</strong>
          ${alertSummary ? `<div style="margin-top:4px;color:var(--text-secondary);font-size:0.85rem;">${alertSummary}</div>` : ''}
          ${Object.entries(groupedEnding).map(([projectName, items]) => `
            <div class="alert-banner__group">
              <button class="alert-banner__group-header" onclick="HoldersPage.toggleProjectGroup(this)">
                <span class="alert-banner__toggle-icon">▶</span>
                <span>${escapeAttr(projectName)}</span>
                <span class="alert-banner__group-count">(${items.length})</span>
              </button>
              <ul class="alert-banner__list alert-banner__list--collapsible" style="max-height:0;opacity:0;">
                ${items.map(e => {
                  const dateStr = formatDate(e.scholarship.end_date);
                  const daysText = formatScholarshipAlert(e.daysLeft);
                  return `<li>${escapeAttr(e.holderName)} — <strong>${daysText}</strong> (${dateStr})</li>`;
                }).join('')}
              </ul>
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    const statsHTML = `
      <div class="stats-grid fade-in">
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--info"><i data-lucide="users"></i></div>
          <div class="stat-card__content">
            <div class="stat-card__label">Bolsistas com Bolsa Ativa</div>
            <div class="stat-card__value">${kpis.holdersWithActiveScholarshipCount}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--accent"><i data-lucide="graduation-cap"></i></div>
          <div class="stat-card__content">
            <div class="stat-card__label">Bolsas Ativas</div>
            <div class="stat-card__value">${kpis.activeScholarshipCount}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--success"><i data-lucide="wallet"></i></div>
          <div class="stat-card__content">
            <div class="stat-card__label">Total Mensal Ativo</div>
            <div class="stat-card__value currency">${formatBRL(kpis.totalMonthlyAll)}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--warning"><i data-lucide="calendar-clock"></i></div>
          <div class="stat-card__content">
            <div class="stat-card__label">Comprometido ${kpis.currentYear}</div>
            <div class="stat-card__value currency">${formatBRL(kpis.totalYearCommitted)}</div>
            <div class="stat-card__hint">custo total das bolsas no ano</div>
          </div>
        </div>
      </div>
    `;

    const toolbarHTML = `
      <div class="holders-toolbar">
        <input type="text" id="holders-search" class="form-input holders-toolbar__search"
          placeholder="Buscar por nome..." value="${escapeAttr(searchQuery)}"
          oninput="HoldersPage.onSearch(this.value)">
        <select id="holders-project-filter" class="form-input holders-toolbar__filter"
          onchange="HoldersPage.onProjectFilter(this.value)">
          <option value="">Todos os projetos</option>
          ${allProjects.map(p => `<option value="${p.id}" ${filterProjectId === p.id ? 'selected' : ''}>${escapeAttr(p.name)}</option>`).join('')}
        </select>
        <label class="holders-toolbar__toggle" title="Exibir cadastros inativos">
          <input type="checkbox" id="holders-show-inactive"
            ${filterShowInactive ? 'checked' : ''}
            onchange="HoldersPage.onToggleInactive(this.checked)">
          <span>Mostrar inativos${kpis.inactiveHolderCount > 0 ? ` (${kpis.inactiveHolderCount})` : ''}</span>
        </label>
        <button class="btn btn--ghost btn--sm" onclick="HoldersPage.openMergeTool()" title="Mesclar bolsistas duplicados">
          <i data-lucide="git-merge" style="width:16px;height:16px;"></i> Mesclar duplicados
        </button>
      </div>
    `;

    // Banner de bolsistas duplicados (mesmo nome) → oferece merge
    const dupGroups = findDuplicateHolderGroups();
    const dupBannerHTML = dupGroups.length ? `
      <div class="alert-banner alert-banner--danger" style="margin-bottom:var(--sp-3);">
        <i data-lucide="copy" class="alert-banner__icon"></i>
        <div class="alert-banner__body" style="display:flex;align-items:center;justify-content:space-between;gap:var(--sp-3);flex-wrap:wrap;">
          <div>
            <strong>${dupGroups.length} possível${dupGroups.length === 1 ? '' : 'is'} bolsista${dupGroups.length === 1 ? '' : 's'} duplicado${dupGroups.length === 1 ? '' : 's'}</strong>
            <div style="font-size:0.85rem;color:var(--text-secondary);margin-top:2px;">Mesmo nome em mais de um cadastro — mescle para consolidar CPF e bolsas.</div>
          </div>
          <button class="btn btn--secondary btn--sm" onclick="HoldersPage.openMergeTool()">
            <i data-lucide="git-merge" style="width:16px;height:16px;"></i> Revisar e mesclar
          </button>
        </div>
      </div>
    ` : '';

    containerEl.innerHTML = tabsBarHTML + bannerHTML + dupBannerHTML + statsHTML + toolbarHTML + '<div id="holders-table-area"></div>';
    lucide.createIcons();
    updateActionButton();
    renderTable();
  }


  function renderTable() {
    const tableArea = containerEl.querySelector('#holders-table-area');
    if (!tableArea) return;

    const visible = applyFilters(allHolders);

    if (!visible.length) {
      tableArea.innerHTML = `
        <div class="empty-state" style="padding: 40px 0;">
          <i data-lucide="search-x" class="empty-state__icon"></i>
          <h3 class="empty-state__title">Nenhum bolsista encontrado</h3>
          <p class="empty-state__text">Tente ajustar os filtros de busca.</p>
        </div>
      `;
    } else {
      const today = localISODate();
      const todayDate = new Date(today + 'T00:00:00');
      const visibleTotalMonthly = visible.reduce((sum, holder) => {
        const holderTotal = getActiveScholarshipsInPeriod(holder, today)
          .reduce((holderSum, scholarship) => holderSum + Number(scholarship.amount), 0);
        return sum + holderTotal;
      }, 0);

      tableArea.innerHTML = `
        <div class="card fade-in">
          <div class="card__header">
            <div>
              <h3 class="card__title">Bolsistas</h3>
              <p class="card__subtitle">${visible.length} bolsista${visible.length !== 1 ? 's' : ''} encontrado${visible.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <div class="data-table-wrapper">
            <table class="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Bolsas</th>
                <th>Valor Mensal Total</th>
                <th>Cadastro</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${visible.map(h => {
                const allScholarships = h.scholarships || [];
                const activeScholarships = getActiveScholarshipsInPeriod(h, today);
                const otherCount = allScholarships.length - activeScholarships.length;
                const totalMonthly = activeScholarships.reduce((sum, s) => sum + Number(s.amount), 0);
                const hasEnding = activeScholarships.some(s => getScholarshipDaysLeft(s, todayDate) <= ALERT_DAYS);

                const bolsasList = activeScholarships.map(s => {
                  const pName = s.projects?.name || ('Externa: ' + (s.funding_source || 'Externa'));
                  return `<div style="font-size:0.8rem;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px;" title="${escapeAttr(pName)}">${escapeAttr(pName)} <span style="color:var(--success);font-weight:600;">${formatBRL(Number(s.amount))}</span></div>`;
                }).join('');
                const otherLink = otherCount > 0
                  ? `<a href="#" onclick="event.preventDefault();HoldersPage.manageScholarships('${escapeAttr(h.id)}','${escapeAttr(h.full_name)}')" style="font-size:0.75rem;color:var(--text-muted);text-decoration:underline;cursor:pointer;">+ ${otherCount} bolsa${otherCount > 1 ? 's' : ''}</a>`
                  : '';

                return `
                  <tr style="${!h.active ? 'opacity:0.55;' : ''}">
                    <td>
                      <span style="font-weight:500;">${escapeAttr(h.full_name)}</span>
                      ${!h.active ? ' <span class="badge badge--ended" style="font-size:0.65rem;padding:1px 5px;">Inativo</span>' : ''}
                      ${hasEnding ? ' <span class="badge badge--warning" style="font-size:0.65rem;padding:1px 5px;">⚠ Encerrando</span>' : ''}
                    </td>
                    <td>${activeScholarships.length > 0 ? bolsasList : '<span style="color:var(--text-secondary);font-size:0.85rem;">—</span>'}${otherLink ? '<div>' + otherLink + '</div>' : ''}</td>
                    <td class="currency" style="font-weight:700;color:${totalMonthly > 0 ? 'var(--success)' : 'inherit'};">${totalMonthly > 0 ? formatBRL(totalMonthly) : '—'}</td>
                    <td>
                      <span class="badge badge--${h.active ? 'active' : 'ended'}">
                        ${h.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td>
                      <div style="display: flex; gap: 4px;">
                        <button class="btn btn--ghost btn--sm" onclick="HoldersPage.viewTimeline('${escapeAttr(h.id)}', '${escapeAttr(h.full_name)}')" title="Ver Rendimentos Mensais">
                          <i data-lucide="bar-chart" style="width:16px;height:16px;color:var(--info);"></i>
                        </button>
                        <button class="btn btn--ghost btn--sm" onclick="HoldersPage.manageScholarships('${escapeAttr(h.id)}', '${escapeAttr(h.full_name)}')" title="Gerenciar Bolsas">
                          <i data-lucide="graduation-cap" style="width:16px;height:16px;color:var(--accent);"></i>
                        </button>
                        <button class="btn btn--ghost btn--sm" onclick="HoldersPage.openForm('${escapeAttr(h.id)}')" title="Editar">
                          <i data-lucide="pencil" style="width:16px;height:16px;"></i>
                        </button>
                        <button class="btn btn--ghost btn--sm" onclick="HoldersPage.remove('${escapeAttr(h.id)}', '${escapeAttr(h.full_name)}')" title="Excluir">
                          <i data-lucide="trash-2" style="width:16px;height:16px;color:var(--danger);"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
            <tfoot>
              <tr style="background:var(--bg-elevated);font-weight:700;">
                <td>Total (${visible.length} bolsista${visible.length !== 1 ? 's' : ''})</td>
                <td></td>
                <td class="currency" style="color:var(--success);">${formatBRL(visibleTotalMonthly)}</td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          </table>
          </div>
        </div>
      `;
    }

    lucide.createIcons();
  }

  let _searchTimer = null;
  function onSearch(value) {
    searchQuery = value;
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(renderTable, 150);
  }

  function onProjectFilter(value) {
    filterProjectId = value;
    renderTable();
  }

  function onToggleInactive(val) {
    filterShowInactive = val;
    renderTable();
  }

  async function openForm(id = null) {
    let holder = {};

    if (id) {
      const { data, error } = await supabaseClient
        .from('scholarship_holders')
        .select('*')
        .eq('id', id)
        .single();
      if (error) { showToast('Erro ao carregar bolsista', 'error'); return; }
      holder = data;
    }

    const formHTML = `
      <div class="form-group">
        <label class="form-label">Nome Completo *</label>
        <input class="form-input" id="fld-name" value="${escapeAttr(holder.full_name || '')}" required placeholder="Nome completo do bolsista">
      </div>
      <div class="form-group">
        <label class="form-label">CPF</label>
        <input class="form-input" id="fld-cpf" value="${escapeAttr(holder.cpf || '')}" placeholder="000.000.000-00" maxlength="14"
          oninput="this.value=this.value.replace(/[^0-9./-]/g,'')">
      </div>
      <div class="form-group">
        <label class="form-label">E-mail</label>
        <input class="form-input" type="email" id="fld-email" value="${escapeAttr(holder.email || '')}" placeholder="email@exemplo.com">
      </div>
      ${id ? `
      <div class="form-group" style="display:flex;align-items:center;gap:8px;margin-top:var(--sp-3);">
        <input type="checkbox" id="fld-active" ${holder.active !== false ? 'checked' : ''}
          style="width:18px;height:18px;accent-color:var(--accent);">
        <label for="fld-active" class="form-label" style="margin:0;cursor:pointer;">
          Bolsista ativo
        </label>
      </div>` : ''}
    `;

    createModal({
      title: id ? 'Editar Bolsista' : 'Novo Bolsista',
      bodyHTML: formHTML,
      onSave: async () => {
        const rawCPF = document.getElementById('fld-cpf').value.trim();
        const cpfDigits = rawCPF.replace(/\D/g, '');
        const payload = {
          full_name: document.getElementById('fld-name').value.trim(),
          cpf: cpfDigits.length === 11 ? cpfDigits : (cpfDigits.length > 0 ? rawCPF : null),
          email: document.getElementById('fld-email').value.trim() || null,
        };

        if (!payload.full_name) throw new Error('Nome é obrigatório.');
        if (cpfDigits.length > 0 && cpfDigits.length !== 11) throw new Error('CPF deve ter 11 dígitos.');

        if (id) {
          payload.active = document.getElementById('fld-active')?.checked ?? true;
          const { error } = await supabaseClient.from('scholarship_holders').update(payload).eq('id', id);
          if (error) throw error;
          showToast('Bolsista atualizado!', 'success');
        } else {
          const { error } = await supabaseClient.from('scholarship_holders').insert(payload);
          if (error) throw error;
          showToast('Bolsista cadastrado!', 'success');
        }

        await refresh();
      }
    });
  }

  async function remove(id, name) {
    // Conta as bolsas vinculadas para decidir o fluxo de exclusão.
    const { count, error: countError } = await supabaseClient
      .from('scholarships')
      .select('id', { count: 'exact', head: true })
      .eq('holder_id', id);

    if (countError) {
      showToast('Erro ao verificar bolsas vinculadas: ' + countError.message, 'error');
      return;
    }

    if (count > 0) {
      // Caso excepcional (ex.: duplicata): o bolsista tem bolsas. Exclusão em
      // cascata consciente — avisa, mostra a contagem e exige confirmação antes
      // de remover bolsista + bolsas numa única transação (RPC).
      const confirmed = await confirmAction(
        `ATENÇÃO: "${name}" possui ${count} bolsa(s) vinculada(s). ` +
        `Excluir o bolsista também removerá TODAS essas bolsas permanentemente. ` +
        `Esta ação é irreversível. Deseja continuar?`
      );
      if (!confirmed) return;

      const { error } = await supabaseClient.rpc('delete_holder_cascade', { p_holder_id: id });
      if (error) {
        showToast('Erro ao excluir: ' + error.message, 'error');
        return;
      }
      showToast(`Bolsista e ${count} bolsa(s) excluíd${count !== 1 ? 'as' : 'a'} com sucesso.`, 'success');
      await refresh();
      return;
    }

    // Caso comum: sem bolsas vinculadas, exclusão direta.
    const confirmed = await confirmAction(`Excluir "${name}"?`);
    if (!confirmed) return;

    const { error } = await supabaseClient.from('scholarship_holders').delete().eq('id', id);
    if (error) {
      showToast('Erro ao excluir: ' + error.message, 'error');
      return;
    }
    showToast('Bolsista excluído.', 'success');
    await refresh();
  }

  async function manageScholarships(holderId, holderName) {
    const { data: scholarships, error } = await supabaseClient
      .from('scholarships')
      .select('*, projects(name), funding_source')
      .eq('holder_id', holderId)
      .order('start_date', { ascending: false });

    if (error) { showToast('Erro ao carregar bolsas', 'error'); return; }

    let listHTML = '';
    if (!scholarships || scholarships.length === 0) {
      listHTML = '<p style="color: var(--text-secondary); margin: 16px 0;">Este bolsista ainda não possui bolsas associadas.</p>';
    } else {
      listHTML = `
        <div class="data-table-wrapper" style="margin-top: 16px; margin-bottom: 24px;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Projeto</th>
                <th>Valor Mensal</th>
                <th>Vigência</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${scholarships.map(s => `
                <tr>
                  <td style="font-weight: 500;">${s.projects?.name ? escapeAttr(s.projects.name) : '<span class="badge badge--warning">Externa: ' + escapeAttr(s.funding_source || '?') + '</span>'}</td>
                  <td class="currency">${formatBRL(s.amount)}</td>
                  <td>${formatDate(s.start_date)} — ${formatDate(s.end_date)}</td>
                  <td>
                    <span class="badge badge--${s.status === 'active' ? 'active' : (s.status === 'ended' ? 'ended' : 'warning')}">
                      ${s.status === 'active' ? 'Ativa' : (s.status === 'ended' ? 'Encerrada' : 'Cancelada')}
                    </span>
                  </td>
                  <td>
                    <div style="display: flex; gap: 4px;">
                      <button class="btn btn--ghost btn--sm" onclick="HoldersPage.openScholarshipForm('${escapeAttr(s.id)}', '${escapeAttr(holderId)}')" title="Editar bolsa">
                        <i data-lucide="pencil" style="width:16px;height:16px;"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    const modalHTML = `
      ${listHTML}
      <button class="btn btn--primary" onclick="HoldersPage.openScholarshipForm(null, '${escapeAttr(holderId)}')">
        <i data-lucide="plus"></i> Adicionar Nova Bolsa
      </button>
    `;

    const { overlay } = createModal({
      title: `Gerenciar Bolsas — ${holderName}`,
      bodyHTML: modalHTML,
      saveLabel: 'Concluir',
      saveClass: 'btn--primary',
      onSave: async () => { /* just close */ }
    });

    const saveBtn = overlay.querySelector('#modal-save-btn');
    saveBtn.textContent = 'Fechar';
    saveBtn.className = 'btn btn--secondary';
  }

  async function openScholarshipForm(scholarshipId, holderId) {
    const prevOverlay = document.querySelector('.modal-overlay');
    if (prevOverlay) prevOverlay.remove();

    const { data: projects } = await supabaseClient.from('projects').select('id, name').order('name');

    let scholarship = {};
    if (scholarshipId) {
      const { data, error } = await supabaseClient.from('scholarships').select('*').eq('id', scholarshipId).single();
      if (!error) scholarship = data;
    }

    const isExternal = !scholarship.project_id && scholarshipId;
    const projectOptions = (projects || []).map(p =>
      `<option value="${p.id}" ${p.id === scholarship.project_id ? 'selected' : ''}>${escapeAttr(p.name)}</option>`
    ).join('');

    const formHTML = `
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <input type="checkbox" id="fld-s-external" ${isExternal ? 'checked' : ''} onchange="document.getElementById('fld-s-project').disabled=this.checked;document.getElementById('funding-source-group').style.display=this.checked?'block':'none';document.getElementById('project-group').style.display=this.checked?'none':'block';">
          <span class="form-label" style="margin:0;">Bolsa de fonte externa (não é custo do laboratório)</span>
        </label>
      </div>
      <div class="form-group" id="project-group" style="${isExternal ? 'display:none' : ''}">
        <label class="form-label">Projeto</label>
        <select class="form-input" id="fld-s-project" ${isExternal ? 'disabled' : ''}>
          <option value="">Selecione um projeto...</option>
          ${projectOptions}
        </select>
      </div>
      <div class="form-group" id="funding-source-group" style="${isExternal ? '' : 'display:none'}">
        <label class="form-label">Fonte de Financiamento *</label>
        <input class="form-input" id="fld-s-funding-source" value="${escapeAttr(scholarship.funding_source || '')}" placeholder="Ex: CIAMB, CAPES, CNPq...">
      </div>
      <div class="form-group">
        <label class="form-label">Valor Mensal (R$) *</label>
        <input class="form-input" type="number" step="0.01" id="fld-s-amount" value="${scholarship.amount || ''}" required>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Data Início *</label>
          <input class="form-input" type="date" id="fld-s-start" value="${toInputDate(scholarship.start_date)}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Data Fim *</label>
          <input class="form-input" type="date" id="fld-s-end" value="${toInputDate(scholarship.end_date)}" required>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Status *</label>
        <select class="form-input" id="fld-s-status">
          <option value="active" ${(scholarship.status === 'active' || !scholarshipId) ? 'selected' : ''}>Ativa</option>
          <option value="ended" ${scholarship.status === 'ended' ? 'selected' : ''}>Encerrada</option>
          <option value="cancelled" ${scholarship.status === 'cancelled' ? 'selected' : ''}>Cancelada</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Observações</label>
        <textarea class="form-input" id="fld-s-notes" rows="2">${escapeAttr(scholarship.notes || '')}</textarea>
      </div>
    `;

    createModal({
      title: scholarshipId ? 'Editar Bolsa' : 'Nova Bolsa',
      bodyHTML: formHTML,
      onSave: async () => {
        const isExt = document.getElementById('fld-s-external').checked;
        const payload = {
          holder_id: holderId,
          project_id: isExt ? null : document.getElementById('fld-s-project').value || null,
          funding_source: isExt ? document.getElementById('fld-s-funding-source').value.trim() : null,
          amount: parseFloat(document.getElementById('fld-s-amount').value),
          start_date: document.getElementById('fld-s-start').value,
          end_date: document.getElementById('fld-s-end').value,
          status: document.getElementById('fld-s-status').value,
          notes: document.getElementById('fld-s-notes').value.trim() || null,
        };

        if (isExt && !payload.funding_source) throw new Error('Informe a fonte de financiamento.');
        if (!isExt && !payload.project_id) throw new Error('Selecione um projeto.');
        if (!payload.amount || payload.amount <= 0) throw new Error('Valor deve ser positivo.');
        if (!payload.start_date || !payload.end_date) throw new Error('Datas são obrigatórias.');
        if (payload.end_date < payload.start_date) throw new Error('A data fim deve ser igual ou posterior à data de início.');

        if (scholarshipId) {
          const { error } = await supabaseClient.from('scholarships').update(payload).eq('id', scholarshipId);
          if (error) throw error;
          showToast('Bolsa atualizada!', 'success');
        } else {
          const { error } = await supabaseClient.from('scholarships').insert(payload);
          if (error) throw error;
          showToast('Bolsa adicionada!', 'success');
        }

        const { data: holder } = await supabaseClient.from('scholarship_holders').select('full_name').eq('id', holderId).single();
        if(holder) manageScholarships(holderId, holder.full_name);

        await refresh();
      }
    });
  }


  async function viewTimeline(holderId, holderName) {
    const { data: scholarships, error } = await supabaseClient
      .from('scholarships')
      .select('*, projects(name), funding_source')
      .eq('holder_id', holderId);

    if (error) {
      showToast('Erro ao carregar histórico: ' + error.message, 'error');
      return;
    }

    const timelineScholarships = (scholarships || []).filter(s => s.status !== 'cancelled');

    let startWindow;
    let endWindow;
    const now = new Date();
    const currentYearJan1 = localISODate(new Date(now.getFullYear(), 0, 1));
    if (timelineScholarships.length > 0) {
      const ends = timelineScholarships.map(s => s.end_date).sort();
      const lastEnd = new Date(ends[ends.length - 1] + 'T00:00:00');
      startWindow = currentYearJan1;
      endWindow = localISODate(new Date(lastEnd.getFullYear(), lastEnd.getMonth() + 1, 0));
      // Garantir que endWindow não seja anterior ao startWindow
      if (endWindow < startWindow) {
        endWindow = localISODate(new Date(now.getFullYear(), 11, 31));
      }
    } else {
      startWindow = currentYearJan1;
      endWindow = localISODate(new Date(now.getFullYear(), now.getMonth() + 2, 0));
    }

    const months = SimulationEngine.generateMonthSeries(startWindow, endWindow);
    const projectMap = {};

    timelineScholarships.forEach(s => {
      if (s.start_date <= endWindow && s.end_date >= startWindow) {
        const projectName = s.projects?.name || ('Externa: ' + (s.funding_source || '?'));
        if (!projectMap[projectName]) {
          projectMap[projectName] = new Array(months.length).fill(0);
        }
      }
    });

    const timelineData = months.map((m, monthIndex) => {
      let totalMonth = 0;
      const activeProjects = new Set();

      timelineScholarships.forEach(s => {
        if (s.start_date <= m.month_end && s.end_date >= m.month_start) {
          const projectName = s.projects?.name || ('Externa: ' + (s.funding_source || '?'));
          const value = Number(s.amount);

          if (projectMap[projectName]) {
            projectMap[projectName][monthIndex] += value;
          }

          totalMonth += value;
          activeProjects.add(projectName);
        }
      });

      return {
        label: m.month_label,
        shortLabel: (() => {
          const d = new Date(m.month_start + 'T00:00:00');
          const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
          return nomes[d.getMonth()] + '/' + String(d.getFullYear()).slice(-2);
        })(),
        amount: totalMonth,
        projects: [...activeProjects].join(', ')
      };
    });

    const colors = [
      '#6C5CE7', '#00B894', '#0984E3', '#E17055', '#FDCB6E', '#D63031', '#8E44AD'
    ];

    const datasets = Object.keys(projectMap).map((projectName, i) => ({
      label: projectName,
      data: projectMap[projectName],
      backgroundColor: colors[i % colors.length],
      borderRadius: 4
    }));

    const modalHTML = `
      <div style="height: 400px; width: 100%; margin-top: 8px; margin-bottom: 24px;">
        <canvas id="timeline-chart"></canvas>
      </div>

      <div class="data-table-wrapper" style="max-height: 200px; overflow-y: auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Mês</th>
              <th>Projetos Atuantes</th>
              <th style="text-align: right;">Total Recebido</th>
            </tr>
          </thead>
          <tbody>
            ${timelineData.map(d => `
              <tr>
                <td style="font-weight: 500;">${d.label}</td>
                <td style="color: var(--text-secondary); font-size: 0.875rem;">${d.projects || '—'}</td>
                <td style="text-align: right; color: ${d.amount > 0 ? 'var(--success)' : 'inherit'};">
                  ${formatBRL(d.amount)}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    const { overlay } = createModal({
      title: `Provisões do Bolsista — ${holderName}`,
      bodyHTML: modalHTML,
      maxWidth: '780px',
      hideCancelBtn: true,
      onSave: async () => {}
    });

    const saveBtn = overlay.querySelector('#modal-save-btn');
    if (saveBtn) {
      saveBtn.textContent = 'Fechar';
      saveBtn.className = 'btn btn--secondary';
    }

    let timelineChart = null;
    const destroyChart = () => {
      if (timelineChart) {
        timelineChart.destroy();
        timelineChart = null;
      }
    };

    const closeBtns = overlay.querySelectorAll('[data-modal-close]');
    closeBtns.forEach(btn => btn.addEventListener('click', destroyChart));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) destroyChart();
    });

    setTimeout(() => {
      const ctx = document.getElementById('timeline-chart');
      if (ctx) {
        timelineChart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: timelineData.map(d => d.shortLabel),
            datasets: datasets
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
              padding: { bottom: 0 }
            },
            plugins: {
              legend: {
                display: true,
                position: 'top',
                align: 'start',
                labels: {
                  color: '#1B3A2A',
                  usePointStyle: false,
                  boxWidth: 14,
                  boxHeight: 14,
                  padding: 24,
                  generateLabels: function(chart) {
                    return chart.data.datasets.map((dataset, i) => ({
                      text: dataset.label,
                      fillStyle: dataset.backgroundColor,
                      strokeStyle: dataset.backgroundColor,
                      lineWidth: 0,
                      hidden: false,
                      index: i,
                      datasetIndex: i
                    }));
                  }
                }
              },
              tooltip: {
                backgroundColor: 'rgba(255,255,255,0.97)',
                titleColor: '#1B3A2A',
                bodyColor: '#345943',
                borderColor: '#DCD2BF',
                borderWidth: 1,
                padding: 12,
                callbacks: {
                  title: function(items) {
                    return items[0]?.label || '';
                  },
                  label: function(context) {
                    const label = context.dataset.label || '';
                    const value = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(context.parsed.y);
                    return `  ${label}: ${value}`;
                  }
                }
              }
            },
            scales: {
              y: {
                stacked: true,
                beginAtZero: true,
                grid: { color: 'rgba(27,58,42,0.06)' },
                ticks: {
                  color: '#5C7868',
                  callback: function(value) {
                    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(value);
                  }
                }
              },
              x: {
                stacked: true,
                display: true,
                grid: { display: false },
                ticks: {
                  color: '#5C7868',
                  font: { size: 11 },
                  maxRotation: 45,
                  minRotation: 30,
                  autoSkip: false
                }
              }
            }
          }
        });
      }
    }, 100);
  }

  // ── Aba Reconciliação ──────────────────────────────────────

  let reconDiff = null; // resultado da comparação
  let reconProjectId = localStorage.getItem('cf_recon_project_id') || '';

  function renderReconciliacaoTab() {
    const projectOptions = allProjects.map(p =>
      `<option value="${p.id}" ${reconProjectId === p.id ? 'selected' : ''}>${escapeAttr(p.name)}</option>`
    ).join('');

    let diffHTML = '';
    if (reconDiff) {
      diffHTML = renderReconciliationDiff(reconDiff);
    }

    const content = document.createElement('div');
    content.innerHTML = `
      <div class="card fade-in" style="margin-top:var(--sp-3);">
        <div class="card__header">
          <div>
            <h3 class="card__title">Reconciliação de Bolsas FUNAPE</h3>
            <p class="card__subtitle">Compare a planilha do sistema FUNAPE com os dados cadastrados</p>
          </div>
        </div>
        <div style="padding:var(--sp-4);">
          <div style="display:flex;gap:var(--sp-3);align-items:end;flex-wrap:wrap;">
            <div class="form-group" style="margin:0;flex:1;min-width:200px;">
              <label class="form-label">Projeto</label>
              <select class="form-input" id="recon-project-select" onchange="HoldersPage.onReconProjectChange(this.value)">
                <option value="">Selecione um projeto...</option>
                ${projectOptions}
              </select>
            </div>
            <button class="btn btn--primary" onclick="HoldersPage.openImportReconciliacao()" ${!reconProjectId ? 'disabled' : ''}>
              <i data-lucide="upload" style="width:16px;height:16px;"></i>
              Importar Planilha (.xlsx)
            </button>
          </div>
          <div id="recon-diff-area">${diffHTML}</div>
        </div>
      </div>
    `;
    containerEl.appendChild(content);
    lucide.createIcons();
  }

  function onReconProjectChange(projectId) {
    reconProjectId = projectId;
    localStorage.setItem('cf_recon_project_id', projectId);
    reconDiff = null;
    renderPage();
  }

  async function openImportReconciliacao() {
    if (!reconProjectId) {
      showToast('Selecione um projeto primeiro.', 'warning');
      return;
    }

    const modalHTML = `
      <div id="recon-step-1">
        <div style="text-align:center;padding:var(--sp-6) 0;">
          <i data-lucide="file-spreadsheet" style="width:48px;height:48px;color:var(--accent);margin-bottom:var(--sp-3);"></i>
          <h3 style="margin-bottom:var(--sp-2);">Importar Planilha de Bolsas</h3>
          <p style="color:var(--text-secondary);margin-bottom:var(--sp-4);">
            Selecione o arquivo .xlsx baixado do sistema FUNAPE.<br>
            Apenas bolsas com status <strong>"Ativo"</strong> serão comparadas.
          </p>
          <input type="file" id="recon-file-input" accept=".xlsx,.xls"
            style="display:inline-block;margin-bottom:var(--sp-3);">
        </div>
      </div>
      <div id="recon-step-2" style="display:none;">
        <div style="text-align:center;padding:var(--sp-6) 0;">
          <div class="spinner" style="margin:0 auto var(--sp-3);"></div>
          <p id="recon-step-2-msg">Lendo planilha...</p>
        </div>
      </div>
    `;

    const { overlay } = createModal({
      title: 'Reconciliação de Bolsas',
      bodyHTML: modalHTML,
      maxWidth: '600px',
      hideCancelBtn: false,
      saveLabel: 'Analisar',
      saveClass: 'btn--primary',
      onSave: async () => {
        const fileInput = document.getElementById('recon-file-input');
        if (!fileInput || !fileInput.files.length) {
          throw new Error('Selecione um arquivo .xlsx.');
        }

        const file = fileInput.files[0];
        document.getElementById('recon-step-1').style.display = 'none';
        document.getElementById('recon-step-2').style.display = 'block';

        // Ler arquivo
        const arrayBuffer = await file.arrayBuffer();

        // Parsear com bolsa-parser
        const msg2 = document.getElementById('recon-step-2-msg');
        if (msg2) msg2.textContent = 'Extraindo dados da planilha...';

        // Aguardar próximo frame para a UI atualizar
        await new Promise(r => setTimeout(r, 50));

        if (typeof parseBolsaSpreadsheet === 'undefined') {
          throw new Error('Parser de planilha não carregado. Recarregue a página.');
        }

        const { data: spreadsheetRows, warnings } = parseBolsaSpreadsheet(arrayBuffer);

        if (warnings.length > 0) {
          console.warn('[Reconciliação] Avisos do parser:', warnings);
        }

        if (!spreadsheetRows.length) {
          throw new Error('Nenhuma bolsa ativa encontrada na planilha.');
        }

        // Carregar bolsas ativas do projeto do banco
        if (msg2) msg2.textContent = 'Carregando dados do sistema...';
        await new Promise(r => setTimeout(r, 50));

        const { data: dbData, error: dbError } = await supabaseClient
          .from('scholarships')
          .select(`
            holder_id,
            amount,
            start_date,
            end_date,
            status,
            scholarship_type,
            scholarship_id:id,
            scholarship_holders!holder_id(id, full_name, cpf, email, education_level)
          `)
          .eq('project_id', reconProjectId)
          .eq('status', 'active');

        if (dbError) {
          throw new Error('Erro ao carregar bolsas: ' + dbError.message);
        }

        // Achatar dados do holder (Supabase retorna nested)
        const dbScholarships = (dbData || []).map(s => ({
          holder_id: s.scholarship_holders?.id || s.holder_id,
          full_name: s.scholarship_holders?.full_name || '?',
          cpf: s.scholarship_holders?.cpf || null,
          email: s.scholarship_holders?.email || null,
          education_level: s.scholarship_holders?.education_level || null,
          scholarship_id: s.scholarship_id,
          amount: s.amount,
          start_date: s.start_date,
          end_date: s.end_date,
          status: s.status,
          scholarship_type: s.scholarship_type || null,
        }));

        // Comparar dados
        if (typeof compareBolsaData === 'undefined') {
          throw new Error('Módulo de comparação não carregado. Recarregue a página.');
        }

        // allHolders (universo global) permite resolver pessoas já cadastradas
        // via outro projeto, evitando criar holders duplicados.
        const holderUniverse = (allHolders || []).map(h => ({
          id: h.id,
          full_name: h.full_name,
          cpf: h.cpf || null,
          email: h.email || null,
          education_level: h.education_level || null,
        }));

        reconDiff = compareBolsaData(spreadsheetRows, dbScholarships, holderUniverse);
        reconDiff._warnings = warnings;
        reconDiff._spreadsheetCount = spreadsheetRows.length;
        reconDiff._dbCount = dbScholarships.length;

        // Fechar modal e renderizar resultado
        const closeBtn = overlay.querySelector('[data-modal-close]');
        if (closeBtn) closeBtn.click();

        renderPage();
        showToast(`${spreadsheetRows.length} bolsas analisadas.`, 'success');
      }
    });
  }

  // Formata o valor de um campo de "alterados" conforme o tipo do campo.
  function reconFieldDisplay(field, val) {
    if (field === 'amount') return formatBRL(val);
    if (field === 'start_date' || field === 'end_date') return formatDate(val) || '—';
    return val ? escapeAttr(String(val)) : '—';
  }

  function renderReconciliationDiff(diff) {
    const { novos, removidos, alterados, iguais } = diff;
    const hasChanges = novos.length + removidos.length + alterados.length > 0;

    // Seção de avisos
    let warningsHTML = '';
    if (diff._warnings && diff._warnings.length) {
      warningsHTML = `
        <div class="alert-banner alert-banner--warning" style="margin-bottom:var(--sp-3);">
          <i data-lucide="alert-triangle" class="alert-banner__icon"></i>
          <div class="alert-banner__body">
            <strong>Avisos</strong>
            ${diff._warnings.map(w => `<div style="font-size:0.85rem;color:var(--text-secondary);margin-top:2px;">${escapeAttr(w)}</div>`).join('')}
          </div>
        </div>
      `;
    }

    // Resumo
    const summaryHTML = `
      <div class="stats-grid fade-in" style="margin-bottom:var(--sp-4);">
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--success"><i data-lucide="plus-circle"></i></div>
          <div class="stat-card__content">
            <div class="stat-card__label">Novos</div>
            <div class="stat-card__value">${novos.length}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--danger"><i data-lucide="minus-circle"></i></div>
          <div class="stat-card__content">
            <div class="stat-card__label">Removidos</div>
            <div class="stat-card__value">${removidos.length}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--warning"><i data-lucide="edit-3"></i></div>
          <div class="stat-card__content">
            <div class="stat-card__label">Alterados</div>
            <div class="stat-card__value">${alterados.length}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--info"><i data-lucide="check-circle"></i></div>
          <div class="stat-card__content">
            <div class="stat-card__label">Iguais</div>
            <div class="stat-card__value">${iguais.length}</div>
          </div>
        </div>
      </div>
    `;

    // Seção Novos
    let novosHTML = '';
    if (novos.length) {
      novosHTML = `
        <div class="recon-section recon-section--novos">
          <div class="recon-section__header">
            <label style="display:flex;align-items:center;gap:8px;">
              <input type="checkbox" class="recon-section__check-all" data-section="novos" checked
                onchange="HoldersPage.reconToggleAll('novos', this.checked)"
                style="width:18px;height:18px;accent-color:var(--success);">
              <strong>🟢 Novos</strong>
              <span style="color:var(--text-secondary);font-size:0.85rem;">(${novos.length} — na planilha mas não no sistema)</span>
            </label>
          </div>
          <div class="data-table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width:40px;"></th>
                  <th>Nome</th>
                  <th>Situação</th>
                  <th>CPF</th>
                  <th>Tipo</th>
                  <th>Valor</th>
                  <th>Início</th>
                  <th>Fim</th>
                </tr>
              </thead>
              <tbody>
                ${novos.map((n, i) => {
                  const situacao = n.matchKind === 'link'
                    ? `<span class="badge badge--active" style="font-size:0.65rem;" title="Bolsista já cadastrado${n.existingHolderName ? ' como: ' + escapeAttr(n.existingHolderName) : ''} — a nova bolsa será vinculada a ele (sem duplicar)">🔗 Vincular${n.matchMethod === 'name' ? ' (nome)' : ' (CPF)'}</span>`
                    : `<span class="badge badge--warning" style="font-size:0.65rem;">+ Novo bolsista</span>`;
                  return `
                  <tr class="recon-row" data-section="novos" data-index="${i}">
                    <td><input type="checkbox" class="recon-item-check" data-section="novos" checked style="width:16px;height:16px;accent-color:var(--success);"></td>
                    <td style="font-weight:500;">${escapeAttr(n.nome)}</td>
                    <td>${situacao}</td>
                    <td>${n.cpf_display || '—'}</td>
                    <td><span style="font-size:0.85rem;">${escapeAttr(n.tipo)}</span></td>
                    <td class="currency">${formatBRL(n.valor)}</td>
                    <td>${formatDate(n.duracao_inicio)}</td>
                    <td>${formatDate(n.duracao_fim)}</td>
                  </tr>
                `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // Seção Removidos
    let removidosHTML = '';
    if (removidos.length) {
      removidosHTML = `
        <div class="recon-section recon-section--removidos" style="margin-top:var(--sp-3);">
          <div class="recon-section__header">
            <label style="display:flex;align-items:center;gap:8px;">
              <input type="checkbox" class="recon-section__check-all" data-section="removidos"
                onchange="HoldersPage.reconToggleAll('removidos', this.checked)"
                style="width:18px;height:18px;accent-color:var(--danger);">
              <strong>🔴 Removidos</strong>
              <span style="color:var(--text-secondary);font-size:0.85rem;">(${removidos.length} — no sistema mas não na planilha)</span>
            </label>
          </div>
          <div class="data-table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width:40px;"></th>
                  <th>Nome</th>
                  <th>CPF</th>
                  <th>Valor</th>
                  <th>Início</th>
                  <th>Fim</th>
                </tr>
              </thead>
              <tbody>
                ${removidos.map((r, i) => `
                  <tr class="recon-row" data-section="removidos" data-index="${i}">
                    <td><input type="checkbox" class="recon-item-check" data-section="removidos" style="width:16px;height:16px;accent-color:var(--danger);"></td>
                    <td style="font-weight:500;">${escapeAttr(r.holder_name)}</td>
                    <td>${r.holder_cpf || '—'}</td>
                    <td class="currency">${formatBRL(r.amount)}</td>
                    <td>${formatDate(r.start_date)}</td>
                    <td>${formatDate(r.end_date)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // Seção Alterados
    let alteradosHTML = '';
    if (alterados.length) {
      alteradosHTML = `
        <div class="recon-section recon-section--alterados" style="margin-top:var(--sp-3);">
          <div class="recon-section__header">
            <label style="display:flex;align-items:center;gap:8px;">
              <input type="checkbox" class="recon-section__check-all" data-section="alterados" checked
                onchange="HoldersPage.reconToggleAll('alterados', this.checked)"
                style="width:18px;height:18px;accent-color:var(--warning);">
              <strong>🟡 Alterados</strong>
              <span style="color:var(--text-secondary);font-size:0.85rem;">(${alterados.length} — mesmo bolsista, dados divergentes)</span>
            </label>
          </div>
          <div class="data-table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width:40px;"></th>
                  <th>Nome</th>
                  <th>Match</th>
                  <th>Campo</th>
                  <th>Sistema</th>
                  <th>Planilha</th>
                </tr>
              </thead>
              <tbody>
                ${alterados.map((a, i) => {
                  const methodBadge = a.matchMethod === 'cpf'
                    ? '<span class="badge badge--active" style="font-size:0.65rem;">CPF</span>'
                    : '<span class="badge badge--warning" style="font-size:0.65rem;">Nome</span>';
                  return a.changes.map((c, ci) => `
                    <tr class="recon-row" data-section="alterados" data-index="${i}">
                      ${ci === 0 ? `
                        <td rowspan="${a.changes.length}"><input type="checkbox" class="recon-item-check" data-section="alterados" checked style="width:16px;height:16px;accent-color:var(--warning);"></td>
                        <td rowspan="${a.changes.length}" style="font-weight:500;">${escapeAttr(a.holder_name)}</td>
                        <td rowspan="${a.changes.length}">${methodBadge}</td>
                      ` : ''}
                      <td style="font-weight:500;">${escapeAttr(c.label)}</td>
                      <td class="recon-field-db">${reconFieldDisplay(c.field, c.database)}</td>
                      <td class="recon-field-changed">${reconFieldDisplay(c.field, c.spreadsheet)}</td>
                    </tr>
                  `).join('');
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // Seção Iguais
    let iguaisHTML = '';
    if (iguais.length) {
      iguaisHTML = `
        <div class="recon-section recon-section--iguais" style="margin-top:var(--sp-3);">
          <div class="recon-section__header">
            <strong>⚪ Iguais</strong>
            <span style="color:var(--text-secondary);font-size:0.85rem;margin-left:8px;">(${iguais.length} — sem alterações)</span>
          </div>
          <details style="cursor:pointer;">
            <summary style="color:var(--text-muted);font-size:0.85rem;padding:4px 0;">Mostrar detalhes</summary>
            <div class="data-table-wrapper">
              <table class="data-table">
                <thead>
                  <tr><th>Nome</th><th>Match</th><th>Valor</th><th>Vigência</th></tr>
                </thead>
                <tbody>
                  ${iguais.map(ig => `
                    <tr>
                      <td>${escapeAttr(ig.holder_name)}</td>
                      <td>${ig.matchMethod === 'cpf'
                        ? '<span class="badge badge--active" style="font-size:0.65rem;">CPF</span>'
                        : '<span class="badge badge--warning" style="font-size:0.65rem;">Nome</span>'}</td>
                      <td class="currency">${formatBRL(ig.amount)}</td>
                      <td>${formatDate(ig.start_date)} — ${formatDate(ig.end_date)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      `;
    }

    // Botão Aplicar
    const applyHTML = hasChanges ? `
      <div style="margin-top:var(--sp-4);text-align:right;">
        <button class="btn btn--primary btn--lg" onclick="HoldersPage.applyApprovedChanges()">
          <i data-lucide="check-check" style="width:18px;height:18px;"></i>
          Aplicar Alterações Aprovadas
        </button>
      </div>
    ` : '<p style="text-align:center;color:var(--success);font-weight:600;margin-top:var(--sp-4);">✅ Todos os dados estão sincronizados!</p>';

    return warningsHTML + summaryHTML + novosHTML + removidosHTML + alteradosHTML + iguaisHTML + applyHTML;
  }

  function reconToggleAll(section, checked) {
    const checkboxes = document.querySelectorAll(`.recon-item-check[data-section="${section}"]`);
    checkboxes.forEach(cb => { cb.checked = checked; });
  }

  async function applyApprovedChanges() {
    if (!reconDiff || !reconProjectId) return;

    const { novos, removidos, alterados } = reconDiff;

    // Coletar itens aprovados (checkbox marcado)
    const approvedCreates = [];
    document.querySelectorAll('.recon-item-check[data-section="novos"]').forEach((cb, i) => {
      if (cb.checked && novos[i]) {
        approvedCreates.push(novos[i]);
      }
    });

    const approvedEnds = [];
    document.querySelectorAll('.recon-item-check[data-section="removidos"]').forEach((cb, i) => {
      if (cb.checked && removidos[i]) {
        approvedEnds.push(removidos[i]);
      }
    });

    const approvedUpdates = [];
    document.querySelectorAll('.recon-item-check[data-section="alterados"]').forEach((cb, i) => {
      if (cb.checked && alterados[i]) {
        approvedUpdates.push(alterados[i]);
      }
    });

    if (!approvedCreates.length && !approvedEnds.length && !approvedUpdates.length) {
      showToast('Nenhuma alteração aprovada para aplicar.', 'warning');
      return;
    }

    const confirmed = await confirmAction(
      `Aplicar ${approvedCreates.length} criação(ões), ${approvedUpdates.length} atualização(ões) e ${approvedEnds.length} encerramento(s)?`
    );
    if (!confirmed) return;

    // Montar payload para a RPC
    // holder_id presente em um "create" → vincula a bolsa a um holder existente
    // (pessoa já cadastrada via outro projeto) em vez de criar duplicado.
    const creates = approvedCreates.map(n => ({
      holder_id: n.existingHolderId || '',
      nome: n.nome,
      cpf: n.cpf || '',
      email: n.email || '',
      tipo: n.tipo || '',
      formacao: n.formacao || '',
      valor: n.valor,
      inicio: n.duracao_inicio,
      fim: n.duracao_fim,
    }));

    const updates = approvedUpdates.map(a => ({
      holder_id: a.holder_id,
      scholarship_id: a.scholarship_id,
      amount: a.spreadsheet.valor,
      start_date: a.spreadsheet.duracao_inicio,
      end_date: a.spreadsheet.duracao_fim,
      scholarship_type: a.spreadsheet.tipo || '',
      cpf: a.cpfNew || '',
      full_name: a.nameNew || '',
      education_level: a.formacaoNew || '',
    }));

    const ends = approvedEnds.map(r => ({
      scholarship_id: r.scholarship_id,
    }));

    const { data, error } = await supabaseClient.rpc('apply_reconciliation', {
      p_project_id: reconProjectId,
      p_actions: { creates, updates, ends },
    });

    if (error) {
      showToast('Erro ao aplicar: ' + error.message, 'error');
      return;
    }

    reconDiff = null;
    showToast(`${data} alteração(ões) aplicada(s) com sucesso!`, 'success');
    await refresh();
  }

  // ── Ferramenta de merge de bolsistas duplicados ────────────

  let _dupGroups = [];

  function holderProjectsSummary(h) {
    const names = new Set();
    (h.scholarships || []).forEach(s => {
      names.add(s.projects?.name || ('Externa: ' + (s.funding_source || '?')));
    });
    return [...names];
  }

  let _mergeSel = []; // ids selecionados no merge manual

  function holderById(id) {
    return allHolders.find(h => h.id === id);
  }

  // Área de merge manual: escolher quaisquer cadastros (útil quando os
  // duplicados têm nomes diferentes — ex.: um com nome FUNAPE+CPF e outro
  // com o nome antigo sem CPF, que a detecção automática não agrupa).
  function renderMergeManual() {
    const selectedHolders = _mergeSel.map(holderById).filter(Boolean);
    const available = allHolders
      .filter(h => !_mergeSel.includes(h.id))
      .slice()
      .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name), 'pt-BR'));

    const options = available.map(h =>
      `<option value="${escapeAttr(h.id)}">${escapeAttr(h.full_name)}${h.cpf ? ' — ' + formatCPFDisplay(h.cpf) : ' — sem CPF'}</option>`
    ).join('');

    const suggestedIdx = Math.max(0, selectedHolders.findIndex(h => h.cpf));
    const selRows = selectedHolders.map((h, hi) => {
      const projetos = holderProjectsSummary(h);
      return `
        <tr>
          <td style="text-align:center;">
            <input type="radio" name="merge-manual-canon" value="${escapeAttr(h.id)}" ${hi === suggestedIdx ? 'checked' : ''}
              style="width:16px;height:16px;accent-color:var(--accent);">
          </td>
          <td style="font-weight:500;">${escapeAttr(h.full_name)}</td>
          <td>${h.cpf ? formatCPFDisplay(h.cpf) : '<span style="color:var(--text-muted);">—</span>'}</td>
          <td style="text-align:center;">${(h.scholarships || []).length}</td>
          <td style="font-size:0.8rem;color:var(--text-secondary);">${projetos.length ? escapeAttr(projetos.join(', ')) : '—'}</td>
          <td style="text-align:center;"><button class="btn btn--ghost btn--sm" onclick="HoldersPage.mergeRemoveSelected('${escapeAttr(h.id)}')" title="Remover da seleção"><i data-lucide="x" style="width:14px;height:14px;color:var(--danger);"></i></button></td>
        </tr>`;
    }).join('');

    return `
      <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:var(--sp-3);">
        <div class="form-group" style="margin:0;flex:1;min-width:240px;">
          <label class="form-label">Adicionar bolsista à mesclagem</label>
          <select class="form-input" id="merge-add-select">
            <option value="">Selecione um bolsista...</option>
            ${options}
          </select>
        </div>
        <button class="btn btn--secondary btn--sm" onclick="HoldersPage.mergeAddSelected()">
          <i data-lucide="plus" style="width:14px;height:14px;"></i> Adicionar
        </button>
      </div>
      ${selectedHolders.length ? `
        <div class="data-table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width:60px;text-align:center;">Manter</th>
                <th>Nome cadastrado</th>
                <th>CPF</th>
                <th style="text-align:center;">Bolsas</th>
                <th>Projetos</th>
                <th style="width:40px;"></th>
              </tr>
            </thead>
            <tbody>${selRows}</tbody>
          </table>
        </div>
        <div style="margin-top:var(--sp-3);text-align:right;">
          <button class="btn btn--primary" onclick="HoldersPage.mergeApplyManual()" ${selectedHolders.length < 2 ? 'disabled' : ''}>
            <i data-lucide="git-merge" style="width:16px;height:16px;"></i> Mesclar selecionados (${selectedHolders.length})
          </button>
        </div>
      ` : '<p style="color:var(--text-muted);font-size:0.85rem;">Adicione 2 ou mais cadastros do mesmo bolsista para mesclá-los.</p>'}
    `;
  }

  function refreshMergeManual() {
    const el = document.getElementById('merge-manual-area');
    if (el) { el.innerHTML = renderMergeManual(); lucide.createIcons(); }
  }

  function mergeAddSelected() {
    const sel = document.getElementById('merge-add-select');
    const id = sel && sel.value;
    if (id && !_mergeSel.includes(id)) {
      _mergeSel.push(id);
      refreshMergeManual();
    }
  }

  function mergeRemoveSelected(id) {
    _mergeSel = _mergeSel.filter(x => x !== id);
    refreshMergeManual();
  }

  async function mergeApplyManual() {
    if (_mergeSel.length < 2) { showToast('Selecione ao menos 2 cadastros.', 'warning'); return; }
    const canon = document.querySelector('input[name="merge-manual-canon"]:checked');
    if (!canon) { showToast('Escolha o cadastro a manter.', 'warning'); return; }
    const canonicalId = canon.value;
    const duplicateIds = _mergeSel.filter(id => id !== canonicalId);
    await doMerge(canonicalId, duplicateIds);
  }

  function openMergeTool() {
    _dupGroups = findDuplicateHolderGroups();
    _mergeSel = [];

    const groupsHTML = _dupGroups.map((group, gi) => {
      // Sugere como canônico quem tem CPF (mais completo); senão o primeiro.
      const suggestedIdx = Math.max(0, group.findIndex(h => h.cpf));
      const rowsHTML = group.map((h, hi) => {
        const projetos = holderProjectsSummary(h);
        const bolsaCount = (h.scholarships || []).length;
        return `
          <tr>
            <td style="text-align:center;">
              <input type="radio" name="merge-grp-${gi}" value="${escapeAttr(h.id)}" ${hi === suggestedIdx ? 'checked' : ''}
                style="width:16px;height:16px;accent-color:var(--accent);">
            </td>
            <td style="font-weight:500;">${escapeAttr(h.full_name)}${!h.active ? ' <span class="badge badge--ended" style="font-size:0.6rem;">Inativo</span>' : ''}</td>
            <td>${h.cpf ? formatCPFDisplay(h.cpf) : '<span style="color:var(--text-muted);">—</span>'}</td>
            <td style="font-size:0.8rem;color:var(--text-secondary);">${h.email || '—'}</td>
            <td style="text-align:center;">${bolsaCount}</td>
            <td style="font-size:0.8rem;color:var(--text-secondary);">${projetos.length ? escapeAttr(projetos.join(', ')) : '—'}</td>
          </tr>
        `;
      }).join('');

      return `
        <div class="recon-section" style="margin-bottom:var(--sp-3);">
          <div class="recon-section__header" style="display:flex;align-items:center;justify-content:space-between;gap:var(--sp-2);">
            <strong>${escapeAttr(group[0].full_name)}</strong>
            <button class="btn btn--primary btn--sm" onclick="HoldersPage.mergeSelectedGroup(${gi})">
              <i data-lucide="git-merge" style="width:14px;height:14px;"></i> Mesclar este grupo
            </button>
          </div>
          <p style="font-size:0.8rem;color:var(--text-secondary);margin:4px 0 8px;">
            Selecione o cadastro <strong>canônico</strong> (será mantido). Os demais terão suas bolsas
            transferidas e serão removidos. CPF/e-mail/formação ausentes no canônico são preenchidos a partir dos duplicados.
          </p>
          <div class="data-table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width:60px;text-align:center;">Manter</th>
                  <th>Nome cadastrado</th>
                  <th>CPF</th>
                  <th>E-mail</th>
                  <th style="text-align:center;">Bolsas</th>
                  <th>Projetos</th>
                </tr>
              </thead>
              <tbody>${rowsHTML}</tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');

    const autoSection = _dupGroups.length ? `
      <h4 style="margin:0 0 var(--sp-2);display:flex;align-items:center;gap:6px;">
        <i data-lucide="copy" style="width:16px;height:16px;color:var(--danger);"></i>
        Possíveis duplicados (mesmo nome)
      </h4>
      ${groupsHTML}
      <hr style="border:none;border-top:1px solid var(--border);margin:var(--sp-4) 0;">
    ` : '';

    const manualSection = `
      <h4 style="margin:0 0 var(--sp-1);display:flex;align-items:center;gap:6px;">
        <i data-lucide="search" style="width:16px;height:16px;color:var(--accent);"></i>
        Mesclar manualmente
      </h4>
      <p style="font-size:0.8rem;color:var(--text-secondary);margin:0 0 var(--sp-3);">
        Use quando os cadastros têm <strong>nomes diferentes</strong> (ex.: um veio da planilha com CPF e o
        outro é o cadastro antigo). Marque o cadastro <strong>canônico</strong> (mantido); os demais têm as
        bolsas transferidas e são removidos.
      </p>
      <div id="merge-manual-area"></div>
    `;

    const { overlay } = createModal({
      title: 'Mesclar Bolsistas Duplicados',
      bodyHTML: `<div style="margin-top:var(--sp-2);">${autoSection}${manualSection}</div>`,
      maxWidth: '760px',
      hideCancelBtn: true,
      onSave: async () => {}
    });

    const saveBtn = overlay.querySelector('#modal-save-btn');
    if (saveBtn) {
      saveBtn.textContent = 'Fechar';
      saveBtn.className = 'btn btn--secondary';
    }
    refreshMergeManual();
    lucide.createIcons();
  }

  function formatCPFDisplay(digits) {
    const d = String(digits || '').replace(/\D/g, '');
    if (d.length !== 11) return digits || '—';
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }

  async function mergeSelectedGroup(groupIndex) {
    const group = _dupGroups[groupIndex];
    if (!group) return;

    const selected = document.querySelector(`input[name="merge-grp-${groupIndex}"]:checked`);
    if (!selected) { showToast('Selecione o cadastro a manter.', 'warning'); return; }

    const canonicalId = selected.value;
    const duplicateIds = group.map(h => h.id).filter(id => id !== canonicalId);
    if (!duplicateIds.length) { showToast('Nada a mesclar neste grupo.', 'warning'); return; }

    await doMerge(canonicalId, duplicateIds);
  }

  // Executa o merge: confirma, chama a RPC, fecha o modal e recarrega.
  async function doMerge(canonicalId, duplicateIds) {
    const canonical = holderById(canonicalId);
    const confirmed = await confirmAction(
      `Mesclar ${duplicateIds.length} cadastro(s) em "${canonical ? canonical.full_name : ''}"? ` +
      `As bolsas serão transferidas e os duplicados removidos. Esta ação não pode ser desfeita.`
    );
    if (!confirmed) return;

    const { data, error } = await supabaseClient.rpc('merge_holders', {
      p_canonical_id: canonicalId,
      p_duplicate_ids: duplicateIds,
    });

    if (error) {
      showToast('Erro ao mesclar: ' + error.message, 'error');
      return;
    }

    const closeBtn = document.querySelector('.modal-overlay [data-modal-close]');
    if (closeBtn) closeBtn.click();

    showToast(`Bolsistas mesclados (${data} bolsa(s) transferida(s)).`, 'success');
    await refresh();
  }

  return { load, openForm, remove, manageScholarships, openScholarshipForm, viewTimeline, onSearch, onProjectFilter, onToggleInactive, toggleProjectGroup, switchTab, onReconProjectChange, openImportReconciliacao, reconToggleAll, applyApprovedChanges, openMergeTool, mergeSelectedGroup, mergeAddSelected, mergeRemoveSelected, mergeApplyManual };
})();

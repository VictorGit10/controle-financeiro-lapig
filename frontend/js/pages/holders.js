/* ============================================================
   Holders Page — CRUD for scholarship holders (Bolsistas)
   ============================================================ */

Router.register('holders', {
  title: 'Bolsistas',

  actions(container) {
    const btn = document.createElement('button');
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

  function computeKPIs() {
    const today = localISODate();
    let holdersWithActiveScholarshipCount = 0;
    let activeScholarshipCount = 0;
    let totalMonthlyAll = 0;
    let inactiveHolderCount = 0;

    allHolders.forEach(h => {
      const activeScholarships = getActiveScholarshipsInPeriod(h, today);
      const holderTotal = activeScholarships.reduce((sum, s) => sum + Number(s.amount), 0);

      if (activeScholarships.length > 0) {
        holdersWithActiveScholarshipCount++;
      }

      activeScholarshipCount += activeScholarships.length;
      totalMonthlyAll += holderTotal;

      if (!h.active) {
        inactiveHolderCount++;
      }
    });

    return {
      holdersWithActiveScholarshipCount,
      activeScholarshipCount,
      totalMonthlyAll,
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


  function renderPage() {
    if (!allHolders.length) {
      containerEl.innerHTML = `
        <div class="empty-state">
          <i data-lucide="users" class="empty-state__icon"></i>
          <h3 class="empty-state__title">Nenhum bolsista cadastrado</h3>
          <p class="empty-state__text">Clique em "Novo Bolsista" para começar.</p>
        </div>
      `;
      lucide.createIcons();
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
      </div>
    `;

    containerEl.innerHTML = bannerHTML + statsHTML + toolbarHTML + '<div id="holders-table-area"></div>';
    lucide.createIcons();
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
        const payload = {
          full_name: document.getElementById('fld-name').value.trim(),
          email: document.getElementById('fld-email').value.trim() || null,
        };

        if (!payload.full_name) throw new Error('Nome é obrigatório.');

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
    const confirmed = await confirmAction(`Excluir "${name}"? Bolsas vinculadas impedirão a exclusão.`);
    if (!confirmed) return;

    const { error } = await supabaseClient.from('scholarship_holders').delete().eq('id', id);
    if (error) {
      showToast('Erro: ' + (error.message.includes('restrict') ? 'Bolsista possui bolsas vinculadas.' : error.message), 'error');
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
    if (timelineScholarships.length > 0) {
      const starts = timelineScholarships.map(s => s.start_date).sort();
      const ends = timelineScholarships.map(s => s.end_date).sort();
      startWindow = starts[0].slice(0, 7) + '-01';
      const lastEnd = new Date(ends[ends.length - 1] + 'T00:00:00');
      endWindow = localISODate(new Date(lastEnd.getFullYear(), lastEnd.getMonth() + 1, 0));
    } else {
      const now = new Date();
      startWindow = localISODate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
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

  return { load, openForm, remove, manageScholarships, openScholarshipForm, viewTimeline, onSearch, onProjectFilter, onToggleInactive, toggleProjectGroup };
})();

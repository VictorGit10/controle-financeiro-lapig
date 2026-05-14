/* ============================================================
   CrudPage — Generic CRUD module for simple table pages
   ============================================================
   Supports server-side pagination, search, and CSV export.
   ============================================================ */

function CrudPage(config) {
  const {
    tableName,
    dateField,
    entityLabel,
    entityIcon,
    columns,
    formFields,
    statsCards,
    statsRpc,
    globalName,
    gender = 'm',
    pageSize = 25,
    searchable = true,
    selectClause = '*, projects:project_id(name)',
    searchField = 'description',
    searchPlaceholder = 'Buscar por descrição...',
    onSave = null,
    onDelete = null,
    loadExtra = null,
  } = config;

  const art = gender === 'f' ? 'a' : 'o';

  let containerEl = null;
  let projectsCache = [];
  let records = [];
  let currentPage = 0;
  let totalCount = 0;
  let searchQuery = '';
  let _searchTimer = null;

  async function loadProjects() {
    const result = await supabaseClient.from('projects').select('id, name, funape_managed').order('name');
    projectsCache = handleSupabaseResponse(result, 'Erro ao carregar projetos') || [];
  }

  async function load(container) {
    containerEl = container;
    await loadProjects();
    currentPage = 0;
    searchQuery = '';
    await refresh();
  }

  async function refresh() {
    const from = currentPage * pageSize;
    const to = from + pageSize - 1;

    let query = supabaseClient
      .from(tableName)
      .select(selectClause, { count: 'exact' })
      .order(dateField, { ascending: false })
      .range(from, to);

    if (searchQuery) {
      query = query.ilike(searchField, `%${searchQuery}%`);
    }

    const { data, error, count } = await query;

    if (error) {
      showToast(`Erro ao carregar ${entityLabel.toLowerCase()}s: ${error.message}`, 'error');
      return;
    }

    records = data || [];
    totalCount = count || 0;

    // Stats via RPC (no unpaginated query)
    let statsData = null;
    if (statsRpc) {
      const { data: rpcResult } = await supabaseClient.rpc(statsRpc);
      statsData = rpcResult;
    }

    if (!records.length && !searchQuery) {
      containerEl.innerHTML = `
        <div class="empty-state">
          <i data-lucide="${entityIcon}" class="empty-state__icon"></i>
          <h3 class="empty-state__title">Nenhum${gender === 'f' ? 'a' : ''} ${entityLabel.toLowerCase()} registrad${art}</h3>
          <p class="empty-state__text">Clique em "Nov${gender === 'f' ? 'a' : 'o'} ${entityLabel}" para começar.</p>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    const stats = statsCards ? statsCards(statsData) : [];
    const totalPages = Math.ceil(totalCount / pageSize);

    containerEl.innerHTML = `
      ${stats.length ? `
        <div class="stats-grid fade-in">
          ${stats.map(s => `
            <div class="stat-card">
              <div class="stat-card__icon stat-card__icon--${s.iconClass}">
                <i data-lucide="${s.icon}"></i>
              </div>
              <div class="stat-card__content">
                <div class="stat-card__label">${s.label}</div>
                <div class="stat-card__value ${s.currency ? 'currency' : ''} ${s.valueClass || ''}">${s.currency ? formatBRL(s.value) : s.value}</div>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${searchable ? `
        <div class="holders-toolbar" style="margin-top: 16px;">
          <input type="text" class="form-input holders-toolbar__search"
            placeholder="${searchPlaceholder}" value="${escapeAttr(searchQuery)}"
            oninput="${globalName}.onSearch(this.value)">
          <button class="btn btn--secondary btn--sm" onclick="${globalName}.exportCSV()" title="Exportar CSV">
            <i data-lucide="download" style="width:16px;height:16px;"></i> Exportar
          </button>
        </div>
      ` : ''}

      ${records.length ? `
        <div class="data-table-wrapper fade-in" style="animation-delay: 0.1s;">
          <table class="data-table">
            <thead>
              <tr>
                ${columns.map(c => `<th>${c.label}</th>`).join('')}
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${records.map(r => `
                <tr>
                  ${columns.map(c => `<td class="${c.className || ''}">${c.render(r)}</td>`).join('')}
                  <td>
                    <div style="display: flex; gap: 4px;">
                      <button class="btn btn--ghost btn--sm" onclick="${globalName}.openForm('${escapeAttr(r.id)}')" title="Editar">
                        <i data-lucide="pencil" style="width:16px;height:16px;"></i>
                      </button>
                      <button class="btn btn--ghost btn--sm" onclick="${globalName}.remove('${escapeAttr(r.id)}')" title="Excluir">
                        <i data-lucide="trash-2" style="width:16px;height:16px;color:var(--danger);"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : `
        <div class="empty-state" style="padding: 40px 0;">
          <i data-lucide="search-x" class="empty-state__icon"></i>
          <h3 class="empty-state__title">Nenhum resultado encontrado</h3>
          <p class="empty-state__text">Tente ajustar a busca.</p>
        </div>
      `}

      ${totalPages > 1 ? `
        <div class="pagination" style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:16px;">
          <button class="btn btn--ghost btn--sm" onclick="${globalName}.goToPage(${currentPage - 1})" ${currentPage === 0 ? 'disabled style="opacity:0.4;"' : ''}>
            <i data-lucide="chevron-left" style="width:16px;height:16px;"></i>
          </button>
          <span style="font-size:0.8125rem;color:var(--text-secondary);">
            ${currentPage + 1} / ${totalPages} (${totalCount} registros)
          </span>
          <button class="btn btn--ghost btn--sm" onclick="${globalName}.goToPage(${currentPage + 1})" ${currentPage >= totalPages - 1 ? 'disabled style="opacity:0.4;"' : ''}>
            <i data-lucide="chevron-right" style="width:16px;height:16px;"></i>
          </button>
        </div>
      ` : ''}
    `;
    lucide.createIcons();
  }

  function onSearch(value) {
    searchQuery = value;
    currentPage = 0;
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => refresh(), 300);
  }

  function goToPage(page) {
    const totalPages = Math.ceil(totalCount / pageSize);
    if (page < 0 || page >= totalPages) return;
    currentPage = page;
    refresh();
  }

  async function exportCSV() {
    const { data, error } = await supabaseClient
      .from(tableName)
      .select(selectClause)
      .order(dateField, { ascending: false });

    if (error || !data) {
      showToast('Erro ao exportar: ' + error.message, 'error');
      return;
    }

    exportToCSV(data, columns, `${entityLabel.toLowerCase()}s.csv`);
    showToast('CSV exportado!', 'success');
  }

  async function openForm(id = null) {
    let record = {};

    if (id) {
      const { data, error } = await supabaseClient
        .from(tableName)
        .select('*')
        .eq('id', id)
        .single();
      if (error) { showToast('Erro ao carregar', 'error'); return; }
      record = data;
    }

    if (loadExtra) await loadExtra(record, id);

    const formHTML = formFields.map(f => f(record, projectsCache)).join('');

    createModal({
      title: id ? `Editar ${entityLabel}` : `Nov${gender === 'f' ? 'a' : 'o'} ${entityLabel}`,
      bodyHTML: formHTML,
      onSave: async () => {
        const payload = {};
        for (const f of formFields) {
          if (f.readOnly) continue;
          const el = document.getElementById(f.id);
          if (!el) continue;
          let val = el.value.trim();
          if (f.type === 'number') val = parseFloat(val) || 0;
          if (f.type === 'boolean') val = el.checked;
          if (f.type === 'nullable-text' && !val) val = null;
          payload[f.key] = val;
        }

        for (const f of formFields) {
          if (f.required && !payload[f.key] && payload[f.key] !== 0) {
            throw new Error(f.requiredMsg || `${f.label} é obrigatóri${art}.`);
          }
          if (f.type === 'number' && f.min !== undefined && payload[f.key] < f.min) {
            throw new Error(f.minMsg || `${f.label} deve ser no mínimo ${f.min}.`);
          }
        }

        if (onSave) {
          await onSave(payload, id);
        } else if (id) {
          const { error } = await supabaseClient.from(tableName).update(payload).eq('id', id);
          if (error) throw error;
          showToast(`${entityLabel} atualizad${art}!`, 'success');
        } else {
          const { error } = await supabaseClient.from(tableName).insert(payload);
          if (error) throw error;
          showToast(`${entityLabel} registrad${art}!`, 'success');
        }

        await refresh();
      }
    });
  }

  async function remove(id) {
    if (onDelete) {
      await onDelete(id);
    } else {
      const confirmed = await confirmAction(`Excluir ${gender === 'f' ? 'esta' : 'este'} ${entityLabel.toLowerCase()}?`);
      if (!confirmed) return;

      const { error } = await supabaseClient.from(tableName).delete().eq('id', id);
      if (error) { showToast('Erro: ' + error.message, 'error'); return; }
      showToast(`${entityLabel} excluíd${art}.`, 'success');
    }
    await refresh();
  }

  return { load, openForm, remove, refresh, onSearch, goToPage, exportCSV };
}
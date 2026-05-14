/* ============================================================
   Gestão de Projetos — CRUD for project management
   Uses CrudPage generic module with custom save/delete handlers
   ============================================================ */

Router.register('gestao', {
  title: 'Gestão de Projetos',

  actions(container) {
    const btn = document.createElement('button');
    btn.className = 'btn btn--primary btn--sm';
    btn.innerHTML = '<i data-lucide="plus"></i> Novo Projeto';
    btn.addEventListener('click', () => GestaoPage.openForm());
    container.appendChild(btn);
  },

  async render(container) {
    await GestaoPage.load(container);
  }
});


const GestaoPage = (() => {
  const page = CrudPage({
    tableName: 'projects',
    dateField: 'created_at',
    entityLabel: 'Projeto',
    entityIcon: 'folder-kanban',
    globalName: 'GestaoPage',
    gender: 'm',
    selectClause: '*',
    searchField: 'name',
    searchPlaceholder: 'Buscar por nome...',

    onSave: async (payload, id) => {
      if (id) payload.p_id = id;
      const { error } = await supabaseClient.rpc('save_project', payload);
      if (error) throw error;
      showToast(id ? 'Projeto atualizado!' : 'Projeto criado!', 'success');
    },

    onDelete: async (id) => {
      const ok = await confirmAction(
        'Excluir este projeto? Se houver bolsas, desembolsos ou gastos vinculados, a exclusão será bloqueada por segurança.'
      );
      if (!ok) return;

      const { error } = await supabaseClient.from('projects').delete().eq('id', id);
      if (error) {
        if (error.code === '23503' || error.message.includes('restrict')) {
          showToast('Não é possível excluir: o projeto possui registros vinculados (bolsas, desembolsos ou gastos).', 'error');
        } else {
          showToast('Erro ao excluir: ' + error.message, 'error');
        }
        return;
      }
      showToast('Projeto excluído.', 'success');
    },

    loadExtra: async (record) => {
      if (record.id) {
        const { data } = await supabaseClient
          .from('dashboard_settings')
          .select('include_in_general')
          .eq('project_id', record.id)
          .maybeSingle();
        record._include_in_general = data ? data.include_in_general : true;
      } else {
        record._include_in_general = true;
      }
    },

    columns: [
      {
        label: 'Nome',
        render: r => `<span style="font-weight:600;color:var(--text-primary);">${escapeAttr(r.name)}</span>`,
        csvRender: r => r.name,
      },
      {
        label: 'Código',
        render: r => r.code ? escapeAttr(r.code) : '—',
        csvRender: r => r.code || '',
      },
      {
        label: 'Vigência',
        render: r => `${formatDate(r.start_date)} — ${formatDate(r.end_date)}`,
        csvRender: r => `${r.start_date} — ${r.end_date}`,
      },
      {
        label: 'Status',
        render: r => `<span class="badge badge--${r.active ? 'active' : 'ended'}">${r.active ? 'Ativo' : 'Inativo'}</span>`,
        csvRender: r => r.active ? 'Ativo' : 'Inativo',
      },
    ],

    formFields: [
      {
        id: 'fld-name', key: 'p_name', label: 'Nome', type: 'text',
        required: true, requiredMsg: 'Nome é obrigatório.',
        render: (rec) => `
          <div class="form-group">
            <label class="form-label">Nome *</label>
            <input class="form-input" id="fld-name" value="${escapeAttr(rec.name || '')}" placeholder="Ex: Projeto Alpha">
          </div>`,
      },
      {
        id: 'fld-code', key: 'p_code', label: 'Código', type: 'nullable-text',
        render: (rec) => `
          <div class="form-group">
            <label class="form-label">Código</label>
            <input class="form-input" id="fld-code" value="${escapeAttr(rec.code || '')}" placeholder="Código interno">
          </div>`,
      },
      {
        id: 'fld-start', key: 'p_start_date', label: 'Início', type: 'text',
        render: (rec) => `
          <div class="form-group">
            <label class="form-label">Início</label>
            <input class="form-input" type="date" id="fld-start" value="${toInputDate(rec.start_date)}">
          </div>`,
      },
      {
        id: 'fld-end', key: 'p_end_date', label: 'Término', type: 'text',
        render: (rec) => `
          <div class="form-group">
            <label class="form-label">Término</label>
            <input class="form-input" type="date" id="fld-end" value="${toInputDate(rec.end_date)}">
          </div>`,
      },
      {
        id: 'fld-notes', key: 'p_notes', label: 'Observações', type: 'nullable-text',
        render: (rec) => `
          <div class="form-group">
            <label class="form-label">Observações</label>
            <textarea class="form-input" id="fld-notes" rows="2" placeholder="Notas adicionais">${escapeAttr(rec.notes || '')}</textarea>
          </div>`,
      },
      {
        id: 'fld-active', key: 'p_active', label: 'Projeto ativo', type: 'boolean',
        render: (rec) => `
          <div class="form-group" style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="fld-active"
              ${rec.active !== false ? 'checked' : ''}
              style="width:18px;height:18px;accent-color:var(--accent);">
            <label for="fld-active" class="form-label" style="margin:0;cursor:pointer;">Projeto ativo</label>
          </div>`,
      },
      {
        id: 'fld-include-dashboard', key: 'p_include_in_general', label: 'Incluir no Dashboard', type: 'boolean',
        render: (rec) => `
          <div class="form-group" style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="fld-include-dashboard"
              ${rec._include_in_general !== false ? 'checked' : ''}
              style="width:18px;height:18px;accent-color:var(--accent);">
            <label for="fld-include-dashboard" class="form-label" style="margin:0;cursor:pointer;">Incluir no Dashboard Geral</label>
          </div>`,
      },
      {
        id: 'fld-funape', key: 'p_funape_managed', label: 'Gerido pela FUNAPE', type: 'boolean',
        render: (rec) => `
          <div class="form-group" style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="fld-funape"
              ${rec.funape_managed ? 'checked' : ''}
              style="width:18px;height:18px;accent-color:var(--accent);">
            <label for="fld-funape" class="form-label" style="margin:0;cursor:pointer;">Projeto gerido pela FUNAPE (gastos virão do balancete)</label>
          </div>`,
      },
    ],
  });

  return page;
})();
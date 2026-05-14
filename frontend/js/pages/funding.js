/* ============================================================
   Funding Page — CRUD for funding releases (Desembolsos)
   Uses CrudPage generic module
   ============================================================ */

Router.register('funding', {
  title: 'Desembolsos',

  actions(container) {
    const btn = document.createElement('button');
    btn.className = 'btn btn--primary btn--sm';
    btn.innerHTML = '<i data-lucide="plus"></i> Novo Desembolso';
    btn.addEventListener('click', () => FundingPage.openForm());
    container.appendChild(btn);
  },

  async render(container) {
    await FundingPage.load(container);
  }
});

const FundingPage = (() => {
  const page = CrudPage({
    tableName: 'funding_releases',
    dateField: 'release_date',
    entityLabel: 'Desembolso',
    entityIcon: 'banknote',
    globalName: 'FundingPage',
    gender: 'm',
    statsRpc: 'funding_stats',

    columns: [
      { label: 'Data', render: r => formatDate(r.release_date), csvRender: r => r.release_date },
      { label: 'Projeto', render: r => `<span style="color: var(--text-primary); font-weight: 500;">${escapeAttr(r.projects?.name || '—')}</span>`, csvRender: r => r.projects?.name || '' },
      { label: 'Descrição', render: r => escapeAttr(r.description || ''), csvRender: r => r.description || '' },
      { label: 'Valor', className: 'currency currency--positive', render: r => formatBRL(r.amount), csvRender: r => r.amount },
    ],

    statsCards: (s) => [
      {
        icon: 'trending-up', iconClass: 'success',
        label: 'Total Desembolsado', value: Number(s?.total || 0), currency: true,
      },
      {
        icon: 'hash', iconClass: 'info',
        label: 'Registros', value: Number(s?.count || 0),
      },
    ],

    formFields: [
      {
        id: 'fld-project', key: 'project_id', label: 'Projeto', type: 'text', required: true, requiredMsg: 'Selecione um projeto.',
        render: (rec, projects) => `
          <div class="form-group">
            <label class="form-label">Projeto *</label>
            <select class="form-input" id="fld-project">
              <option value="">Selecione...</option>
              ${projects.map(p => `<option value="${p.id}" ${p.id === rec.project_id ? 'selected' : ''}>${escapeAttr(p.name)}</option>`).join('')}
            </select>
          </div>`,
      },
      {
        id: 'fld-desc', key: 'description', label: 'Descrição', type: 'text', required: true, requiredMsg: 'Descrição é obrigatória.',
        render: (rec) => `
          <div class="form-group">
            <label class="form-label">Descrição *</label>
            <input class="form-input" id="fld-desc" value="${escapeAttr(rec.description || '')}" placeholder="Ex: 1ª parcela FUNAPE">
          </div>`,
      },
      {
        id: 'fld-date', key: 'release_date', label: 'Data', type: 'text', required: true, requiredMsg: 'Data é obrigatória.',
        render: (rec) => `
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Data *</label>
              <input class="form-input" type="date" id="fld-date" value="${toInputDate(rec.release_date)}">
            </div>
            <div class="form-group">
              <label class="form-label">Valor (R$) *</label>
              <input class="form-input" type="number" step="0.01" id="fld-amount" value="${rec.amount || ''}">
            </div>
          </div>`,
        readOnly: true,
      },
      {
        id: 'fld-amount', key: 'amount', label: 'Valor', type: 'number', required: true, requiredMsg: 'Valor é obrigatório.', min: 0.01, minMsg: 'Valor deve ser positivo.',
        render: () => '',
      },
      {
        id: 'fld-notes', key: 'notes', label: 'Observações', type: 'nullable-text',
        render: (rec) => `
          <div class="form-group">
            <label class="form-label">Observações</label>
            <textarea class="form-input" id="fld-notes" rows="2">${escapeAttr(rec.notes || '')}</textarea>
          </div>`,
      },
    ],
  });

  return page;
})();
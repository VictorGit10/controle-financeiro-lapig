/* ============================================================
   Expenses Page — CRUD for expenses (Outros Gastos)
   Uses CrudPage generic module
   ============================================================ */

Router.register('expenses', {
  title: 'Gastos',

  actions(container) {
    const btn = document.createElement('button');
    btn.className = 'btn btn--primary btn--sm';
    btn.innerHTML = '<i data-lucide="plus"></i> Novo Gasto';
    btn.addEventListener('click', () => ExpensesPage.openForm());
    container.appendChild(btn);
  },

  async render(container) {
    await ExpensesPage.load(container);
  }
});

const ExpensesPage = (() => {
  const page = CrudPage({
    tableName: 'expenses',
    dateField: 'expense_date',
    entityLabel: 'Gasto',
    entityIcon: 'receipt',
    globalName: 'ExpensesPage',
    gender: 'm',
    statsRpc: 'expenses_stats',

    columns: [
      { label: 'Data', render: r => formatDate(r.expense_date), csvRender: r => r.expense_date },
      { label: 'Projeto', render: r => `<span style="color: var(--text-primary); font-weight: 500;">${escapeAttr(r.projects?.name || '—')}</span>`, csvRender: r => r.projects?.name || '' },
      { label: 'Descrição', render: r => escapeAttr(r.description || ''), csvRender: r => r.description || '' },
      {
        label: 'Categoria', render: r =>
          r.category ? `<span class="badge badge--warning">${escapeAttr(r.category)}</span>` : '—',
        csvRender: r => r.category || '',
      },
      { label: 'Valor', className: 'currency currency--negative', render: r => formatBRL(r.amount), csvRender: r => r.amount },
    ],

    statsCards: (s) => [
      {
        icon: 'trending-down', iconClass: 'danger',
        label: 'Total de Gastos', value: Number(s?.total || 0), currency: true,
      },
      {
        icon: 'hash', iconClass: 'info',
        label: 'Registros', value: Number(s?.count || 0),
      },
      {
        icon: 'tag', iconClass: 'warning',
        label: 'Categorias', value: Number(s?.category_count || 0),
      },
    ],

    formFields: [
      {
        id: 'fld-project', key: 'project_id', label: 'Projeto', type: 'text', required: true, requiredMsg: 'Selecione um projeto.',
        render: (rec, projects) => {
          const nonFunape = projects.filter(p => !p.funape_managed);
          const hiddenCount = projects.length - nonFunape.length;
          return `
          <div class="form-group">
            <label class="form-label">Projeto *</label>
            <select class="form-input" id="fld-project">
              <option value="">Selecione...</option>
              ${nonFunape.map(p => `<option value="${p.id}" ${p.id === rec.project_id ? 'selected' : ''}>${escapeAttr(p.name)}</option>`).join('')}
            </select>
            ${hiddenCount > 0 ? `<small style="color:var(--text-secondary);">${hiddenCount} projeto(s) gerido(s) pela FUNAPE ocultos — seus gastos vêm do balancete.</small>` : ''}
          </div>`;
        },
      },
      {
        id: 'fld-desc', key: 'description', label: 'Descrição', type: 'text', required: true, requiredMsg: 'Descrição é obrigatória.',
        render: (rec) => `
          <div class="form-group">
            <label class="form-label">Descrição *</label>
            <input class="form-input" id="fld-desc" value="${escapeAttr(rec.description || '')}" placeholder="Ex: Material de escritório">
          </div>`,
      },
      {
        id: 'fld-date', key: 'expense_date', label: 'Data', type: 'text', required: true, requiredMsg: 'Data é obrigatória.',
        render: (rec) => `
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Data *</label>
              <input class="form-input" type="date" id="fld-date" value="${toInputDate(rec.expense_date)}">
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
        id: 'fld-category', key: 'category', label: 'Categoria', type: 'nullable-text',
        render: (rec) => `
          <div class="form-group">
            <label class="form-label">Categoria</label>
            <input class="form-input" id="fld-category" value="${escapeAttr(rec.category || '')}"
              placeholder="Ex: viagem, material, software"
              list="category-suggestions">
            <datalist id="category-suggestions">
              <option value="material">
              <option value="viagem">
              <option value="evento">
              <option value="software">
              <option value="equipamento">
              <option value="manutenção">
              <option value="serviço">
              <option value="outros">
            </datalist>
          </div>`,
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
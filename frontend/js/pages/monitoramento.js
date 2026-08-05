/* ============================================================
   Observações Page — registro leve de monitoramento por projeto
   (data + texto livre). Substitui a antiga aba Gastos (provisão
   temporária de expenses). A execução financeira vem do balancete
   da FUNAPE; aqui ficam apenas observações pontuais que o usuário
   discrimina e apaga quando não precisar mais.
   Uses CrudPage generic module
   ============================================================ */

Router.register('monitoramento', {
  title: 'Observações',

  actions(container) {
    const btn = document.createElement('button');
    btn.className = 'btn btn--primary btn--sm';
    btn.innerHTML = '<i data-lucide="plus"></i> Nova Observação';
    btn.addEventListener('click', () => MonitoramentoPage.openForm());
    container.appendChild(btn);
  },

  async render(container) {
    await MonitoramentoPage.load(container);
  }
});

const MonitoramentoPage = (() => {
  const page = CrudPage({
    tableName: 'monitoramento',
    dateField: 'note_date',
    entityLabel: 'Observação',
    entityIcon: 'clipboard-list',
    globalName: 'MonitoramentoPage',
    gender: 'f',
    statsRpc: 'monitoramento_stats',
    searchField: 'observacao',
    searchPlaceholder: 'Buscar observações...',

    columns: [
      { label: 'Data', render: r => formatDate(r.note_date), csvRender: r => r.note_date },
      { label: 'Projeto', render: r => `<span style="color: var(--text-primary); font-weight: 500;">${escapeAttr(r.projects?.name || '—')}</span>`, csvRender: r => r.projects?.name || '' },
      { label: 'Observação', render: r => escapeAttr(r.observacao || ''), csvRender: r => r.observacao || '' },
    ],

    statsCards: (s) => [
      {
        icon: 'clipboard-list', iconClass: 'info',
        label: 'Observações', value: Number(s?.count || 0),
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
        id: 'fld-date', key: 'note_date', label: 'Data', type: 'date', required: true, requiredMsg: 'Data é obrigatória.',
        render: (rec) => `
          <div class="form-group">
            <label class="form-label">Data *</label>
            <input class="form-input" type="date" id="fld-date" value="${toInputDate(rec.note_date)}">
          </div>`,
      },
      {
        id: 'fld-obs', key: 'observacao', label: 'Observação', type: 'text', required: true, requiredMsg: 'Observação é obrigatória.',
        render: (rec) => `
          <div class="form-group">
            <label class="form-label">Observação *</label>
            <textarea class="form-input" id="fld-obs" rows="4" placeholder="Ex: compra de equipamento de R$ 50 mil enquanto não entra no saldo">${escapeAttr(rec.observacao || '')}</textarea>
          </div>`,
      },
    ],
  });

  return page;
})();
/* ============================================================
   Fechamento Mensal — rotina de conciliação por competência
   ============================================================
   Painel de status: para cada projeto FUNAPE ativo, mostra se
   a competência selecionada já recebeu (a) balancete e (b)
   planilha de bolsas FUNAPE, além do plano de trabalho ativo.

   Importação unificada: um botão abre a ImportQueue com os 3
   handlers (balancete PDF, plano DOCX, bolsas XLSX) — os
   arquivos do mês são arrastados de uma vez e revisados um a
   um (human-in-the-loop).
   ============================================================ */

Router.register('fechamento', {
  title: 'Fechamento Mensal',

  actions(container) {
    const btn = document.createElement('button');
    btn.id = 'fech-import-btn';
    btn.className = 'btn btn--primary btn--sm';
    btn.innerHTML = '<i data-lucide="upload"></i> Importar arquivos do mês';
    btn.addEventListener('click', () => FechamentoPage.onImportClick());
    container.appendChild(btn);
  },

  async render(container) {
    await FechamentoPage.load(container);
  },
});


const FechamentoPage = (() => {

  let containerEl  = null;
  let competencia  = null;   // 'YYYY-MM'
  let projects     = [];     // projetos ativos
  let balSet       = new Set();   // project_ids com balancete na competência
  let reconSet     = new Set();   // project_ids com reconciliação na competência
  let planoSet     = new Set();   // project_ids com plano de trabalho ativo
  let reconError   = null;   // erro ao ler `reconciliacoes` (ex.: migração 031)
  let propostas    = [];     // propostas pendentes do Buriti (mig. 051), best-effort

  // Competência default = mês anterior (o fechamento cuida do mês que passou).
  function defaultCompetencia() {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function monthBounds(ym) {
    const [y, m] = ym.split('-').map(Number);
    const start = `${ym}-01`;
    const end   = `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    return { start, end };
  }

  async function load(container) {
    containerEl = container;
    if (!competencia) competencia = defaultCompetencia();
    await refresh();
  }

  async function refresh() {
    containerEl.innerHTML = '<div class="skeleton skeleton--card" style="height:280px;"></div>';
    const { start, end } = monthBounds(competencia);

    const [projRes, balRes, planoRes, reconRes, propRes] = await Promise.all([
      supabaseClient.from('projects').select('id, name, code, active').order('name'),
      supabaseClient.from('balancetes').select('project_id, data_referencia')
        .gte('data_referencia', start).lte('data_referencia', end),
      supabaseClient.from('planos_trabalho').select('project_id').eq('ativo', true),
      supabaseClient.from('reconciliacoes').select('project_id, competencia').eq('competencia', start),
      supabaseClient.from('propostas_agente').select('project_id, tipo').eq('status', 'pendente'),
    ]);

    if (projRes.error) { showToast('Erro ao carregar projetos: ' + projRes.error.message, 'error'); return; }
    if (balRes.error)  { showToast('Erro ao carregar balancetes: ' + balRes.error.message, 'error'); return; }
    if (planoRes.error) { showToast('Erro ao carregar planos: ' + planoRes.error.message, 'error'); return; }

    const all    = projRes.data || [];
    projects     = all.filter(p => p.active !== false);
    balSet       = new Set((balRes.data || []).map(r => r.project_id));
    planoSet     = new Set((planoRes.data || []).map(r => r.project_id));

    // `reconciliacoes` pode não existir ainda (migração 031 pendente).
    if (reconRes.error) {
      reconError = reconRes.error;
      reconSet = new Set();
    } else {
      reconError = null;
      reconSet = new Set((reconRes.data || []).map(r => r.project_id));
    }

    // Sem a mig. 051 a tabela não existe: o checklist segue igual, sem o Buriti.
    propostas = propRes.error ? [] : (propRes.data || []);

    renderPage();
  }

  function onCompetenciaChange(value) {
    if (!value) return;
    competencia = value;
    refresh();
  }

  function statusBadge(ok, okLabel, pendLabel) {
    return ok
      ? `<span class="badge badge--active" style="display:inline-flex;align-items:center;gap:4px;"><i data-lucide="check" style="width:12px;height:12px;"></i> ${okLabel}</span>`
      : `<span class="badge badge--warning" style="display:inline-flex;align-items:center;gap:4px;"><i data-lucide="clock" style="width:12px;height:12px;"></i> ${pendLabel}</span>`;
  }

  function renderPage() {
    const total     = projects.length;
    const balOk     = projects.filter(p => balSet.has(p.id)).length;
    const reconOk   = projects.filter(p => reconSet.has(p.id)).length;
    const completos = projects.filter(p => balSet.has(p.id) && reconSet.has(p.id)).length;

    const reconWarnHTML = reconError ? `
      <div class="alert-banner alert-banner--warning" style="margin-bottom:var(--sp-3);">
        <i data-lucide="alert-triangle" class="alert-banner__icon"></i>
        <div class="alert-banner__body">
          <strong>Status das bolsas indisponível</strong>
          <div style="font-size:0.85rem;color:var(--text-secondary);">
            ${detalheTecnico('Execute a migração <code>031_reconciliacoes.sql</code> no Supabase para registrar as reconciliações de bolsas por competência.')}
          </div>
        </div>
      </div>` : '';

    const rowsHTML = projects.map(p => {
      const done = balSet.has(p.id) && reconSet.has(p.id);
      return `
        <tr style="${done ? 'opacity:0.75;' : ''}">
          <td style="font-weight:500;">${escapeAttr(p.name)}${p.code ? ` <span style="color:var(--text-muted);font-size:0.8rem;">${escapeAttr(p.code)}</span>` : ''}</td>
          <td style="text-align:center;">${planoSet.has(p.id)
            ? '<span class="badge badge--active">Ativo</span>'
            : '<span class="badge badge--ended" title="Nenhum plano de trabalho ativo — importe o DOCX">—</span>'}</td>
          <td style="text-align:center;">${statusBadge(balSet.has(p.id), 'Recebido', 'Pendente')}${
            propostas.some(x => x.project_id === p.id && x.tipo === 'balancete')
              ? `<div style="margin-top:4px;"><button class="btn btn--ghost btn--sm" onclick="Router.navigate('buriti')" title="O Buriti já conferiu um balancete deste projeto e espera revisão"><i data-lucide="palmtree" style="width:14px;height:14px;"></i> proposta</button></div>`
              : ''}</td>
          <td style="text-align:center;">${statusBadge(reconSet.has(p.id), 'Conferida', 'Pendente')}</td>
        </tr>`;
    }).join('');

    const tableHTML = total === 0
      ? `<div class="empty-state" style="padding:var(--sp-6);">
           <i data-lucide="folder-x" class="empty-state__icon"></i>
           <h3 class="empty-state__title">Nenhum projeto ativo</h3>
           <p class="empty-state__text">Cadastre ou ative projetos em Gestão de Projetos para acompanhá-los aqui.</p>
         </div>`
      : `<div class="data-table-wrapper">
           <table class="data-table">
             <thead>
               <tr>
                 <th>Projeto</th>
                 <th style="text-align:center;">Plano de Trabalho</th>
                 <th style="text-align:center;">Balancete</th>
                 <th style="text-align:center;">Planilha de Bolsas</th>
               </tr>
             </thead>
             <tbody>${rowsHTML}</tbody>
           </table>
         </div>`;

    const buritiHTML = propostas.length === 0 ? '' : `
      <div class="alert-banner alert-banner--info" style="margin-bottom:var(--sp-3);">
        <i data-lucide="palmtree" class="alert-banner__icon"></i>
        <div class="alert-banner__body" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <span><strong>${propostas.length} proposta(s) do Buriti</strong> esperando revisão.</span>
          <button class="btn btn--primary btn--sm" onclick="Router.navigate('buriti')">Abrir caixa do Buriti</button>
        </div>
      </div>`;

    containerEl.innerHTML = `
      ${reconWarnHTML}
      ${buritiHTML}

      <div style="display:flex;gap:16px;align-items:end;flex-wrap:wrap;margin-bottom:var(--sp-4);">
        <div class="form-group" style="margin:0;">
          <label class="form-label">Competência</label>
          <input type="month" class="form-input" id="fech-competencia" value="${competencia}"
            onchange="FechamentoPage.onCompetenciaChange(this.value)">
        </div>
        <div style="flex:1;"></div>
        <button class="btn btn--primary" onclick="FechamentoPage.onImportClick()">
          <i data-lucide="upload" style="width:16px;height:16px;"></i>
          Importar arquivos do mês
        </button>
      </div>

      <div class="stats-grid fade-in" style="margin-bottom:var(--sp-4);">
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--${completos === total && total > 0 ? 'success' : 'info'}">
            <i data-lucide="calendar-check"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Projetos fechados</div>
            <div class="stat-card__value">${completos} / ${total}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--${balOk === total && total > 0 ? 'success' : 'warning'}">
            <i data-lucide="file-stack"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Balancetes</div>
            <div class="stat-card__value">${balOk} / ${total}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--${reconOk === total && total > 0 ? 'success' : 'warning'}">
            <i data-lucide="file-spreadsheet"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Planilhas de bolsas</div>
            <div class="stat-card__value">${reconOk} / ${total}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--info">
            <i data-lucide="layers"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Planos ativos</div>
            <div class="stat-card__value">${projects.filter(p => planoSet.has(p.id)).length} / ${total}</div>
          </div>
        </div>
      </div>

      <div class="card fade-in">
        <div class="card__header">
          <div>
            <h3 class="card__title">Checklist da competência ${competencia.split('-').reverse().join('/')}</h3>
            <p class="card__subtitle">
              Arraste os PDFs (balancetes), DOCX (planos/remanejamentos) e XLSX (bolsas FUNAPE) de uma vez —
              cada arquivo é identificado pelo tipo e revisado antes de entrar no sistema.
            </p>
          </div>
        </div>
        ${tableHTML}
      </div>
    `;
    lucide.createIcons();
  }

  async function onImportClick() {
    let handlers;
    try {
      const pt    = await PlanoTrabalhoPage.getImportHandlers();
      const bolsa = await HoldersPage.getBolsaImportHandler({ defaultCompetencia: competencia });
      handlers = [pt.balancete, pt.plano, bolsa];
    } catch (e) {
      showToast(e.message, 'error');
      return;
    }
    ImportQueue.open({
      title: 'Fechamento mensal — importar arquivos',
      handlers,
      onFinished: (summary) => { if (summary.saved) refresh(); },
    });
  }

  return { load, refresh, onCompetenciaChange, onImportClick };
})();

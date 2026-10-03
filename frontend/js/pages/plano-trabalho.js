/* ============================================================
   Plano de Trabalho Page — orçamento previsto por rubrica
   Suporta upload de DOCX (plano original ou remanejamento)
   com extração via Edge Function (Ollama Cloud).
   ============================================================ */

Router.register('plano-trabalho', {
  title: 'Plano de Trabalho',

  actions(container) {
    const btn = document.createElement('button');
    btn.id = 'pt-import-btn';
    btn.className = 'btn btn--primary btn--sm';
    btn.innerHTML = '<i data-lucide="upload"></i> Importar plano/remanejamento';
    btn.addEventListener('click', () => PlanoTrabalhoPage.onImportClick());
    container.appendChild(btn);
  },

  async render(container) {
    await PlanoTrabalhoPage.load(container);
  },
});


const PlanoTrabalhoPage = (() => {

  const STORAGE_BUCKET           = 'plano-trabalho-docs';
  const BALANCETE_STORAGE_BUCKET = 'balancete-pdfs';
  const LS_PROJECT_KEY           = 'cf_plano_trabalho_project_id';
  const LS_TAB_KEY               = 'cf_plano_trabalho_tab';

  const TABS = [
    { id: 'orcamento',        label: 'Orçamento',          icon: 'layers' },
    { id: 'balancetes',       label: 'Balancetes',         icon: 'file-stack' },
    { id: 'previsto-real',    label: 'Previsto x Realizado', icon: 'scale' },
  ];

  // Mapa estável de códigos de rubrica → metadados de display.
  const RUBRICAS = [
    { code: 'a',         parent: null, name: 'a — Pessoal',                            ordem: 10 },
    { code: 'a.colab',   parent: 'a',  name: 'Colaboradores eventuais (CLT)',           ordem: 11 },
    { code: 'a.enc',     parent: 'a',  name: 'Encargos s/ CLT',                         ordem: 12 },
    { code: 'a.cons',    parent: 'a',  name: 'Consultorias (STPF-RPA) + Encargos',      ordem: 13 },
    { code: 'a.estag',   parent: 'a',  name: 'Estagiários',                             ordem: 14 },
    { code: 'a.bolsas',  parent: 'a',  name: 'Bolsas',                                  ordem: 15 },
    { code: 'a.outros',  parent: 'a',  name: 'Outros encargos',                         ordem: 16 },
    { code: 'b',         parent: null, name: 'b — Serviços de Terceiros P. Jurídica',   ordem: 20 },
    { code: 'c',         parent: null, name: 'c — Passagens e Despesas com Locomoção',  ordem: 30 },
    { code: 'd',         parent: null, name: 'd — Despesas com diárias',                ordem: 40 },
    { code: 'e',         parent: null, name: 'e — Material de Consumo',                 ordem: 50 },
    { code: 'f',         parent: null, name: 'f — Investimento',                        ordem: 60 },
    { code: 'g',         parent: null, name: 'g — Ganho econômico',                     ordem: 70 },
    { code: 'cip_ufg',   parent: null, name: 'CIP — UFG',                               ordem: 80 },
    { code: 'cip_ua',    parent: null, name: 'CIP — UA/Órgão',                          ordem: 81 },
    { code: 'dao',       parent: null, name: 'D.A.O. da Fundação',                      ordem: 90 },
  ];
  const RUBRICA_BY_CODE = Object.fromEntries(RUBRICAS.map(r => [r.code, r]));

  // Estado.
  let containerEl       = null;
  let allProjects       = [];
  let selectedProjectId = localStorage.getItem(LS_PROJECT_KEY) || null;
  let currentTab        = localStorage.getItem(LS_TAB_KEY) || 'orcamento';
  let viewing           = null;   // plano sendo exibido (default = ativo)
  let historico         = [];
  let balancetes        = [];     // lista de balancetes do projeto
  let prevReal          = null;   // resultado de get_previsto_vs_realizado
  let saldoLivre        = null;   // resultado de get_saldo_livre (compromissos)
  let saldoLivreErro    = null;   // consulta que falhou NUNCA vira zero (ver CLAUDE.md)
  let rubricasAbertas   = {};     // { [rubrica_code]: true } — detalhamento expandido
  let contaRubricaMap   = [];     // [{ conta_prefix, rubrica_code }] — carregado do banco

  /* ── Mapeamento conta → rubrica (espelha resolve_rubrica_for_conta) ── */

  async function loadContaRubricaMap() {
    const { data, error } = await supabaseClient
      .from('conta_rubrica_map')
      .select('conta_prefix, rubrica_code')
      .eq('ativo', true);
    if (error) {
      console.warn('Falha ao carregar conta_rubrica_map:', error.message);
      contaRubricaMap = [];
      return;
    }
    // Ordena por tamanho de prefix descendente para resolver longest-prefix-match em O(n).
    contaRubricaMap = (data || [])
      .slice()
      .sort((a, b) => b.conta_prefix.length - a.conta_prefix.length);
  }

  function resolveRubricaForConta(conta) {
    if (!conta) return null;
    for (const m of contaRubricaMap) {
      if (conta.startsWith(m.conta_prefix)) return m.rubrica_code;
    }
    return null;
  }

  /* ── Carregamento ─────────────────────────────────────────── */

  async function load(container) {
    containerEl = container;
    containerEl.innerHTML = '<div class="skeleton skeleton--card" style="height:200px;"></div>';

    const { data, error } = await supabaseClient
      .from('projects')
      .select('id,name,code,active')
      .order('name', { ascending: true });

    if (error) {
      showToast('Erro ao carregar projetos: ' + error.message, 'error');
      return;
    }
    allProjects = data || [];

    if (selectedProjectId && !allProjects.find(p => p.id === selectedProjectId)) {
      selectedProjectId = null;
    }
    if (!selectedProjectId && allProjects.length > 0) {
      selectedProjectId = allProjects[0].id;
    }

    // Carrega mapeamento conta→rubrica para resolver lançamentos no preview.
    // Falha silenciosa: split-view ainda funciona, lançamentos ficam não-mapeados.
    await loadContaRubricaMap();

    await refresh();
  }

  async function refresh() {
    if (!selectedProjectId) { renderEmpty(); return; }

    // get_saldo_livre entra aqui em vez de a tela recalcular compromisso:
    // a conta mora na migração 038 e é a mesma que o Dashboard, o MCP e o
    // Assistente leem. Segunda implementação divergiria em silêncio.
    const [ativoRes, histRes, balRes, prevRes, livreRes] = await Promise.all([
      supabaseClient.rpc('get_plano_ativo',           { p_project_id: selectedProjectId }),
      supabaseClient.rpc('get_planos_historico',      { p_project_id: selectedProjectId }),
      supabaseClient.rpc('get_balancetes_by_project', { p_project_id: selectedProjectId }),
      supabaseClient.rpc('get_previsto_vs_realizado', { p_project_id: selectedProjectId }),
      supabaseClient.rpc('get_saldo_livre',           { p_project_id: selectedProjectId }),
    ]);

    if (ativoRes.error) { showToast('Erro: ' + ativoRes.error.message, 'error'); return; }
    if (histRes.error)  { showToast('Erro: ' + histRes.error.message,  'error'); return; }
    if (balRes.error)   { showToast('Erro: ' + balRes.error.message,   'error'); return; }
    if (prevRes.error)  { showToast('Erro: ' + prevRes.error.message,  'error'); return; }

    viewing    = ativoRes.data || null;
    historico  = histRes.data  || [];
    balancetes = balRes.data   || [];
    prevReal   = prevRes.data  || null;

    // Falha aqui não derruba a aba: sem compromisso ela ainda informa
    // previsto x realizado. Mas também não vira zero — a tela diz que
    // não conseguiu perguntar, em vez de exibir "nada comprometido".
    saldoLivre     = livreRes.error ? null : (livreRes.data || null);
    saldoLivreErro = livreRes.error ? (livreRes.error.message || 'falha ao consultar') : null;

    renderPage();
  }

  function switchTab(tab) {
    if (!TABS.find(t => t.id === tab)) return;
    currentTab = tab;
    localStorage.setItem(LS_TAB_KEY, currentTab);
    renderPage();
  }

  function onImportClick() {
    if (currentTab === 'balancetes' || currentTab === 'previsto-real') {
      return openQueue(BALANCETE_HANDLER);
    }
    return openQueue(PLANO_HANDLER);
  }

  // Abre a fila genérica (ImportQueue) com os dois handlers da página, o da
  // aba atual primeiro. Ambos precisam estar na fila para o roteamento por
  // conteúdo funcionar: um PDF que é plano (e não balancete) só consegue ser
  // reentregue ao PLANO_HANDLER se ele estiver presente.
  function openQueue(preferred) {
    if (allProjects.length === 0) {
      showToast('Cadastre um projeto antes de importar.', 'error');
      return;
    }
    const handlers = preferred === BALANCETE_HANDLER
      ? [BALANCETE_HANDLER, PLANO_HANDLER]
      : [PLANO_HANDLER, BALANCETE_HANDLER];
    ImportQueue.open({
      title: preferred.title,
      handlers,
      onFinished: async (summary) => {
        if (!summary.saved) return;
        if (summary.newMappings > 0) await loadContaRubricaMap();
        refresh();
      },
    });
  }

  /**
   * Contexto para uso dos handlers fora desta página (Fechamento Mensal):
   * garante projetos + mapeamento conta→rubrica carregados e devolve os
   * handlers de plano (DOCX) e balancete (PDF).
   */
  async function getImportHandlers() {
    if (allProjects.length === 0) {
      const { data, error } = await supabaseClient
        .from('projects')
        .select('id,name,code,active')
        .order('name', { ascending: true });
      if (error) throw new Error('Erro ao carregar projetos: ' + error.message);
      allProjects = data || [];
      if (allProjects.length === 0) throw new Error('Cadastre um projeto antes de importar.');
      if (!selectedProjectId || !allProjects.find(p => p.id === selectedProjectId)) {
        selectedProjectId = allProjects[0].id;
      }
    }
    if (contaRubricaMap.length === 0) await loadContaRubricaMap();
    return { plano: PLANO_HANDLER, balancete: BALANCETE_HANDLER };
  }

  function updateActionButton() {
    const btn = document.getElementById('pt-import-btn');
    if (!btn) return;
    if (currentTab === 'balancetes') {
      btn.innerHTML = '<i data-lucide="upload"></i> Importar balancete (PDF)';
    } else if (currentTab === 'previsto-real') {
      btn.innerHTML = '<i data-lucide="upload"></i> Importar balancete (PDF)';
    } else {
      btn.innerHTML = '<i data-lucide="upload"></i> Importar plano/remanejamento';
    }
    lucide.createIcons({ nodes: [btn] });
  }

  function onProjectChange() {
    const sel = document.getElementById('pt-project-sel');
    selectedProjectId = sel.value || null;
    if (selectedProjectId) {
      localStorage.setItem(LS_PROJECT_KEY, selectedProjectId);
    } else {
      localStorage.removeItem(LS_PROJECT_KEY);
    }
    refresh();
  }

  /* ── Render ───────────────────────────────────────────────── */

  function renderEmpty() {
    const isAdminUser = typeof Auth !== 'undefined' && Auth.isAdmin();
    containerEl.innerHTML = `
      <div class="empty-state">
        <i data-lucide="${isAdminUser ? 'folder-x' : 'folder-plus'}" class="empty-state__icon"></i>
        <h3 class="empty-state__title">${isAdminUser ? 'Nenhum projeto cadastrado' : 'Nenhum centro de custo vinculado'}</h3>
        <p class="empty-state__text">${isAdminUser
          ? 'Cadastre um projeto em Gestão de Projetos antes de importar planos.'
          : 'Crie um novo na aba <strong>Gestão de Projetos</strong>, ou peça ao administrador para atribuir um existente.'}</p>
      </div>`;
    lucide.createIcons();
  }

  function projectSelectorHTML() {
    return `
      <div class="form-group" style="margin:0;min-width:280px;flex:1;max-width:520px;">
        <label class="form-label">Projeto</label>
        <select id="pt-project-sel" class="form-input" onchange="PlanoTrabalhoPage.onProjectChange()">
          ${allProjects.map(p => `
            <option value="${p.id}" ${p.id === selectedProjectId ? 'selected' : ''}>
              ${escapeAttr(p.name)}${p.code ? ' — ' + escapeAttr(p.code) : ''}${p.active === false ? ' [inativo]' : ''}
            </option>`).join('')}
        </select>
      </div>`;
  }

  function renderPage() {
    let tabContent;
    if (currentTab === 'balancetes')         tabContent = renderBalancetesTab();
    else if (currentTab === 'previsto-real') tabContent = renderPrevistoRealTab();
    else                                     tabContent = renderOrcamentoTab();

    containerEl.innerHTML = `
      <div style="display:flex;gap:16px;align-items:end;flex-wrap:wrap;margin-bottom:16px;">
        ${projectSelectorHTML()}
      </div>

      <div class="tabs" style="display:flex;gap:4px;border-bottom:1px solid var(--border-color);margin-bottom:24px;">
        ${TABS.map(t => `
          <button class="tab-btn ${t.id === currentTab ? 'tab-btn--active' : ''}"
                  onclick="PlanoTrabalhoPage.switchTab('${t.id}')"
                  style="background:${t.id === currentTab ? 'var(--bg-elevated)' : 'transparent'};
                         border:none;border-bottom:2px solid ${t.id === currentTab ? 'var(--accent)' : 'transparent'};
                         padding:10px 16px;cursor:pointer;color:${t.id === currentTab ? 'var(--text-primary)' : 'var(--text-secondary)'};
                         font-weight:${t.id === currentTab ? '600' : '500'};display:flex;align-items:center;gap:6px;">
            <i data-lucide="${t.icon}"></i> ${t.label}
          </button>`).join('')}
      </div>

      <div class="tab-content fade-in">${tabContent}</div>
    `;
    lucide.createIcons();
    updateActionButton();
  }

  /* ── Tab: Orçamento ──────────────────────────────────────── */

  function renderOrcamentoTab() {
    if (!viewing) {
      return `
        <div class="empty-state">
          <i data-lucide="file-plus-2" class="empty-state__icon"></i>
          <h3 class="empty-state__title">Sem plano de trabalho</h3>
          <p class="empty-state__text">Este projeto ainda não tem um plano importado. Clique em "Importar plano/remanejamento" no topo.</p>
        </div>`;
    }

    const v = viewing;
    const rubricas    = Array.isArray(v.rubricas)    ? v.rubricas    : [];
    const desembolsos = Array.isArray(v.desembolsos) ? v.desembolsos : [];

    return `
      <div style="display:flex;gap:8px;align-items:center;color:var(--text-secondary);font-size:14px;margin-bottom:16px;">
        <i data-lucide="info"></i>
        <span>Visualizando versão <strong>${v.versao}</strong> ${v.ativo ? '(ativa)' : '(histórico)'}</span>
      </div>

      <div class="stats-grid" style="margin-bottom:24px;">
        ${kpiCard('Total do plano',         v.valor_total_plano,      'wallet',    'success')}
        ${kpiCard('Despesas do projeto',    v.valor_despesas_projeto, 'list',      'info')}
        ${kpiCard('CIP',                    v.valor_cip,              'building',  'warning')}
        ${kpiCard('DAO',                    v.valor_dao,              'briefcase', 'warning')}
      </div>

      <div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(280px,1fr);gap:24px;">
        <div>
          ${renderRubricasCard(rubricas)}
          ${renderDesembolsosCard(desembolsos)}
          ${renderMetadataCard(v)}
        </div>
        <div>
          ${renderHistoricoCard()}
        </div>
      </div>`;
  }

  function kpiCard(label, value, icon, color) {
    const display = value == null ? '—' : formatBRL(value);
    return `
      <div class="stat-card">
        <div class="stat-card__icon stat-card__icon--${color}">
          <i data-lucide="${icon}"></i>
        </div>
        <div class="stat-card__body">
          <span class="stat-card__label">${label}</span>
          <span class="stat-card__value">${display}</span>
        </div>
      </div>`;
  }

  /* ── Tab: Balancetes ─────────────────────────────────────── */

  function renderBalancetesTab() {
    const intro = `<p style="color:var(--text-secondary);margin-bottom:16px;">
           Importe o balancete mensal da FUNAPE em PDF. Os gastos por rubrica são extraídos e cruzados com o orçamento do plano ativo.
         </p>`;

    if (balancetes.length === 0) {
      return `
        ${intro}
        <div class="empty-state">
          <i data-lucide="file-plus-2" class="empty-state__icon"></i>
          <h3 class="empty-state__title">Nenhum balancete importado</h3>
          <p class="empty-state__text">Use o botão "Importar balancete (PDF)" no topo para enviar o primeiro.</p>
        </div>`;
    }

    const rows = balancetes.map(b => `
      <tr>
        <td>${formatDate(b.data_referencia)}</td>
        <td>${b.data_emissao ? formatDate(b.data_emissao) : '—'}</td>
        <td style="text-align:right;" class="currency">${formatBRL(b.saldo_disponivel)}</td>
        <td style="text-align:right;color:var(--text-secondary);" class="currency">${formatBRL(b.rendimento_liquido)}</td>
        <td style="text-align:right;" class="currency">${formatBRL(b.total_debitos)}</td>
        <td>
          <div style="display:flex;gap:4px;flex-wrap:wrap;">
            <button class="btn btn--ghost btn--sm" onclick="PlanoTrabalhoPage.verBalancete('${escapeAttrJs(b.id)}')" title="Detalhes">
              <i data-lucide="eye"></i>
            </button>
            ${b.arquivo_nome ? `
              <button class="btn btn--ghost btn--sm" onclick="PlanoTrabalhoPage.baixarBalancete('${escapeAttrJs(b.id)}')" title="Baixar PDF original">
                <i data-lucide="download"></i>
              </button>` : ''}
            <button class="btn btn--ghost btn--sm" onclick="PlanoTrabalhoPage.excluirBalancete('${escapeAttrJs(b.id)}')" title="Excluir" style="color:var(--danger);">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </td>
      </tr>`).join('');

    return `
      ${intro}
      <div class="card">
        <h3 class="card__title"><i data-lucide="file-stack"></i> Balancetes importados</h3>
        <div style="overflow-x:auto;">
          <table class="data-table" style="width:100%;">
            <thead>
              <tr>
                <th style="text-align:left;">Data referência</th>
                <th style="text-align:left;">Emissão</th>
                <th style="text-align:right;">Saldo disponível</th>
                <th style="text-align:right;">Rendimento</th>
                <th style="text-align:right;">Total débitos</th>
                <th style="width:140px;">Ações</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  /* ── Tab: Previsto x Realizado ───────────────────────────── */

  /**
   * A linha expandida de uma rubrica: de onde vem o previsto (linhas do
   * plano) e de onde vem o realizado (contas do balancete).
   *
   * O bloco de contas não é enfeite — é auditoria. Foi exatamente a sua
   * ausência que deixou "PASSAGENS E DESPESAS COM LOCOMOÇÃO" somar dentro de
   * Serviços de Terceiros por meses sem ninguém ver: número agregado não se
   * confere, número com a conta ao lado sim (ver migração 047).
   */
  function renderDetalheRubrica(r, detalhes, contas, temCompromisso) {
    const somaDet = detalhes.reduce((acc, d) => acc + Number(d.previsto || 0), 0);
    // O plano pode ter linha sem descrição: ela soma no total da rubrica mas
    // não vira item. Declarar o resto evita a subtração silenciosa.
    const restoSemDescricao = Number(r.previsto || 0) - somaDet;

    const linhaDet = (rotulo, valor) => `
      <div style="display:flex;justify-content:space-between;gap:16px;padding:3px 0;border-bottom:1px solid var(--border-subtle);">
        <span>${rotulo}</span>
        <span class="currency" style="white-space:nowrap;">${formatBRL(valor)}</span>
      </div>`;

    const secao = (titulo, cor, corpo) => `
      <div style="margin-bottom:12px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:${cor};margin-bottom:4px;">${titulo}</div>
        ${corpo}
      </div>`;

    // Por item (mig. 053): previsto, realizado e saldo de cada linha do plano,
    // no formato da tabela que vai para o professor. Antes da 053 os itens
    // não trazem `realizado` e a tela cai no bloco antigo, só com o previsto.
    const temRealizadoPorItem = detalhes.some(d => d.realizado !== undefined);
    if (temRealizadoPorItem) {
      const semItem = Number(r.realizado_sem_item || 0);
      const semDescricao = Number(r.previsto_sem_descricao || 0);
      // Blocos em vez de tabela: nome do item numa linha, os três números
      // embaixo — cabe no celular, onde a tabela de rubricas já é larga.
      const linhaItem = (rotulo, prev, real, extraStyle = '') => {
        const saldo = prev == null ? null : prev - real;
        return `
          <div class="pxr-item" style="${extraStyle}">
            <div class="pxr-item__nome">${rotulo}</div>
            <div class="pxr-item__nums">
              <span><small>Previsto</small>${prev == null ? '—' : formatBRL(prev)}</span>
              <span><small>Já gasto</small>${formatBRL(real)}</span>
              <span class="pxr-item__saldo ${saldo != null && saldo < 0 ? 'pxr-item__saldo--neg' : ''}"><small>Saldo</small>${saldo == null ? '—' : formatBRL(saldo)}</span>
            </div>
          </div>`;
      };
      const linhas = detalhes.map(d => linhaItem(escapeAttr(d.descricao), Number(d.previsto || 0), Number(d.realizado || 0))).join('') +
        (semItem !== 0
          ? linhaItem('<em>Sem item atribuído</em> <span style="font-size:11px;">— classifique na revisão do próximo balancete</span>', null, semItem, 'color:var(--warning);')
          : '') +
        (semDescricao > 0.005
          ? linhaItem('<em>Sem descrição no plano</em>', semDescricao, 0, 'color:var(--text-secondary);')
          : '');
      const blocoItens = secao('Por item do plano', 'var(--text-secondary)', `<div class="pxr-itens">${linhas}</div>`);
      const blocoContas = contas.length === 0 ? '' : `
        <details style="margin-bottom:12px;">
          <summary style="cursor:pointer;font-size:12px;color:var(--text-secondary);">Contas do balancete que compõem esta rubrica (${contas.length})</summary>
          ${contas.map(c => linhaDet(
            `<code style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);">${escapeAttr(c.conta_codigo)}</code>&nbsp;${escapeAttr(c.conta_descricao || '—')}` +
            (c.item ? ` <span style="color:var(--text-secondary);font-size:11px;">› ${escapeAttr(c.item)}</span>` : ''),
            c.realizado
          )).join('')}
        </details>`;
      const bolsasI = (saldoLivre && Array.isArray(saldoLivre.bolsas_ativas)) ? saldoLivre.bolsas_ativas : [];
      const blocoCompromissoI = (!temCompromisso || bolsasI.length === 0) ? '' : secao(
        `Compromissos até ${formatDate(saldoLivre.compromissos_fim)} — já contratados`,
        'var(--warning)',
        bolsasI.map(b => linhaDet(
          `${escapeAttr(b.bolsista)} <span style="color:var(--text-secondary);">— ${b.meses} × ${formatBRL(b.valor_mensal)}</span>`,
          b.compromisso
        )).join('')
      );
      return `
        <tr>
          <td colspan="5" class="pxr-detalhe" style="background:var(--bg-elevated);font-size:13px;">
            ${blocoItens}${blocoContas}${blocoCompromissoI}
          </td>
        </tr>`;
    }

    const blocoPrevisto = detalhes.length === 0 ? '' : secao(
      'Previsto — linhas do plano', 'var(--text-secondary)',
      detalhes.map(d => linhaDet(escapeAttr(d.descricao), d.previsto)).join('') +
      (restoSemDescricao > 0.005
        ? `<div style="display:flex;justify-content:space-between;gap:16px;padding:3px 0;color:var(--text-secondary);font-style:italic;">
             <span>Sem descrição no plano</span>
             <span class="currency" style="white-space:nowrap;">${formatBRL(restoSemDescricao)}</span>
           </div>`
        : '')
    );

    const blocoRealizado = contas.length === 0 ? '' : secao(
      'Realizado — contas do balancete', 'var(--text-secondary)',
      contas.map(c => linhaDet(
        `<code style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);">${escapeAttr(c.conta_codigo)}</code>&nbsp;${escapeAttr(c.conta_descricao || '—')}`,
        c.realizado
      )).join('')
    );

    const bolsas = (saldoLivre && Array.isArray(saldoLivre.bolsas_ativas))
      ? saldoLivre.bolsas_ativas : [];
    const blocoCompromisso = (!temCompromisso || bolsas.length === 0) ? '' : secao(
      `Compromissos até ${formatDate(saldoLivre.compromissos_fim)} — já contratados`,
      'var(--warning)',
      bolsas.map(b => linhaDet(
        `${escapeAttr(b.bolsista)} <span style="color:var(--text-secondary);">— ${b.meses} × ${formatBRL(b.valor_mensal)}</span>`,
        b.compromisso
      )).join('')
    );

    return `
      <tr>
        <td colspan="5" style="background:var(--bg-elevated);padding:12px 16px 12px 40px;font-size:13px;">
          ${blocoPrevisto}${blocoRealizado}${blocoCompromisso}
        </td>
      </tr>`;
  }

  function toggleRubrica(code) {
    rubricasAbertas[code] = !rubricasAbertas[code];
    renderPage();
  }

  function renderPrevistoRealTab() {
    if (!prevReal || prevReal.has_plano === false) {
      return `
        <div class="empty-state">
          <i data-lucide="file-x" class="empty-state__icon"></i>
          <h3 class="empty-state__title">Sem plano de trabalho ativo</h3>
          <p class="empty-state__text">Importe um plano na aba "Orçamento" antes de comparar com o realizado.</p>
        </div>`;
    }
    if (!prevReal.has_balancete) {
      return `
        <div class="empty-state">
          <i data-lucide="file-plus-2" class="empty-state__icon"></i>
          <h3 class="empty-state__title">Sem balancete importado</h3>
          <p class="empty-state__text">Importe o balancete da FUNAPE na aba "Balancetes" para ver Previsto x Realizado.</p>
        </div>`;
    }

    const rubricasArr = Array.isArray(prevReal.rubricas) ? prevReal.rubricas : [];
    const naoMapeados = Array.isArray(prevReal.nao_mapeados) ? prevReal.nao_mapeados : [];

    // Calcula totais gerais
    let somaPrev = 0, somaReal = 0;
    rubricasArr.forEach(r => {
      somaPrev += Number(r.previsto || 0);
      somaReal += Number(r.realizado || 0);
    });

    const totalDespesasNM = naoMapeados.reduce((s, x) => s + Number(x.saldo_atual || 0), 0);

    // Compromissos por rubrica, vindos de get_saldo_livre (mig. 038). A tela
    // não soma nada: só indexa o que a RPC devolveu. A conta de compromisso
    // mora no banco e é a mesma que o Dashboard, o MCP e o Assistente leem.
    const compromissoPorRubrica = {};
    if (saldoLivre && Array.isArray(saldoLivre.rubricas)) {
      saldoLivre.rubricas.forEach(x => {
        compromissoPorRubrica[x.rubrica_code] = {
          compromissos: Number(x.compromissos || 0),
          saldoLivre:   Number(x.saldo_livre  || 0),
        };
      });
    }

    const rubricaRows = rubricasArr.map(r => {
      const perc = r.perc_executado;
      const saldo = Number(r.saldo || 0);
      const isOverbudget = saldo < 0;
      const percColor = perc == null ? 'var(--text-secondary)'
                        : perc > 100 ? 'var(--danger)'
                        : perc > 90  ? 'var(--warning)'
                        : 'var(--success)';

      // `detalhes`/`contas` só existem a partir da migração 047. Ausentes, a
      // linha renderiza como sempre — o frontend é publicado ANTES de a
      // migração rodar e não pode quebrar no intervalo.
      const detalhes = Array.isArray(r.detalhes) ? r.detalhes : [];
      const contas   = Array.isArray(r.contas)   ? r.contas   : [];
      const temDetalhe = detalhes.length > 0 || contas.length > 0;
      const aberta = !!rubricasAbertas[r.rubrica_code];

      const comp = compromissoPorRubrica[r.rubrica_code];
      const temCompromisso = !!comp && comp.compromissos > 0;

      const nomeCell = temDetalhe
        ? `<button class="btn btn--ghost btn--sm" style="padding:0 6px;margin-right:4px;"
             onclick="PlanoTrabalhoPage.toggleRubrica('${escapeAttrJs(r.rubrica_code)}')"
             title="${aberta ? 'Recolher' : 'Ver detalhamento'}" aria-expanded="${aberta}"
           ><i data-lucide="${aberta ? 'chevron-down' : 'chevron-right'}"></i></button>${escapeAttr(r.rubrica_name)}`
        : escapeAttr(r.rubrica_name);

      // Saldo de rubrica com bolsa contratada NÃO é dinheiro livre. Mostrar só
      // o saldo é o que fazia "R$ 175.000" parecer disponível quando o que
      // sobrava, descontado o já contratado, era bem menos.
      const saldoCell = temCompromisso
        ? `${formatBRL(saldo)}
           <div style="font-size:11px;font-weight:400;color:var(--warning);line-height:1.35;margin-top:2px;">
             −${formatBRL(comp.compromissos)} comprometido<br>
             <strong>livre ${formatBRL(comp.saldoLivre)}</strong>
           </div>`
        : formatBRL(saldo);

      const linhaPrincipal = `
        <tr>
          <td style="${r.parent_code ? 'padding-left:24px;color:var(--text-secondary);' : 'font-weight:600;'}">${nomeCell}</td>
          <td style="text-align:right;" class="currency">${formatBRL(r.previsto)}</td>
          <td style="text-align:right;" class="currency">${formatBRL(r.realizado)}</td>
          <td style="text-align:right;color:${isOverbudget ? 'var(--danger)' : 'var(--text-primary)'};" class="currency">${saldoCell}</td>
          <td style="text-align:right;color:${percColor};font-weight:500;">${perc == null ? '—' : perc.toFixed(1) + '%'}</td>
        </tr>`;

      if (!temDetalhe || !aberta) return linhaPrincipal;
      return linhaPrincipal + renderDetalheRubrica(r, detalhes, contas, temCompromisso);
    }).join('');

    const avisoCompromisso = !saldoLivreErro ? '' : `
      <div class="card" style="margin-bottom:16px;border-left:3px solid var(--warning);">
        <p style="margin:0;color:var(--text-secondary);font-size:13px;">
          <i data-lucide="alert-triangle"></i>
          Não foi possível consultar os compromissos já assumidos (bolsas contratadas).
          Os saldos abaixo são <strong>previsto − realizado</strong> e não descontam nada.
        </p>
      </div>`;

    const naoMapeadosCard = naoMapeados.length === 0 ? '' : `
      <div class="card" style="margin-top:16px;">
        <h3 class="card__title"><i data-lucide="alert-circle"></i> Lançamentos não mapeados (${formatBRL(totalDespesasNM)})</h3>
        <p style="color:var(--text-secondary);font-size:13px;margin-bottom:8px;">
          Contas de despesa sem rubrica do plano. Valor negativo é estorno da FUNAPE
          (recuperação de despesa) ainda sem regra — o gasto que ele desfaz continua contado.
          Configure mapeamentos em <code>conta_rubrica_map</code> se quiser incluí-las.
        </p>
        <table class="data-table" style="width:100%;">
          <thead>
            <tr>
              <th style="text-align:left;width:200px;">Conta</th>
              <th style="text-align:left;">Descrição</th>
              <th style="text-align:right;width:140px;">Realizado</th>
            </tr>
          </thead>
          <tbody>
            ${naoMapeados.map(n => `
              <tr>
                <td style="font-family:var(--font-mono);font-size:13px;color:var(--text-secondary);">${escapeAttr(n.conta_codigo)}</td>
                <td>${escapeAttr(n.conta_descricao || '—')}</td>
                <td style="text-align:right;" class="currency">${formatBRL(n.saldo_atual)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    return `
      <div style="display:flex;gap:8px;align-items:center;color:var(--text-secondary);font-size:14px;margin-bottom:16px;">
        <i data-lucide="info"></i>
        <span>Balancete de <strong>${formatDate(prevReal.data_referencia)}</strong></span>
      </div>

      ${avisoCompromisso}

      <div class="stats-grid" style="margin-bottom:24px;">
        ${kpiCard('Saldo disponível (PÓS IR/IOF)', prevReal.saldo_disponivel,   'wallet',     'success')}
        ${kpiCard('Rendimento líquido',            prevReal.rendimento_liquido, 'trending-up','info')}
        ${kpiCard('Previsto total',                somaPrev,                    'target',     'info')}
        ${kpiCard('Realizado total',               somaReal,                    'activity',   'warning')}
      </div>

      <div class="card">
        <h3 class="card__title"><i data-lucide="scale"></i> Por rubrica</h3>
        <div style="overflow-x:auto;">
          <table class="data-table" style="width:100%;">
            <thead>
              <tr>
                <th style="text-align:left;">Rubrica</th>
                <th style="text-align:right;">Previsto</th>
                <th style="text-align:right;">Realizado</th>
                <th style="text-align:right;">Saldo</th>
                <th style="text-align:right;">% Executado</th>
              </tr>
            </thead>
            <tbody>${rubricaRows}</tbody>
            <tfoot>
              <tr style="background:var(--bg-elevated);font-weight:600;">
                <td>Total</td>
                <td style="text-align:right;" class="currency">${formatBRL(somaPrev)}</td>
                <td style="text-align:right;" class="currency">${formatBRL(somaReal)}</td>
                <td style="text-align:right;" class="currency">${formatBRL(somaPrev - somaReal)}</td>
                <td style="text-align:right;">${somaPrev > 0 ? ((somaReal / somaPrev) * 100).toFixed(1) + '%' : '—'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      ${naoMapeadosCard}`;
  }

  function renderRubricasCard(rubricas) {
    if (rubricas.length === 0) {
      return `
        <div class="card" style="margin-bottom:16px;">
          <h3 class="card__title"><i data-lucide="layers"></i> Rubricas (Plano de Aplicação)</h3>
          <p style="color:var(--text-secondary);">Nenhuma rubrica registrada nesta versão.</p>
        </div>`;
    }

    // Agrupa por rubrica top-level (com sub-itens).
    const grouped = {};
    rubricas.forEach(r => {
      const meta = RUBRICA_BY_CODE[r.rubrica_code];
      if (!meta) return;
      const top = meta.parent || r.rubrica_code;
      if (!grouped[top]) grouped[top] = { items: [], total: 0 };
      grouped[top].items.push(r);
      grouped[top].total += Number(r.valor_previsto || 0);
    });

    const ordemTop = ['a','b','c','d','e','f','g','cip_ufg','cip_ua','dao'];

    let rows = '';
    ordemTop.forEach(topCode => {
      const g = grouped[topCode];
      if (!g) return;
      const meta = RUBRICA_BY_CODE[topCode];
      rows += `
        <tr style="background:var(--bg-elevated);">
          <td style="font-weight:600;color:var(--text-primary);">${escapeAttr(meta.name)}</td>
          <td style="text-align:right;font-weight:600;" class="currency">${formatBRL(g.total)}</td>
        </tr>`;
      g.items
        .sort((a,b) => (RUBRICA_BY_CODE[a.rubrica_code]?.ordem || 999) - (RUBRICA_BY_CODE[b.rubrica_code]?.ordem || 999))
        .forEach(item => {
          const sub = RUBRICA_BY_CODE[item.rubrica_code];
          const isTopOnly = sub.parent == null && (g.items.length === 1) && !item.descricao_livre;
          if (isTopOnly) return; // a linha-total já mostra; não duplica
          const subLabel = sub.parent
            ? sub.name
            : (item.descricao_livre || sub.name);
          rows += `
            <tr>
              <td style="padding-left:24px;color:var(--text-secondary);">${escapeAttr(subLabel)}</td>
              <td style="text-align:right;" class="currency">${formatBRL(item.valor_previsto)}</td>
            </tr>`;
        });
    });

    return `
      <div class="card" style="margin-bottom:16px;">
        <h3 class="card__title"><i data-lucide="layers"></i> Rubricas (Plano de Aplicação)</h3>
        <div style="overflow-x:auto;">
          <table class="data-table" style="width:100%;">
            <thead>
              <tr>
                <th style="text-align:left;">Rubrica</th>
                <th style="text-align:right;width:160px;">Valor previsto</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderDesembolsosCard(desembolsos) {
    if (desembolsos.length === 0) {
      return `
        <div class="card" style="margin-bottom:16px;">
          <h3 class="card__title"><i data-lucide="calendar-clock"></i> Cronograma de desembolso</h3>
          <p style="color:var(--text-secondary);">Sem desembolsos cadastrados.</p>
        </div>`;
    }
    const rows = desembolsos
      .sort((a,b) => a.parcela - b.parcela)
      .map(d => `
        <tr>
          <td style="text-align:center;">${d.parcela}</td>
          <td>${d.data_prevista ? formatDate(d.data_prevista) : escapeAttr(d.data_texto || '—')}</td>
          <td style="text-align:right;" class="currency">${d.valor != null ? formatBRL(d.valor) : escapeAttr(d.valor_texto || '—')}</td>
        </tr>`).join('');
    return `
      <div class="card" style="margin-bottom:16px;">
        <h3 class="card__title"><i data-lucide="calendar-clock"></i> Cronograma de desembolso</h3>
        <table class="data-table" style="width:100%;">
          <thead>
            <tr>
              <th style="text-align:center;width:80px;">Parcela</th>
              <th style="text-align:left;">Data</th>
              <th style="text-align:right;width:160px;">Valor</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function renderMetadataCard(v) {
    const lines = [
      ['Título',       v.titulo],
      ['Coordenador',  v.coordenador],
      ['Vigência',     v.prazo_inicio || v.prazo_fim ? `${formatDate(v.prazo_inicio)} — ${formatDate(v.prazo_fim)}` : null],
      ['Receita',      v.receita_origem],
      ['Data do doc.', v.data_documento ? formatDate(v.data_documento) : null],
      ['Arquivo',      v.arquivo_nome],
      ['Observações',  v.observacoes],
    ].filter(([_, val]) => val != null && val !== '');

    if (lines.length === 0) return '';

    return `
      <div class="card">
        <h3 class="card__title"><i data-lucide="info"></i> Metadados</h3>
        <dl style="display:grid;grid-template-columns:140px 1fr;gap:8px 16px;font-size:14px;">
          ${lines.map(([k, val]) => `
            <dt style="color:var(--text-secondary);">${escapeAttr(k)}</dt>
            <dd style="margin:0;color:var(--text-primary);">${escapeAttr(String(val))}</dd>
          `).join('')}
        </dl>
      </div>`;
  }

  function renderHistoricoCard() {
    if (historico.length === 0) {
      return `
        <div class="card">
          <h3 class="card__title"><i data-lucide="history"></i> Versões</h3>
          <p style="color:var(--text-secondary);">Nenhuma versão importada ainda.</p>
        </div>`;
    }
    const rows = historico.map(h => {
      const isViewing = viewing && h.id === viewing.id;
      const chip = h.tipo === 'original'
        ? `<span class="badge badge--info">Original</span>`
        : `<span class="badge badge--warning">Remanejamento</span>`;
      return `
        <li style="border-bottom:1px solid var(--border-color);padding:12px 0;${isViewing ? 'background:var(--bg-elevated);padding-left:8px;padding-right:8px;border-radius:6px;' : ''}">
          <div style="display:flex;align-items:center;gap:8px;font-weight:600;color:var(--text-primary);">
            v${h.versao} ${chip}
            ${h.ativo ? '<span class="badge badge--active">Ativa</span>' : ''}
          </div>
          <div style="font-size:13px;color:var(--text-secondary);margin-top:4px;">
            ${h.data_documento ? formatDate(h.data_documento) : 'Sem data'} ·
            ${h.valor_total_plano != null ? formatBRL(h.valor_total_plano) : '—'}
          </div>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
            <button class="btn btn--ghost btn--sm" onclick="PlanoTrabalhoPage.visualizar('${escapeAttrJs(h.id)}')" ${isViewing ? 'disabled' : ''}>
              <i data-lucide="eye"></i> ${isViewing ? 'Vendo' : 'Ver'}
            </button>
            ${!h.ativo ? `
              <button class="btn btn--secondary btn--sm" onclick="PlanoTrabalhoPage.ativar('${escapeAttrJs(h.id)}')">
                <i data-lucide="check"></i> Ativar
              </button>` : ''}
            ${h.arquivo_nome ? `
              <button class="btn btn--ghost btn--sm" onclick="PlanoTrabalhoPage.baixar('${escapeAttrJs(h.id)}')" title="Baixar arquivo original">
                <i data-lucide="download"></i>
              </button>` : ''}
            <button class="btn btn--ghost btn--sm" onclick="PlanoTrabalhoPage.excluir('${escapeAttrJs(h.id)}')" title="Excluir versão" style="color:var(--danger);">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </li>`;
    }).join('');
    return `
      <div class="card">
        <h3 class="card__title"><i data-lucide="history"></i> Versões</h3>
        <ul style="list-style:none;padding:0;margin:0;">${rows}</ul>
      </div>`;
  }

  /* ── Ações no histórico ───────────────────────────────────── */

  async function visualizar(planoId) {
    if (!planoId) return;
    if (viewing && viewing.id === planoId) return;
    const { data, error } = await supabaseClient
      .from('planos_trabalho')
      .select(`
        id, project_id, versao, tipo, data_documento, ativo,
        arquivo_storage_path, arquivo_nome,
        titulo, coordenador, prazo_inicio, prazo_fim,
        valor_total_plano, valor_despesas_projeto, valor_cip, valor_dao,
        receita_origem, observacoes,
        rubricas:plano_rubricas(id, rubrica_code, valor_previsto, descricao_livre),
        desembolsos:plano_desembolsos(id, parcela, data_prevista, data_texto, valor, valor_texto)
      `)
      .eq('id', planoId)
      .maybeSingle();
    if (error) { showToast('Erro ao carregar versão: ' + error.message, 'error'); return; }
    viewing = data;
    renderPage();
  }

  async function ativar(planoId) {
    const ok = await confirmAction('Tornar esta versão a ATIVA do projeto? A versão atualmente ativa será desativada.');
    if (!ok) return;
    const { error } = await supabaseClient.rpc('ativar_plano_trabalho', { p_plano_id: planoId });
    if (error) { showToast('Erro ao ativar: ' + error.message, 'error'); return; }
    showToast('Versão ativada.', 'success');
    await refresh();
  }

  async function excluir(planoId) {
    const ok = await confirmAction('Excluir esta versão do plano? Esta ação não pode ser desfeita.');
    if (!ok) return;
    const { data: row } = await supabaseClient
      .from('planos_trabalho').select('arquivo_storage_path').eq('id', planoId).maybeSingle();

    // O registro sai primeiro, o arquivo depois. Na ordem inversa, um delete
    // que falhe (RLS, FK) deixa a linha viva apontando para um arquivo que
    // não existe mais, e o botão Baixar quebra sem forma de recuperar.
    // Falhar aqui só custa um órfão no bucket, que não quebra tela nenhuma.
    const { error } = await supabaseClient.from('planos_trabalho').delete().eq('id', planoId);
    if (error) { showToast('Erro ao excluir: ' + error.message, 'error'); return; }
    if (row?.arquivo_storage_path) {
      await supabaseClient.storage.from(STORAGE_BUCKET).remove([row.arquivo_storage_path]);
    }
    showToast('Versão excluída.', 'success');
    await refresh();
  }

  async function baixar(planoId) {
    const { data: row } = await supabaseClient
      .from('planos_trabalho').select('arquivo_storage_path, arquivo_nome').eq('id', planoId).maybeSingle();
    if (!row?.arquivo_storage_path) { showToast('Arquivo não disponível.', 'error'); return; }
    const { data, error } = await supabaseClient.storage
      .from(STORAGE_BUCKET).createSignedUrl(row.arquivo_storage_path, 60);
    if (error) { showToast('Erro ao gerar link: ' + error.message, 'error'); return; }
    window.open(data.signedUrl, '_blank');
  }

  /* ── Ações de Balancete ───────────────────────────────────── */

  async function verBalancete(balanceteId) {
    const { data, error } = await supabaseClient.rpc('get_balancete_detalhado', { p_balancete_id: balanceteId });
    if (error) { showToast('Erro ao carregar: ' + error.message, 'error'); return; }
    if (!data) { showToast('Balancete não encontrado.', 'error'); return; }

    const lancs = Array.isArray(data.lancamentos) ? data.lancamentos : [];
    const despesaLancs = lancs.filter(l => l.conta_codigo.startsWith('7.'));

    const rows = despesaLancs.map(l => {
      const rubrica = l.rubrica_name
        ? `<span class="badge badge--info">${escapeAttr(l.rubrica_name)}</span>`
        : '<span style="color:var(--text-secondary);font-size:12px;">não mapeado</span>';
      return `
        <tr>
          <td style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);">${escapeAttr(l.conta_codigo)}</td>
          <td>${escapeAttr(l.conta_descricao || '—')}</td>
          <td>${rubrica}</td>
          <td style="text-align:right;" class="currency">${formatBRL(l.saldo_atual)}</td>
        </tr>`;
    }).join('');

    createModal({
      title: `Balancete ${formatDate(data.data_referencia)}`,
      maxWidth: '900px',
      saveLabel: 'Fechar',
      bodyHTML: `
        <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:12px;margin-bottom:16px;font-size:14px;">
          <div><strong>Data referência:</strong> ${formatDate(data.data_referencia)}</div>
          <div><strong>Emissão:</strong> ${data.data_emissao ? formatDate(data.data_emissao) : '—'}</div>
          <div><strong>Saldo disponível:</strong> ${formatBRL(data.saldo_disponivel)}</div>
          <div><strong>Rendimento líquido:</strong> ${formatBRL(data.rendimento_liquido)}</div>
          <div><strong>Total débitos:</strong> ${formatBRL(data.total_debitos)}</div>
          <div><strong>Total créditos:</strong> ${formatBRL(data.total_creditos)}</div>
        </div>
        <h4 style="margin-bottom:8px;">Lançamentos de despesa (7.1.3.x)</h4>
        <div style="max-height:50vh;overflow-y:auto;">
          <table class="data-table" style="width:100%;">
            <thead>
              <tr>
                <th style="text-align:left;width:160px;">Conta</th>
                <th style="text-align:left;">Descrição</th>
                <th style="text-align:left;width:160px;">Rubrica</th>
                <th style="text-align:right;width:140px;">Saldo</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:var(--text-secondary);">Sem lançamentos.</td></tr>'}</tbody>
          </table>
        </div>
      `,
      onSave: async () => { /* close only */ },
      hideCancelBtn: true,
    });
  }

  async function excluirBalancete(balanceteId) {
    const ok = await confirmAction('Excluir este balancete? Os lançamentos serão removidos junto.');
    if (!ok) return;
    const { data: row } = await supabaseClient
      .from('balancetes').select('arquivo_storage_path').eq('id', balanceteId).maybeSingle();

    // Mesma ordem do excluir() acima, pelo mesmo motivo: registro primeiro,
    // arquivo depois. Órfão no bucket é reparável; registro apontando para
    // arquivo inexistente não é.
    const { error } = await supabaseClient.from('balancetes').delete().eq('id', balanceteId);
    if (error) { showToast('Erro ao excluir: ' + error.message, 'error'); return; }
    if (row?.arquivo_storage_path) {
      await supabaseClient.storage.from(BALANCETE_STORAGE_BUCKET).remove([row.arquivo_storage_path]);
    }
    showToast('Balancete excluído.', 'success');
    await refresh();
  }

  async function baixarBalancete(balanceteId) {
    const { data: row } = await supabaseClient
      .from('balancetes').select('arquivo_storage_path').eq('id', balanceteId).maybeSingle();
    if (!row?.arquivo_storage_path) { showToast('Arquivo não disponível.', 'error'); return; }
    const { data, error } = await supabaseClient.storage
      .from(BALANCETE_STORAGE_BUCKET).createSignedUrl(row.arquivo_storage_path, 60);
    if (error) { showToast('Erro ao gerar link: ' + error.message, 'error'); return; }
    window.open(data.signedUrl, '_blank');
  }

  /* ── Importação (modal multi-step) ────────────────────────── */

  /* ── Handlers de importação (consumidos pela ImportQueue) ─────
     Cada tipo (balancete PDF, plano DOCX) é um "handler" que
     reaproveita as funções single-file (parse, render de revisão,
     save). O controlador da fila vive em js/import-queue.js e
     também é usado pela página Fechamento Mensal. ─────────────── */

  // Seletores Projeto + Tipo injetados no topo da revisão de PLANO
  // (no lote não existe mais o step-1 com esses campos).
  function planoBatchSelectorsHTML() {
    const projOpts = allProjects.map(p =>
      `<option value="${p.id}" ${p.id === selectedProjectId ? 'selected' : ''}>${escapeAttr(p.name)}${p.code ? ' — ' + escapeAttr(p.code) : ''}</option>`
    ).join('');
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-elevated);">
        <div class="form-group" style="margin:0;">
          <label class="form-label" style="font-size:12px;">Projeto *</label>
          <select id="pti-project" class="form-input">${projOpts}</select>
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label" style="font-size:12px;">Tipo *</label>
          <select id="pti-tipo" class="form-input">
            <option value="original">Plano original</option>
            <option value="remanejamento" selected>Remanejamento</option>
          </select>
        </div>
      </div>`;
  }

  const PLANO_HANDLER = {
    type: 'plano',
    badge: 'Plano',
    title: 'Importar planos / remanejamentos (DOCX)',
    // Além do DOCX (único com leitor automático), aceita os formatos em que
    // os planos fora do padrão costumam chegar — eles caem no preenchimento
    // manual, mas ficam anexados ao plano como comprovante.
    accept: '.docx,.doc,.odt,.xlsx,.xls,.ods',
    extLabel: 'DOCX',
    checkDeps() {
      if (typeof mammoth === 'undefined') throw new Error('Biblioteca mammoth não carregada — verifique conexão.');
    },
    validExt(name) { return name.toLowerCase().endsWith('.docx'); },
    // Só reivindicado quando ninguém mais quer o arquivo — em especial o
    // XLSX, que é do handler de bolsas quando ele está na fila (Fechamento).
    fallbackExt(name) { return /\.(doc|odt|xls|xlsx|ods)$/i.test(name); },
    async parse(file) {
      // PDF chega aqui reroteado pelo handler de balancete (validExt só
      // reivindica DOCX, senão roubaria todo PDF do balancete).
      if (/\.pdf$/i.test(file.name)) {
        if (typeof parsePtFromPdfText !== 'function') {
          throw new Error('pt-pdf-parser.js não carregado — preencha manualmente.');
        }
        try {
          return parsePtFromPdfText(await extractPdfText(file));
        } catch (err) {
          if (err instanceof PtFormatError) throw new Error(err.message);
          throw err;
        }
      }
      if (!this.validExt(file.name)) {
        // Sem leitor automático para este formato: nomeia o modelo (quando
        // dá para farejar o texto) e manda para o preenchimento manual.
        const ext = (file.name.match(/\.([^.]+)$/)?.[1] || '').toUpperCase();
        const modelo = safeDetectPtModel(await sniffDocText(file));
        const prefixo = modelo.id === 'desconhecido'
          ? `Não há leitor automático para arquivos ${ext} — só o DOCX no padrão PROAD/UFG é lido sozinho.`
          : `${modelo.label} (${ext}).`;
        throw new Error(`${prefixo} ${modelo.message}`.trim());
      }
      const buf = await file.arrayBuffer();
      const mres = await mammoth.convertToHtml({ arrayBuffer: buf });
      const html = mres?.value || '';
      let extracted;
      try {
        extracted = parsePtFromHtml(html);
      } catch (err) {
        if (err instanceof PtFormatError) throw new Error(err.message);
        throw err;
      }
      extracted._html = html;   // reaproveitado pelo split-view
      return extracted;
    },
    // Esqueleto vazio para digitação: as rubricas que os modelos fora do
    // padrão usam, já na ordem. Linhas deixadas em branco são descartadas
    // por collectReviewForm (filtra valor_previsto > 0).
    manualFallback() {
      return {
        data: {
          rubricas: ['a.bolsas', 'b', 'c', 'd', 'e', 'f', 'dao']
            .map(code => ({ rubrica_code: code, descricao_livre: null, valor_previsto: null })),
          desembolsos: [],
        },
        warnings: [
          'Preenchimento manual — nada foi extraído do arquivo. Digite os valores ' +
          'conforme o documento ao lado e apague as rubricas que não se aplicam ' +
          '(linhas sem valor são ignoradas ao salvar).',
        ],
        _manual: true,
      };
    },
    async renderReview(hostEl, extracted, file) {
      const rightHTML = `<div id="pt-review-form">${planoBatchSelectorsHTML()}${renderReviewForm(extracted, file.name)}</div>`;
      const onMount = (rightEl) => { lucide.createIcons({ nodes: [rightEl] }); };
      const formOnly = () => {
        hostEl.innerHTML = rightHTML;
        lucide.createIcons({ nodes: [hostEl] });
        return null;
      };

      // PDF (típico do plano assinado) ganha o visualizador de PDF; DOCX, o
      // HTML já convertido. XLSX/DOC/ODT não têm visualizador — o usuário
      // digita com o arquivo aberto por fora.
      const isPdf = /\.pdf$/i.test(file.name);
      if (!isPdf && !extracted._html) return formOnly();

      hostEl.innerHTML = `<div id="pt-splitview"></div>`;
      const splitHost = hostEl.querySelector('#pt-splitview');
      try {
        return isPdf
          ? await mountPdfSplitView(splitHost, { pdfData: await file.arrayBuffer(), rightHTML, onMount })
          : await mountDocxSplitView(splitHost, { file, html: extracted._html, rightHTML, onMount });
      } catch (e) {
        // Split-view é opcional: sem ele o formulário ainda salva.
        console.warn('Falha ao montar split-view do plano:', e.message);
        return formOnly();
      }
    },
    async save(hostEl, extracted, file) {
      const targetProjectId = hostEl.querySelector('#pti-project')?.value;
      const tipo = hostEl.querySelector('#pti-tipo')?.value || 'remanejamento';
      if (!targetProjectId) throw new Error('Selecione o projeto.');

      const payload = collectReviewForm(hostEl, extracted);
      payload.project_id     = targetProjectId;
      payload.tipo           = tipo;
      payload.arquivo_nome   = file.name;
      // No preenchimento manual nada foi extraído — gravar o esqueleto em
      // branco como raw_extraction mentiria sobre a origem dos números.
      payload.raw_extraction = extracted._manual
        ? null
        : (extracted.raw_extraction || extracted.data);

      // Remanejamento redistribui entre rubricas — não muda o total. Quando
      // muda, é digitação errada ou aporte, e os dois merecem uma pergunta
      // antes de virar orçamento. Foi assim que a Adequação 08 do 30.068
      // entrou com 9.000 a menos em bolsas: o número era plausível e ninguém
      // tinha como notar. A conferência é aqui, antes do upload, para um
      // cancelamento não deixar arquivo órfão no bucket.
      if (tipo === 'remanejamento') {
        const { data: ativo, error: errAtivo } = await supabaseClient
          .rpc('get_plano_ativo', { p_project_id: targetProjectId });
        const anterior = errAtivo ? NaN : Number(ativo?.valor_total_plano);
        const novo = Number(payload.valor_total_plano);
        // Falha na consulta não vira alerta falso nem silêncio: sem o plano
        // anterior simplesmente não há o que comparar.
        if (Number.isFinite(anterior) && Number.isFinite(novo) && Math.abs(novo - anterior) >= 0.01) {
          const dif = novo - anterior;
          // Mensagem em parágrafo corrido: confirmAction escapa o texto dentro
          // de um <p>, então quebra de linha viraria espaço.
          const ok = await confirmAction(
            'Este remanejamento muda o valor TOTAL do plano: o plano ativo hoje é ' +
            `${formatBRL(anterior)} e este documento traz ${formatBRL(novo)} ` +
            `(diferença de ${dif > 0 ? '+' : ''}${formatBRL(dif)}). ` +
            'Um remanejamento normalmente mantém o total e só troca dinheiro de rubrica — ' +
            'confira se algum valor foi digitado errado. Salvar assim mesmo?'
          );
          if (!ok) throw new Error('Salvamento cancelado: o total diverge do plano ativo em ' + formatBRL(dif) + '.');
        }
      }

      const safeName = file.name.replace(/[^\w.-]/g, '_');
      const path = `${targetProjectId}/${Date.now()}_${safeName}`;
      const upload = await supabaseClient.storage
        .from(STORAGE_BUCKET)
        .upload(path, file, { contentType: file.type || 'application/octet-stream' });
      if (upload.error) throw new Error('Falha no upload do arquivo: ' + upload.error.message);
      payload.arquivo_storage_path = path;

      const { error } = await supabaseClient.rpc('upsert_plano_trabalho', { p_payload: payload });
      if (error) {
        await supabaseClient.storage.from(STORAGE_BUCKET).remove([path]).catch(() => {});
        throw new Error('Erro ao salvar plano: ' + error.message);
      }

      // Mantém o projeto recém-salvo como default do próximo arquivo.
      selectedProjectId = targetProjectId;
      localStorage.setItem(LS_PROJECT_KEY, selectedProjectId);
      return { label: payload.titulo || file.name };
    },
  };

  const BALANCETE_HANDLER = {
    type: 'balancete',
    badge: 'Balancete',
    title: 'Importar balancetes (PDF)',
    accept: '.pdf,application/pdf',
    extLabel: 'PDF',
    checkDeps() {
      if (typeof pdfjsLib === 'undefined') throw new Error('Biblioteca pdf.js não carregada — verifique conexão.');
    },
    validExt(name) { return name.toLowerCase().endsWith('.pdf'); },
    async parse(file) {
      const text = await extractPdfText(file);
      // Plano e balancete chegam ambos em .pdf — só o conteúdo distingue.
      // O teste é positivo e específico (o balancete da FUNAPE não fala em
      // "Plano de Aplicação dos Recursos Financeiros" nem em Termo de
      // Fomento), então um balancete de verdade nunca é reroteado.
      const modelo = safeDetectPtModel(text);
      if (modelo.isPlano) {
        const err = new Error(`Este PDF é um Plano de Trabalho (${modelo.label}), não um balancete.`);
        err.rerouteTo = 'plano';
        throw err;
      }
      return extractBalanceteFromText(text);   // { data, warnings } — detecta projeto pelo código
    },
    async renderReview(hostEl, extracted, file) {
      const codigo = extracted?.data?.project_code;
      const doCodigo = codigo ? allProjects.find(p => p.code && p.code.trim() === String(codigo).trim()) : null;
      await carregarItensRevisao(doCodigo?.id || selectedProjectId);
      hostEl.innerHTML = renderBalanceteReviewForm(extracted, file.name);
      lucide.createIcons({ nodes: [hostEl] });
      const splitHost = hostEl.querySelector('#bal-splitview');

      // Celular: o PDF lado a lado tomava a tela inteira antes da lista. Lá ele
      // fica recolhido atrás de "Ver PDF", e a revisão ocupa a largura toda.
      if (window.matchMedia('(max-width: 900px)').matches) {
        let view = null;
        const barra = document.createElement('div');
        barra.className = 'bal-pdf-mobile';
        barra.innerHTML = `
          <button type="button" class="btn btn--secondary btn--sm"><i data-lucide="file-text"></i> <span>Ver PDF</span></button>
          <div class="bal-pdf-mobile__corpo" hidden></div>`;
        hostEl.insertBefore(barra, hostEl.firstChild);
        lucide.createIcons({ nodes: [barra] });
        const corpo = barra.querySelector('.bal-pdf-mobile__corpo');
        const rotulo = barra.querySelector('span');
        barra.querySelector('button').addEventListener('click', async () => {
          corpo.hidden = !corpo.hidden;
          rotulo.textContent = corpo.hidden ? 'Ver PDF' : 'Esconder PDF';
          if (!corpo.hidden && !view) {
            try {
              view = await mountPdfSplitView(corpo, { pdfData: await file.arrayBuffer(), rightHTML: '' });
            } catch (e) {
              corpo.textContent = 'Não foi possível abrir o PDF: ' + e.message;
            }
          }
        });
        return { destroy() { if (view) view.destroy(); } };
      }
      const rightHTML = hostEl.querySelector('#bal-review-form')?.outerHTML || '';
      try {
        const pdfBuf = await file.arrayBuffer();
        const view = await mountPdfSplitView(splitHost, {
          pdfData: pdfBuf,
          rightHTML,
          onMount: (rightEl) => { lucide.createIcons({ nodes: [rightEl] }); },
        });
        hostEl.querySelector('#bal-review-form')?.remove();
        return view;
      } catch (e) {
        // Split-view opcional: o form já está no host, não bloqueia o salvamento.
        console.warn('Falha ao montar split-view do PDF:', e.message);
        return null;
      }
    },
    async save(hostEl, extracted, file) {
      return salvarBalancete(hostEl, extracted, file, null);
    },
    afterAllSaved() {
      // Após importar balancetes, a aba mais útil é Previsto x Realizado.
      currentTab = 'previsto-real';
      localStorage.setItem(LS_TAB_KEY, currentTab);
    },
  };

  /**
   * Gravação do balancete revisado. `propostaId` vem quando a origem é uma
   * proposta do Buriti: upsert_balancete marca a proposta como aplicada na
   * MESMA transação (mig. 051) — se ela já não estiver pendente, nada grava.
   */
  async function salvarBalancete(hostEl, extracted, file, propostaId) {
    const targetProjectId = hostEl.querySelector('#bali-project-sel')?.value;
    if (!targetProjectId) throw new Error('Selecione o projeto.');

    const payload = collectBalanceteReview(hostEl, extracted);
    payload.project_id     = targetProjectId;
    payload.arquivo_nome   = file.name;
    payload.raw_extraction = extracted.raw_extraction || extracted.data;
    if (propostaId) payload.proposta_id = propostaId;

    const safeName = file.name.replace(/[^\w.-]/g, '_');
    const path = `${targetProjectId}/${Date.now()}_${safeName}`;
    const up = await supabaseClient.storage
      .from(BALANCETE_STORAGE_BUCKET)
      .upload(path, file, { contentType: 'application/pdf' });
    if (up.error) throw new Error('Falha no upload do PDF: ' + up.error.message);
    payload.arquivo_storage_path = path;

    const { error } = await supabaseClient.rpc('upsert_balancete', { p_payload: payload });
    if (error) {
      await supabaseClient.storage.from(BALANCETE_STORAGE_BUCKET).remove([path]).catch(() => {});
      throw new Error('Erro ao salvar balancete: ' + error.message);
    }
    const newMappings = Array.isArray(payload.new_mappings) ? payload.new_mappings.length : 0;
    return {
      label: payload.data_referencia ? formatDate(payload.data_referencia) : file.name,
      newMappings,
    };
  }

  /**
   * Handler para revisar uma PROPOSTA do Buriti (mig. 051) na mesma fila e
   * na mesma tela de revisão da importação comum. Diferenças, e só elas:
   *   • não lê o PDF de novo — usa `payload.extraido`, que o Buriti produziu
   *     com o MESMO parser (mcp/src/buriti-proposta.js);
   *   • as sugestões de rubrica vêm pré-selecionadas, com a justificativa à
   *     vista (salvar = o humano confirmar);
   *   • grava com `proposta_id`, que marca a proposta como aplicada na
   *     mesma transação.
   * O `file` é o PDF da proposta, baixado do bucket propostas-agente: é o
   * comprovante que a gravação anexa, como numa importação comum.
   */
  function buritiBalanceteHandler(proposta) {
    const payload = proposta.payload || {};
    const sugestoes = {};
    (payload.perguntas || []).forEach(q => { if (q.sugestao) sugestoes[q.reduzido] = q.sugestao; });
    return {
      ...BALANCETE_HANDLER,
      title: 'Revisar proposta do Buriti',
      validExt: () => true,
      async parse() {
        const ex = payload.extraido || { data: {}, warnings: [] };
        const data = {
          ...ex.data,
          lancamentos: (ex.data?.lancamentos || []).map(l => {
            const s = l.conta_incompleta ? sugestoes[l.conta_reduzido] : null;
            return s ? { ...l, sugestao_buriti: s } : { ...l };
          }),
        };
        const extras = (payload.avisos || []).filter(a => !(ex.warnings || []).includes(a));
        return { data, warnings: [...(ex.warnings || []), ...extras] };
      },
      async save(hostEl, extracted, file) {
        return salvarBalancete(hostEl, extracted, file, proposta.id);
      },
    };
  }

  /** Nome da rubrica pelo código — a página do Buriti mostra as sugestões por extenso. */
  function rubricaNome(code) {
    return RUBRICAS.find(r => r.code === code)?.name || code;
  }

  /** Abre a revisão de uma proposta de balancete. `onFinished(summary)` como na fila. */
  async function revisarPropostaBalancete(proposta, onFinished) {
    await getImportHandlers();   // projetos + mapa conta → rubrica
    if (!proposta.arquivo_path) throw new Error('A proposta não tem o PDF anexado.');
    const { data: blob, error } = await supabaseClient.storage
      .from('propostas-agente').download(proposta.arquivo_path);
    if (error) throw new Error('Não foi possível baixar o PDF da proposta: ' + error.message);
    const nome = proposta.payload?.arquivo_nome || proposta.arquivo_path.split('/').pop();
    const file = new File([blob], nome, { type: 'application/pdf' });
    ImportQueue.open({
      title: 'Revisar proposta do Buriti',
      handlers: [buritiBalanceteHandler(proposta)],
      files: [file],
      onFinished,
    });
  }

  // A extração de DOCX migrou para parsePtFromHtml (parser determinístico,
  // sem IA). Veja frontend/js/parsers/pt-parser.js e a integração em
  // PLANO_HANDLER acima. A Edge Function extract-plano-trabalho continua
  // deployada mas não é mais chamada pelo frontend.

  /* ── Extração PDF → texto e Edge Function de balancete ───── */

  // Um PDF reroteado de balancete para plano seria lido duas vezes; o cache
  // por File evita repetir a extração (que percorre todas as páginas).
  const pdfTextCache = new WeakMap();

  async function extractPdfText(file) {
    if (pdfTextCache.has(file)) return pdfTextCache.get(file);
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('Biblioteca pdf.js não carregada — verifique conexão.');
    }
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let full = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // Mesma montagem que o Buriti usa no MCP (parsers/pdf-texto.js).
      if (typeof textoDaPagina !== 'function') throw new Error('pdf-texto.js não carregado.');
      full += textoDaPagina(content.items) + '\n';
    }
    full = full.trim();
    if (full.length < 100) throw new Error('Texto extraído do PDF muito curto.');
    pdfTextCache.set(file, full);
    return full;
  }

  /**
   * detectPtModel vem de um <script type="module"> (window-bridged). Se ele
   * não carregar, degrada para o comportamento antigo — sem nome de modelo e
   * sem roteamento por conteúdo — em vez de derrubar a importação inteira.
   */
  function safeDetectPtModel(text) {
    if (typeof detectPtModel !== 'function') {
      return { id: 'desconhecido', label: 'Modelo não reconhecido', isPlano: false, message: '' };
    }
    return detectPtModel(text);
  }

  /**
   * Texto bruto de um arquivo, só o suficiente para o detectPtModel dizer
   * qual modelo é. Best-effort: se a lib não estiver lá ou o arquivo for
   * ilegível, devolve '' e o detector responde "desconhecido".
   */
  async function sniffDocText(file) {
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith('.pdf')) return await extractPdfText(file);
      if (/\.(xlsx|xls|ods)$/.test(name)) {
        if (typeof XLSX === 'undefined') return '';
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        // Nome das abas já entrega o modelo FAPEG ("5_Custeio FOR 005");
        // as duas primeiras dão o cabeçalho sem custar leitura do arquivo todo.
        const heads = wb.SheetNames.slice(0, 2)
          .map(n => XLSX.utils.sheet_to_csv(wb.Sheets[n]).slice(0, 4000));
        return [wb.SheetNames.join(' '), ...heads].join('\n');
      }
    } catch (e) {
      console.warn('Falha ao farejar o modelo do documento:', e.message);
    }
    return '';
  }

  /**
   * Parser determinístico do balancete (substitui chamada Ollama).
   * Mantém o formato { data, warnings } compatível com a Edge Function antiga.
   * A função extract-balancete continua deployada como fallback, mas não é mais chamada.
   */
  function extractBalanceteFromText(text) {
    if (typeof parseBalanceteText !== 'function') {
      throw new Error('balancete-parser.js não carregado.');
    }
    return parseBalanceteText(text);
  }

  /* ── Itens do plano na revisão (mig. 053) ─────────────────── */

  // Itens do plano ativo e regras de item do projeto em revisão. Carregados
  // ao abrir a revisão; sem plano, ou sem a mig. 053 no banco, a revisão
  // segue funcionando só pela letra.
  let revisaoItens = { projeto: null, itens: {}, unico: {}, regras: [] };

  // Mesma normalização de public.norm_item (053): sem acento, caixa,
  // pontuação nem aspas. É assim que a regra casa com o plano.
  function normItem(t) {
    const n = String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return n || null;
  }

  async function carregarItensRevisao(projectId) {
    revisaoItens = { projeto: projectId, itens: {}, unico: {}, regras: [] };
    if (!projectId) return;
    const [planoRes, regrasRes] = await Promise.all([
      supabaseClient.from('plano_rubricas')
        .select('rubrica_code, descricao_livre, planos_trabalho!inner(project_id, ativo)')
        .eq('planos_trabalho.project_id', projectId).eq('planos_trabalho.ativo', true),
      supabaseClient.from('conta_item_map')
        .select('conta_prefix, rubrica_code, item_descricao').eq('project_id', projectId),
    ]);
    if (!planoRes.error) {
      const vistos = {}; const semDescricao = {};
      (planoRes.data || []).forEach(r => {
        const chave = normItem(r.descricao_livre);
        if (!chave) { semDescricao[r.rubrica_code] = true; return; }
        vistos[r.rubrica_code] = vistos[r.rubrica_code] || {};
        if (!vistos[r.rubrica_code][chave]) {
          vistos[r.rubrica_code][chave] = String(r.descricao_livre).replace(/^["\s]+|["\s]+$/g, '');
        }
      });
      Object.entries(vistos).forEach(([rub, m]) => {
        revisaoItens.itens[rub] = Object.values(m);
        if (revisaoItens.itens[rub].length === 1 && !semDescricao[rub]) revisaoItens.unico[rub] = revisaoItens.itens[rub][0];
      });
    }
    if (!regrasRes.error) {
      revisaoItens.regras = (regrasRes.data || []).slice().sort((a, b) => b.conta_prefix.length - a.conta_prefix.length);
    }
  }

  /** Descrição canônica do item no plano, se existir com essa letra. */
  function itemDoPlano(rubrica, item) {
    const chave = normItem(item);
    return (revisaoItens.itens[rubrica] || []).find(i => normItem(i) === chave) || null;
  }

  /** O que o banco vai resolver para a conta (espelha o gatilho da 053). */
  function resolverItem(conta, letra) {
    const regra = revisaoItens.regras.find(r => conta.startsWith(r.conta_prefix));
    if (regra) {
      const item = itemDoPlano(regra.rubrica_code, regra.item_descricao);
      if (item) return { rubrica: regra.rubrica_code, item, origem: 'regra' };
    }
    if (letra && revisaoItens.unico[letra]) return { rubrica: letra, item: revisaoItens.unico[letra], origem: 'unico' };
    return { rubrica: letra || '', item: null, origem: null };
  }

  /** Valor do seletor: "letra" ou "letra::item". */
  function valorRubricaItem(rubrica, item) {
    if (!rubrica) return '';
    const canon = item ? itemDoPlano(rubrica, item) : null;
    if (canon) return `${rubrica}::${canon}`;
    if (revisaoItens.unico[rubrica]) return `${rubrica}::${revisaoItens.unico[rubrica]}`;
    return rubrica;
  }

  /* ── Revisão de Balancete (usada pela fila em BALANCETE_HANDLER) ── */

  function renderBalanceteReviewForm(extracted, fileName) {
    const d = extracted.data || {};
    const warnings = Array.isArray(extracted.warnings) ? extracted.warnings : [];

    // Auto-detecção: procura projeto cujo code bate com project_code do PDF
    let autoMatch = null;
    if (d.project_code) {
      autoMatch = allProjects.find(p =>
        p.code && p.code.trim() === String(d.project_code).trim()
      ) || null;
    }
    const defaultProjectId = autoMatch?.id || selectedProjectId;

    const projOpts = allProjects.map(p => `
      <option value="${p.id}" ${p.id === defaultProjectId ? 'selected' : ''}>
        ${escapeAttr(p.name)}${p.code ? ' — ' + escapeAttr(p.code) : ''}
      </option>`).join('');

    const detectMsg = d.project_code
      ? (autoMatch
          // Detectado: o resumo "Dados do balancete" já mostra o código — o
          // aviso verde só ocupava a tela. Aviso aparece quando há problema.
          ? ''
          : `<div class="callout callout--warning" style="margin-bottom:12px;">
               <i data-lucide="alert-triangle"></i>
               <div>Código <code>${escapeAttr(d.project_code)}</code> detectado, mas nenhum projeto cadastrado tem esse código.</div>
             </div>`)
      : `<div class="callout callout--warning" style="margin-bottom:12px;">
           <i data-lucide="alert-triangle"></i>
           <div>Não foi possível detectar o código do projeto no PDF. Selecione manualmente.</div>
         </div>`;

    // Avisos: o que muda a decisão fica à vista; a lista técnica de códigos
    // cortados (o leitor resolve ou vira pergunta abaixo) vai para "detalhes".
    const tecnicos = warnings.filter(w => w.startsWith('Código de conta cortado'));
    const avisos   = warnings.filter(w => !w.startsWith('Código de conta cortado'));
    const warningsHTML = (avisos.length === 0 ? '' : `
      <div class="callout callout--warning" style="margin-bottom:12px;">
        <i data-lucide="alert-triangle"></i>
        <div>
          <strong>Atenção</strong>
          <ul style="margin:6px 0 0 16px;padding:0;">
            ${avisos.map(w => `<li>${escapeAttr(w)}</li>`).join('')}
          </ul>
        </div>
      </div>`) + (tecnicos.length === 0 ? '' : `
      <details class="bal-detalhes">
        <summary>Detalhes técnicos da leitura do PDF</summary>
        <ul>${tecnicos.map(w => `<li>${escapeAttr(w)}</li>`).join('')}</ul>
      </details>`);

    const lancs = Array.isArray(d.lancamentos) ? d.lancamentos : [];
    const nomeRubrica = (code) => RUBRICAS.find(r => r.code === code)?.name || code;

    // Três grupos, para a pessoa ver primeiro só o que depende dela:
    //   pergunta — código cortado e conta nova (obrigatória), ou despesa sem
    //              regra no mapa (opcional: classificar e salvar a regra);
    //   ok       — já tem rubrica pelo mapa (inclusive estorno 7.1.1.08 com
    //              regra: conta na rubrica desde a mig. 049);
    //   fora     — receita, rendimento, transferência e estorno sem regra
    //              (7.1.1.*): não é despesa, não leva rubrica e não gera alerta.
    const itens = lancs
      .map((l, idx) => ({ l, idx }))
      .filter(({ l }) => l.conta_codigo && l.conta_codigo.startsWith('7.'))
      .map(({ l, idx }) => {
        const receita = l.conta_codigo.startsWith('7.1.1.');
        const incompleta = !!l.conta_incompleta && !l.conta_codigo.startsWith('7.1.1.01.');
        const sugestao = incompleta ? l.sugestao_buriti : null;
        // A letra vem do mapa global; a regra de item do projeto (mig. 053)
        // pode trocá-la — é decisão humana daquele projeto.
        const r = incompleta ? { rubrica: '', item: null, origem: null }
                             : resolverItem(l.conta_codigo, resolveRubricaForConta(l.conta_codigo) || '');
        const auto = valorRubricaItem(r.rubrica, r.item);
        let grupo = 'ok';
        if (incompleta) grupo = 'pergunta';
        else if (!r.rubrica) grupo = receita ? 'fora' : 'pergunta';
        return { l, idx, incompleta, sugestao, auto, grupo, letra: r.rubrica, item: r.item };
      });

    const dicaDe = (it) => {
      if (it.sugestao) {
        const item = it.sugestao.item ? itemDoPlano(it.sugestao.rubrica, it.sugestao.item) : null;
        return `Sugestão do Buriti: <strong>${escapeAttr(nomeRubrica(it.sugestao.rubrica))}${item ? ' › ' + escapeAttr(item) : ''}</strong> — ${escapeAttr(it.sugestao.justificativa || '')}`;
      }
      if (it.incompleta) {
        const c = typeof classificarContaCortada === 'function'
          ? classificarContaCortada(it.l.conta_codigo, contaRubricaMap)
          : { rubrica: null, ambigua: true };
        if (c.ambigua) return 'Conta nova (código cortado no PDF): o trecho que falta decide a rubrica.';
        if (c.rubrica) return `Conta nova. Pelo início do código seria <strong>${escapeAttr(nomeRubrica(c.rubrica))}</strong>.`;
        return 'Conta nova, sem regra no mapa.';
      }
      return 'Despesa sem regra no mapa. Classifique e marque "salvar regra" para as próximas, ou deixe sem rubrica.';
    };

    // Rubrica › item do plano (mig. 053). Rubrica sem item descrito no plano
    // aparece sozinha; com vários itens, há também "item a definir" — vira
    // "Sem item atribuído" no Previsto × Realizado.
    const opcao = (valor, rotulo, selecionada) =>
      `<option value="${escapeAttr(valor)}" ${valor === selecionada ? 'selected' : ''}>${escapeAttr(rotulo)}</option>`;
    const selectHTML = (it, selecionada) => `
      <select class="form-input bal-rubrica-sel" data-bal-rubrica>
        <option value="">${it.incompleta ? '— Escolha a rubrica —' : '— Sem rubrica —'}</option>
        ${RUBRICAS.map(r => {
          const lista = revisaoItens.itens[r.code] || [];
          if (lista.length === 0) return opcao(r.code, r.name, selecionada);
          return `<optgroup label="${escapeAttr(r.name)}">` +
            lista.map(i => opcao(`${r.code}::${i}`, `${r.name} › ${i}`, selecionada)).join('') +
            (revisaoItens.unico[r.code] ? '' : opcao(r.code, `${r.name} › (item a definir)`, selecionada)) +
            '</optgroup>';
        }).join('')}
      </select>`;

    const atributos = (it) =>
      `data-bal-row="${it.idx}" data-conta="${escapeAttr(it.l.conta_codigo)}" data-bal-auto="${escapeAttr(it.auto)}"` +
      (it.incompleta ? ' data-bal-obrigatoria="1"' : '');

    // Grupo 1 — cartões: o seletor ocupa a largura toda e o rótulo cabe inteiro.
    const perguntas = itens.filter(it => it.grupo === 'pergunta');
    const cartoesHTML = perguntas.map(it => {
      const selecionada = it.incompleta && it.sugestao
        ? valorRubricaItem(it.sugestao.rubrica, it.sugestao.item)
        : '';
      const salvar = it.incompleta
        ? '<label title="Código incompleto: uma regra feita com ele capturaria outras contas." style="opacity:0.4;"><input type="checkbox" data-bal-save-mapping disabled> salvar regra</label>'
        : '<label><input type="checkbox" data-bal-save-mapping> salvar regra</label>';
      return `
        <div class="bal-pergunta ${it.incompleta ? 'bal-pergunta--obrigatoria' : ''}" ${atributos(it)}>
          <div class="bal-pergunta__topo">
            <strong>${escapeAttr(it.l.conta_descricao || '—')}</strong>
            <span class="currency">${formatBRL(it.l.saldo_atual)}</span>
          </div>
          <div class="bal-pergunta__dica">${dicaDe(it)}</div>
          ${selectHTML(it, selecionada)}
          <div class="bal-pergunta__rodape">
            <span>${escapeAttr(it.l.conta_codigo)}${it.incompleta ? '…' : ''}${it.l.conta_reduzido ? ` · red. ${escapeAttr(it.l.conta_reduzido)}` : ''}</span>
            ${salvar}
          </div>
        </div>`;
    }).join('');

    // Grupo 2 — já classificadas: recolhido, com o total de cada rubrica.
    const ok = itens.filter(it => it.grupo === 'ok');
    const totais = {}; const semItem = {};
    ok.forEach(it => {
      totais[it.letra] = (totais[it.letra] || 0) + Number(it.l.saldo_atual || 0);
      if (!it.item && (revisaoItens.itens[it.letra] || []).length > 1) semItem[it.letra] = (semItem[it.letra] || 0) + 1;
    });
    const totaisHTML = Object.entries(totais)
      .sort((a, b) => (RUBRICA_BY_CODE[a[0]]?.ordem || 999) - (RUBRICA_BY_CODE[b[0]]?.ordem || 999))
      .map(([c, v]) => `<li><span>${escapeAttr(nomeRubrica(c))}${semItem[c] ? ` <em class="bal-sem-item">· ${semItem[c]} sem item</em>` : ''}</span><span class="currency">${formatBRL(v)}</span></li>`).join('');
    const totalSemItem = Object.values(semItem).reduce((a, b) => a + b, 0);
    const okLinhas = ok.map(it => `
      <tr ${atributos(it)}>
        <td>${escapeAttr(it.l.conta_descricao || '—')}<div class="bal-codigo">${escapeAttr(it.l.conta_codigo)}</div></td>
        <td class="currency bal-valor">${formatBRL(it.l.saldo_atual)}</td>
        <td>${selectHTML(it, it.auto)}</td>
      </tr>`).join('');

    // Grupo 3 — fora de rubrica: só para conferência, sem seletor.
    const fora = itens.filter(it => it.grupo === 'fora');
    const foraLinhas = fora.map(it => `
      <tr>
        <td>${escapeAttr(it.l.conta_descricao || '—')}<div class="bal-codigo">${escapeAttr(it.l.conta_codigo)}</div></td>
        <td class="currency bal-valor">${formatBRL(it.l.saldo_atual)}</td>
      </tr>`).join('');

    const obrigatorias = perguntas.filter(it => it.incompleta).length;
    const opcionais = perguntas.length - obrigatorias;
    const subtitulo = [
      obrigatorias > 0 ? `${obrigatorias} obrigatória(s): conta nova, a rubrica precisa da sua confirmação.` : '',
      opcionais > 0 ? `${opcionais} opcional(is): despesa sem regra no mapa.` : '',
    ].filter(Boolean).join(' ');
    const lancamentosHTML = `
      <h4 class="bal-grupo-titulo">Precisa de você (${perguntas.length})</h4>
      ${perguntas.length === 0
        ? '<p class="bal-grupo-sub">Nada a decidir: todas as despesas já têm rubrica.</p>'
        : `<p class="bal-grupo-sub">${subtitulo}</p><div class="bal-perguntas">${cartoesHTML}</div>`}

      <details class="bal-grupo">
        <summary>Já classificadas (${ok.length})${totalSemItem ? ` · ${totalSemItem} sem item do plano — abra para escolher` : ''}</summary>
        <ul class="bal-totais">${totaisHTML}</ul>
        <div class="bal-tabela"><table class="data-table"><tbody>${okLinhas}</tbody></table></div>
      </details>

      ${fora.length === 0 ? '' : `
      <details class="bal-grupo">
        <summary>Não entram em rubrica (${fora.length}): receitas, rendimentos e transferências</summary>
        <div class="bal-tabela"><table class="data-table"><tbody>${foraLinhas}</tbody></table></div>
      </details>`}`;

    return `
      <div id="bal-review-form">
        <p style="color:var(--text-secondary);margin-bottom:12px;font-size:13px;">
          Conferir extração de <strong>${escapeAttr(fileName)}</strong>.
        </p>
        ${detectMsg}
        ${warningsHTML}

        <!-- Dados do cabeçalho: vêm do PDF e raramente mudam. Recolhidos para a
             lista do que depende da pessoa aparecer primeiro (no celular, os
             campos empurravam as perguntas para baixo da dobra). Abrem sozinhos
             quando o projeto não foi detectado. -->
        <details class="bal-grupo bal-cabecalho" ${autoMatch ? '' : 'open'}>
          <summary>Dados do balancete: ${escapeAttr(autoMatch ? (autoMatch.code || autoMatch.name) : 'projeto a escolher')}
            · até ${d.data_referencia ? formatDate(d.data_referencia) : '—'}
            · saldo ${d.saldo_disponivel != null ? formatBRL(d.saldo_disponivel) : '—'}</summary>
          <div class="form-group" style="margin-bottom:10px;">
            <label class="form-label" style="font-size:12px;">Projeto *</label>
            <select id="bali-project-sel" class="form-input">${projOpts}</select>
          </div>

          <div class="form-row" style="gap:8px;">
            <div class="form-group" style="margin-bottom:8px;">
              <label class="form-label" style="font-size:12px;">Data de referência *</label>
              <input type="date" class="form-input" data-bal-field="data_referencia" value="${toInputDate(d.data_referencia || '')}">
            </div>
            <div class="form-group" style="margin-bottom:8px;">
              <label class="form-label" style="font-size:12px;">Data de emissão</label>
              <input type="date" class="form-input" data-bal-field="data_emissao" value="${toInputDate(d.data_emissao || '')}">
            </div>
          </div>

          <div class="form-row" style="gap:8px;">
            <div class="form-group" style="margin-bottom:8px;">
              <label class="form-label" style="font-size:12px;">Saldo disponível</label>
              <input type="number" step="0.01" class="form-input" data-bal-field="saldo_disponivel" value="${d.saldo_disponivel ?? ''}">
            </div>
            <div class="form-group" style="margin-bottom:8px;">
              <label class="form-label" style="font-size:12px;">Rendimento líquido</label>
              <input type="number" step="0.01" class="form-input" data-bal-field="rendimento_liquido" value="${d.rendimento_liquido ?? ''}">
            </div>
          </div>
        </details>

        ${lancamentosHTML}

        <!-- Campos hidden para totais (preservados, sem UI) -->
        <input type="hidden" data-bal-field="total_debitos"  value="${d.total_debitos ?? ''}">
        <input type="hidden" data-bal-field="total_creditos" value="${d.total_creditos ?? ''}">
      </div>
      <!-- Onde o split-view monta. O #bal-review-form acima é movido para dentro do .pdfsv-pane--right. -->
      <div id="bal-splitview"></div>
    `;
  }

  function collectBalanceteReview(overlay, extracted) {
    const get = (k) => overlay.querySelector(`[data-bal-field="${k}"]`)?.value || null;
    const num = (k) => {
      const v = get(k);
      return v == null || v === '' ? null : Number(v);
    };

    const d = extracted?.data || {};
    // Cópia rasa: a rubrica escolhida vai no lançamento sem alterar o
    // extraído, que é reaproveitado se o salvamento falhar.
    const lancamentos = (Array.isArray(d.lancamentos) ? d.lancamentos : []).map(l => ({ ...l }));

    // Rubrica escolhida na revisão vai no próprio lançamento quando difere
    // do que o mapa resolveria (mig. 050: upsert_balancete a respeita; o
    // gatilho só preenche rubrica nula). Antes, escolher sem marcar
    // "salvar" não tinha efeito nenhum. Linha de código cortado é
    // obrigatória: sem resposta, não salva.
    const faltando = [];
    overlay.querySelectorAll('[data-bal-row]').forEach((tr) => {
      const idx = Number(tr.getAttribute('data-bal-row'));
      const escolhida = tr.querySelector('[data-bal-rubrica]')?.value || '';
      const auto = tr.getAttribute('data-bal-auto') || '';
      const obrigatoria = tr.hasAttribute('data-bal-obrigatoria');
      if (obrigatoria && !escolhida) faltando.push(tr.getAttribute('data-conta'));
      if (lancamentos[idx] && escolhida && (obrigatoria || escolhida !== auto)) {
        const [rubrica, item] = escolhida.split('::');
        lancamentos[idx].rubrica_code = rubrica;
        lancamentos[idx].item_descricao = item || null;
      }
    });
    if (faltando.length > 0) {
      throw new Error(`Escolha a rubrica das ${faltando.length} conta(s) nova(s) em "Precisa de você" antes de salvar.`);
    }

    // Coleta mapeamentos a salvar: linhas com checkbox marcado e rubrica selecionada.
    // O usuário só vê o checkbox em linhas que estavam não-mapeadas.
    // Com item escolhido, a regra é do PROJETO (conta → item, mig. 053); só
    // a letra, a regra é do mapa global, como antes.
    const new_mappings = [];
    const new_item_mappings = [];
    overlay.querySelectorAll('[data-bal-row]').forEach((tr) => {
      const conta = tr.getAttribute('data-conta');
      const sel = tr.querySelector('[data-bal-rubrica]');
      const save = tr.querySelector('[data-bal-save-mapping]');
      const valor = sel?.value || '';
      if (!(save && !save.disabled && save.checked && valor && conta)) return;
      const [rubrica, item] = valor.split('::');
      if (item) {
        new_item_mappings.push({ conta_prefix: conta, rubrica_code: rubrica, item_descricao: item });
      } else {
        new_mappings.push({
          conta_prefix: conta,
          rubrica_code: rubrica,
          descricao: 'Cadastrado via revisão do balancete',
        });
      }
    });

    return {
      data_referencia:    get('data_referencia'),
      data_emissao:       get('data_emissao'),
      periodo_inicio:     d.periodo_inicio || null,
      saldo_disponivel:   num('saldo_disponivel'),
      rendimento_liquido: num('rendimento_liquido'),
      total_debitos:      num('total_debitos'),
      total_creditos:     num('total_creditos'),
      lancamentos,
      new_mappings,
      new_item_mappings,
    };
  }

  /* ── Form de revisão (Step 3) ─────────────────────────────── */

  function renderReviewForm(extracted, fileName) {
    const d = extracted.data || {};
    const warnings = Array.isArray(extracted.warnings) ? extracted.warnings : [];

    const warningHTML = warnings.length === 0 ? '' : `
      <div class="callout callout--warning" style="margin-bottom:16px;">
        <i data-lucide="alert-triangle"></i>
        <div>
          <strong>Avisos da extração</strong>
          <ul style="margin:6px 0 0 16px;padding:0;">
            ${warnings.map(w => `<li>${escapeAttr(w)}</li>`).join('')}
          </ul>
        </div>
      </div>`;

    const rubricaOptions = RUBRICAS.map(r => `<option value="${r.code}">${escapeAttr(r.name)}</option>`).join('');

    const rubricasRows = (d.rubricas || []).map((r, i) => rubricaRowHTML(r, i, rubricaOptions)).join('');
    const desembolsosRows = (d.desembolsos || []).map((d2, i) => desembolsoRowHTML(d2, i)).join('');

    return `
      <p style="color:var(--text-secondary);margin-bottom:16px;">
        Confira os dados extraídos de <strong>${escapeAttr(fileName)}</strong>. Ajuste o que estiver incorreto antes de salvar.
      </p>
      ${warningHTML}

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Título</label>
          <input class="form-input" data-pt-field="titulo" value="${escapeAttr(d.titulo || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Coordenador</label>
          <input class="form-input" data-pt-field="coordenador" value="${escapeAttr(d.coordenador || '')}">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Início da vigência</label>
          <input type="date" class="form-input" data-pt-field="prazo_inicio" value="${toInputDate(d.prazo_inicio || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Fim da vigência</label>
          <input type="date" class="form-input" data-pt-field="prazo_fim" value="${toInputDate(d.prazo_fim || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Data do documento</label>
          <input type="date" class="form-input" data-pt-field="data_documento" value="">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Total do plano (R$)</label>
          <input type="number" step="0.01" class="form-input" data-pt-field="valor_total_plano" value="${d.valor_total_plano ?? ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Despesas do projeto (R$)</label>
          <input type="number" step="0.01" class="form-input" data-pt-field="valor_despesas_projeto" value="${d.valor_despesas_projeto ?? ''}">
        </div>
        <div class="form-group">
          <label class="form-label">CIP total (R$)</label>
          <input type="number" step="0.01" class="form-input" data-pt-field="valor_cip" value="${d.valor_cip ?? ''}">
        </div>
        <div class="form-group">
          <label class="form-label">DAO (R$)</label>
          <input type="number" step="0.01" class="form-input" data-pt-field="valor_dao" value="${d.valor_dao ?? ''}">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Receita / origem dos recursos</label>
        <textarea class="form-input" rows="2" data-pt-field="receita_origem">${escapeAttr(d.receita_origem || '')}</textarea>
      </div>

      <hr style="margin:16px 0;border:none;border-top:1px solid var(--border-color);">

      <h4 style="margin-bottom:8px;">Rubricas
        <button type="button" class="btn btn--ghost btn--sm" onclick="PlanoTrabalhoPage._addRubrica(this)">
          <i data-lucide="plus"></i> Adicionar
        </button>
      </h4>
      <div id="pt-rubricas-rows" data-rubrica-options='${rubricaOptions.replace(/'/g, "&#39;")}'>
        ${rubricasRows}
      </div>

      <hr style="margin:16px 0;border:none;border-top:1px solid var(--border-color);">

      <h4 style="margin-bottom:8px;">Desembolsos
        <button type="button" class="btn btn--ghost btn--sm" onclick="PlanoTrabalhoPage._addDesembolso(this)">
          <i data-lucide="plus"></i> Adicionar
        </button>
      </h4>
      <div id="pt-desemb-rows">
        ${desembolsosRows}
      </div>
    `;
  }

  function rubricaRowHTML(r, idx, rubricaOptions) {
    const code = r?.rubrica_code || '';
    return `
      <div class="pt-rubrica-row" style="display:grid;grid-template-columns:200px 1fr 140px 36px;gap:8px;margin-bottom:8px;align-items:center;">
        <select class="form-input" data-pt-rubrica="code">
          ${RUBRICAS.map(rb => `<option value="${rb.code}" ${rb.code === code ? 'selected' : ''}>${escapeAttr(rb.name)}</option>`).join('')}
        </select>
        <input class="form-input" data-pt-rubrica="descricao_livre" placeholder="Descrição (opcional)" value="${escapeAttr(r?.descricao_livre || '')}">
        <input type="number" step="0.01" class="form-input" data-pt-rubrica="valor" value="${r?.valor_previsto ?? ''}">
        <button type="button" class="btn btn--ghost btn--sm" onclick="this.closest('.pt-rubrica-row').remove()" title="Remover">
          <i data-lucide="trash-2"></i>
        </button>
      </div>`;
  }

  function desembolsoRowHTML(d, idx) {
    return `
      <div class="pt-desemb-row" style="display:grid;grid-template-columns:60px 140px 1fr 140px 36px;gap:8px;margin-bottom:8px;align-items:center;">
        <input type="number" min="1" class="form-input" data-pt-desemb="parcela" value="${d?.parcela ?? (idx + 1)}">
        <input type="date" class="form-input" data-pt-desemb="data_prevista" value="${toInputDate(d?.data_prevista || '')}">
        <input class="form-input" data-pt-desemb="data_texto" placeholder="Texto original (ex: Julho/25)" value="${escapeAttr(d?.data_texto || '')}">
        <input type="number" step="0.01" class="form-input" data-pt-desemb="valor" placeholder="Valor" value="${d?.valor ?? ''}">
        <button type="button" class="btn btn--ghost btn--sm" onclick="this.closest('.pt-desemb-row').remove()" title="Remover">
          <i data-lucide="trash-2"></i>
        </button>
      </div>`;
  }

  function _addRubrica(btn) {
    const container = btn.closest('.modal').querySelector('#pt-rubricas-rows');
    const tmp = document.createElement('div');
    tmp.innerHTML = rubricaRowHTML({}, container.children.length);
    container.appendChild(tmp.firstElementChild);
    lucide.createIcons({ nodes: [container] });
  }

  function _addDesembolso(btn) {
    const container = btn.closest('.modal').querySelector('#pt-desemb-rows');
    const tmp = document.createElement('div');
    tmp.innerHTML = desembolsoRowHTML({}, container.children.length);
    container.appendChild(tmp.firstElementChild);
    lucide.createIcons({ nodes: [container] });
  }

  function collectReviewForm(overlay, extracted) {
    const get = (k) => overlay.querySelector(`[data-pt-field="${k}"]`)?.value || null;
    const num = (k) => {
      const v = get(k);
      return v == null || v === '' ? null : Number(v);
    };
    const rubricas = Array.from(overlay.querySelectorAll('.pt-rubrica-row')).map(row => {
      const code  = row.querySelector('[data-pt-rubrica="code"]')?.value;
      const desc  = row.querySelector('[data-pt-rubrica="descricao_livre"]')?.value || null;
      const valor = Number(row.querySelector('[data-pt-rubrica="valor"]')?.value || 0);
      return { rubrica_code: code, descricao_livre: desc?.trim() || null, valor_previsto: valor };
    }).filter(r => r.rubrica_code && r.valor_previsto > 0);

    const desembolsos = Array.from(overlay.querySelectorAll('.pt-desemb-row')).map((row, i) => {
      const parcela    = parseInt(row.querySelector('[data-pt-desemb="parcela"]')?.value || (i + 1), 10);
      const dataPrev   = row.querySelector('[data-pt-desemb="data_prevista"]')?.value || null;
      const dataTexto  = row.querySelector('[data-pt-desemb="data_texto"]')?.value || null;
      const valor      = row.querySelector('[data-pt-desemb="valor"]')?.value;
      return {
        parcela,
        data_prevista: dataPrev || null,
        data_texto: dataTexto?.trim() || null,
        valor: valor === '' || valor == null ? null : Number(valor),
        valor_texto: null,
      };
    }).filter(d => Number.isInteger(d.parcela) && d.parcela > 0);

    return {
      titulo: get('titulo'),
      coordenador: get('coordenador'),
      prazo_inicio: get('prazo_inicio'),
      prazo_fim: get('prazo_fim'),
      data_documento: get('data_documento'),
      valor_total_plano: num('valor_total_plano'),
      valor_despesas_projeto: num('valor_despesas_projeto'),
      valor_cip: num('valor_cip'),
      valor_dao: num('valor_dao'),
      receita_origem: get('receita_origem'),
      rubricas,
      desembolsos,
    };
  }

  return {
    load, onProjectChange, switchTab, onImportClick, getImportHandlers, revisarPropostaBalancete, rubricaNome,
    visualizar, ativar, excluir, baixar,
    verBalancete, excluirBalancete, baixarBalancete,
    toggleRubrica,
    _addRubrica, _addDesembolso,
  };
})();

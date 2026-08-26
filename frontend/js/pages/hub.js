/* ============================================================
   Hub do Projeto — visão consolidada (somente leitura)
   Junta numa tela só os 4 indicadores-chave de um projeto e
   atalhos "Abrir" para as telas completas de cada área.

   EXPERIMENTAL: aba de teste. Não substitui nenhuma tela
   existente — apenas agrega dados que já vêm das mesmas RPCs.
   Compartilha o projeto selecionado com a aba "Projetos"
   (localStorage cf_selected_project_id) de propósito, para
   testar a ideia de um "projeto atual" único no app.
   ============================================================ */

Router.register('hub', {
  title: 'Visão do Projeto',

  async render(container) {
    await HubPage.load(container);
  }
});


const HubPage = (() => {

  let containerEl       = null;
  let allProjects       = [];
  let selectedProjectId = null;

  // Compartilhado com ProjetosPage de propósito (projeto atual único).
  const STORAGE_KEY = 'cf_selected_project_id';
  const ALERT_DAYS  = 90;   // mesma régua de "encerrando" da aba Bolsistas

  /* ── Load ────────────────────────────────────────────────── */

  async function load(container) {
    containerEl = container;
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

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && allProjects.some(p => p.id === stored)) {
      selectedProjectId = stored;
    } else {
      selectedProjectId = allProjects.find(p => p.active)?.id || allProjects[0].id;
    }

    await renderFull();
  }

  /* ── On dropdown change ─────────────────────────────────── */

  async function onProjectChange(id) {
    selectedProjectId = id;
    localStorage.setItem(STORAGE_KEY, id);
    await renderFull();
  }

  /* ── Navegação para as telas completas ───────────────────── */

  function openIn(page) {
    // Propaga o projeto atual para a tela de destino (onde houver suporte).
    localStorage.setItem('cf_selected_project_id', selectedProjectId);
    localStorage.setItem('cf_plano_trabalho_project_id', selectedProjectId);
    Router.navigate(page);
  }

  /* ── Full render ─────────────────────────────────────────── */

  async function renderFull() {
    if (!selectedProjectId) return;

    containerEl.innerHTML = `
      <div class="proj-selector-bar fade-in">
        <div class="skeleton" style="height:44px;border-radius:10px;width:100%;max-width:420px;"></div>
      </div>
      <div class="skeleton skeleton--card" style="height:120px;margin-top:20px;"></div>
      <div class="skeleton skeleton--card" style="height:320px;margin-top:20px;"></div>`;

    const todayStartStr = localISODate().slice(0, 8) + '01';

    const [projectRes, scholarshipsRes, monthlyRes, prevRealRes, obsRes] = await Promise.all([
      supabaseClient.from('projects').select('*').eq('id', selectedProjectId).single(),
      supabaseClient.from('scholarships')
        .select('amount, start_date, end_date, status, holder:holder_id(full_name)')
        .eq('project_id', selectedProjectId),
      supabaseClient.rpc('calc_project_monthly', {
        p_project_id: selectedProjectId,
        p_start_date: todayStartStr,
        p_balance_status: 'unpaid_current',
      }),
      supabaseClient.rpc('get_previsto_vs_realizado', { p_project_id: selectedProjectId }),
      supabaseClient.from('monitoramento').select('id', { count: 'exact', head: true }).eq('project_id', selectedProjectId),
    ]);

    if (projectRes.error) {
      showToast('Erro ao carregar projeto', 'error');
      return;
    }

    const project      = projectRes.data;
    const scholarships  = scholarshipsRes.data || [];
    const monthlyData   = monthlyRes.data || [];
    const prevReal      = prevRealRes.data || null;
    if (obsRes.error) showToast('Erro ao contar observações: ' + obsRes.error.message, 'error');
    const obsCount      = obsRes.count ?? 0;

    renderView(project, scholarships, monthlyData, prevReal, obsCount);
  }

  /* ── Render view ─────────────────────────────────────────── */

  function renderView(project, scholarships, monthlyData, prevReal, obsCount) {
    const today    = localISODate();

    // KPI 1 — Saldo atual + rendimento (mesma conta da aba Projetos)
    const saldoAtual = Number(project.initial_balance) + Number(project.yield_amount || 0);

    // KPI 2 — Está dentro do orçamento? (Previsto x Realizado)
    const orcamento = computeOrcamento(prevReal);

    // KPI 3 — Bolsas: custo mensal + vencendo
    const activeScholarships = scholarships.filter(s =>
      s.status === 'active' && s.start_date <= today && s.end_date >= today
    );
    const custoMensal = activeScholarships.reduce((sum, s) => sum + Number(s.amount), 0);
    const todayDate = new Date(today + 'T00:00:00');
    const vencendo = activeScholarships.filter(s => {
      const days = Math.ceil((new Date(s.end_date + 'T00:00:00') - todayDate) / 86400000);
      return days <= ALERT_DAYS;
    }).length;

    // KPI 4 — Saldo projetado (último mês da projeção)
    const lastMonth = monthlyData.length > 0 ? monthlyData[monthlyData.length - 1] : null;
    const saldoProjetado = lastMonth ? Number(lastMonth.net_balance) : null;

    containerEl.innerHTML = `

      <!-- ── Banner experimental ── -->
      <div class="fade-in" style="margin-bottom:16px;display:flex;gap:10px;align-items:center;padding:12px 16px;border-radius:10px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.25);color:var(--text-secondary);font-size:0.85rem;">
        <i data-lucide="flask-conical" style="width:18px;height:18px;color:var(--info,#3b82f6);flex-shrink:0;"></i>
        <div>Tela <strong>experimental</strong> — visão consolidada do projeto, somente leitura. Cada bloco tem um botão para abrir a tela completa.</div>
      </div>

      <!-- ── Seletor de projeto ── -->
      <div class="proj-selector-bar fade-in">
        <div class="proj-selector-wrap">
          <i data-lucide="folder-kanban" class="proj-selector-wrap__icon"></i>
          <select id="hub-project-selector" class="proj-selector"
            onchange="HubPage.onProjectChange(this.value)">
            ${(() => {
              const active   = allProjects.filter(p =>  p.active);
              const inactive = allProjects.filter(p => !p.active);
              const renderOpt = p => `<option value="${p.id}" ${p.id === selectedProjectId ? 'selected' : ''}>${escapeAttr(p.name)}${p.code ? ' — ' + escapeAttr(p.code) : ''}</option>`;
              return [
                ...active.map(renderOpt),
                inactive.length
                  ? `<optgroup label="— Inativos —">${inactive.map(renderOpt).join('')}</optgroup>`
                  : ''
              ].join('');
            })()}
          </select>
          <span class="badge badge--${project.active ? 'active' : 'ended'}" style="flex-shrink:0;">
            ${project.active ? 'Ativo' : 'Inativo'}
          </span>
          ${project.drive_folder_url ? `
          <a class="hub-drive-link" href="${escapeAttr(project.drive_folder_url)}"
             target="_blank" rel="noopener noreferrer"
             title="Abrir pasta do projeto no Drive">
            <i data-lucide="folder-open"></i> Drive
          </a>` : ''}
        </div>
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
            ${project.balance_date
              ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">+ rend. em ${formatDate(project.balance_date)}</div>`
              : `<div style="font-size:0.7rem;color:var(--warning);margin-top:2px;">Data do saldo não informada</div>`}
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--${orcamento.color}">
            <i data-lucide="target"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Execução do Orçamento</div>
            <div class="stat-card__value" style="font-size:1.4rem;">${orcamento.value}</div>
            <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">${orcamento.hint}</div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--warning">
            <i data-lucide="wallet"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Bolsas / Mês</div>
            <div class="stat-card__value currency">${formatBRL(custoMensal)}</div>
            <div style="font-size:0.7rem;color:${vencendo > 0 ? 'var(--warning)' : 'var(--text-muted)'};margin-top:2px;">
              ${activeScholarships.length} ativa(s)${vencendo > 0 ? ` · ${vencendo} encerrando em ${ALERT_DAYS}d` : ''}
            </div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-card__icon ${saldoProjetado != null && saldoProjetado < 0 ? 'stat-card__icon--danger' : 'stat-card__icon--info'}">
            <i data-lucide="trending-up"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Saldo Projetado</div>
            <div class="stat-card__value currency ${saldoProjetado != null && saldoProjetado < 0 ? 'currency--negative' : ''}">
              ${saldoProjetado != null ? formatBRL(saldoProjetado) : '—'}
            </div>
            <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">fim da vigência</div>
          </div>
        </div>

      </div>

      <!-- ── Blocos por área ── -->
      <div class="hub-sections fade-in" style="margin-top:24px;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;">

        ${sectionCard({
          icon: 'layers', title: 'Orçamento',
          body: orcamento.sectionBody,
          page: 'plano-trabalho', btnLabel: 'Abrir Plano de Trabalho',
        })}

        ${sectionCard({
          icon: 'users', title: 'Bolsistas',
          body: `<div class="hub-section__metric">${formatBRL(custoMensal)}<span>/mês</span></div>
                 <p class="hub-section__text">${activeScholarships.length} bolsa(s) ativa(s)${vencendo > 0 ? ` · <strong style="color:var(--warning);">${vencendo} encerrando</strong> nos próximos ${ALERT_DAYS} dias` : ''}.</p>`,
          page: 'holders', btnLabel: 'Abrir Bolsistas',
        })}

        ${sectionCard({
          icon: 'file-stack', title: 'Execução (Balancete FUNAPE)',
          body: prevReal && prevReal.has_balancete
            ? `<div class="hub-section__metric">${formatBRL(prevReal.rendimento_liquido)}<span>rend. líq.</span></div>
               <p class="hub-section__text">Último balancete em <strong>${formatDate(prevReal.data_referencia)}</strong>. Gastos por rubrica vêm do PDF da FUNAPE.</p>`
            : `<p class="hub-section__text">Nenhum balancete importado ainda. Importe o PDF da FUNAPE para ver a execução.</p>`,
          page: 'plano-trabalho', btnLabel: 'Abrir Balancetes',
        })}

        ${sectionCard({
          icon: 'clipboard-list', title: 'Observações',
          body: `<div class="hub-section__metric">${obsCount}<span>registros</span></div>
                 <p class="hub-section__text">Acompanhamento pontual do projeto (discrimina acontecimentos entre saldos). Apague quando não for mais relevante.</p>`,
          page: 'monitoramento', btnLabel: 'Abrir Observações',
        })}

        ${sectionCard({
          icon: 'calendar-range', title: 'Vigência & Saldo',
          body: `<p class="hub-section__text" style="margin-bottom:8px;">
                   <strong>${formatDate(project.start_date)}</strong> — <strong>${formatDate(project.end_date)}</strong>
                 </p>
                 <p class="hub-section__text">Saldo atual: <strong class="currency">${formatBRL(saldoAtual)}</strong>${project.balance_date ? ` (em ${formatDate(project.balance_date)})` : ''}.</p>`,
          page: 'saldos', btnLabel: 'Abrir Saldos',
        })}

      </div>
    `;

    lucide.createIcons();
  }

  /* ── Helpers ─────────────────────────────────────────────── */

  // Resume o Previsto x Realizado num KPI e num bloco.
  function computeOrcamento(prevReal) {
    if (!prevReal || prevReal.has_plano === false) {
      return {
        value: '—', color: 'info', hint: 'Sem plano ativo',
        sectionBody: `<p class="hub-section__text">Nenhum plano de trabalho ativo. Importe um plano para acompanhar previsto × realizado.</p>`,
      };
    }
    if (!prevReal.has_balancete) {
      return {
        value: '—', color: 'info', hint: 'Sem balancete',
        sectionBody: `<p class="hub-section__text">Plano ativo, mas sem balancete importado para comparar. Importe um balancete para ver a execução.</p>`,
      };
    }

    const rubricas = Array.isArray(prevReal.rubricas) ? prevReal.rubricas : [];
    let somaPrev = 0, somaReal = 0;
    rubricas.forEach(r => {
      somaPrev += Number(r.previsto || 0);
      somaReal += Number(r.realizado || 0);
    });
    const perc = somaPrev > 0 ? (somaReal / somaPrev) * 100 : null;
    const color = perc == null ? 'info' : perc > 100 ? 'danger' : perc > 90 ? 'warning' : 'success';
    const saldoPlano = somaPrev - somaReal;

    return {
      value: perc == null ? '—' : perc.toFixed(0) + '%',
      color,
      hint: `Resta ${formatBRL(saldoPlano)} do plano`,
      sectionBody: `
        <div class="hub-section__metric">${perc == null ? '—' : perc.toFixed(1) + '%'}<span>executado</span></div>
        <p class="hub-section__text">
          Previsto <strong class="currency">${formatBRL(somaPrev)}</strong> ·
          Realizado <strong class="currency">${formatBRL(somaReal)}</strong>.
        </p>`,
    };
  }

  function sectionCard({ icon, title, body, page, btnLabel }) {
    return `
      <div class="card" style="display:flex;flex-direction:column;">
        <h3 class="card__title" style="margin-bottom:12px;"><i data-lucide="${icon}"></i> ${title}</h3>
        <div style="flex:1;">${body}</div>
        <div style="margin-top:16px;">
          <button class="btn btn--secondary btn--sm" onclick="HubPage.openIn('${page}')">
            ${btnLabel} <i data-lucide="arrow-right"></i>
          </button>
        </div>
      </div>`;
  }

  return {
    load,
    onProjectChange,
    openIn,
  };
})();

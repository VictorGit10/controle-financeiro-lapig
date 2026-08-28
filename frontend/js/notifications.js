/* ============================================================
   Notifications — o sino de alertas do topbar
   ============================================================
   O sino vive no topbar, que é estático e aparece em TODAS as
   telas. Até aqui ele era montado e alimentado por dashboard.js:
   os listeners só eram registrados dentro de DashboardPage.load()
   e os alertas vinham dos projetos marcados no filtro do próprio
   Dashboard.

   Isso produzia dois defeitos de confiança:

     • Como a tela inicial é "Projetos", o primeiro clique no sino
       não fazia nada — não havia listener ainda. O ícone estava
       lá, visível, inerte.
     • Depois de visitar a Visão Geral, o sino passava a mostrar
       os alertas DAQUELE filtro, e continuava exibindo esse
       escopo nas outras telas. Um badge "2 alertas" podia
       significar "2 entre os 3 projetos que você marcou no
       Dashboard", sem nada na tela dizendo isso.

   Um alerta global não pode depender de visita prévia a outra
   tela nem herdar o recorte dela. Aqui ele é montado no boot
   (app.js) e busca os alertas de TODOS os centros de custo
   ativos que o usuário enxerga — o RLS das mig. 033/034 já
   escopa isso no banco, então "todos os que ele enxerga" é
   exatamente a lista certa sem filtro no cliente.
   ============================================================ */

/* exported Notifications -- global de script clássico: consumido por app.js. */
const Notifications = (() => {

  let inited     = false;
  let carregado  = false;   // já houve uma resposta (com ou sem alertas)?
  let alertas    = [];
  let erro       = null;

  /* ── Montagem (uma vez, no boot) ─────────────────────────── */

  function init() {
    if (inited) return;
    const btn   = document.getElementById('notif-bell-btn');
    const panel = document.getElementById('notif-dropdown');
    if (!btn || !panel) return;
    inited = true;

    btn.addEventListener('click', e => {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
    });

    document.addEventListener('click', e => {
      if (!document.getElementById('notif-bell-wrapper')?.contains(e.target)) {
        panel.hidden = true;
      }
    });

    render();
  }

  /* ── Carga ───────────────────────────────────────────────── */

  // Não é `await`-ada pelo boot de propósito: o sino é informação
  // secundária e não deve atrasar a primeira tela.
  async function refresh() {
    const { data: projects, error: projErr } = await supabaseClient
      .from('projects')
      .select('id')
      .eq('active', true);

    if (projErr) {
      erro      = projErr;
      alertas   = [];
      carregado = true;
      render();
      return;
    }

    const ids = (projects || []).map(p => p.id);
    if (ids.length === 0) {
      erro      = null;
      alertas   = [];
      carregado = true;
      render();
      return;
    }

    const { data, error } = await supabaseClient.rpc('get_alerts_for_projects', {
      p_project_ids: ids,
    });

    // Falha vira estado visível no painel, não badge zerado: "nenhum alerta" e
    // "não consegui perguntar" são conclusões diferentes, e a segunda não pode
    // se disfarçar da primeira num sino.
    erro      = error || null;
    alertas   = error ? [] : (data || []);
    carregado = true;
    render();
  }

  /* ── Render ──────────────────────────────────────────────── */

  function render() {
    const badge = document.getElementById('notif-badge');
    const count = document.getElementById('notif-count');
    const list  = document.getElementById('notif-list');
    if (!badge || !count || !list) return;

    // Enquanto a primeira resposta não chega, o painel não pode dizer "tudo
    // certo": ele ainda não perguntou nada. Silêncio otimista num sino de
    // alerta é o mesmo defeito que zero num campo de dinheiro.
    if (!carregado) {
      badge.hidden = true;
      count.textContent = 'consultando…';
      list.innerHTML = '<p class="notif-dropdown__empty">Consultando alertas…</p>';
      return;
    }

    if (erro) {
      badge.hidden = false;
      badge.textContent = '!';
      count.textContent = 'indisponível';
      list.innerHTML = `
        <p class="notif-dropdown__empty">
          Não foi possível consultar os alertas.<br>
          Isto não quer dizer que está tudo certo — recarregue a página.
        </p>`;
      return;
    }

    if (alertas.length === 0) {
      badge.hidden = true;
      count.textContent = 'Nenhum alerta';
      list.innerHTML = '<p class="notif-dropdown__empty">Tudo certo! Nenhum alerta ativo.</p>';
      return;
    }

    badge.hidden = false;
    badge.textContent = alertas.length;
    count.textContent = `${alertas.length} alerta${alertas.length > 1 ? 's' : ''}`;

    list.innerHTML = alertas.map(a => {
      const color = a.severity === 'danger'  ? 'var(--danger)'
                  : a.severity === 'warning' ? 'var(--warning)'
                  : 'var(--info)';
      const icon  = a.severity === 'danger' ? 'alert-triangle' : 'alert-circle';
      return `
        <div class="notif-item" style="border-left-color:${color};">
          <i data-lucide="${icon}" style="color:${color};width:14px;height:14px;flex-shrink:0;"></i>
          <div class="notif-item__body">
            <span class="notif-item__project">${escapeAttr(a.project_name)}</span>
            <span class="notif-item__msg">${escapeAttr(a.message)}</span>
          </div>
        </div>`;
    }).join('');

    lucide.createIcons({ nodes: [list] });
  }

  return { init, refresh };
})();

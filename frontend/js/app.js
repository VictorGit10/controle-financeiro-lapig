/* ============================================================
   App — Main entry point
   ============================================================ */

/* exported App -- global de script clássico: chamado por auth.js e pelo inline de index.html. */
const App = (() => {
  let initialized = false;

  let inicializacao = 0;

  async function init({ novaSessao = false } = {}) {
    const vez = ++inicializacao;
    const usuario = Auth.getUser()?.id;
    const paginaAtual = Router.getCurrent();
    const primeiraPagina = novaSessao || !initialized || !paginaAtual;
    const tarefas = window.BuritiTarefasUI.atualizarMenu();

    // O perfil é carregado pelo Auth antes daqui, inclusive ao trocar de login.
    document.querySelectorAll('li[data-admin]').forEach(li => {
      li.style.display = Auth.isAdmin() ? '' : 'none';
    });
    if (!initialized) {
      initialized = true;
      Router.registerGuard(async (_from, to) => {
        if (to === 'usuarios' && !Auth.isAdmin()) {
          showToast('Acesso restrito a administradores.', 'error');
          return false;
        }
        return true;
      });

      // Sidebar navigation
      document.querySelectorAll('.sidebar__link').forEach(link => {
        link.addEventListener('click', () => {
          const page = link.dataset.page;
          if (page && page !== Router.getCurrent()) Router.navigate(page);
        });
      });

      // Sidebar toggle (mobile)
      const sidebarToggle = document.getElementById('sidebar-toggle');
      const sidebar = document.getElementById('sidebar');

      sidebarToggle?.addEventListener('click', () => {
        sidebar.classList.toggle('sidebar--open');
      });

      // Close sidebar when clicking outside on mobile
      document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 &&
            sidebar.classList.contains('sidebar--open') &&
            !sidebar.contains(e.target) &&
            e.target !== sidebarToggle &&
            !sidebarToggle.contains(e.target)) {
          sidebar.classList.remove('sidebar--open');
        }
      });

      Notifications.init();
    }
    Notifications.refresh();

    // O link explícito prevalece sobre a página inicial. Só a entrada sem
    // centros precisa aguardar a consulta do menu; os demais abrem já.
    let destino = primeiraPagina ? null : paginaAtual;
    if (!destino && window.location.hash === '#minhas-tarefas') destino = 'minhas-tarefas';
    if (!destino) {
      const semCentros = !Auth.isAdmin() && Auth.getAllowedProjectIds().length === 0;
      destino = semCentros && await tarefas === true ? 'minhas-tarefas' : 'projetos';
    }
    // Uma resposta lenta não pode trocar a tela escolhida enquanto carregava,
    // nem navegar com a sessão anterior depois de logout/troca de usuário.
    if (vez !== inicializacao || usuario !== Auth.getUser()?.id || Router.getCurrent() !== paginaAtual) return;
    await Router.navigate(destino, { reload: novaSessao });

    // Initialize icons
    lucide.createIcons();
  }

  return { init };
})();


// Warn before closing/reloading the tab if any page has unsaved changes.
window.addEventListener('beforeunload', (event) => {
  if (Router?.hasUnsavedChanges?.()) {
    event.preventDefault();
    event.returnValue = '';
  }
});

// ── Bootstrap ────────────────────────────────────────────────

// Global error handlers — catch unhandled errors and rejected promises
window.addEventListener('error', (event) => {
  console.error('Erro não tratado:', event.error || event.message);
  if (typeof showToast === 'function') {
    showToast('Ocorreu um erro inesperado. Tente novamente.', 'error');
  }
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Promise rejeitada não tratada:', event.reason);
  if (typeof showToast === 'function') {
    showToast('Erro de comunicação. Verifique sua conexão.', 'error');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide icons
  lucide.createIcons();

  // Check for existing auth session
  Auth.checkSession();

  // Fix para colar números formatados (ex: 86.186,55) em inputs do tipo number
  document.addEventListener('paste', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type === 'number') {
      const pasteData = (e.clipboardData || window.clipboardData).getData('text');
      if (pasteData) {
        let clean = pasteData.trim().replace(/[R$\s]/g, '');
        // Se tem vírgula, assume padrão BR
        if (clean.includes(',')) {
          clean = clean.replace(/\./g, '').replace(',', '.');
        } else if ((clean.match(/\./g) || []).length > 1) {
          // Múltiplos pontos = separadores de milhar
          clean = clean.replace(/\./g, '');
        }

        // Remove tudo que não for dígito, ponto ou sinal de menos
        clean = clean.replace(/[^\d.-]/g, '');

        if (clean !== '' && !isNaN(parseFloat(clean))) {
          e.preventDefault();
          e.target.value = clean;
          e.target.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }
  });
});

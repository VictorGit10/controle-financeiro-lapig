/* ============================================================
   App — Main entry point
   ============================================================ */

const App = (() => {
  let initialized = false;

  function init() {
    if (initialized) {
      // Just navigate to current or dashboard
      Router.navigate(Router.getCurrent() || 'saldos');
      return;
    }

    initialized = true;

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

    // Navigate to projetos (default landing page)
    Router.navigate('projetos');

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

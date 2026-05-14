/* ============================================================
   Router — Simple page navigation
   ============================================================ */

const Router = (() => {
  const pages = {};
  let currentPage = null;

  const pageTitle = document.getElementById('page-title');
  const pageContent = document.getElementById('page-content');
  const pageActions = document.getElementById('page-actions');
  const sidebarLinks = document.querySelectorAll('.sidebar__link');

  function register(name, { title, icon, render, actions }) {
    pages[name] = { title, icon, render, actions };
  }

  async function navigate(pageName) {
    const page = pages[pageName];
    if (!page) {
      console.warn(`Page "${pageName}" not registered.`);
      return;
    }

    currentPage = pageName;

    // Update sidebar active state
    sidebarLinks.forEach(link => {
      link.classList.toggle('sidebar__link--active', link.dataset.page === pageName);
    });

    // Update topbar
    pageTitle.textContent = page.title;
    pageActions.innerHTML = '';

    // Add page actions if defined
    if (page.actions) {
      page.actions(pageActions);
      lucide.createIcons({ nodes: [pageActions] });
    }

    // Clear and render content
    pageContent.innerHTML = '<div class="skeleton skeleton--card" style="height: 200px;"></div>';
    
    try {
      await page.render(pageContent);
    } catch (err) {
      console.error(`Error rendering page "${pageName}":`, err);
      pageContent.innerHTML = `
        <div class="empty-state">
          <i data-lucide="alert-triangle" class="empty-state__icon"></i>
          <h3 class="empty-state__title">Erro ao carregar</h3>
          <p class="empty-state__text">${escapeAttr(err.message)}</p>
        </div>
      `;
    }

    lucide.createIcons();

    // Close sidebar on mobile after navigation
    document.getElementById('sidebar')?.classList.remove('sidebar--open');
  }

  function getCurrent() {
    return currentPage;
  }

  return { register, navigate, getCurrent };
})();

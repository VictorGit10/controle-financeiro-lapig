/* ============================================================
   Supabase Config — Connection to the database
   ============================================================ */

const SUPABASE_URL  = 'https://skxiivmkhpegefafdlty.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_cWm8BfwIb2JQ-WIOOjkQfA_jvTt7OmG';

// Sentry error monitoring — only initializes if SENTRY_DSN is set
// Set window.SENTRY_DSN before this script loads to enable.
if (window.SENTRY_DSN) {
  const s = document.createElement('script');
  s.src = 'https://js.sentry-cdn.com/' + encodeURIComponent(window.SENTRY_DSN) + '.min.js';
  s.crossOrigin = 'anonymous';
  s.onload = function() {
    if (window.Sentry) {
      window.Sentry.init({
        environment: window.SENTRY_ENV || 'production',
        release: window.SENTRY_RELEASE || undefined,
      });
    }
  };
  document.head.appendChild(s);
}

// Create client and assign it to the global object. 
// This overwrites the library namespace avoiding the "Identifier 'supabase' has already been declared" SyntaxError.
window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Utility: Show toast notification
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container') || createToastContainer();
  
  const iconMap = {
    success: 'check-circle',
    error: 'x-circle',
    info: 'info',
  };

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  const icon = document.createElement('i');
  icon.setAttribute('data-lucide', iconMap[type] || 'info');
  const span = document.createElement('span');
  span.textContent = message;
  toast.appendChild(icon);
  toast.appendChild(span);

  container.appendChild(toast);
  lucide.createIcons({ nodes: [toast] });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function createToastContainer() {
  const container = document.createElement('div');
  container.id = 'toast-container';
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

// Utility: Create modal
function createModal({ title, bodyHTML, onSave, saveLabel = 'Salvar', saveClass = 'btn--primary', maxWidth = '520px', onClose, hideCancelBtn = false }) {
  // Remove existing modal
  const existing = document.querySelector('.modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width: ${maxWidth}">
      <div class="modal__header">
        <h3 class="modal__title">${escapeAttr(title)}</h3>
        <button class="modal__close" data-modal-close>
          <i data-lucide="x"></i>
        </button>
      </div>
      <div class="modal__body">
        ${bodyHTML}
      </div>
      <div class="modal__footer">
        <button class="btn btn--secondary" data-modal-close style="${hideCancelBtn ? 'display:none;' : ''}">Cancelar</button>
        <button class="btn ${saveClass}" id="modal-save-btn">${saveLabel}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  lucide.createIcons({ nodes: [overlay] });

  // Close handlers
  const closeModal = () => { if (onClose) onClose(); overlay.remove(); };
  overlay.querySelectorAll('[data-modal-close]').forEach(el => {
    el.addEventListener('click', closeModal);
  });
  
  // Fix para evitar fechamento acidental ao soltar o clique fora do modal
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) {
      overlay.dataset.mousedownOnOverlay = 'true';
    } else {
      overlay.dataset.mousedownOnOverlay = 'false';
    }
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && overlay.dataset.mousedownOnOverlay === 'true') {
      closeModal();
    }
  });

  // Save handler
  const saveBtn = overlay.querySelector('#modal-save-btn');
  if (onSave) {
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Salvando...';
      try {
        await onSave();
        closeModal();
      } catch (err) {
        showToast(err.message || 'Erro ao salvar', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = saveLabel;
      }
    });
  }

  return { overlay, closeModal };
}

// Utility: Confirm dialog
function confirmAction(message) {
  return new Promise((resolve) => {
    createModal({
      title: 'Confirmar',
      bodyHTML: `<p style="color: var(--text-secondary);">${escapeAttr(message)}</p>`,
      saveLabel: 'Confirmar',
      saveClass: 'btn--danger',
      onSave: async () => resolve(true),
      onClose: () => resolve(false),
    });
  });
}

// Utility: Handle Supabase response (centralized error handling)
function handleSupabaseResponse({ data, error }, errorMsg = 'Erro na operação') {
  if (error) {
    showToast(`${errorMsg}: ${error.message}`, 'error');
    return null;
  }
  return data;
}

// Utility: Export data to CSV
function exportToCSV(data, columns, filename) {
  const header = columns.map(c => c.label).join(';');
  const rows = data.map(row =>
    columns.map(c => {
      let val = c.csvRender ? c.csvRender(row) : c.render(row);
      // Strip HTML tags for CSV
      val = String(val).replace(/<[^>]*>/g, '').trim();
      // Escape quotes and wrap in quotes if contains separator
      if (val.includes(';') || val.includes('"') || val.includes('\n')) {
        val = '"' + val.replace(/"/g, '""') + '"';
      }
      return val;
    }).join(';')
  );
  const csv = '\uFEFF' + header + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

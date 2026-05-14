/* ============================================================
   docx-split-view.js
   Split-view para DOCX: HTML convertido por mammoth (esquerda)
   + slot HTML (direita) para tabela editável de rubricas.

   Uso:
     await mountDocxSplitView(container, {
       file:        File,                   // .docx
       rightHTML:   string,                 // form de revisão
       onMount:     (rightEl) => { ... },
     });

   Requer `mammoth` global (carregado em index.html).
   Retorna { html, root, rightEl, destroy } — html é a string
   HTML produzida por mammoth (caso o caller precise).
   ============================================================ */

const STYLES = `
.dxsv-root {
  display: flex;
  gap: 12px;
  width: 100%;
  min-height: 620px;
  height: 82vh;
  max-height: 88vh;
}
.dxsv-pane {
  flex: 1 1 50%;
  min-width: 0;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary, #f8f9fa);
  display: flex;
  flex-direction: column;
}
.dxsv-pane--right {
  background: var(--bg-primary, #fff);
  overflow: auto;
  padding: 12px;
}
.dxsv-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-primary, #fff);
  border-radius: 6px 6px 0 0;
  font-size: 13px;
}
.dxsv-toolbar label.dxsv-highlight-toggle {
  display: inline-flex; align-items: center; gap: 4px; cursor: pointer;
  color: var(--text-secondary);
}
.dxsv-content {
  flex: 1;
  overflow: auto;
  padding: 16px 20px;
  background: #fafafa;
  font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
  font-size: 14px;
  color: #222;
  line-height: 1.4;
}
.dxsv-content table {
  border-collapse: collapse;
  width: 100%;
  margin: 8px 0;
  background: #fff;
}
.dxsv-content th, .dxsv-content td {
  border: 1px solid #d0d0d0;
  padding: 4px 6px;
  vertical-align: top;
  text-align: left;
  font-size: 13px;
}
.dxsv-content th { background: #f0f0f0; }
.dxsv-content p { margin: 4px 0; }
.dxsv-content h1, .dxsv-content h2, .dxsv-content h3 {
  margin: 12px 0 6px 0;
  color: #111;
}
.dxsv-content img { max-width: 100%; height: auto; }
.dxsv-hl { background: rgba(252, 211, 77, 0.55); border-radius: 2px; }
@media (max-width: 900px) {
  .dxsv-root { flex-direction: column; height: auto; max-height: none; }
  .dxsv-pane { flex: 0 0 auto; min-height: 380px; }
}
`;

function ensureStyles() {
  if (document.getElementById('dxsv-styles')) return;
  const tag = document.createElement('style');
  tag.id = 'dxsv-styles';
  tag.textContent = STYLES;
  document.head.appendChild(tag);
}

const RE_NUMERO_MONETARIO = /^\(?\d{1,3}(?:\.\d{3})*,\d{2}\)?$/;

/**
 * Aplica destaque amarelo a nodes-folha de texto que casem com valor monetário.
 * Faz mutação no DOM da árvore passada.
 */
function applyHighlight(rootEl) {
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
  const toWrap = [];
  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue;
    if (!text) continue;
    // Tokeniza por espaço, identifica os que parecem valor monetário.
    const tokens = text.split(/(\s+)/);
    if (!tokens.some((t) => RE_NUMERO_MONETARIO.test(t.trim()))) continue;
    toWrap.push({ node, tokens });
  }
  for (const { node, tokens } of toWrap) {
    const frag = document.createDocumentFragment();
    for (const t of tokens) {
      if (RE_NUMERO_MONETARIO.test(t.trim())) {
        const span = document.createElement('span');
        span.className = 'dxsv-hl';
        span.textContent = t;
        frag.appendChild(span);
      } else {
        frag.appendChild(document.createTextNode(t));
      }
    }
    node.parentNode.replaceChild(frag, node);
  }
}

function removeHighlight(rootEl) {
  rootEl.querySelectorAll('span.dxsv-hl').forEach((s) => {
    const parent = s.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(s.textContent || ''), s);
    parent.normalize();
  });
}

export async function mountDocxSplitView(container, opts = {}) {
  ensureStyles();
  if (typeof mammoth === 'undefined') {
    throw new Error('mammoth.js não está carregado.');
  }
  if (!opts.file) {
    throw new Error('mountDocxSplitView: opts.file é obrigatório.');
  }

  container.innerHTML = `
    <div class="dxsv-root">
      <div class="dxsv-pane dxsv-pane--left">
        <div class="dxsv-toolbar">
          <span style="color:var(--text-secondary);">📄 ${escape(opts.file.name || 'documento.docx')}</span>
          <span style="flex:1;"></span>
          <label class="dxsv-highlight-toggle" title="Destacar valores monetários">
            <input type="checkbox" class="dxsv-toggle-hl" checked> Destacar valores
          </label>
        </div>
        <div class="dxsv-content">Convertendo DOCX…</div>
      </div>
      <div class="dxsv-pane dxsv-pane--right">${opts.rightHTML || ''}</div>
    </div>
  `;

  const root      = container.querySelector('.dxsv-root');
  const contentEl = container.querySelector('.dxsv-content');
  const toggleHl  = container.querySelector('.dxsv-toggle-hl');
  const rightEl   = container.querySelector('.dxsv-pane--right');

  // Aceita HTML pré-computado para evitar conversão dupla pelo mammoth.
  let html = typeof opts.html === 'string' ? opts.html : null;
  if (!html) {
    const buf = await opts.file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer: buf });
    html = result.value;
  }

  contentEl.innerHTML = html;
  if (toggleHl.checked) applyHighlight(contentEl);

  toggleHl.addEventListener('change', () => {
    if (toggleHl.checked) applyHighlight(contentEl);
    else removeHighlight(contentEl);
  });

  if (typeof opts.onMount === 'function') opts.onMount(rightEl);

  return {
    html,
    root,
    rightEl,
    destroy() { container.innerHTML = ''; },
  };
}

function escape(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]
  ));
}

// ── Browser bridge ─────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.mountDocxSplitView = mountDocxSplitView;
}

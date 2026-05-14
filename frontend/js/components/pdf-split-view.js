/* ============================================================
   pdf-split-view.js
   Componente: PDF renderizado em canvas (esquerda) + slot HTML
   (direita) para revisão lado-a-lado de dados extraídos.

   Uso:
     import { mountPdfSplitView } from './components/pdf-split-view.js';
     const view = await mountPdfSplitView(container, {
       pdfData:   ArrayBuffer | Uint8Array,
       rightHTML: string,
       onMount:   (rightEl) => { ...delegate eventos no rightEl... },
     });
     // ...
     view.destroy();

   Depende de pdf.js global (`pdfjsLib`), que já é carregado no
   index.html.
   ============================================================ */

const STYLES = `
.pdfsv-root {
  display: flex;
  gap: 12px;
  width: 100%;
  min-height: 620px;
  height: 82vh;
  max-height: 88vh;
}
.pdfsv-pane {
  flex: 1 1 50%;
  min-width: 0;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary, #f8f9fa);
  display: flex;
  flex-direction: column;
}
.pdfsv-pane--right {
  background: var(--bg-primary, #fff);
  overflow: auto;
  padding: 12px;
}
.pdfsv-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-primary, #fff);
  border-radius: 6px 6px 0 0;
  font-size: 13px;
}
.pdfsv-toolbar button {
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.pdfsv-toolbar button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pdfsv-toolbar .pdfsv-page-info {
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}
.pdfsv-toolbar select,
.pdfsv-toolbar label {
  border-radius: 4px;
  padding: 2px 4px;
  font-size: 13px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary);
}
.pdfsv-toolbar select { border: 1px solid var(--border-color); }
.pdfsv-toolbar label.pdfsv-highlight-toggle {
  display: inline-flex; align-items: center; gap: 4px; cursor: pointer;
  color: var(--text-secondary);
}
.pdfsv-canvas-scroll {
  flex: 1;
  overflow: auto;
  padding: 12px;
  background: #e5e7eb;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}
.pdfsv-canvas-wrap {
  position: relative;
  box-shadow: 0 1px 4px rgba(0,0,0,0.15);
  background: #fff;
  line-height: 1;
}
.pdfsv-canvas-wrap canvas { display: block; }
.pdfsv-textlayer {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  overflow: hidden;
  opacity: 0.999; /* mantém renderização */
  line-height: 1.0;
  pointer-events: none;
}
.pdfsv-textlayer > span {
  color: transparent;            /* texto invisível, só queremos o highlight */
  position: absolute;
  white-space: pre;
  transform-origin: 0% 0%;
}
.pdfsv-textlayer > span.pdfsv-hl {
  background: rgba(252, 211, 77, 0.55); /* amarelo */
  border-radius: 2px;
  mix-blend-mode: multiply;
}
@media (max-width: 900px) {
  .pdfsv-root { flex-direction: column; height: auto; max-height: none; }
  .pdfsv-pane { flex: 0 0 auto; min-height: 380px; }
}
`;

function ensureStyles() {
  if (document.getElementById('pdfsv-styles')) return;
  const tag = document.createElement('style');
  tag.id = 'pdfsv-styles';
  tag.textContent = STYLES;
  document.head.appendChild(tag);
}

const ZOOM_OPTIONS = [
  { value: 0.75, label: '75%' },
  { value: 1.0,  label: '100%' },
  { value: 1.25, label: '125%' },
  { value: 1.5,  label: '150%' },
  { value: 2.0,  label: '200%' },
];

export async function mountPdfSplitView(container, opts = {}) {
  ensureStyles();
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('pdf.js (pdfjsLib) não está carregado.');
  }
  if (!opts.pdfData) {
    throw new Error('mountPdfSplitView: pdfData é obrigatório.');
  }

  container.innerHTML = `
    <div class="pdfsv-root">
      <div class="pdfsv-pane pdfsv-pane--left">
        <div class="pdfsv-toolbar">
          <button type="button" class="pdfsv-prev" title="Página anterior">‹</button>
          <span class="pdfsv-page-info">Pág. <span class="pdfsv-cur">–</span> de <span class="pdfsv-total">–</span></span>
          <button type="button" class="pdfsv-next" title="Próxima página">›</button>
          <span style="flex:1;"></span>
          <label class="pdfsv-highlight-toggle" title="Destaca valores monetários no PDF">
            <input type="checkbox" class="pdfsv-toggle-hl" checked> Destacar valores
          </label>
          <label style="font-size:12px;color:var(--text-secondary);margin-left:8px;">Zoom</label>
          <select class="pdfsv-zoom">
            ${ZOOM_OPTIONS.map(o => `<option value="${o.value}" ${o.value === 1.25 ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </div>
        <div class="pdfsv-canvas-scroll">
          <div class="pdfsv-canvas-wrap">
            <canvas class="pdfsv-canvas"></canvas>
            <div class="pdfsv-textlayer"></div>
          </div>
        </div>
      </div>
      <div class="pdfsv-pane pdfsv-pane--right">${opts.rightHTML || ''}</div>
    </div>
  `;

  const root        = container.querySelector('.pdfsv-root');
  const canvas      = container.querySelector('.pdfsv-canvas');
  const ctx         = canvas.getContext('2d');
  const btnPrev     = container.querySelector('.pdfsv-prev');
  const btnNext     = container.querySelector('.pdfsv-next');
  const elCur       = container.querySelector('.pdfsv-cur');
  const elTotal     = container.querySelector('.pdfsv-total');
  const selZoom     = container.querySelector('.pdfsv-zoom');
  const toggleHl    = container.querySelector('.pdfsv-toggle-hl');
  const textLayerEl = container.querySelector('.pdfsv-textlayer');
  const canvasWrap  = container.querySelector('.pdfsv-canvas-wrap');
  const rightEl     = container.querySelector('.pdfsv-pane--right');

  const pdf = await pdfjsLib.getDocument({ data: opts.pdfData }).promise;
  let currentPage = 1;
  let currentZoom = 1.25;
  let renderTask = null;

  elTotal.textContent = String(pdf.numPages);

  // Regex que casa "valores monetários" no PDF (1.234,56 ou (1.234,56) ou 0,00).
  // Não casa números avulsos curtos como "3224" ou códigos de conta.
  const RE_NUMERO_MONETARIO = /^\(?\d{1,3}(?:\.\d{3})*,\d{2}\)?$/;

  function renderTextLayer(textContent, viewport) {
    textLayerEl.innerHTML = '';
    const cssScale = 1 / (window.devicePixelRatio || 1);
    const cssW = viewport.width  * cssScale;
    const cssH = viewport.height * cssScale;
    textLayerEl.style.width  = cssW + 'px';
    textLayerEl.style.height = cssH + 'px';

    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) continue;
      const [a, b, c, d, e, f] = item.transform;
      // No pdf.js, a transform mapeia origem (0,0) no canto inferior-esquerdo
      // do PDF para coordenadas do viewport (origem topo-esquerda).
      const m = pdfjsLib.Util.transform(viewport.transform, [a, b, c, d, e, f]);
      const fontHeight = Math.hypot(m[2], m[3]);
      const left = m[4] * cssScale;
      const top  = (m[5] - fontHeight) * cssScale;
      const angle = Math.atan2(m[1], m[0]);

      const span = document.createElement('span');
      span.textContent = item.str;
      span.style.left = left + 'px';
      span.style.top  = top  + 'px';
      span.style.fontSize = (fontHeight * cssScale) + 'px';
      span.style.fontFamily = item.fontName || 'sans-serif';
      if (angle !== 0) span.style.transform = `rotate(${angle}rad)`;

      // Destaque para valores monetários.
      if (RE_NUMERO_MONETARIO.test(item.str.trim())) {
        span.classList.add('pdfsv-hl');
      }
      textLayerEl.appendChild(span);
    }
    textLayerEl.style.display = toggleHl.checked ? '' : 'none';
  }

  async function renderPage(num) {
    if (renderTask) {
      try { renderTask.cancel(); } catch { /* noop */ }
    }
    const page = await pdf.getPage(num);
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: currentZoom * dpr });
    canvas.width  = viewport.width;
    canvas.height = viewport.height;
    const cssW = viewport.width  / dpr;
    const cssH = viewport.height / dpr;
    canvas.style.width  = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvasWrap.style.width  = cssW + 'px';
    canvasWrap.style.height = cssH + 'px';

    renderTask = page.render({ canvasContext: ctx, viewport });
    try { await renderTask.promise; } catch (e) {
      if (e?.name !== 'RenderingCancelledException') throw e;
    }

    // Text layer com destaque (tolerante a falha — PDF ainda fica visível).
    try {
      const textContent = await page.getTextContent();
      renderTextLayer(textContent, viewport);
    } catch (e) {
      console.warn('pdf-split-view: falha ao montar text layer:', e.message);
      textLayerEl.innerHTML = '';
    }

    elCur.textContent = String(num);
    btnPrev.disabled = num <= 1;
    btnNext.disabled = num >= pdf.numPages;
  }

  btnPrev.addEventListener('click', () => {
    if (currentPage > 1) { currentPage -= 1; renderPage(currentPage); }
  });
  btnNext.addEventListener('click', () => {
    if (currentPage < pdf.numPages) { currentPage += 1; renderPage(currentPage); }
  });
  selZoom.addEventListener('change', () => {
    currentZoom = Number(selZoom.value) || 1.0;
    renderPage(currentPage);
  });
  toggleHl.addEventListener('change', () => {
    textLayerEl.style.display = toggleHl.checked ? '' : 'none';
  });

  await renderPage(1);
  if (typeof opts.onMount === 'function') opts.onMount(rightEl);

  return {
    root,
    rightEl,
    setRight(html) { rightEl.innerHTML = html; },
    destroy() {
      if (renderTask) { try { renderTask.cancel(); } catch { /* noop */ } }
      try { pdf.destroy(); } catch { /* noop */ }
      container.innerHTML = '';
    },
  };
}

// ── Browser bridge ─────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.mountPdfSplitView = mountPdfSplitView;
}

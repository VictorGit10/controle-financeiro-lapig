/* ============================================================
   ImportQueue — fila genérica de importação com revisão
   ============================================================
   Seleciona N arquivos e percorre uma fila: a tela de revisão
   de cada handler aparece para cada arquivo, com "arquivo X
   de N" e botões Salvar / Pular (human-in-the-loop).

   Aceita um ou vários handlers; com vários, cada arquivo é
   roteado para o primeiro handler cujo validExt() aceite o
   nome (ex.: PDF → balancete, DOCX → plano, XLSX → bolsas).

   Contrato do handler:
     type        string  — id do tipo ('plano' | 'balancete' | 'bolsas')
     badge       string  — rótulo curto exibido ao lado do arquivo
     title       string  — título do modal (usado no modo handler único)
     accept      string  — extensões para o <input type="file">
     extLabel    string  — rótulo das extensões aceitas
     checkDeps() — lança Error se alguma lib não carregou
     validExt(name) → bool
     parse(file) → extracted            (lança Error se ilegível)
     renderReview(host, extracted, file) → view opcional c/ destroy()
     save(host, extracted, file) → { label?, newMappings? }
     afterAllSaved()? — chamado 1x se o handler salvou ≥1 arquivo

   Uso:
     ImportQueue.open({
       title,                 // opcional (default: handler único ou genérico)
       handlers: [h1, h2],
       onFinished(summary),   // { saved, skipped, errored, newMappings, savedByType }
     });
   ============================================================ */

/* exported ImportQueue */
const ImportQueue = (() => {

  function open({ title, handlers, onFinished }) {
    if (!Array.isArray(handlers) || handlers.length === 0) return;

    for (const h of handlers) {
      try { if (typeof h.checkDeps === 'function') h.checkDeps(); }
      catch (e) { showToast(e.message, 'error'); return; }
    }

    const accept   = handlers.map(h => h.accept).join(',');
    const extLabel = handlers.map(h => h.extLabel).filter((v, i, a) => a.indexOf(v) === i).join(' / ');

    const files        = [];   // File[]
    const fileHandlers = [];   // handler por índice (roteado no addFiles)
    let   index        = 0;
    let   phase        = 'selection';   // 'selection' | 'review'
    const results      = [];            // [{ name, status, label?, type? }]
    const parsedCache  = [];            // extracted por índice (lazy)
    let   currentView  = null;          // split-view atual (p/ destroy)
    let   newMappings  = 0;
    let   finalized    = false;

    const { overlay, closeModal } = createModal({
      title: title || (handlers.length === 1 ? handlers[0].title : 'Importar arquivos'),
      bodyHTML: `<div id="iq-body"></div>`,
      maxWidth: '95vw',
      saveLabel: 'Continuar',
      onClose: finalize,
    });

    const bodyEl  = overlay.querySelector('#iq-body');
    const saveBtn = overlay.querySelector('#modal-save-btn');
    saveBtn.addEventListener('click', onSaveClick);

    renderSelection();

    function handlerFor(name) {
      return handlers.find(h => h.validExt(name)) || null;
    }

    function badgeHTML(handler) {
      if (!handler || !handler.badge || handlers.length === 1) return '';
      return `<span style="font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;background:var(--bg-secondary);color:var(--text-secondary);border:1px solid var(--border-color);white-space:nowrap;">${escapeAttr(handler.badge)}</span>`;
    }

    /* — Tela A: seleção de arquivos — */
    function renderSelection() {
      phase = 'selection';
      bodyEl.innerHTML = `
        <p style="color:var(--text-secondary);margin-bottom:12px;">
          Selecione um ou vários arquivos <strong>${extLabel}</strong>. Você vai revisar e confirmar cada um, um por vez.
        </p>
        <label id="iq-drop" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:28px;border:2px dashed var(--border-color);border-radius:10px;cursor:pointer;text-align:center;color:var(--text-secondary);">
          <i data-lucide="upload-cloud" style="width:32px;height:32px;"></i>
          <span>Arraste os arquivos aqui ou <strong>clique para escolher</strong></span>
          <input type="file" id="iq-file" accept="${accept}" multiple hidden>
        </label>
        <div id="iq-filelist" style="margin-top:12px;"></div>`;
      lucide.createIcons({ nodes: [bodyEl] });
      saveBtn.removeAttribute('hidden');
      saveBtn.textContent = 'Continuar';
      saveBtn.disabled = files.length === 0;

      const input = bodyEl.querySelector('#iq-file');
      const drop  = bodyEl.querySelector('#iq-drop');
      input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
      drop.addEventListener('dragover',  (e) => { e.preventDefault(); drop.style.borderColor = 'var(--accent)'; });
      drop.addEventListener('dragleave', () => { drop.style.borderColor = 'var(--border-color)'; });
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.style.borderColor = 'var(--border-color)';
        addFiles(e.dataTransfer.files);
      });
      renderFileList();
    }

    function addFiles(fileList) {
      for (const f of Array.from(fileList || [])) {
        const h = handlerFor(f.name);
        if (!h) {
          showToast(`"${f.name}" ignorado — não é ${extLabel}.`, 'error');
          continue;
        }
        if (files.some(x => x.name === f.name && x.size === f.size)) continue;   // evita duplicata
        files.push(f);
        fileHandlers.push(h);
      }
      renderFileList();
      saveBtn.disabled = files.length === 0;
    }

    function renderFileList() {
      const listEl = bodyEl.querySelector('#iq-filelist');
      if (!listEl) return;
      if (files.length === 0) { listEl.innerHTML = ''; return; }
      listEl.innerHTML = `
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:6px;">${files.length} arquivo(s) selecionado(s):</div>
        <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:4px;">
          ${files.map((f, i) => `
            <li style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-elevated);border-radius:6px;font-size:13px;">
              <i data-lucide="file" style="width:16px;height:16px;color:var(--text-secondary);flex-shrink:0;"></i>
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeAttr(f.name)}</span>
              ${badgeHTML(fileHandlers[i])}
              <span style="color:var(--text-muted);font-size:11px;">${(f.size / 1024).toFixed(0)} KB</span>
              <button class="btn btn--ghost btn--sm" data-iq-remove="${i}" title="Remover" style="color:var(--danger);padding:2px 6px;">
                <i data-lucide="x" style="width:14px;height:14px;"></i>
              </button>
            </li>`).join('')}
        </ul>`;
      lucide.createIcons({ nodes: [listEl] });
      listEl.querySelectorAll('[data-iq-remove]').forEach(btn => {
        btn.addEventListener('click', () => {
          const i = Number(btn.getAttribute('data-iq-remove'));
          files.splice(i, 1);
          fileHandlers.splice(i, 1);
          renderFileList();
          saveBtn.disabled = files.length === 0;
        });
      });
    }

    /* — Botão principal (muda de papel conforme a fase) — */
    async function onSaveClick() {
      if (phase === 'selection') {
        if (files.length === 0) return;
        phase = 'review';
        index = 0;
        await processIndex();
        return;
      }
      await saveCurrent();
    }

    /* — Cabeçalho de progresso "Arquivo X de N" + pontos — */
    function progressHeaderHTML(showSkip) {
      const f = files[index];
      const dots = files.map((_, i) => {
        const r = results[i];
        const color = i < index
          ? (r?.status === 'saved' ? 'var(--success)' : r?.status === 'error' ? 'var(--danger)' : 'var(--text-muted)')
          : (i === index ? 'var(--accent)' : 'var(--border-color)');
        return `<span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block;"></span>`;
      }).join('');
      return `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--border-color);flex-wrap:wrap;">
          <div style="font-weight:600;color:var(--text-primary);white-space:nowrap;">Arquivo ${index + 1} de ${files.length}</div>
          <div style="flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary);font-size:13px;">${escapeAttr(f.name)}</div>
          ${badgeHTML(fileHandlers[index])}
          <div style="display:flex;gap:4px;align-items:center;">${dots}</div>
          ${showSkip ? `<button class="btn btn--ghost btn--sm" id="iq-skip"><i data-lucide="skip-forward"></i> Pular</button>` : ''}
        </div>`;
    }

    function wireSkip() {
      const skipBtn = bodyEl.querySelector('#iq-skip');
      if (skipBtn) skipBtn.addEventListener('click', skipCurrent);
    }

    /* — Processa o arquivo do índice atual (parse lazy → revisão) — */
    async function processIndex() {
      destroyView();
      if (index >= files.length) { finish(); return; }

      const file    = files[index];
      const handler = fileHandlers[index];

      bodyEl.innerHTML = `
        ${progressHeaderHTML(false)}
        <div style="text-align:center;padding:32px;">
          <i data-lucide="loader-2" class="spin" style="width:32px;height:32px;color:var(--accent);"></i>
          <p style="margin-top:12px;color:var(--text-secondary);">Lendo ${escapeAttr(file.name)}…</p>
        </div>`;
      lucide.createIcons({ nodes: [bodyEl] });
      saveBtn.setAttribute('hidden', '');

      let extracted = parsedCache[index];
      if (!extracted) {
        try {
          extracted = await handler.parse(file);
          parsedCache[index] = extracted;
        } catch (err) {
          renderParseError(file, err);
          return;
        }
      }

      bodyEl.innerHTML = progressHeaderHTML(true);
      const host = document.createElement('div');
      host.id = 'iq-review-host';
      bodyEl.appendChild(host);
      try {
        currentView = await handler.renderReview(host, extracted, file);
      } catch (err) {
        renderParseError(file, err);
        return;
      }
      lucide.createIcons({ nodes: [bodyEl] });
      wireSkip();

      saveBtn.removeAttribute('hidden');
      saveBtn.disabled = false;
      saveBtn.textContent = index === files.length - 1 ? 'Salvar e concluir' : 'Salvar e próximo';
    }

    function renderParseError(file, err) {
      results[index] = { name: file.name, status: 'error', error: err.message, type: fileHandlers[index]?.type };
      bodyEl.innerHTML = progressHeaderHTML(true);
      const box = document.createElement('div');
      box.innerHTML = `
        <div class="callout callout--warning" style="margin:12px 0;">
          <i data-lucide="alert-triangle"></i>
          <div>
            <strong>Não foi possível processar ${escapeAttr(file.name)}</strong>
            <p style="margin:4px 0 0;">${escapeAttr(err.message || 'Erro desconhecido.')}</p>
          </div>
        </div>
        <p style="color:var(--text-secondary);font-size:13px;">Pule este arquivo para continuar com os demais.</p>`;
      bodyEl.appendChild(box);
      lucide.createIcons({ nodes: [bodyEl] });
      wireSkip();
      saveBtn.setAttribute('hidden', '');   // só o "Pular" avança
    }

    async function saveCurrent() {
      const host = bodyEl.querySelector('#iq-review-host');
      const extracted = parsedCache[index];
      if (!host || !extracted) { skipCurrent(); return; }

      const handler   = fileHandlers[index];
      const origLabel = saveBtn.textContent;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Salvando…';
      try {
        const r = await handler.save(host, extracted, files[index]);
        results[index] = { name: files[index].name, status: 'saved', label: r?.label, type: handler.type };
        if (r?.newMappings) newMappings += r.newMappings;
        advance();
      } catch (err) {
        showToast(err.message || 'Erro ao salvar.', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = origLabel;
      }
    }

    function skipCurrent() {
      if (!results[index]) results[index] = { name: files[index].name, status: 'skipped', type: fileHandlers[index]?.type };
      advance();
    }

    function advance() {
      index += 1;
      if (index >= files.length) finish();
      else processIndex();
    }

    function destroyView() {
      if (currentView && typeof currentView.destroy === 'function') {
        try { currentView.destroy(); } catch { /* noop */ }
      }
      currentView = null;
    }

    function finish() {
      closeModal();   // dispara onClose → finalize()
    }

    // Finalização única (chamada tanto por concluir quanto por Cancelar).
    function finalize() {
      if (finalized) return;
      finalized = true;
      destroyView();

      const saved   = results.filter(r => r?.status === 'saved').length;
      const skipped = results.filter(r => r?.status === 'skipped').length;
      const errored = results.filter(r => r?.status === 'error').length;

      const savedByType = {};
      results.forEach(r => {
        if (r?.status === 'saved' && r.type) savedByType[r.type] = (savedByType[r.type] || 0) + 1;
      });

      if (saved || skipped || errored) {
        const parts = [];
        if (saved)   parts.push(`${saved} salvo(s)`);
        if (skipped) parts.push(`${skipped} pulado(s)`);
        if (errored) parts.push(`${errored} com erro`);
        showToast(parts.join(' · '), saved ? 'success' : 'info');
      }

      handlers.forEach(h => {
        if (savedByType[h.type] && typeof h.afterAllSaved === 'function') h.afterAllSaved();
      });

      if (typeof onFinished === 'function') {
        onFinished({ saved, skipped, errored, newMappings, savedByType, results });
      }
    }
  }

  return { open };
})();

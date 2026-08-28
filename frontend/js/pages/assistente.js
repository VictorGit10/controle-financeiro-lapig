/* ============================================================
   Assistente — a aba de conversa sobre os dados
   ============================================================
   Fase 3 da camada de IA. A tela é fina: junta o laço
   (`js/ai/agent.js`) com as tools (`js/ai/tools.js`) e mostra
   o passo a passo.

   O passo a passo é a parte que não é enfeite. A regra da
   camada é que **todo número sai de RPC** — e a lista de
   consultas, com o JSON cru dobrável embaixo de cada uma, é
   como quem lê confere isso sem acreditar na palavra do
   modelo. Um número que apareça na resposta sem passo
   correspondente é invenção, e a tela deixa isso visível.

   A conversa vive na memória desta aba do navegador: sobrevive
   à navegação entre telas do site (o módulo não é recarregado)
   e morre com o refresh. Nada é gravado no banco.
   ============================================================ */

Router.register('assistente', {
  title: 'Assistente',

  actions(container) {
    const seletor = document.createElement('select');
    seletor.id = 'assist-modelo';
    seletor.className = 'form-input form-input--inline';
    seletor.style.width = 'auto';
    seletor.title = 'Modelo do Ollama Cloud';
    seletor.addEventListener('change', () => AssistentePage.onModeloChange(seletor.value));
    container.appendChild(seletor);

    const btn = document.createElement('button');
    btn.className = 'btn btn--secondary btn--sm';
    btn.innerHTML = '<i data-lucide="eraser"></i> Nova conversa';
    btn.addEventListener('click', () => AssistentePage.limpar());
    container.appendChild(btn);
  },

  async render(container) {
    await AssistentePage.load(container);
  },
});


const AssistentePage = (() => {

  const MODELO_KEY = 'cf_assistente_modelo';

  // Perguntas de referência. São as mesmas três fixadas em mcp/README.md
  // ("Segunda rodada") como régua para medir se uma mudança de prompt melhorou
  // ou piorou a resposta — deixá-las à mão na tela é o que torna a comparação
  // barata o bastante para alguém de fato fazer.
  const SUGESTOES = [
    'Como estão os projetos?',
    'Onde eu coloco uma bolsa de R$ 2.000 por 12 meses?',
    'Quais bolsas vencem nos próximos 3 meses?',
  ];

  let containerEl = null;
  let mensagens   = null;   // histórico cru, o que vai ao modelo
  let turnos      = [];     // o que a tela mostra: {papel, texto, passos}
  let modelo      = null;
  let modelos     = [];
  let ocupado     = false;
  let erroSetup   = null;   // Edge Function ausente/mal configurada

  // Quais <details> de passo estão abertos. A tela se redesenha inteira a cada
  // evento do laço, e sem isto o JSON que alguém abriu para conferir fecharia
  // sozinho no passo seguinte — justo enquanto está sendo lido.
  const abertos = new Set();

  /* ── Carga ───────────────────────────────────────────────── */

  async function load(container) {
    containerEl = container;
    if (!mensagens) mensagens = CFAgent.conversaNova();

    if (!modelos.length && !erroSetup) {
      try {
        const info = await CFAgent.listarModelos();
        modelos = info.modelos;
        const salvo = localStorage.getItem(MODELO_KEY);
        modelo = modelos.includes(salvo) ? salvo : info.padrao;
      } catch (e) {
        erroSetup = e.message;
      }
    }

    preencherSeletor();
    render();
  }

  function preencherSeletor() {
    const sel = document.getElementById('assist-modelo');
    if (!sel) return;
    if (!modelos.length) { sel.hidden = true; return; }
    sel.hidden = false;
    sel.innerHTML = modelos
      .map(m => `<option value="${escapeAttr(m)}">${escapeAttr(m)}</option>`)
      .join('');
    sel.value = modelo;
  }

  function onModeloChange(valor) {
    modelo = valor;
    localStorage.setItem(MODELO_KEY, valor);
    showToast(`Modelo: ${valor}`, 'info');
  }

  function limpar() {
    if (ocupado) return;
    mensagens = CFAgent.conversaNova();
    turnos = [];
    abertos.clear();
    render();
  }

  /* ── Render ──────────────────────────────────────────────── */

  function render() {
    containerEl.innerHTML = `
      ${erroSetup ? bannerErro() : ''}
      <div class="chat">
        <div class="chat__stream" id="chat-stream">
          ${turnos.length ? turnos.map(renderTurno).join('') : boasVindas()}
        </div>
        <form class="chat__composer" id="chat-form" autocomplete="off">
          <textarea
            id="chat-input"
            class="chat__input"
            rows="1"
            placeholder="Pergunte sobre saldo, bolsas, plano de trabalho…"
            ${ocupado || erroSetup ? 'disabled' : ''}></textarea>
          <button type="submit" class="btn btn--primary chat__send" ${ocupado || erroSetup ? 'disabled' : ''}>
            <i data-lucide="${ocupado ? 'loader-2' : 'send'}" class="${ocupado ? 'spin' : ''}"></i>
          </button>
        </form>
        <p class="chat__rodape">
          Todo número vem de consulta ao banco — a resposta mostra quais.
          O assistente não decide: expõe as opções e o porquê de cada uma.
        </p>
      </div>`;

    ligarEventos();
    lucide.createIcons();
    rolarAoFim();
  }

  function bannerErro() {
    return `
      <div class="chat__banner">
        <i data-lucide="alert-triangle"></i>
        <div>
          <strong>Assistente indisponível.</strong>
          <p>${escapeAttr(erroSetup)}</p>
          <p class="chat__banner-dica">
            ${detalheTecnico(`A aba depende da Edge Function <code>assistente</code>, que guarda a
            chave do Ollama Cloud. Publique com
            <code>supabase functions deploy assistente</code> e confira o secret
            <code>OLLAMA_API_KEY</code>.`)}
          </p>
          <button class="btn btn--secondary btn--sm" id="chat-retry">
            <i data-lucide="refresh-cw"></i> Tentar de novo
          </button>
        </div>
      </div>`;
  }

  function boasVindas() {
    return `
      <div class="chat__welcome">
        <i data-lucide="sparkles" class="chat__welcome-icon"></i>
        <h3>O que você quer saber?</h3>
        <p>
          Pergunte em português. Cada resposta é montada a partir das mesmas
          consultas que as telas do sistema usam — e você vê quais foram.
          Só aparece o que este login já enxerga.
        </p>
        <div class="chat__sugestoes">
          ${SUGESTOES.map((s, i) =>
            `<button class="chat__sugestao" data-sugestao="${i}">${escapeAttr(s)}</button>`
          ).join('')}
        </div>
      </div>`;
  }

  function renderTurno(turno, idx) {
    if (turno.papel === 'user') {
      return `<div class="chat-msg chat-msg--user"><div class="chat-bubble">${escapeAttr(turno.texto)}</div></div>`;
    }

    const passos = (turno.passos && turno.passos.length)
      ? `<div class="chat-passos">${turno.passos.map((p, j) => renderPasso(p, idx, j)).join('')}</div>`
      : '';

    const corpo = turno.pendente
      ? `<div class="chat-pensando"><i data-lucide="loader-2" class="spin"></i><span>${escapeAttr(turno.status || 'Consultando…')}</span></div>`
      : `<div class="chat-bubble chat-bubble--bot">${CFMarkdown.renderMarkdown(turno.texto)}</div>`;

    const erro = turno.erro
      ? `<div class="chat-erro"><i data-lucide="x-circle"></i><span>${escapeAttr(turno.erro)}</span></div>`
      : '';

    return `<div class="chat-msg chat-msg--bot">${passos}${erro}${corpo}</div>`;
  }

  function renderPasso(passo, i, j) {
    const icone = passo.ok === false ? 'alert-circle' : (passo.ok ? 'check' : 'loader-2');
    const classe = passo.ok === false ? 'chat-passo--erro' : (passo.ok ? '' : 'chat-passo--ativo');
    const tempo  = passo.ms != null ? `<span class="chat-passo__ms">${passo.ms} ms</span>` : '';
    const args   = passo.args && Object.keys(passo.args).length
      ? `<span class="chat-passo__args">${escapeAttr(resumirArgs(passo.args))}</span>`
      : '';

    // O JSON cru fica dobrável: é o que permite conferir o número da resposta
    // contra o que a RPC devolveu, sem sair da tela.
    const chave = `${i}-${j}`;
    const detalhe = (passo.resultado !== undefined || passo.erro)
      ? `<details class="chat-passo__json" data-json="${chave}" ${abertos.has(chave) ? 'open' : ''}>
           <summary>ver retorno</summary>
           <pre>${escapeAttr(
             passo.erro ? passo.erro : JSON.stringify(passo.resultado, null, 2)
           )}</pre>
         </details>`
      : '';

    return `
      <div class="chat-passo ${classe}" data-passo="${i}-${j}">
        <i data-lucide="${icone}" class="${passo.ok === undefined ? 'spin' : ''}"></i>
        <span class="chat-passo__nome">${escapeAttr(CFTools.rotuloDaTool(passo.nome))}</span>
        ${args}${tempo}
        ${passo.truncado ? '<span class="chat-passo__aviso">retorno cortado</span>' : ''}
        ${detalhe}
      </div>`;
  }

  function resumirArgs(args) {
    return Object.entries(args)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join(' · ')
      .slice(0, 120);
  }

  /* ── Eventos ─────────────────────────────────────────────── */

  function ligarEventos() {
    const form  = document.getElementById('chat-form');
    const input = document.getElementById('chat-input');

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      enviar(input.value);
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        enviar(input.value);
      }
    });

    // Textarea que cresce com o texto, até um teto.
    input?.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 180) + 'px';
    });

    containerEl.querySelectorAll('[data-sugestao]').forEach(btn => {
      btn.addEventListener('click', () => enviar(SUGESTOES[Number(btn.dataset.sugestao)]));
    });

    containerEl.querySelectorAll('[data-json]').forEach(el => {
      el.addEventListener('toggle', () => {
        if (el.open) abertos.add(el.dataset.json);
        else abertos.delete(el.dataset.json);
      });
    });

    document.getElementById('chat-retry')?.addEventListener('click', async () => {
      erroSetup = null;
      await load(containerEl);
    });

    if (!ocupado && !erroSetup) input?.focus();
  }

  function rolarAoFim() {
    const stream = document.getElementById('chat-stream');
    if (stream) stream.scrollTop = stream.scrollHeight;
  }

  /* ── Envio ───────────────────────────────────────────────── */

  async function enviar(texto) {
    const pergunta = String(texto || '').trim();
    if (!pergunta || ocupado || erroSetup) return;

    ocupado = true;
    // Ponto de retorno: se a rodada falhar no meio, o histórico volta inteiro
    // para cá. Remover só a última pergunta não bastaria — o laço pode ter
    // acrescentado um `assistant` com tool_calls cujas respostas `tool` ficaram
    // faltando, e um par quebrado desses derruba a próxima chamada.
    const anteriores = mensagens.slice();

    turnos.push({ papel: 'user', texto: pergunta });

    const turnoBot = { papel: 'bot', texto: '', passos: [], pendente: true, status: 'Pensando…' };
    turnos.push(turnoBot);
    mensagens.push({ role: 'user', content: pergunta });
    render();

    try {
      const resultado = await CFAgent.conversar({
        mensagens,
        modelo,
        onEvento: (ev) => aoEvento(turnoBot, ev),
      });

      mensagens = resultado.mensagens;
      turnoBot.pendente = false;
      turnoBot.texto = resultado.conteudo || '(sem resposta)';
      turnoBot.passos = resultado.passos;
    } catch (e) {
      turnoBot.pendente = false;
      turnoBot.texto = '';
      turnoBot.erro = e.message;
      mensagens = anteriores;
    } finally {
      ocupado = false;
      render();
    }
  }

  function aoEvento(turno, ev) {
    if (ev.tipo === 'pensando') {
      turno.status = ev.rodada === 1 ? 'Pensando…' : 'Cruzando os resultados…';
    } else if (ev.tipo === 'tool') {
      turno.status = `Consultando ${CFTools.rotuloDaTool(ev.nome).toLowerCase()}…`;
      turno.passos.push({ nome: ev.nome, args: ev.args });
    } else if (ev.tipo === 'tool_ok' || ev.tipo === 'tool_erro') {
      const passo = [...turno.passos].reverse().find(p => p.nome === ev.nome && p.ok === undefined);
      if (passo) Object.assign(passo, ev, { ok: ev.tipo === 'tool_ok' });
    }
    render();
  }

  return { load, limpar, onModeloChange };
})();

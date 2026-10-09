// Atividades: uma lista só, para o Victor, a equipe e os professores (o RLS decide o que cada um vê).
// Responde "o que precisa de atenção agora, e o que está com quem". A linha mostra o essencial; clicar abre
// o cartão completo da tarefa (passos, histórico e ações), que é o mesmo da 054–057.
window.AtividadesPage = (() => {
  const f = () => window.BuritiTarefas;
  const ui = () => window.BuritiTarefasUI;
  const ABERTAS = ['em_andamento', 'aguardando_terceiro'];
  let root = null, lista = [], centros = [], pessoas = [], abertos = new Set(), geracao = 0;
  let filtro = 'todos', vista = 'urgencia', encerradas = false;

  const guardado = (chave, padrao) => { try { return localStorage.getItem('atividades:' + chave) || padrao; } catch { return padrao; } };
  const guardar = (chave, valor) => { try { localStorage.setItem('atividades:' + chave, valor); } catch { /* sem armazenamento */ } };
  const eu = () => Auth.getUser()?.id;

  // "arthurpietro.lapig" (login sem nome no sistema) vira "Arthurpietro".
  function primeiroNome(nome) {
    const p = String(nome || '').trim().split(/[\s.]+/)[0] || '';
    return p ? p[0].toUpperCase() + p.slice(1) : '';
  }

  const mesmaPessoa = (a, b) => Boolean(a && b) && f().normalizar(b).startsWith(f().normalizar(primeiroNome(a)));

  function curto(texto, n = 140) {
    const t = String(texto || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  }

  function dataCurta(iso) {
    return iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
  }

  // Último movimento: o que o responsável disse por último; senão, o evento mais recente.
  function ultimaHTML(t) {
    const a = f().lerAtualizacao(t.atualizacao);
    if (a) return `${escapeAttr(primeiroNome(a.por))} · ${escapeAttr(dataCurta(a.quando))}: ${escapeAttr(curto(a.texto))}`;
    // Criação e troca de responsável não dizem nada de novo na linha.
    const e = (t.eventos || []).find(x => !['criada', 'status'].includes(x.tipo));
    return e ? `${escapeAttr(f().rotuloOrigem(e.origem))} · ${escapeAttr(dataCurta(e.ocorrido_em))}: ${escapeAttr(curto(e.resumo))}` : '';
  }

  function quemHTML(t) {
    if (!t.responsavel_id && !t.responsavel) return '<span class="ativ__quem">sem responsável</span>';
    return t.responsavel_id === eu() ? '<span class="ativ__quem ativ__quem--eu">Você</span>'
      : `<span class="ativ__quem">${escapeAttr(primeiroNome(t.responsavel))}</span>`;
  }

  function linhaHTML(t) {
    const admin = Auth.isAdmin();
    const grupo = f().grupoAtividade(t, { admin });
    const prazo = f().prazoCurto(t.prazo);
    const motivo = grupo === 'agora' ? f().motivoAgora(t, { admin }) : null;
    const prox = f().proximoPasso(t, admin);
    // Atividade anotada com um passo igual ao título: a linha do passo só repetiria o título.
    const repete = prox && !prox.confirmar && f().normalizar(prox.texto) === f().normalizar(t.titulo);
    const centro = t.projects?.code || t.centro_custo || '';
    const aberto = abertos.has(t.id);
    const encerrada = !ABERTAS.includes(t.status);
    return `<li class="ativ__item ativ__item--${grupo}" data-id="${escapeAttr(t.id)}">
      <button type="button" class="ativ__linha" aria-expanded="${aberto}" data-abrir>
        <span class="ativ__marca ativ__marca--${encerrada ? 'feito' : grupo === 'agora' ? 'agora' : grupo}" aria-hidden="true"></span>
        <span class="ativ__corpo">
          <span class="ativ__titulo">${escapeAttr(t.titulo)}${centro ? ` <span class="ativ__centro">${escapeAttr(centro)}</span>` : ''}</span>
          ${encerrada ? `<span class="ativ__proximo">${t.status === 'cancelada' ? 'Cancelada' : 'Concluída'} em ${escapeAttr(dataCurta(t.concluida_em || t.atualizada_em))}</span>`
            : repete ? '' : prox ? `<span class="ativ__proximo${prox.confirmar ? ' ativ__proximo--confirmar' : ''}"><i data-lucide="${prox.confirmar ? 'circle-help' : 'arrow-right'}"></i>
              ${prox.confirmar ? 'Confirmar: ' : ''}${escapeAttr(curto(prox.texto, 110))}${prox.quem && !prox.confirmar && !mesmaPessoa(prox.quem, t.responsavel) ? ` · ${escapeAttr(prox.quem)}` : ''}</span>`
            : '<span class="ativ__proximo">Nenhum passo em aberto</span>'}
          ${encerrada ? '' : `<span class="ativ__ultima">${ultimaHTML(t)}</span>`}
        </span>
        <span class="ativ__lado">
          ${encerrada ? '' : `<span class="ativ__prazo ativ__prazo--${prazo.nivel}">${escapeAttr(prazo.texto)}</span>`}
          ${motivo && !['vencida', 'vence'].some(p => motivo.startsWith(p)) ? `<span class="ativ__motivo">${escapeAttr(curto(motivo, 30))}</span>` : ''}
          ${quemHTML(t)}
        </span>
      </button>
      <div class="ativ__detalhe" ${aberto ? '' : 'hidden'}>${aberto ? ui().cartao(t, false, { semTopo: true }) : ''}</div>
    </li>`;
  }

  function visiveis() {
    if (filtro === 'eu') return lista.filter(t => t.responsavel_id === eu());
    if (filtro === 'sem') return lista.filter(t => !t.responsavel_id);
    if (filtro !== 'todos') return lista.filter(t => t.responsavel_id === filtro);
    return lista;
  }

  function filtrosHTML() {
    const contar = fn => lista.filter(fn).length;
    const outros = new Map();
    lista.forEach(t => { if (t.responsavel_id && t.responsavel_id !== eu()) outros.set(t.responsavel_id, t.responsavel); });
    const chips = [['todos', 'Tudo', lista.length]];
    if (contar(t => t.responsavel_id === eu())) chips.push(['eu', 'Comigo', contar(t => t.responsavel_id === eu())]);
    [...outros].sort((a, b) => String(a[1]).localeCompare(String(b[1]))).forEach(([id, nome]) =>
      chips.push([id, 'Com ' + primeiroNome(nome), contar(t => t.responsavel_id === id)]));
    if (contar(t => !t.responsavel_id)) chips.push(['sem', 'Sem responsável', contar(t => !t.responsavel_id)]);
    if (chips.length <= 2 || encerradas) return '';
    return chips.map(([v, nome, n]) => `<button type="button" class="ativ__chip" data-filtro="${escapeAttr(v)}" aria-pressed="${v === filtro}">
      ${escapeAttr(nome)} <span class="ativ__n">${n}</span></button>`).join('');
  }

  function gruposHTML(itens) {
    const admin = Auth.isAdmin();
    if (encerradas) {
      return itens.length ? `<ul class="ativ__lista">${itens.map(linhaHTML).join('')}</ul>`
        : '<p class="ativ__vazio">Nenhuma atividade concluída nos últimos 60 dias.</p>';
    }
    if (!itens.length) {
      return `<div class="ativ__vazio"><i data-lucide="sprout"></i><p>${lista.length ? 'Nada neste filtro.' : 'Nenhuma atividade em aberto.'}</p>
        ${admin && !lista.length ? '<p class="buriti-sub">Anote a primeira acima, como no caderno.</p>' : ''}</div>`;
    }
    const ordem = { agora: 0, andamento: 1, esperando: 2 };
    if (vista === 'projeto') {
      const porCentro = new Map();
      for (const t of itens) {
        const c = t.projects?.code || t.centro_custo || '—';
        if (!porCentro.has(c)) porCentro.set(c, { nome: t.projects?.name || '', itens: [] });
        porCentro.get(c).itens.push(t);
      }
      return [...porCentro].sort((a, b) => a[0].localeCompare(b[0])).map(([c, g]) => {
        const ord = f().ordenarAtividades(g.itens).sort((a, b) =>
          ordem[f().grupoAtividade(a, { admin })] - ordem[f().grupoAtividade(b, { admin })]);
        return `<section class="ativ__grupo"><h3 class="ativ__cabeca">${escapeAttr(c)}${g.nome ? ` <span>${escapeAttr(g.nome)}</span>` : ''}
          <span class="ativ__n">${g.itens.length}</span></h3><ul class="ativ__lista">${ord.map(linhaHTML).join('')}</ul></section>`;
      }).join('');
    }
    return Object.entries(f().GRUPOS).map(([g, nome]) => {
      const doGrupo = f().ordenarAtividades(itens.filter(t => f().grupoAtividade(t, { admin }) === g));
      if (!doGrupo.length) return '';
      return `<section class="ativ__grupo ativ__grupo--${g}"><h3 class="ativ__cabeca">${escapeAttr(nome)} <span class="ativ__n">${doGrupo.length}</span></h3>
        <ul class="ativ__lista">${doGrupo.map(linhaHTML).join('')}</ul></section>`;
    }).join('');
  }

  function desenhar() {
    if (!root?.isConnected) return;
    root.querySelector('[data-filtros]').innerHTML = filtrosHTML();
    root.querySelectorAll('[data-vista]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.vista === vista && !encerradas)));
    root.querySelector('[data-encerradas]').setAttribute('aria-pressed', String(encerradas));
    root.querySelector('[data-lista]').innerHTML = gruposHTML(visiveis());
    lucide.createIcons();
  }

  async function carregar() {
    const vez = ++geracao;
    const alvo = root.querySelector('[data-lista]');
    alvo.innerHTML = '<div class="skeleton skeleton--card" style="height:160px;"></div>';
    try {
      const rows = await ui().lerTudo(() => {
        const q = ui().consultaTarefa().order('prazo', { ascending: true, nullsFirst: false }).order('id');
        if (!encerradas) return q.in('status', ABERTAS);
        return q.eq('status', 'concluida').gte('concluida_em', new Date(Date.now() - 60 * 86400000).toISOString());
      });
      await ui().preencherCentros(rows);
      if (vez !== geracao || !root.isConnected) return;
      lista = encerradas ? rows.sort((a, b) => String(b.concluida_em).localeCompare(String(a.concluida_em))) : rows;
      if (!['todos', 'eu', 'sem'].includes(filtro) && !lista.some(t => t.responsavel_id === filtro)) filtro = 'todos';
      desenhar();
    } catch (e) {
      if (vez !== geracao || !root.isConnected) return;
      alvo.innerHTML = ui().aviso('Não foi possível consultar as atividades.', e);
      lucide.createIcons();
    }
  }

  // Depois de uma ação no cartão: relê só aquela tarefa e redesenha (ela pode ter mudado de grupo).
  async function depois(id) {
    const t = await ui().ler(ui().consultaTarefa().eq('id', id).single());
    await ui().preencherCentros([t]);
    const i = lista.findIndex(x => x.id === id);
    if (i >= 0) lista[i] = t; else lista.push(t);
    if (!encerradas && !ABERTAS.includes(t.status)) { lista = lista.filter(x => x.id !== id); abertos.delete(id); }
    desenhar();
    await ui().atualizarMenu();
  }

  // ---------- Anotar ----------
  async function carregarApoio() {
    if (!Auth.isAdmin()) return;
    const [c, p] = await Promise.all([
      ui().lerTudo(() => supabaseClient.from('projects').select('id,code,name').not('code', 'is', null).order('code').order('id')),
      ui().lerTudo(() => supabaseClient.from('app_users').select('user_id,display_name,role').in('role', ['admin', 'professor'])
        .order('display_name').order('user_id')),
    ]);
    centros = c; pessoas = p.filter(x => x.display_name);
  }

  function previa() {
    const campo = root.querySelector('[data-anotar-texto]');
    const saida = root.querySelector('[data-anotar-previa]');
    saida.classList.remove('ativ__previa--erro');
    if (!campo.value.trim()) { saida.textContent = 'Centro, o que fazer, prazo (até 20/10) e quem (@Arthur). Sem @, fica com você.'; return null; }
    try {
      const r = f().lerCaptura(campo.value, { centros, pessoas, eu: eu() });
      const prazo = r.prazo ? 'até ' + r.prazo.split('-').reverse().slice(0, 2).join('/') : 'sem prazo';
      const quem = !r.responsavel ? 'sem responsável' : r.responsavel.user_id === eu() ? 'com você' : 'com ' + r.responsavel.display_name;
      saida.textContent = `${r.centro.code} · ${r.titulo} · ${prazo} · ${quem}`;
      return r;
    } catch (e) {
      saida.textContent = e.message;
      saida.classList.add('ativ__previa--erro');
      return null;
    }
  }

  async function anotar(ev) {
    ev.preventDefault();
    const campo = root.querySelector('[data-anotar-texto]');
    const botao = root.querySelector('[data-anotar-botao]');
    if (!campo.value.trim()) { previa(); campo.focus(); return; }
    const r = previa();
    if (!r) { campo.focus(); return; }
    botao.disabled = true;
    try {
      const nome = r.responsavel?.display_name || null;
      const p = { project_id: r.centro.id, titulo: r.titulo, passos: [{ descricao: r.titulo, ...(nome ? { quem: nome } : {}) }] };
      if (r.prazo) p.prazo = r.prazo;
      const id = await ui().ler(supabaseClient.rpc('criar_tarefa_na_tela', { p, p_responsavel: r.responsavel?.user_id || null }));
      campo.value = '';
      previa();
      showToast('Anotada.', 'success');
      if (encerradas) { encerradas = false; await carregar(); } else await depois(id);
    } catch (e) {
      const saida = root.querySelector('[data-anotar-previa]');
      saida.textContent = 'Não foi possível anotar: ' + e.message;
      saida.classList.add('ativ__previa--erro');
    } finally { botao.disabled = false; }
  }

  async function aoClicar(e) {
    if (e.target.closest('.ativ__detalhe')) {
      // Não use closest('[data-id]'): os botões do cartão também têm data-id (o do passo).
      await ui().acao(e, 'todas', false, depois);
      return;
    }
    const chip = e.target.closest('[data-filtro]');
    if (chip) { filtro = chip.dataset.filtro; guardar('filtro', filtro); desenhar(); return; }
    const v = e.target.closest('[data-vista]');
    if (v) {
      vista = v.dataset.vista; guardar('vista', vista);
      if (encerradas) { encerradas = false; await carregar(); } else desenhar();
      return;
    }
    if (e.target.closest('[data-encerradas]')) { encerradas = !encerradas; abertos.clear(); await carregar(); return; }
    const linha = e.target.closest('[data-abrir]');
    if (linha) {
      const item = linha.closest('.ativ__item'), id = item.dataset.id;
      const detalhe = item.querySelector('.ativ__detalhe');
      if (abertos.has(id)) { abertos.delete(id); detalhe.hidden = true; detalhe.innerHTML = ''; }
      else {
        abertos.add(id);
        detalhe.innerHTML = ui().cartao(lista.find(t => t.id === id), false, { semTopo: true });
        detalhe.hidden = false;
        lucide.createIcons();
      }
      linha.setAttribute('aria-expanded', String(abertos.has(id)));
    }
  }

  async function render(container) {
    ui().sair();
    abertos = new Set();
    encerradas = false;
    filtro = guardado('filtro', 'todos');
    vista = guardado('vista', 'urgencia') === 'projeto' ? 'projeto' : 'urgencia';
    const admin = Auth.isAdmin();
    container.innerHTML = `<div class="ativ">
      ${admin ? `<form class="ativ__anotar" data-anotar autocomplete="off">
        <label class="sr-only" for="ativ-anotar">Anotar atividade</label>
        <i data-lucide="plus" aria-hidden="true"></i>
        <input id="ativ-anotar" class="ativ__campo" data-anotar-texto maxlength="400"
          placeholder="30.068 remanejar rubricas até 20/10 @Arthur">
        <button type="submit" class="btn btn--primary btn--sm" data-anotar-botao>Anotar</button>
      </form>
      <p class="ativ__previa" data-anotar-previa aria-live="polite">Centro, o que fazer, prazo (até 20/10) e quem (@Arthur). Sem @, fica com você.</p>` : ''}
      <div class="ativ__barra">
        <div class="ativ__filtros" role="group" aria-label="Filtrar por responsável" data-filtros></div>
        <div class="ativ__vistas" role="group" aria-label="Organizar">
          <button type="button" class="ativ__chip" data-vista="urgencia">Por urgência</button>
          <button type="button" class="ativ__chip" data-vista="projeto">Por projeto</button>
          <button type="button" class="ativ__chip" data-encerradas>Concluídas</button>
        </div>
      </div>
      <div data-lista></div>
    </div>`;
    root = container.querySelector('.ativ');
    root.addEventListener('click', aoClicar);
    if (admin) {
      root.querySelector('[data-anotar]').addEventListener('submit', anotar);
      root.querySelector('[data-anotar-texto]').addEventListener('input', previa);
    }
    lucide.createIcons();
    const apoio = carregarApoio().catch(e => {
      const saida = root.querySelector('[data-anotar-previa]');
      if (saida) { saida.textContent = 'Não foi possível carregar centros e pessoas para anotar: ' + e.message; saida.classList.add('ativ__previa--erro'); }
    });
    await Promise.all([carregar(), apoio]);
    await ui().atualizarMenu();
  }

  return { render };
})();

Router.register('atividades', {
  title: 'Atividades',
  render: container => window.AtividadesPage.render(container),
});

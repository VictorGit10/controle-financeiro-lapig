// Adaptador humano da migração 054. Só RPCs escrevem; o RLS decide o escopo.
window.BuritiTarefasUI = (() => {
  const f = () => window.BuritiTarefas;
  let geracao = 0;
  const ocupados = new Set();
  const CAMPOS = 'id,project_id,titulo,descricao,responsavel,responsavel_id,status,situacao,precisa_atencao,motivo_atencao,aviso_responsavel,' +
    'prazo,prazo_motivo,criada_em,concluida_em,projects(name,code),' +
    'atualizacao:tarefa_eventos!ultima_atualizacao_id(tipo,origem,detalhe,ocorrido_em),' +
    'tarefa_passos(id,ordem,descricao,quem,executor,estado,evento_id,' +
    'feito:tarefa_eventos!ultimo_feito_id(tipo,origem,detalhe),' +
    'evento:tarefa_eventos!evento_id(resumo,gmail_thread_id,ocorrido_em)),' +
    'eventos:tarefa_eventos!tarefa_eventos_tarefa_id_fkey(id,tipo,origem,resumo,detalhe,gmail_thread_id,ocorrido_em,criado_em)';
  const MSG = 'gmail_message_id,gmail_thread_id,recebida_em,assunto,trecho,fila,motivo,classificacao,estado,anexos,' +
    'vigia_vinculos(tarefa_id,estado,tarefas(id,titulo,status))';

  async function ler(consulta) {
    const { data, error } = await consulta;
    if (error) throw new Error(error.message);
    return data;
  }

  // Paginação explícita: uma fila grande não pode parecer uma fila vazia ou completa.
  async function lerTudo(criar) {
    const linhas = [];
    for (let inicio = 0; ; inicio += 200) {
      const lote = await ler(criar().range(inicio, inicio + 199));
      linhas.push(...lote);
      if (lote.length < 200) return linhas;
    }
  }

  function aviso(texto, erro) {
    return `<div class="alert-banner alert-banner--warning" role="alert"><div>
      <strong>${escapeAttr(texto)}</strong>${erro ? detalheTecnico(`<div>${escapeAttr(erro.message)}</div>`) : ''}
      </div></div>`;
  }

  function erroCartao(node, erro) {
    const slot = node.querySelector('[data-erro]');
    if (slot) slot.innerHTML = aviso('Não foi possível completar a ação. Tente novamente.', erro);
    lucide.createIcons();
  }

  async function saude(node) {
    // A 054 permite SELECT de vigia_execucoes só ao admin. Lista vazia via RLS
    // para professor NÃO significa que o executor nunca rodou.
    if (!Auth.isAdmin()) {
      node.innerHTML = '<p class="buriti-sub">Vigia: saúde indisponível para este perfil.</p>';
      return;
    }
    try {
      const rows = await ler(supabaseClient.from('vigia_execucoes').select('terminada_em,erros')
        .eq('tipo', 'checagem').not('terminada_em', 'is', null)
        .order('terminada_em', { ascending: false }).limit(1));
      const s = f().saudeVigia(rows[0]);
      node.innerHTML = s.atrasado ? aviso(s.texto) : `<p class="buriti-sub">${escapeAttr(s.texto)}</p>`;
      if (rows[0]?.erros?.length) node.innerHTML += aviso('A última checagem do vigia terminou com falhas.');
    } catch (e) {
      node.innerHTML = aviso('Não foi possível consultar a saúde do vigia.', e);
    }
    lucide.createIcons();
  }

  function link(thread) {
    const url = f().gmailLink(thread);
    return url ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">Abrir no Gmail</a>` : '';
  }

  function botao(acao, texto, id = '', primaria = false) {
    return `<button class="btn ${primaria ? 'btn--primary' : 'btn--secondary'}" data-acao="${acao}" data-id="${escapeAttr(id)}">${texto}</button>`;
  }

  // Passos são a lista do que fazer. O responsável não marca passo a passo: responde pelo botão Atualizar (057).
  function passoHTML(s, aberta, ultimaTexto) {
    const estado = f().ESTADOS_PASSO[s.estado];
    const editavel = aberta && ['pendente', 'sugerido'].includes(s.estado);
    const feito = f().registroFeito(s);
    const rotulo = s.estado === 'sugerido' ? (feito ? `Feito por ${feito.por} — falta o Victor confirmar` : 'O Buriti achou sinal de que foi feito')
      : s.estado === 'pendente' ? 'A fazer' : estado.texto;
    return `<li class="buriti-passo">
      <div class="buriti-bloco__titulo"><i data-lucide="${estado.icone}"></i> ${f().textoComLinks(s.descricao)}</div>
      <div class="buriti-sub">${escapeAttr(rotulo)}${s.quem ? ` · ${escapeAttr(s.quem)}` : ''}</div>
      ${s.estado === 'sugerido' && feito && feito.nota !== ultimaTexto ? `<div class="buriti-sub buriti-evidencia">${f().textoComLinks(feito.nota)} ${feito.link ? f().textoComLinks(feito.link) : ''}</div>` : ''}
      ${s.estado === 'sugerido' && !feito && Auth.isAdmin() ? `<div class="buriti-sub buriti-evidencia">${f().textoComLinks(s.evento?.resumo || '')} ${link(s.evento?.gmail_thread_id)}</div>` : ''}
      ${editavel && Auth.isAdmin() ? `<div class="buriti-acoes">${botao('confirmar', 'Confirmar', s.id, s.estado === 'sugerido')}${botao('dispensar', 'Dispensar', s.id)}</div>` : ''}
    </li>`;
  }

  function seloSituacao(situacao) {
    const s = f().SITUACOES[situacao];
    return s ? `<span class="badge ${s.classe}">${escapeAttr(s.texto)}</span>` : '';
  }

  // O que o responsável disse por último: é a primeira coisa que o Victor e o Arthur leem no cartão.
  function ultimaHTML(t) {
    const a = f().lerAtualizacao(t.atualizacao);
    if (!a) {
      return `<div class="buriti-bloco buriti-ultima"><div class="buriti-sub">${t.responsavel ? `${escapeAttr(t.responsavel)} ainda não atualizou.` : 'Sem atualização ainda.'}</div></div>`;
    }
    return `<div class="buriti-bloco buriti-ultima">
      <div class="buriti-ultima__topo">${seloSituacao(a.situacao)}<span class="buriti-sub">${escapeAttr(a.por)} · ${escapeAttr(f().dataHora(a.quando))}</span></div>
      <p class="buriti-ultima__texto">${f().textoComLinks(a.texto)}</p>${a.link ? f().textoComLinks(a.link) : ''}</div>`;
  }

  function eventosHTML(eventos) {
    return eventos.map(e => {
      const a = f().lerAtualizacao(e);
      const corpo = a ? `${seloSituacao(a.situacao)} <span>${f().textoComLinks(a.texto)}</span>${a.link ? ' ' + f().textoComLinks(a.link) : ''}`
        : f().textoComLinks(e.resumo) + (e.detalhe?.link ? ' ' + f().textoComLinks(e.detalhe.link) : '');
      return '<li><div class="buriti-sub">' + escapeAttr(f().dataHora(e.ocorrido_em)) + ' · ' +
        escapeAttr(a ? a.por : f().rotuloOrigem(e.origem)) + '</div><div>' + corpo + '</div>' + link(e.gmail_thread_id) + '</li>';
    }).join('') || '<li>Nenhum registro.</li>';
  }

  // Cartão em três partes: o que o responsável disse por último (com o botão Atualizar), o que fazer e o histórico.
  function tarefaHTML(t, minhas = false) {
    const aberta = ['em_andamento', 'aguardando_terceiro'].includes(t.status);
    const selo = f().seloPrazo(t.prazo);
    const passos = [...t.tarefa_passos].sort((a, b) => a.ordem - b.ordem);
    const abertos = passos.filter(s => ['pendente', 'sugerido'].includes(s.estado)).length;
    const podeAtualizar = aberta && f().podeRegistrarFeito(t, Auth.getUser()?.id, Auth.isAdmin());
    return `<article class="card buriti-cartao" data-tarefa="${escapeAttr(t.id)}">
      <header class="buriti-cartao__topo"><h3 class="buriti-titulo">${escapeAttr(t.titulo)}</h3>
        <span class="badge ${aberta ? selo.classe : 'badge--active'}">${aberta ? selo.texto : t.status === 'cancelada' ? 'Cancelada' : 'Concluída'}</span></header>
      <div class="buriti-sub">${escapeAttr(t.projects?.code || t.centro_custo || 'Centro indisponível')} ${escapeAttr(t.projects?.name || '')}${t.responsavel ? ` · ${escapeAttr(t.responsavel)}` : ''}${t.prazo ? ` · prazo ${escapeAttr(t.prazo.split('-').reverse().join('/'))}` : ''}</div>
      ${(t.precisa_atencao || t.aviso_responsavel) && Auth.isAdmin() ? `<div class="buriti-bloco buriti-bloco--aviso"><span class="badge badge--warning">precisa de você</span>
        ${[t.precisa_atencao ? t.motivo_atencao : '', t.aviso_responsavel].filter(Boolean).map(m => `<p class="buriti-sub">${escapeAttr(m)}</p>`).join('')}</div>` : ''}
      ${t.descricao ? `<p class="buriti-cartao__resumo">${f().textoComLinks(t.descricao)}</p>` : ''}
      ${ultimaHTML(t)}
      ${podeAtualizar ? `<div class="buriti-acoes">${botao('atualizar', 'Atualizar', '', true)}</div>` : ''}
      <details class="buriti-bloco"${abertos && !minhas ? ' open' : ''}><summary>O que fazer${abertos ? ` · ${abertos} em aberto` : ''}</summary>
        <ol class="buriti-lista buriti-passos">${passos.map(s => passoHTML(s, aberta, f().lerAtualizacao(t.atualizacao)?.texto)).join('')}</ol></details>
      <details class="buriti-bloco" data-linha-tempo><summary>Histórico</summary>
        <ul class="buriti-lista" data-eventos>${eventosHTML(t.eventos)}</ul>
        ${t.eventos.length >= 10 ? botao('historico', 'Ver todo o histórico') : ''}
      </details>
      <div data-erro></div>${Auth.isAdmin() ? `<div class="buriti-acoes">${botao('nota', 'Nota')}${botao('responsavel', 'Responsável')}${aberta && !minhas ? botao('concluir', 'Concluir') : ''}</div>` : ''}
    </article>`;
  }

  function consultaTarefa() {
    return supabaseClient.from('tarefas').select(CAMPOS)
      .order('criado_em', { referencedTable: 'eventos', ascending: false })
      .order('id', { referencedTable: 'eventos' }).limit(10, { referencedTable: 'eventos' });
  }

  async function atualizarTarefa(node, id, filtro, minhas) {
    const t = await ler(consultaTarefa().eq('id', id).single());
    await preencherCentros([t]);
    if (!node.isConnected) return;
    if ((minhas && t.responsavel_id !== Auth.getUser()?.id) || (filtro === 'abertas' && !['em_andamento', 'aguardando_terceiro'].includes(t.status)) ||
      (filtro === 'concluidas' && t.status !== 'concluida')) {
      const lista = node.parentElement;
      node.remove();
      if (!lista.querySelector('[data-tarefa]')) lista.innerHTML = '<p class="buriti-sub">Nenhuma tarefa neste filtro.</p>';
      return;
    }
    const aberto = node.querySelector('[data-linha-tempo]')?.open;
    const temp = document.createElement('div');
    temp.innerHTML = tarefaHTML(t, minhas);
    const novo = temp.firstElementChild;
    novo.querySelector('[data-linha-tempo]').open = aberto;
    node.replaceWith(novo);
    lucide.createIcons();
    return novo;
  }

  // Mantém os demais cartões, trava duplo clique e recarrega inclusive se uma
  // operação composta falhar depois de já ter gravado o primeiro efeito.
  async function agir(node, chave, operacao, recarregar) {
    if (ocupados.has(chave)) return false;
    ocupados.add(chave);
    const pai = node.parentElement;
    const buttons = [...node.querySelectorAll('button')];
    buttons.forEach(b => { b.disabled = true; });
    node.querySelector('[data-erro]').innerHTML = '';
    let atual = node;
    try {
      try { await operacao(); }
      catch (e) {
        // Releitura mostra efeitos já persistidos mesmo quando uma segunda RPC
        // falha (ex.: vínculo aceito, mas revisão da fila ainda pendente).
        try { atual = await recarregar() || node; } catch { /* mantém o cartão anterior */ }
        throw e;
      }
      atual = await recarregar() || node;
      return true;
    } catch (e) {
      if (!atual.isConnected && pai?.isConnected) pai.append(atual);
      erroCartao(atual, e);
      return false;
    } finally {
      ocupados.delete(chave);
      buttons.forEach(b => { b.disabled = false; });
    }
  }

  async function rpc(nome, args) { await ler(supabaseClient.rpc(nome, args)); }

  async function acaoTarefa(e, filtro, minhas) {
    const button = e.target.closest('[data-acao]');
    const node = button?.closest('[data-tarefa]');
    if (!node) return;
    const id = node.dataset.tarefa, acao = button.dataset.acao;
    const atualizar = () => atualizarTarefa(node, id, filtro, minhas);
    if (acao === 'historico') {
      button.disabled = true;
      try {
        const eventos = await lerTudo(() => supabaseClient.from('tarefa_eventos')
          .select('id,tipo,origem,resumo,detalhe,gmail_thread_id,ocorrido_em,criado_em')
          .eq('tarefa_id', id).order('criado_em', { ascending: false }).order('id'));
        if (!node.isConnected) return;
        node.querySelector('[data-eventos]').innerHTML = eventosHTML(eventos);
        button.remove();
      } catch (erro) { button.disabled = false; erroCartao(node, erro); }
      return;
    }
    if (acao === 'responsavel' && Auth.isAdmin()) {
      try {
        const t = await ler(consultaTarefa().eq('id', id).single());
        await escolherResponsavel(t.responsavel_id, async usuario => {
          const ok = await agir(node, id, () => rpc('atribuir_tarefa', { p_tarefa: id, p_user: usuario }), atualizar);
          if (!ok) throw new Error('Não foi possível atribuir a tarefa.');
          await atualizarMenu();
        });
      } catch (erro) { erroCartao(node, erro); }
      return;
    }
    if (acao === 'atualizar') {
      try {
        const t = await ler(consultaTarefa().eq('id', id).single());
        abrirAtualizar(t, async args => {
          const ok = await agir(node, id, () => rpc('registrar_atualizacao', { p_tarefa: id, ...args }), atualizar);
          if (!ok) throw new Error('Não foi possível salvar. Confira o erro no cartão.');
        });
      } catch (erro) { erroCartao(node, erro); }
      return;
    }
    if (acao === 'nota') {
      createModal({ title: 'Nota da tarefa', saveLabel: 'Registrar nota',
        bodyHTML: '<label class="form-label" for="buriti-nota">Nota (use pseudônimos; sem CPF, e-mail ou telefone)</label><textarea id="buriti-nota" class="form-input" rows="4" maxlength="2000"></textarea>',
        onSave: async () => {
          const texto = document.getElementById('buriti-nota').value.trim();
          if (!texto) throw new Error('Escreva a nota.');
          const ok = await agir(node, id, () => rpc('registrar_nota', { p_tarefa: id, p_texto: texto }), atualizar);
          if (!ok) throw new Error('Não foi possível registrar a nota. Confira o erro no cartão.');
        } });
      return;
    }
    if (!Auth.isAdmin()) return;
    if (acao === 'concluir') {
      if (!await confirmAction('Concluir esta tarefa? Todos os passos precisam estar confirmados ou dispensados.')) return;
      await agir(node, id, () => rpc('concluir_tarefa', { p_tarefa: id, p_nota: null }), atualizar);
    } else if (['confirmar', 'dispensar'].includes(acao)) {
      await agir(node, id, () => rpc(acao === 'confirmar' ? 'confirmar_passo' : 'dispensar_passo',
        { p_passo: button.dataset.id, p_nota: null }), atualizar);
    }
  }

  async function tarefas(root, filtro = 'abertas', minhas = false) {
    const vez = ++geracao;
    root.innerHTML = `<div class="buriti-abas" role="group" aria-label="Filtro de tarefas">
      ${(minhas ? ['todas', 'abertas', 'concluidas'] : ['abertas', 'concluidas']).map(v => `<button class="btn ${v === filtro ? 'btn--primary' : 'btn--ghost'}" data-filtro="${v}" aria-pressed="${v === filtro}">${v === 'abertas' ? 'Abertas' : v === 'todas' ? 'Todas' : 'Concluídas'}</button>`).join('')}</div>
      <div class="buriti-coluna" data-cartoes><p class="buriti-sub">Consultando tarefas…</p></div>`;
    root.onclick = e => {
      const valor = e.target.closest('[data-filtro]')?.dataset.filtro;
      if (valor) tarefas(root, valor, minhas);
      else acaoTarefa(e, filtro, minhas);
    };
    try {
      const rows = await lerTudo(() => {
        const q = consultaTarefa().order('prazo', { ascending: true, nullsFirst: false }).order('id');
        if (minhas) q.eq('responsavel_id', Auth.getUser()?.id);
        return filtro === 'abertas' ? q.in('status', ['em_andamento', 'aguardando_terceiro']) : filtro === 'concluidas' ? q.eq('status', 'concluida') : q;
      });
      await preencherCentros(rows);
      if (vez !== geracao || !root.isConnected) return;
      root.querySelector('[data-cartoes]').innerHTML = rows.length ? f().ordenarTarefas(rows).map(t => tarefaHTML(t, minhas)).join('')
        : '<p class="buriti-sub">Nenhuma tarefa neste filtro.</p>';
    } catch (e) {
      if (vez !== geracao || !root.isConnected) return;
      root.querySelector('[data-cartoes]').innerHTML = aviso('Não foi possível consultar as tarefas.', e);
    }
    lucide.createIcons();
  }

  function mensagemHTML(m, candidatas, escolhasDisponiveis) {
    const sugeridos = m.vigia_vinculos.filter(v => v.estado === 'sugerido');
    const rotina = m.fila === 'rotina' && !sugeridos.length;
    const excluidos = new Set(m.vigia_vinculos.map(v => v.tarefa_id));
    const selo = f().seloClassificacao(m.classificacao);
    return `<article class="card buriti-cartao" data-msg="${escapeAttr(m.gmail_message_id)}">
      <header class="buriti-cartao__topo"><h3 class="buriti-titulo">${escapeAttr(m.assunto || 'Assunto indisponível')}</h3>
        <span class="buriti-acoes">${selo ? `<span class="badge ${selo.classe}">${escapeAttr(selo.texto)}</span>` : ''}
        <span class="badge ${rotina ? 'badge--info' : 'badge--warning'}">${rotina ? 'Rotina' : 'Precisa de revisão'}</span></span></header>
      <div class="buriti-sub">${escapeAttr(f().dataHora(m.recebida_em))} · ${escapeAttr(f().motivoLegivel(m.motivo))}${m.estado === 'processada' ? '' : ` · ${escapeAttr(m.estado)}`}</div>
      <p class="buriti-cartao__resumo">${escapeAttr(m.trecho || 'Trecho indisponível.')}</p>
      ${m.anexos > 0 ? '<p class="buriti-sub">Anexo não conferido</p>' : ''}${link(m.gmail_thread_id)}
      ${sugeridos.map(v => `<div class="buriti-bloco"><strong>Vínculo sugerido: ${escapeAttr(v.tarefas?.titulo || v.tarefa_id)}</strong>
        <div class="buriti-acoes">${botao('aceitar', 'Aceitar vínculo', v.tarefa_id, true)}${botao('rejeitar', 'Não é desta tarefa', v.tarefa_id)}</div></div>`).join('')}
      ${!rotina ? `<div class="buriti-bloco"><label class="form-label">Vincular a outra tarefa
        <select class="form-input" data-escolha ${escolhasDisponiveis ? '' : 'disabled'}><option value="">Selecione uma tarefa aberta</option>
          ${candidatas.filter(t => !excluidos.has(t.id)).map(t => `<option value="${escapeAttr(t.id)}">${escapeAttr(t.titulo)}</option>`).join('')}
        </select></label><div class="buriti-acoes">${botao('vincular', 'Aceitar vínculo')}</div></div>` : ''}
      <div data-erro></div><div class="buriti-acoes">${rotina ? botao('esclarecer', 'Precisa de revisão') : botao('rotina', 'É rotina')}</div>
    </article>`;
  }

  async function triagem(root) {
    const vez = ++geracao;
    if (!Auth.isAdmin()) { root.innerHTML = aviso('A triagem está disponível apenas para administradores.'); return; }
    root.innerHTML = '<p class="buriti-sub">Consultando triagem…</p>';
    const consultas = [
      lerTudo(() => supabaseClient.from('vigia_mensagens').select(MSG).eq('fila', 'esclarecer').order('recebida_em').order('gmail_message_id')),
      lerTudo(() => supabaseClient.from('vigia_vinculos').select('gmail_message_id').eq('estado', 'sugerido').order('gmail_message_id').order('tarefa_id')),
      lerTudo(() => supabaseClient.from('vigia_mensagens').select(MSG).eq('fila', 'rotina')
        .gte('recebida_em', new Date(Date.now() - 7 * 86400000).toISOString()).order('recebida_em', { ascending: false }).order('gmail_message_id')),
      lerTudo(() => supabaseClient.from('tarefas').select('id,titulo').in('status', ['em_andamento', 'aguardando_terceiro']).order('titulo').order('id')),
    ];
    const resultados = await Promise.allSettled(consultas);
    if (vez !== geracao || !root.isConnected) return;
    const erros = resultados.flatMap((r, i) => r.status === 'rejected' ? [aviso(`Não foi possível consultar ${['mensagens a esclarecer', 'vínculos sugeridos', 'rotina dos últimos 7 dias', 'tarefas para vínculo'][i]}.`, r.reason)] : []);
    const valor = i => resultados[i].status === 'fulfilled' ? resultados[i].value : [];
    const mapa = new Map(valor(0).map(m => [m.gmail_message_id, m]));
    try {
      const ids = [...new Set(valor(1).map(v => v.gmail_message_id))].filter(id => !mapa.has(id));
      for (let i = 0; i < ids.length; i += 100) {
        const lote = await ler(supabaseClient.from('vigia_mensagens').select(MSG).in('gmail_message_id', ids.slice(i, i + 100)));
        lote.forEach(m => mapa.set(m.gmail_message_id, m));
      }
    } catch (e) { erros.push(aviso('Não foi possível consultar as mensagens com vínculo sugerido.', e)); }
    if (vez !== geracao || !root.isConnected) return;
    // Inclui sugestões em mensagens de rotina no grupo prioritário.
    valor(2).filter(m => m.vigia_vinculos.some(v => v.estado === 'sugerido')).forEach(m => mapa.set(m.gmail_message_id, m));
    const todas = [...mapa.values()].sort((a, b) => a.recebida_em.localeCompare(b.recebida_em));
    const automaticas = todas.filter(m => f().ligadaAutomaticamente(m));
    const pendentes = todas.filter(m => !f().ligadaAutomaticamente(m));
    const rotina = valor(2).filter(m => !mapa.has(m.gmail_message_id));
    const renderMsg = m => mensagemHTML(m, valor(3), resultados[3].status === 'fulfilled');
    root.innerHTML = `${erros.join('')}<div class="buriti-coluna" data-pendentes>
      ${pendentes.map(renderMsg).join('') || (erros.length ? '' : '<p class="buriti-sub" data-vazio>Nenhuma mensagem esperando revisão.</p>')}</div>
      ${automaticas.length ? `<details class="buriti-bloco buriti-automaticas"><summary>Ligadas automaticamente (${automaticas.length})</summary>
        <p class="buriti-sub">Mesma conversa da tarefa ou mensagem sua, sem pedido de ação. Confira se quiser.</p>
        <div class="buriti-acoes"><button type="button" class="btn btn--primary" data-aceitar-todas>Aceitar todas</button></div>
        <div class="buriti-coluna" data-automaticas>${automaticas.map(renderMsg).join('')}</div></details>` : ''}
      <details class="buriti-bloco buriti-rotina"><summary>Rotina · últimos 7 dias${resultados[2].status === 'fulfilled' ? ` (${rotina.length})` : ' · indisponível'}</summary>
        <div class="buriti-coluna" data-rotina>${rotina.map(renderMsg).join('')}</div></details>`;
    root.onclick = async e => {
      const todasBtn = e.target.closest('[data-aceitar-todas]');
      if (todasBtn && Auth.isAdmin()) {
        todasBtn.disabled = true;
        const bloco = todasBtn.closest('.buriti-automaticas');
        try {
          for (const m of automaticas) {
            for (const v of m.vigia_vinculos.filter(v => v.estado === 'sugerido')) {
              await rpc('vincular_mensagem', { p_msg: m.gmail_message_id, p_tarefa: v.tarefa_id, p_aceitar: true });
            }
            await rpc('revisar_mensagem', { p_msg: m.gmail_message_id, p_fila: 'tarefa' });
          }
          bloco.remove();
        } catch (err) { todasBtn.disabled = false; bloco.insertAdjacentHTML('afterbegin', aviso('Nem todos os vínculos foram aceitos; tente de novo.', err)); }
        return;
      }
      const b = e.target.closest('[data-acao]'), node = b?.closest('[data-msg]');
      if (!node || !Auth.isAdmin()) return;
      const id = node.dataset.msg, acao = b.dataset.acao;
      const tarefa = acao === 'vincular' ? node.querySelector('[data-escolha]').value : b.dataset.id;
      if (acao === 'vincular' && !tarefa) { erroCartao(node, new Error('Selecione uma tarefa.')); return; }
      await agir(node, id, async () => {
        if (['aceitar', 'vincular', 'rejeitar'].includes(acao)) {
          await rpc('vincular_mensagem', { p_msg: id, p_tarefa: tarefa, p_aceitar: acao !== 'rejeitar' });
          if (acao !== 'rejeitar') await rpc('revisar_mensagem', { p_msg: id, p_fila: 'tarefa' });
        } else {
          if (acao === 'rotina') {
            // Os pares recusados ficam lembrados pela 054. Apenas mudar a fila
            // deixaria a mensagem de rotina no topo por causa dos vínculos.
            const m = await ler(supabaseClient.from('vigia_mensagens').select(MSG).eq('gmail_message_id', id).single());
            for (const v of m.vigia_vinculos.filter(v => v.estado === 'sugerido')) {
              await rpc('vincular_mensagem', { p_msg: id, p_tarefa: v.tarefa_id, p_aceitar: false });
            }
          }
          await rpc('revisar_mensagem', { p_msg: id, p_fila: acao === 'rotina' ? 'rotina' : 'esclarecer' });
        }
      }, async () => {
        const m = await ler(supabaseClient.from('vigia_mensagens').select(MSG).eq('gmail_message_id', id).single());
        if (!node.isConnected) return;
        const destino = m.fila === 'esclarecer' || m.vigia_vinculos.some(v => v.estado === 'sugerido')
          ? root.querySelector('[data-pendentes]') : m.fila === 'rotina' && new Date(m.recebida_em) >= Date.now() - 7 * 86400000
            ? root.querySelector('[data-rotina]') : null;
        const temp = document.createElement('div'); temp.innerHTML = renderMsg(m);
        const novo = temp.firstElementChild;
        if (destino === node.parentElement) node.replaceWith(novo);
        else { node.remove(); if (destino) { destino.querySelector('[data-vazio]')?.remove(); destino.append(novo); } }
        const auditados = root.querySelectorAll('[data-rotina] [data-msg]').length;
        root.querySelector('.buriti-rotina > summary').textContent = `Rotina · últimos 7 dias${resultados[2].status === 'fulfilled' ? ` (${auditados})` : ' · indisponível'}`;
        lucide.createIcons();
        return novo;
      });
    };
    lucide.createIcons();
  }

  // Um formulário só: como está, o que aconteceu, passos concluídos (se houver mais de um aberto) e link.
  function abrirAtualizar(t, salvar) {
    const abertos = [...t.tarefa_passos].sort((a, b) => a.ordem - b.ordem)
      .filter(s => s.executor !== 'buriti' && ['pendente', 'sugerido'].includes(s.estado));
    const atual = t.situacao || 'em_andamento';
    createModal({ title: 'Atualizar tarefa', saveLabel: 'Salvar', maxWidth: '560px',
      bodyHTML: `<p class="buriti-sub" style="margin-top:0;">${escapeAttr(t.titulo)}</p>
        <fieldset class="buriti-opcoes"><legend class="form-label">Como está?</legend>
          ${Object.entries(f().SITUACOES).map(([valor, s]) => `<label class="buriti-opcao">
            <input type="radio" name="buriti-situacao" value="${valor}" ${valor === atual ? 'checked' : ''}>
            <i data-lucide="${s.icone}"></i> ${escapeAttr(s.texto)}</label>`).join('')}
        </fieldset>
        <div class="form-group"><label class="form-label" for="buriti-atualizar-texto">O que aconteceu?</label>
          <textarea id="buriti-atualizar-texto" class="form-input" style="width:100%;" rows="5" maxlength="2000"
            placeholder="Ex.: Liguei para a FUNAPE. A Ranielly disse que o ofício chegou e responde até sexta."></textarea>
          <div class="buriti-sub">Sem CPF nem e-mail de pessoas.</div></div>
        ${abertos.length > 1 ? `<fieldset class="buriti-opcoes"><legend class="form-label">Concluiu algum destes? (opcional)</legend>
          ${abertos.map(s => `<label class="buriti-opcao"><input type="checkbox" name="buriti-passo" value="${escapeAttr(s.id)}">
            ${escapeAttr(s.descricao)}</label>`).join('')}
          <div class="buriti-sub">Com "Feito", todos contam como concluídos.</div></fieldset>` : ''}
        <div class="form-group"><label class="form-label" for="buriti-atualizar-link">Link (opcional)</label>
          <input id="buriti-atualizar-link" class="form-input" style="width:100%;" type="url" placeholder="https://" maxlength="500"></div>`,
      onSave: async () => {
        const situacao = document.querySelector('input[name="buriti-situacao"]:checked')?.value;
        const args = f().validarAtualizacao(situacao, document.getElementById('buriti-atualizar-texto').value,
          document.getElementById('buriti-atualizar-link').value);
        const passos = [...document.querySelectorAll('input[name="buriti-passo"]:checked')].map(i => i.value);
        await salvar({ ...args, p_passos: passos.length ? passos : null });
      } });
  }

  async function preencherCentros(rows) {
    const semCentro = rows.filter(t => !t.projects?.code);
    for (let i = 0; i < semCentro.length; i += 200) {
      const lote = semCentro.slice(i, i + 200);
      const centros = await ler(supabaseClient.rpc('centros_das_tarefas', { p_ids: lote.map(t => t.id) }));
      const mapa = new Map(centros.map(c => [c.tarefa_id, c.centro_custo]));
      for (const t of lote) {
        if (!mapa.has(t.id)) throw new Error('Centro da tarefa indisponível. Atualize a página.');
        t.centro_custo = mapa.get(t.id);
      }
    }
  }

  async function escolherResponsavel(atual, salvar, titulo = 'Responsável da tarefa') {
    if (!Auth.isAdmin()) return;
    const usuarios = await lerTudo(() => supabaseClient.from('app_users')
      .select('user_id,display_name,role').in('role', ['admin', 'professor']).order('display_name').order('user_id'));
    createModal({ title: titulo, saveLabel: 'Salvar',
      bodyHTML: '<label class="form-label" for="buriti-responsavel">Responsável</label>' +
        '<select id="buriti-responsavel" class="form-input"><option value="">Sem responsável</option>' +
        usuarios.map(u => '<option value="' + escapeAttr(u.user_id) + '" ' + (u.user_id === atual ? 'selected' : '') + '>' +
          escapeAttr(u.display_name || 'Usuário sem nome (' + u.user_id.slice(0, 8) + ')') + '</option>').join('') + '</select>',
      onSave: () => salvar(document.getElementById('buriti-responsavel').value || null) });
  }

  let consultaMenu = 0;
  // true/false = consulta concluída; null = indisponível ou superada por outra consulta.
  async function atualizarMenu() {
    const vez = ++consultaMenu;
    const item = document.querySelector('[data-minhas-tarefas]');
    const status = document.querySelector('[data-minhas-status]');
    if (!item) return null;
    const usuario = Auth.getUser()?.id;
    item.hidden = !usuario;
    if (status) { status.hidden = true; status.textContent = ''; }
    if (!usuario) return false;
    try {
      const rows = await ler(supabaseClient.from('tarefas').select('id').eq('responsavel_id', usuario).limit(1));
      if (vez !== consultaMenu || usuario !== Auth.getUser()?.id) return null;
      item.hidden = rows.length === 0;
      return rows.length > 0;
    } catch {
      if (vez !== consultaMenu || usuario !== Auth.getUser()?.id) return null;
      item.hidden = false;
      if (status) { status.hidden = false; status.textContent = 'Não foi possível consultar suas tarefas. Abra Minhas tarefas para tentar novamente.'; }
      return null;
    }
  }

  function sair() { geracao++; }
  return { tarefas, triagem, saude, sair, atualizarMenu, escolherResponsavel };
})();

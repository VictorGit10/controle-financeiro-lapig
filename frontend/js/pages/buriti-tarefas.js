// Adaptador humano da migração 054. Só RPCs escrevem; o RLS decide o escopo.
window.BuritiTarefasUI = (() => {
  const f = () => window.BuritiTarefas;
  let geracao = 0;
  const ocupados = new Set();
  const CAMPOS = 'id,project_id,titulo,descricao,responsavel,status,precisa_atencao,motivo_atencao,' +
    'prazo,prazo_motivo,criada_em,concluida_em,projects(name,code),' +
    'tarefa_passos(id,ordem,descricao,quem,estado,evento_id,' +
    'evento:tarefa_eventos!evento_id(resumo,gmail_thread_id,ocorrido_em)),' +
    'eventos:tarefa_eventos!tarefa_eventos_tarefa_id_fkey(id,tipo,origem,resumo,gmail_thread_id,ocorrido_em,criado_em)';
  const MSG = 'gmail_message_id,gmail_thread_id,recebida_em,assunto,trecho,fila,motivo,estado,anexos,' +
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

  function passoHTML(s, aberta) {
    const estado = f().ESTADOS_PASSO[s.estado];
    const editavel = aberta && ['pendente', 'sugerido'].includes(s.estado);
    return `<li class="buriti-passo">
      <div class="buriti-bloco__titulo"><i data-lucide="${estado.icone}"></i> ${s.ordem}. ${escapeAttr(s.descricao)}</div>
      <div class="buriti-sub">${estado.texto}${s.quem ? ` · ${escapeAttr(s.quem)}` : ''}</div>
      ${s.estado === 'sugerido' ? `<div class="buriti-bloco buriti-evidencia"><strong>Evidência sugerida</strong>
        <p class="buriti-sub">${escapeAttr(s.evento?.resumo || 'Resumo indisponível.')}</p>
        ${link(s.evento?.gmail_thread_id)}</div>` : ''}
      ${editavel ? `<div class="buriti-acoes">${botao('confirmar', 'Confirmar', s.id, true)}${botao('dispensar', 'Dispensar', s.id)}</div>` : ''}
    </li>`;
  }

  function tarefaHTML(t) {
    const aberta = ['em_andamento', 'aguardando_terceiro'].includes(t.status);
    const selo = f().seloPrazo(t.prazo);
    const passos = [...t.tarefa_passos].sort((a, b) => a.ordem - b.ordem);
    return `<article class="card buriti-cartao" data-tarefa="${escapeAttr(t.id)}">
      <header class="buriti-cartao__topo"><h3 class="buriti-titulo">${escapeAttr(t.titulo)}</h3>
        <span class="badge ${aberta ? selo.classe : 'badge--active'}">${aberta ? selo.texto : 'Concluída'}</span></header>
      <div class="buriti-cartao__centro">${escapeAttr(t.projects?.code || '')} ${escapeAttr(t.projects?.name || '')}</div>
      ${t.precisa_atencao ? `<div class="buriti-bloco buriti-bloco--aviso"><span class="badge badge--warning">precisa de você</span>
        <p class="buriti-sub">${escapeAttr(t.motivo_atencao || '')}</p></div>` : ''}
      ${t.descricao ? `<p class="buriti-cartao__resumo">${escapeAttr(t.descricao)}</p>` : ''}
      <div class="buriti-sub">${t.responsavel ? `Responsável: ${escapeAttr(t.responsavel)} · ` : ''}
        Prazo: ${t.prazo ? escapeAttr(t.prazo.split('-').reverse().join('/')) : '—'}
        ${t.prazo_motivo ? ` · ${escapeAttr(t.prazo_motivo)}` : ''}
        ${t.status === 'aguardando_terceiro' ? ' · Aguardando terceiro' : ''}</div>
      <ol class="buriti-lista buriti-passos">${passos.map(s => passoHTML(s, aberta)).join('')}</ol>
      <details class="buriti-bloco" data-linha-tempo><summary>Linha do tempo · últimos eventos</summary>
        <ul class="buriti-lista">${t.eventos.map(e => `<li><div class="buriti-sub">${escapeAttr(f().dataHora(e.ocorrido_em))} · ${escapeAttr(e.origem)}</div>
          <div>${escapeAttr(e.resumo)}</div>${link(e.gmail_thread_id)}</li>`).join('') || '<li>Nenhum evento.</li>'}</ul>
      </details>
      <div data-erro></div><div class="buriti-acoes">${botao('nota', 'Nota')}
        ${aberta ? botao('concluir', 'Concluir', '', true) : ''}</div>
    </article>`;
  }

  function consultaTarefa() {
    return supabaseClient.from('tarefas').select(CAMPOS)
      .order('criado_em', { referencedTable: 'eventos', ascending: false })
      .order('id', { referencedTable: 'eventos' }).limit(10, { referencedTable: 'eventos' });
  }

  async function atualizarTarefa(node, id, filtro) {
    const t = await ler(consultaTarefa().eq('id', id).single());
    if (!node.isConnected) return;
    if ((filtro === 'abertas' && !['em_andamento', 'aguardando_terceiro'].includes(t.status)) ||
      (filtro === 'concluidas' && t.status !== 'concluida')) {
      const lista = node.parentElement;
      node.remove();
      if (!lista.querySelector('[data-tarefa]')) lista.innerHTML = '<p class="buriti-sub">Nenhuma tarefa neste filtro.</p>';
      return;
    }
    const aberto = node.querySelector('[data-linha-tempo]')?.open;
    const temp = document.createElement('div');
    temp.innerHTML = tarefaHTML(t);
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

  async function acaoTarefa(e, filtro) {
    const button = e.target.closest('[data-acao]');
    const node = button?.closest('[data-tarefa]');
    if (!node) return;
    const id = node.dataset.tarefa, acao = button.dataset.acao;
    const atualizar = () => atualizarTarefa(node, id, filtro);
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
    if (acao === 'concluir') {
      if (!await confirmAction('Concluir esta tarefa? Todos os passos precisam estar confirmados ou dispensados.')) return;
      await agir(node, id, () => rpc('concluir_tarefa', { p_tarefa: id, p_nota: null }), atualizar);
    } else if (['confirmar', 'dispensar'].includes(acao)) {
      await agir(node, id, () => rpc(acao === 'confirmar' ? 'confirmar_passo' : 'dispensar_passo',
        { p_passo: button.dataset.id, p_nota: null }), atualizar);
    }
  }

  async function tarefas(root, filtro = 'abertas') {
    const vez = ++geracao;
    root.innerHTML = `<div class="buriti-abas" role="group" aria-label="Filtro de tarefas">
      ${['abertas', 'concluidas'].map(v => `<button class="btn ${v === filtro ? 'btn--primary' : 'btn--ghost'}" data-filtro="${v}" aria-pressed="${v === filtro}">${v === 'abertas' ? 'Abertas' : 'Concluídas'}</button>`).join('')}</div>
      <div class="buriti-coluna" data-cartoes><p class="buriti-sub">Consultando tarefas…</p></div>`;
    root.onclick = e => {
      const valor = e.target.closest('[data-filtro]')?.dataset.filtro;
      if (valor) tarefas(root, valor);
      else acaoTarefa(e, filtro);
    };
    try {
      const rows = await lerTudo(() => {
        const q = consultaTarefa().order('prazo', { ascending: true, nullsFirst: false }).order('id');
        return filtro === 'abertas' ? q.in('status', ['em_andamento', 'aguardando_terceiro']) : q.eq('status', 'concluida');
      });
      if (vez !== geracao || !root.isConnected) return;
      root.querySelector('[data-cartoes]').innerHTML = rows.length ? f().ordenarTarefas(rows).map(tarefaHTML).join('')
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
    return `<article class="card buriti-cartao" data-msg="${escapeAttr(m.gmail_message_id)}">
      <header class="buriti-cartao__topo"><h3 class="buriti-titulo">${escapeAttr(m.assunto || 'Assunto indisponível')}</h3>
        <span class="badge ${rotina ? 'badge--info' : 'badge--warning'}">${rotina ? 'Rotina' : 'Precisa de revisão'}</span></header>
      <div class="buriti-sub">${escapeAttr(f().dataHora(m.recebida_em))} · ${escapeAttr(m.motivo)} · ${escapeAttr(m.estado)}</div>
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
    const pendentes = [...mapa.values()].sort((a, b) => a.recebida_em.localeCompare(b.recebida_em));
    const rotina = valor(2).filter(m => !mapa.has(m.gmail_message_id));
    const renderMsg = m => mensagemHTML(m, valor(3), resultados[3].status === 'fulfilled');
    root.innerHTML = `${erros.join('')}<div class="buriti-coluna" data-pendentes>
      ${pendentes.map(renderMsg).join('') || (erros.length ? '' : '<p class="buriti-sub" data-vazio>Nenhuma mensagem esperando revisão.</p>')}</div>
      <details class="buriti-bloco buriti-rotina"><summary>Rotina · últimos 7 dias${resultados[2].status === 'fulfilled' ? ` (${rotina.length})` : ' · indisponível'}</summary>
        <div class="buriti-coluna" data-rotina>${rotina.map(renderMsg).join('')}</div></details>`;
    root.onclick = async e => {
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

  function sair() { geracao++; }
  return { tarefas, triagem, saude, sair };
})();

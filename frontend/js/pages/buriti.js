/* ============================================================
   Buriti — caixa de propostas do agente de IA (mig. 051)
   ============================================================
   O Buriti PROPÕE; quem aplica é a pessoa logada aqui. Esta página
   não grava nada por conta própria:
     • "Revisar e aplicar" (balancete) abre a MESMA fila e a MESMA
       revisão da importação comum, com a proposta pré-preenchida —
       salvar grava pelo upsert_balancete, que marca a proposta como
       aplicada na mesma transação;
     • "Responder" (pergunta/aviso) e "Rejeitar" chamam
       decidir_proposta — rejeitar exige o motivo, que é o que o
       Buriti lê para não repetir.
   Pensada para o celular: o Victor aprova pelo telefone. Cartões em
   coluna, botões grandes, nada de tabela larga.
   ============================================================ */

Router.register('buriti', {
  title: 'Buriti',
  async render(container) {
    await BuritiPage.load(container);
  },
});

/* exported BuritiPage */
const BuritiPage = (() => {

  let containerEl = null;
  let contentEl = null;
  let secao = 'propostas';
  let carga = 0;
  const ocupados = new Set();
  let aba = 'pendentes';      // 'pendentes' | 'decididas'
  let propostas = [];

  const TIPO = {
    balancete: { icone: 'file-stack',     rotulo: 'Balancete' },
    plano:     { icone: 'file-text', rotulo: 'Plano de trabalho' },
    bolsas:    { icone: 'file-spreadsheet', rotulo: 'Bolsas' },
    pergunta:  { icone: 'message-circle-question', rotulo: 'Pergunta' },
    aviso:     { icone: 'bell',           rotulo: 'Aviso' },
    tarefa:    { icone: 'list-checks',     rotulo: 'Tarefa' },
  };
  const STATUS = {
    pendente:   ['badge--warning', 'Pendente'],
    aplicada:   ['badge--active',  'Aplicada'],
    rejeitada:  ['badge--ended',   'Rejeitada'],
    respondida: ['badge--info',    'Respondida'],
    obsoleta:   ['badge--ended',   'Substituída'],
  };

  const nomeRubrica = (c) =>
    (typeof PlanoTrabalhoPage !== 'undefined' && PlanoTrabalhoPage.rubricaNome)
      ? PlanoTrabalhoPage.rubricaNome(c) : c;

  async function load(container) {
    containerEl = container;
    secao = 'propostas';
    aba = 'pendentes';
    await trocarSecao(secao);
  }

  async function trocarSecao(nova) {
    if (nova === 'triagem' && !Auth.isAdmin()) return;
    carga++;
    window.BuritiTarefasUI.sair();
    secao = nova;
    containerEl.innerHTML = `<div class="buriti-pagina">
      <p class="buriti-intro">O <strong>Buriti</strong> propõe; você revisa, aplica e acompanha.</p>
      <div data-saude><p class="buriti-sub">Consultando saúde do vigia…</p></div>
      <div class="buriti-abas" role="tablist" aria-label="Buriti">
        ${[['propostas', 'Propostas'], ...(Auth.isAdmin() ? [['triagem', 'Triagem']] : [])].map(([s, nome]) =>
          `<button role="tab" aria-selected="${secao === s}" class="btn ${secao === s ? 'btn--primary' : 'btn--ghost'}" onclick="BuritiPage.trocarSecao('${s}')">${nome}</button>`).join('')}
      </div><div data-conteudo role="tabpanel"></div></div>`;
    contentEl = containerEl.querySelector('[data-conteudo]');
    const saude = window.BuritiTarefasUI.saude(containerEl.querySelector('[data-saude]'));
    if (secao === 'triagem') await window.BuritiTarefasUI.triagem(contentEl);
    else await refresh();
    await saude;
  }

  async function refresh() {
    if (secao !== 'propostas') return;
    const vez = ++carga;
    contentEl.innerHTML = '<div class="skeleton skeleton--card" style="height:200px;"></div>';
    const campos = aba === 'pendentes'
      ? 'id,tipo,project_id,chave,resumo,payload,arquivo_path,status,criada_em,projects(name,code)'
      : 'id,tipo,project_id,chave,resumo,payload,status,criada_em,decidida_em,motivo,projects(name,code)';
    let q = supabaseClient.from('propostas_agente').select(campos)
      .order('criada_em', { ascending: false }).limit(aba === 'pendentes' ? 100 : 50);
    q = aba === 'pendentes' ? q.eq('status', 'pendente') : q.neq('status', 'pendente');
    const { data, error } = await q;
    if (vez !== carga || secao !== 'propostas') return;

    if (error) {
      // Tabela ausente = migração 051 não aplicada. Falha nunca vira "caixa vazia".
      contentEl.innerHTML = `
        <div class="alert-banner alert-banner--warning">
          <i data-lucide="alert-triangle" class="alert-banner__icon"></i>
          <div class="alert-banner__body">
            <strong>Não foi possível ler a caixa do Buriti</strong>
            <div style="font-size:0.85rem;color:var(--text-secondary);">
              ${detalheTecnico(`Confira se a migração <code>051_buriti_propostas_do_agente.sql</code> foi aplicada. Erro: ${escapeAttr(error.message)}`)}
            </div>
          </div>
        </div>`;
      lucide.createIcons();
      return;
    }
    propostas = data || [];
    render();
  }

  function trocarAba(nova) {
    if (nova === aba) return;
    aba = nova;
    refresh();
  }

  function dataHora(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function centroHTML(p) {
    if (!p.projects) return '<span style="color:var(--text-muted);">Geral</span>';
    return `${escapeAttr(p.projects.code || '')} <span style="color:var(--text-secondary);font-weight:400;">${escapeAttr(p.projects.name || '')}</span>`;
  }

  function perguntasHTML(p) {
    const qs = p.payload?.perguntas || [];
    if (qs.length === 0) return '';
    // Recolhido: o cartão mostra o resumo e a contagem; a lista abre se a
    // pessoa quiser ler antes de entrar na revisão (onde a resposta é dada).
    return `
      <details class="buriti-bloco">
        <summary class="buriti-bloco__titulo"><i data-lucide="help-circle"></i> ${qs.length} pergunta(s) para você — ver</summary>
        <ul class="buriti-lista" style="margin-top:6px;">
          ${qs.map(q => `
            <li>
              <div><strong>${escapeAttr(q.descricao || q.conta)}</strong> · ${formatBRL(q.valor)}</div>
              <div class="buriti-sub">
                ${q.sugestao
                  ? `Sugestão: <strong>${escapeAttr(nomeRubrica(q.sugestao.rubrica))}</strong> — ${escapeAttr(q.sugestao.justificativa || '')}`
                  : 'Sem sugestão: o trecho cortado do código decide a rubrica.'}
              </div>
            </li>`).join('')}
        </ul>
      </details>`;
  }

  function avisosHTML(p) {
    const avisos = p.payload?.avisos || [];
    if (avisos.length === 0) return '';
    return `
      <div class="buriti-bloco buriti-bloco--aviso">
        <div class="buriti-bloco__titulo"><i data-lucide="alert-triangle"></i> Avisos</div>
        <ul class="buriti-lista">${avisos.map(a => `<li>${escapeAttr(a)}</li>`).join('')}</ul>
      </div>`;
  }

  function cartaoHTML(p) {
    const t = TIPO[p.tipo] || { icone: 'circle', rotulo: p.tipo };
    const [cls, rot] = STATUS[p.status] || ['badge--info', p.status];
    const id = escapeAttrJs(p.id);
    const acoes = p.status !== 'pendente' ? '' : `
      <div class="buriti-acoes">
        ${p.tipo === 'balancete' || p.tipo === 'plano' ? `<button class="btn btn--primary" onclick="BuritiPage.revisar('${id}')"><i data-lucide="clipboard-check"></i> Revisar e aplicar</button>` : ''}
        ${p.tipo === 'tarefa' && Auth.isAdmin() ? `<button class="btn btn--primary" onclick="BuritiPage.criarTarefa('${id}')"><i data-lucide="list-checks"></i> Criar tarefa</button>` : ''}
        ${p.tipo === 'pergunta' || p.tipo === 'aviso' ? `<button class="btn btn--primary" onclick="BuritiPage.responder('${id}')"><i data-lucide="reply"></i> ${p.tipo === 'aviso' ? 'Ciente' : 'Responder'}</button>` : ''}
        <button class="btn btn--secondary" onclick="BuritiPage.rejeitar('${id}')"><i data-lucide="x-circle"></i> Rejeitar</button>
      </div>`;
    const decisao = p.status === 'pendente' ? '' : `
      <div class="buriti-sub" style="margin-top:6px;">
        ${p.decidida_em ? `Decidida em ${dataHora(p.decidida_em)}` : ''}
        ${p.motivo ? ` — <em>${escapeAttr(p.motivo)}</em>` : ''}
      </div>`;
    return `
      <article class="card buriti-cartao fade-in" data-proposta="${escapeAttr(p.id)}">
        <header class="buriti-cartao__topo">
          <span class="buriti-cartao__tipo"><i data-lucide="${t.icone}"></i> ${t.rotulo}</span>
          <span class="badge ${cls}">${rot}</span>
        </header>
        <div class="buriti-cartao__centro">${centroHTML(p)}</div>
        <p class="buriti-cartao__resumo">${escapeAttr(p.resumo)}</p>
        ${p.tipo === 'plano' ? `<div class="buriti-sub">${p.payload?.tipo === 'original' ? 'Plano original' : 'Remanejamento'}</div>` : ''}
        ${p.tipo === 'tarefa' ? resumoTarefaHTML(p.payload) : ''}
        ${p.status === 'pendente' ? perguntasHTML(p) + avisosHTML(p) : ''}
        <div class="buriti-sub">Proposta em ${dataHora(p.criada_em)}</div>
        ${decisao}
        <div data-erro></div>
        ${acoes}
      </article>`;
  }

  function resumoTarefaHTML(p = {}) {
    const selo = window.BuritiTarefas.seloPrazo(p.prazo);
    return `<div class="buriti-bloco"><span class="badge ${selo.classe}">${selo.texto}</span>
      ${p.prazo ? `<div class="buriti-sub">Prazo: ${escapeAttr(p.prazo.split('-').reverse().join('/'))}</div>` : ''}
      ${p.prazo_motivo ? `<p class="buriti-sub">${escapeAttr(p.prazo_motivo)}</p>` : ''}
      ${p.descricao ? `<p>${escapeAttr(p.descricao)}</p>` : ''}
      ${p.responsavel ? `<p class="buriti-sub">Responsável: ${escapeAttr(p.responsavel)}</p>` : ''}
      <ol class="buriti-lista">${(p.passos || []).map((s, i) => `<li>${i + 1}. ${escapeAttr(s.descricao)}${s.quem ? ` · ${escapeAttr(s.quem)}` : ''}</li>`).join('')}</ol></div>`;
  }

  function erroCartao(id, e) {
    const node = [...contentEl.querySelectorAll('[data-proposta]')].find(n => n.dataset.proposta === id);
    if (node) {
      node.querySelector('[data-erro]').innerHTML = `<div class="alert-banner alert-banner--warning" role="alert">
        <div>Não foi possível completar a ação. ${escapeAttr(e.message)}</div></div>`;
    }
  }

  async function atualizarProposta(id) {
    const { data, error } = await supabaseClient.from('propostas_agente')
      .select('id,tipo,project_id,chave,resumo,payload,status,criada_em,decidida_em,motivo,projects(name,code)').eq('id', id).single();
    if (error) throw new Error(error.message);
    propostas = propostas.map(p => p.id === id ? data : p);
    const node = [...contentEl.querySelectorAll('[data-proposta]')].find(n => n.dataset.proposta === id);
    if (!node || secao !== 'propostas') return;
    if (aba === 'pendentes' && data.status !== 'pendente') node.remove();
    else node.outerHTML = cartaoHTML(data);
    lucide.createIcons();
  }

  async function criarTarefa(id) {
    if (!Auth.isAdmin() || ocupados.has(id)) return;
    ocupados.add(id);
    try {
      await window.BuritiTarefasUI.escolherResponsavel(null, async usuario => {
        const { error } = await supabaseClient.rpc('aplicar_proposta_tarefa', { p_id: id, p_responsavel: usuario });
        if (error) { erroCartao(id, error); throw new Error(error.message); }
        await atualizarProposta(id);
        await window.BuritiTarefasUI.atualizarMenu();
        showToast('Tarefa criada. Acompanhe em Atividades.', 'success');
      }, 'Criar tarefa — escolher responsável');
    } catch (e) { erroCartao(id, e); }
    finally { ocupados.delete(id); }
  }

  function render() {
    const vazio = aba === 'pendentes'
      ? `<div class="empty-state" style="padding:var(--sp-6);">
           <i data-lucide="inbox" class="empty-state__icon"></i>
           <h3 class="empty-state__title">Nada esperando por você</h3>
           <p class="empty-state__text">Quando o Buriti conferir um balancete, um plano ou tiver uma dúvida, a proposta aparece aqui.</p>
         </div>`
      : `<div class="empty-state" style="padding:var(--sp-6);"><p class="empty-state__text">Nenhuma decisão ainda.</p></div>`;

    contentEl.innerHTML = `
        <div class="buriti-abas" role="group" aria-label="Filtro de propostas">
          <button class="btn ${aba === 'pendentes' ? 'btn--primary' : 'btn--ghost'} btn--sm" onclick="BuritiPage.trocarAba('pendentes')">
            Pendentes${aba === 'pendentes' ? ` (${propostas.length})` : ''}
          </button>
          <button class="btn ${aba === 'decididas' ? 'btn--primary' : 'btn--ghost'} btn--sm" onclick="BuritiPage.trocarAba('decididas')">Decididas</button>
        </div>
        <div class="buriti-coluna">${propostas.length ? propostas.map(cartaoHTML).join('') : vazio}</div>`;
    lucide.createIcons();
  }

  async function revisar(id) {
    const p = propostas.find(x => x.id === id);
    if (!p) return;
    try {
      const revisarProposta = p.tipo === 'plano'
        ? PlanoTrabalhoPage.revisarPropostaPlano : PlanoTrabalhoPage.revisarPropostaBalancete;
      await revisarProposta(p, (resumo) => {
        if (resumo?.saved) showToast((p.tipo === 'plano' ? 'Plano' : 'Balancete') + ' gravado e proposta marcada como aplicada.', 'success');
        atualizarProposta(id).catch(e => erroCartao(id, e));
      });
    } catch (e) {
      erroCartao(id, e);
    }
  }

  function decidir(id, decisao, { titulo, rotulo, placeholder, obrigatorio, botao }) {
    const p = propostas.find(x => x.id === id);
    if (!p) return;
    createModal({
      title: titulo,
      bodyHTML: `
        <p style="margin:0 0 8px;color:var(--text-secondary);font-size:0.9rem;">${escapeAttr(p.resumo)}</p>
        <label class="form-label" for="buriti-texto">${rotulo}</label>
        <textarea id="buriti-texto" class="form-input" rows="4" placeholder="${escapeAttr(placeholder)}" style="width:100%;"></textarea>`,
      saveLabel: botao,
      onSave: async () => {
        const texto = document.getElementById('buriti-texto').value.trim();
        if (obrigatorio && !texto) throw new Error(`${rotulo} é obrigatório.`);
        const { error } = await supabaseClient.rpc('decidir_proposta', {
          p_id: id, p_decisao: decisao, p_motivo: texto || null,
        });
        if (error) { erroCartao(id, error); throw new Error(error.message); }
        showToast(decisao === 'rejeitada' ? 'Proposta rejeitada.' : 'Resposta enviada ao Buriti.', 'success');
        try { await atualizarProposta(id); }
        catch (e) { erroCartao(id, e); throw e; }
      },
    });
    setTimeout(() => document.getElementById('buriti-texto')?.focus(), 50);
  }

  function rejeitar(id) {
    decidir(id, 'rejeitada', {
      titulo: 'Rejeitar proposta',
      rotulo: 'Motivo',
      placeholder: 'O que está errado? O Buriti lê isto para não repetir.',
      obrigatorio: true,
      botao: 'Rejeitar',
    });
  }

  function responder(id) {
    const p = propostas.find(x => x.id === id);
    const pergunta = p?.tipo === 'pergunta';
    decidir(id, 'respondida', {
      titulo: pergunta ? 'Responder ao Buriti' : 'Marcar aviso como lido',
      rotulo: pergunta ? 'Resposta' : 'Comentário (opcional)',
      placeholder: pergunta ? 'A resposta volta para o Buriti.' : '',
      obrigatorio: pergunta,
      botao: pergunta ? 'Enviar resposta' : 'Ciente',
    });
  }

  return { load, refresh, trocarAba, trocarSecao, revisar, responder, rejeitar, criarTarefa };
})();

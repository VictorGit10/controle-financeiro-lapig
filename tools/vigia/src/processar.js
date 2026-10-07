var VigiaProcessar = (function () {
  var U = typeof module !== 'undefined' ? require('./00-util.js') : VigiaUtil;
  var M = typeof module !== 'undefined' ? require('./mascara.js') : VigiaMascara;
  var T = typeof module !== 'undefined' ? require('./triagem.js') : VigiaTriagem;
  var L = typeof module !== 'undefined' ? require('./ligacao.js') : VigiaLigacao;
  var E = typeof module !== 'undefined' ? require('./evidencia.js') : VigiaEvidencia;
  var Modelo = typeof module !== 'undefined' ? require('./modelo.js') : VigiaModelo;
  function prepararMensagem(msg, contexto) {
    contexto = contexto || {};
    var mapa = contexto.mapa || { dominiosInstitucionais: (contexto.config || {}).dominiosInstitucionais };
    mapa.pessoas = (mapa.pessoas || []).concat((contexto.tarefas || []).reduce(function (a, t) {
      return a.concat((t.chaves || []).filter(function (c) { return c.tipo === 'pessoa'; }).map(function (c) { return c.valor; }), t.responsavel ? [t.responsavel] : []);
    }, []));
    var citacoes = M.tirarCitacoes(msg.corpo), encaminhada = !!citacoes.encaminhado;
    var corpo = citacoes.novo + (encaminhada ? '\nMensagem encaminhada:\n' + citacoes.encaminhado : '');
    var ocorrido = encaminhada ? U.dataEncaminhada(citacoes.encaminhado) : null;
    var limpa = Object.assign({}, msg, { corpo: corpo, ocorrido_em: ocorrido || msg.recebida_em, encaminhada: encaminhada });
    var mascarada = {};
    var falhou = false;
    try { ['assunto', 'corpo', 'de', 'para', 'cc'].forEach(function (k) { mascarada[k] = M.mascarar(limpa[k] || '', mapa); }); }
    catch (_) { falhou = true; mascarada = { assunto: '', corpo: '', de: '', para: '', cc: '' }; }
    falhou = falhou || Object.keys(mascarada).some(function (k) { return M.aindaTemCpf(mascarada[k]); });
    var dominio = (U.emails(msg.de)[0] || '').split('@')[1] || '';
    var registro = {
      gmail_message_id: String(msg.gmail_message_id), gmail_thread_id: String(msg.gmail_thread_id), recebida_em: msg.recebida_em,
      remetente: mascarada.de, remetente_dominio: dominio, assunto: mascarada.assunto, trecho: mascarada.corpo.slice(0, 300),
      estado: 'capturada', fila: null, motivo: null, classificacao: null, confianca: null, modelo: null,
      encaminhada: encaminhada, ocorrido_em: limpa.ocorrido_em, anexos: Number(msg.anexos || 0)
    };
    // Uma falha de máscara não pode persistir o fragmento que escapou.
    if (falhou) { registro.assunto = '[Conteúdo retido: máscara falhou]'; registro.trecho = ''; registro.remetente = '[Retido]'; }
    return { limpa: limpa, mascarada: mascarada, registro: registro, mapa: mapa, falhou: falhou };
  }
  function processarMensagem(msg, contexto, chamarModelo) {
    contexto = contexto || {};
    var prep = prepararMensagem(msg, contexto), reg = prep.registro, config = contexto.config || {};
    var propria = U.mensagemPropria(prep.limpa, config), restricoes = U.restricoesTexto(prep.limpa), spamComVinculo = false, motivoAnalise = null;
    var resultado = { registro_mensagem: reg, vinculos: [], eventos: [], passos_sugeridos: [], precisa_victor: false, chamou_modelo: false };
    function motivo(m) { motivoAnalise = m; reg.motivo = spamComVinculo ? 'spam_com_vinculo' : m; }
    function esclarecer(m) { reg.estado = 'processada'; reg.fila = 'esclarecer'; motivo(m); resultado.precisa_victor = !propria; return resultado; }
    if (prep.falhou) return esclarecer('mascara_falhou');
    var rejeitados = (contexto.vinculos || []).filter(function (v) { return v.gmail_message_id === reg.gmail_message_id && v.estado === 'rejeitado'; }).map(function (v) { return v.tarefa_id; });
    var tarefas = (contexto.tarefas || []).filter(function (t) { return rejeitados.indexOf(t.id) < 0 && ['concluida','cancelada'].indexOf(t.status) < 0; });
    var cands = L.candidatos(prep.limpa, tarefas), decisao = L.decidirPorRegra(cands);
    spamComVinculo = prep.limpa.spam === true && cands.some(function (c) { return c.forca === 'forte' || c.forca === 'media'; });
    var inicial = T.filaInicial(prep.limpa, config, cands);
    if (inicial.fila === 'rotina') { reg.estado = 'processada'; reg.fila = 'rotina'; motivo(inicial.motivo); reg.classificacao = 'sem_acao'; return resultado; }
    function vinculo(id, origem) {
      var anterior = (contexto.vinculos || []).find(function (v) { return v.gmail_message_id === reg.gmail_message_id && v.tarefa_id === id; });
      return { gmail_message_id: reg.gmail_message_id, tarefa_id: id, origem: origem, estado: anterior && anterior.estado === 'confirmado' ? 'confirmado' : 'sugerido' };
    }
    resultado.vinculos = decisao.vinculos.map(function (v) { return vinculo(v.tarefa_id, v.origem); });
    var tarefasComEvidencia = [];
    // Evidência direta é uma ligação por regra, mesmo quando a conversa é nova.
    tarefas.forEach(function (tarefa) {
      (tarefa.passos || []).forEach(function (passo) {
        if (propria || prep.limpa.encaminhada || T.sinaisTecnicos(prep.limpa, config).length) return;
        var ev = E.avaliarPasso(passo.evidencia, prep.limpa, tarefa, config);
        if (!ev.cumpre) return;
        if (tarefasComEvidencia.indexOf(tarefa.id) < 0) tarefasComEvidencia.push(tarefa.id);
        if (passo.estado !== 'pendente') return;
        if (!resultado.vinculos.some(function (v) { return v.tarefa_id === tarefa.id; })) resultado.vinculos.push(vinculo(tarefa.id, 'regra'));
        var chave = 'msg:' + reg.gmail_message_id + ':passo:' + passo.id;
        resultado.passos_sugeridos.push({ tarefa_id: tarefa.id, passo_id: passo.id, estado: 'sugerido', evento_chave: chave });
        resultado.eventos.push({ chave: chave, tarefa_id: tarefa.id, tipo: 'sugestao', origem: 'vigia', resumo: 'Evidência encontrada; aguarda confirmação humana.', detalhe: { passo_id: passo.id, trecho: M.mascarar(ev.trecho, prep.mapa).slice(0, 300) }, gmail_message_id: reg.gmail_message_id, gmail_thread_id: reg.gmail_thread_id, ocorrido_em: reg.ocorrido_em });
      });
    });
    reg.classificacao = restricoes.injecao ? 'duvida' : 'informativo'; reg.confianca = 'alta'; motivo('regra');
    var ausencia = T.sinaisTecnicos(prep.limpa, config).indexOf('ausencia') >= 0;
    if (propria) { reg.classificacao = 'informativo'; motivo('mensagem_propria'); }
    else if (ausencia) { motivo('ausencia'); reg.confianca = null; }
    else if (!resultado.passos_sugeridos.length && typeof chamarModelo === 'function') {
      var fichas = cands.slice(0, 5).map(function (c) {
        var t = tarefas.find(function (t) { return t.id === c.tarefa_id; });
        return { tarefa_id: c.tarefa_id, forca: c.forca, razoes: c.razoes, titulo: M.mascarar(t.titulo, prep.mapa), centro_custo: /^\d{2}\.\d{3}$/.test(t.centro_custo || '') ? t.centro_custo : '', chaves: (t.chaves || []).filter(function (ch) { return ch.tipo !== 'thread'; }).map(function (ch) { return { tipo: ch.tipo, valor: M.mascarar(ch.valor, prep.mapa) }; }) };
      });
      var prompt = Modelo.montarPrompt(prep.mascarada, fichas);
      if (M.aindaTemCpf(prompt)) return esclarecer('mascara_falhou');
      resultado.chamou_modelo = true;
      var raw;
      try { raw = chamarModelo(prompt); } catch (_) {
        // Não registra interpretação parcial. A captura será reprocessada.
        resultado.vinculos = []; resultado.eventos = []; resultado.passos_sugeridos = [];
        reg.classificacao = null; reg.confianca = null; motivo('modelo_indisponivel');
        return resultado;
      }
      var validada = Modelo.validarResposta(raw, prep.mascarada, fichas);
      if (validada.fila === 'esclarecer') return esclarecer(validada.motivo);
      reg.classificacao = validada.classificacao; reg.confianca = validada.confianca; reg.modelo = config.modelo || 'glm-5.3-flash'; motivo('modelo');
      (validada.tarefa_id ? [validada.tarefa_id] : []).concat(validada.varias).forEach(function (id) {
        if (!resultado.vinculos.some(function (v) { return v.tarefa_id === id; })) resultado.vinculos.push(vinculo(id, 'modelo'));
      });
      if (!resultado.vinculos.length) {
        // Candidato não é vínculo: classificação sem tarefa não exige prova de passo.
        spamComVinculo = false;
        if (validada.demanda_nova) return esclarecer('demanda_nova');
        reg.estado = 'processada'; reg.fila = 'rotina'; motivo('sem_tarefa_relacionada');
        return resultado;
      }
      if (validada.demanda_nova) return esclarecer('demanda_nova');
    } else if (!ausencia && !resultado.vinculos.length) return esclarecer('sem_modelo');
    var alegacaoSemEvidencia = !propria && (reg.classificacao === 'concluido' || restricoes.alegacao) && resultado.vinculos.some(function (v) { return tarefasComEvidencia.indexOf(v.tarefa_id) < 0; });
    if (alegacaoSemEvidencia) motivo('alegacao_sem_evidencia');
    reg.estado = 'processada'; reg.fila = resultado.vinculos.length ? 'tarefa' : propria || reg.classificacao === 'sem_acao' ? 'rotina' : 'esclarecer';
    resultado.precisa_victor = !propria && (alegacaoSemEvidencia || reg.fila === 'esclarecer' || ['exigencia','duvida'].indexOf(reg.classificacao) >= 0 || resultado.passos_sugeridos.length > 0);
    resultado.vinculos.forEach(function (v) {
      v.gmail_message_id = reg.gmail_message_id;
      var anterior = (contexto.vinculos || []).find(function (a) { return a.gmail_message_id === reg.gmail_message_id && a.tarefa_id === v.tarefa_id; });
      if (anterior && anterior.estado === 'confirmado') v.estado = 'confirmado';
      resultado.eventos.push({ chave: 'msg:' + reg.gmail_message_id + ':tarefa:' + v.tarefa_id, tarefa_id: v.tarefa_id, tipo: 'mensagem', origem: 'vigia', resumo: 'Mensagem: ' + reg.classificacao, detalhe: { classificacao: reg.classificacao, precisa_victor: resultado.precisa_victor, motivo: motivoAnalise }, gmail_message_id: reg.gmail_message_id, gmail_thread_id: reg.gmail_thread_id, ocorrido_em: reg.ocorrido_em });
    });
    return resultado;
  }
  return { prepararMensagem: prepararMensagem, processarMensagem: processarMensagem };
})();
if (typeof module !== 'undefined') module.exports = VigiaProcessar;

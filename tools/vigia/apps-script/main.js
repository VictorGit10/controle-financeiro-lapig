var VigiaMain = (function () {
  var VERSAO = 'vigia-1';
  function configuracao() { return PropertiesService.getScriptProperties().getProperties(); }
  function conferir(config) {
    var obrigatorias = ['SUPABASE_URL','SUPABASE_ANON_KEY','VIGIA_EMAIL','VIGIA_SENHA','SITE_URL','EMAIL_AVISO'];
    var opcionais = ['OLLAMA_API_KEY','OLLAMA_MODEL','NTFY_TOPICO','OLLAMA_TIMEOUT_MS','DOMINIOS_INSTITUCIONAIS','REMETENTES_AUTOMATICOS','VICTOR_EMAIL'];
    return obrigatorias.concat(opcionais).map(function (nome) {
      var valor = config[nome], valido = !!valor;
      if (valido && /^(SUPABASE_URL|SITE_URL)$/.test(nome)) valido = /^https:\/\/[^\s]+$/.test(valor);
      if (valido && /^(VIGIA_EMAIL|EMAIL_AVISO|VICTOR_EMAIL)$/.test(nome)) valido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor);
      if (valido && nome === 'NTFY_TOPICO') valido = /^[a-zA-Z0-9_-]+$/.test(valor);
      if (valido && nome === 'OLLAMA_TIMEOUT_MS') valido = Number(valor) >= 1000 && Number(valor) <= 120000;
      return { propriedade: nome, estado: valido ? 'ok' : valor ? 'invalida' : obrigatorias.indexOf(nome) >= 0 ? 'ausente' : 'opcional_desligada', obrigatoria: obrigatorias.indexOf(nome) >= 0 };
    });
  }
  function validarConfig(config) {
    if (conferir(config).some(function (r) { return r.estado === 'invalida' || r.obrigatoria && r.estado === 'ausente'; })) throw new Error('configuracao_incompleta');
  }
  function configurarContexto(ctx, config) {
    if (!ctx || ctx.versao_esquema !== 1 || !Array.isArray(ctx.tarefas) || !Array.isArray(ctx.pendentes)) throw new Error('contexto_incompativel');
    ctx.config = { modelo: config.OLLAMA_MODEL || 'glm-5.3-flash', emailVictor: config.VICTOR_EMAIL || config.EMAIL_AVISO };
    if (config.DOMINIOS_INSTITUCIONAIS) ctx.config.dominiosInstitucionais = config.DOMINIOS_INSTITUCIONAIS.split(',').map(function (s) { return s.trim().toLowerCase(); });
    if (config.REMETENTES_AUTOMATICOS) ctx.config.remetentesAutomaticos = config.REMETENTES_AUTOMATICOS.split(',').map(function (s) { return s.trim().toLowerCase(); });
    ctx.mapa = { dominiosInstitucionais: ctx.config.dominiosInstitucionais };
    return ctx;
  }
  function chaveErro(e) { return /^(janela_|contexto_|configuracao_|login_|rpc_|mensagem_)[a-z0-9_]+$/.test(e.message || '') ? e.message : 'execucao_falhou'; }
  function entregar(db, config, avisos, ctx) {
    (avisos || []).forEach(function (aviso) {
      var tarefa = (ctx.tarefas || []).find(function (t) { return t.id === aviso.tarefa_id; }) || { titulo: 'Triagem do vigia' };
      var texto = aviso.tipo === 'resumo_diario' ? VigiaResumo.textoResumoDiario(Object.assign({}, ctx, { site_url: config.SITE_URL }), aviso.dia) : VigiaResumo.textoAviso(Object.assign({}, tarefa, { tipo: aviso.tipo, site_url: config.SITE_URL, mapa: ctx.mapa }));
      var envio = VigiaAvisos.enviar(config, texto, 'Vigia LAPIG', aviso.tipo === 'alerta_prazo' ? 4 : 3);
      db.rpc('vigia_registrar', { p: { versao: VERSAO, avisos_resultados: [Object.assign({ chave: aviso.chave }, envio)] } });
    });
  }
  function executar(tipo) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) return { estado: 'ocupado' };
    var config, db, ctx, execucao, terminou = false;
    try {
      config = configuracao(); validarConfig(config); db = VigiaSupabase.criar(config);
      var inicio = new Date().toISOString();
      var aberta = db.rpc('vigia_registrar', { p: { versao: VERSAO, execucao: { tipo: tipo, iniciada_em: inicio } } });
      if (!aberta || !aberta.execucao_id) throw new Error('rpc_execucao_sem_id');
      execucao = aberta.execucao_id;
      ctx = configurarContexto(db.rpc('vigia_contexto'), config);
      var resultados = [], erros = [], capturas = [], mensagensNovas = 0;
      if (tipo === 'checagem') {
        var janela = VigiaGmail.buscar(ctx.cursor_em, inicio), disponiveis = Object.create(null);
        janela.mensagens.forEach(function (msg) { disponiveis[msg.gmail_message_id] = msg; capturas.push(VigiaProcessar.prepararMensagem(msg, ctx).registro); });
        // Primeira carga: o banco exige o aviso explícito (sem cursor não há sobreposição a conferir).
        if (!ctx.cursor_em) janela.janela.primeira_carga = true;
        var capturada = db.rpc('vigia_capturar', { p: { execucao_id: execucao, janela: janela.janela, mensagens: capturas } });
        if (!capturada || !Array.isArray(capturada.processar_ids)) throw new Error('rpc_captura_invalida');
        mensagensNovas = Number(capturada.mensagens_novas || 0);
        var ids = ctx.pendentes.map(function (p) { return typeof p === 'string' ? p : p.gmail_message_id; }).concat(capturada.processar_ids).filter(function (id, i, todos) { return todos.indexOf(id) === i; });
        var modelo = VigiaOllama.criar(config);
        ids.forEach(function (id) {
          // Reserva tempo para registrar fim e efeitos, sem perder capturas.
          if (Date.now() - Date.parse(inicio) > 240000) { erros.push({ gmail_message_id: id, codigo: 'orcamento_esgotado' }); return; }
          try {
            var msg = disponiveis[id] || VigiaGmail.porId(id);
            var resultado = VigiaProcessar.processarMensagem(msg, ctx, modelo);
            resultados.push(resultado);
            if (resultado.registro_mensagem.estado === 'capturada') erros.push({ gmail_message_id: id, codigo: 'modelo_indisponivel' });
          } catch (e) { erros.push({ gmail_message_id: id, codigo: chaveErro(e) }); }
        });
      }
      var hoje = VigiaUtil.diaSP(inicio), eventos = [];
      ctx.tarefas.forEach(function (t) { eventos = eventos.concat(VigiaPrazos.alertasDevidos(t, hoje, ctx.alertas_emitidos || [])); });
      var final = db.rpc('vigia_registrar', { p: { versao: VERSAO, execucao: { id: execucao, terminada_em: new Date().toISOString(), mensagens_novas: mensagensNovas,
        chamadas_modelo: resultados.filter(function (r) { return r.chamou_modelo; }).length, alertas: eventos.length, erros: erros }, resultados: resultados, eventos: eventos,
        resumo_diario: tipo === 'resumo_diario' ? { chave: 'resumo:' + hoje, dia: hoje } : null } });
      terminou = true;
      // O banco devolve a outbox pendente, incluindo avisos de execuções anteriores.
      entregar(db, config, (final || {}).avisos, ctx);
      db.rpc('vigia_expurgar');
      return { estado: 'ok', execucao_id: execucao, mensagens: resultados.length, erros: erros.length };
    } catch (e) {
      if (db && execucao && !terminou) {
        try { db.rpc('vigia_registrar', { p: { versao: VERSAO, execucao: { id: execucao, terminada_em: new Date().toISOString(), erros: [{ codigo: chaveErro(e) }] } } }); } catch (_) { /* O monitor externo verá execução sem fim. */ }
      }
      if (config) VigiaAvisos.enviar(config, 'Vigia requer atenção. Consulte a página Buriti.\n' + (config.SITE_URL || ''), 'Vigia LAPIG', 4);
      throw new Error(chaveErro(e));
    } finally { lock.releaseLock(); }
  }
  function testarConfiguracao() {
    var resultado = conferir(configuracao());
    resultado.forEach(function (r) { console.log(r.propriedade + ': ' + r.estado); });
    return resultado;
  }
  function instalarGatilhos() {
    validarConfig(configuracao());
    ScriptApp.getProjectTriggers().forEach(function (t) { if (['checar','resumoDiario'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
    ScriptApp.newTrigger('checar').timeBased().everyMinutes(30).create();
    ScriptApp.newTrigger('resumoDiario').timeBased().atHour(8).everyDays(1).inTimezone('America/Sao_Paulo').create();
    return 'Gatilhos instalados';
  }
  return { executar: executar, testarConfiguracao: testarConfiguracao, instalarGatilhos: instalarGatilhos };
})();
function checar() { return VigiaMain.executar('checagem'); }
function resumoDiario() { return VigiaMain.executar('resumo_diario'); }
function testarConfiguracao() { return VigiaMain.testarConfiguracao(); }
function instalarGatilhos() { return VigiaMain.instalarGatilhos(); }

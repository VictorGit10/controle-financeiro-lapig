var VigiaResumo = (function () {
  var M = typeof module !== 'undefined' ? require('./mascara.js') : VigiaMascara;
  function mapaDasTarefas(mapa, tarefas) {
    mapa = mapa || {};
    mapa.pessoas = (mapa.pessoas || []).concat(tarefas.reduce(function (a, t) {
      return a.concat((t.chaves || []).filter(function (c) { return c.tipo === 'pessoa'; }).map(function (c) { return c.valor; }), t.responsavel ? [t.responsavel] : []);
    }, []));
    return mapa;
  }
  function titulo(tarefa, mapa) {
    var texto = M.mascarar(tarefa.titulo || 'Tarefa', mapa).replace(/[\r\n]/g, ' ');
    return M.aindaTemCpf(texto) ? 'Tarefa (título retido)' : texto;
  }
  function site(url) { return /^https:\/\/[^\s]+$/i.test(url || '') ? url : ''; }
  // Aviso avulso pode ir ao ntfy (serviço de fora): só título mascarado e o tipo, nunca conteúdo.
  function textoAviso(evento) {
    var mapa = mapaDasTarefas(evento.mapa || { pessoas: evento.pessoas || [] }, [evento]);
    var tipos = { alerta_prazo: 'Prazo requer atenção', sugestao: 'Passo aguarda confirmação', mensagem: 'Mensagem requer atenção', esclarecer: 'Mensagem aguarda revisão', saude: 'Vigia requer atenção' };
    var centro = /^\d{2}\.\d{3}$/.test(evento.centro_custo || '') ? ' · ' + evento.centro_custo : '';
    return titulo(evento, mapa) + centro + '\n' + (tipos[evento.tipo] || 'Revisão pendente') + '\n' + site(evento.site_url);
  }

  // ---- Resumo diário (057): sai só por e-mail, da conta do Victor para ela mesma, e diz o conteúdo. ----
  // Nome de pessoa fica (é o e-mail do próprio Victor); CPF nunca: trecho com padrão de CPF é retido.
  var SITUACOES = { em_andamento: 'Em andamento', esperando: 'Esperando alguém', travado: 'Travado', feito: 'Feito' };
  function limpo(texto, max) {
    var s = String(texto == null ? '' : texto).replace(/\s+/g, ' ').trim();
    if (M.aindaTemCpf(s)) return '[retido: parece ter CPF]';
    return max && s.length > max ? s.slice(0, max - 1) + '…' : s;
  }
  function quando(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return '';
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
  }
  function prazo(dia, hoje) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia || '')) return '';
    var dias = Math.round((Date.parse(dia + 'T12:00:00Z') - Date.parse(hoje + 'T12:00:00Z')) / 86400000);
    var data = dia.slice(8, 10) + '/' + dia.slice(5, 7);
    if (dias < 0) return 'prazo ' + data + ' (vencido há ' + -dias + (dias === -1 ? ' dia)' : ' dias)');
    if (dias === 0) return 'prazo ' + data + ' (hoje)';
    return 'prazo ' + data + ' (faltam ' + dias + (dias === 1 ? ' dia)' : ' dias)');
  }
  function gmail(thread, conta) {
    if (!thread) return '';
    return 'https://mail.google.com/mail/' + (conta ? '?authuser=' + encodeURIComponent(conta) : 'u/0/') + '#all/' + encodeURIComponent(thread);
  }
  function linhaTarefa(t, hoje) {
    var cabeca = (/^\d{2}\.\d{3}$/.test(t.centro_custo || '') ? t.centro_custo + ' · ' : '') + limpo(t.titulo, 200);
    var detalhe = [t.responsavel ? limpo(t.responsavel, 80) : '', SITUACOES[t.situacao] || '', prazo(t.prazo, hoje)].filter(Boolean).join(' · ');
    var linhas = ['• ' + cabeca + (detalhe ? ' — ' + detalhe : '')];
    if (t.precisa_atencao && t.motivo_atencao) linhas.push('  Precisa de você: ' + limpo(t.motivo_atencao, 300));
    if (t.aviso_responsavel) linhas.push('  Precisa de você: ' + limpo(t.aviso_responsavel, 300));
    if (t.ultima_atualizacao && t.ultima_atualizacao.resumo) {
      linhas.push('  Última atualização (' + quando(t.ultima_atualizacao.ocorrido_em) + '): ' + limpo(t.ultima_atualizacao.resumo, 400));
    }
    return linhas;
  }
  var ORIGENS = { humano: 'Pessoa', buriti: 'Buriti', vigia: 'Buriti (e-mail)', sistema: 'Sistema' };
  var MOTIVOS = { demanda_nova: 'assunto novo, sem tarefa', mascara_falhou: 'conteúdo retido', alegacao_sem_evidencia: 'diz que fez, sem prova',
    spam_com_vinculo: 'veio do spam, mas parece de uma tarefa', sem_tarefa_relacionada: 'sem tarefa aberta ligada',
    json_invalido: 'o modelo não soube classificar', confianca_baixa: 'o modelo não teve certeza' };

  function textoResumoDiario(estado, hoje) {
    var tarefas = (estado.tarefas || []).filter(function (t) { return ['concluida','cancelada'].indexOf(t.status) < 0; });
    var detalhadas = estado.resumo_tarefas || null;
    var precisam = (detalhadas || tarefas).filter(function (t) { return t.precisa_atencao || t.aviso_responsavel; });
    var linhas = ['Vigia · ' + hoje, 'Tarefas abertas: ' + tarefas.length, 'Precisam de você: ' + precisam.length,
      'Mensagens para esclarecer: ' + (estado.esclarecer == null ? 'indisponível' : estado.esclarecer), 'Rotina: ' + (estado.rotina == null ? 'indisponível' : estado.rotina),
      'Saúde: ' + (estado.saude === 'ok' ? 'checagem em dia' : 'checagem requer atenção')];
    if (detalhadas) {
      var outras = detalhadas.filter(function (t) { return !t.precisa_atencao && !t.aviso_responsavel; });
      if (precisam.length) {
        linhas.push('', 'PRECISA DE VOCÊ');
        precisam.forEach(function (t) { linhas = linhas.concat(linhaTarefa(t, hoje)); });
      }
      if (outras.length) {
        linhas.push('', 'TAREFAS EM ANDAMENTO');
        outras.forEach(function (t) { linhas = linhas.concat(linhaTarefa(t, hoje)); });
      }
      var novidades = estado.novidades || [];
      if (novidades.length) {
        linhas.push('', 'O QUE MUDOU NAS ÚLTIMAS 24 H');
        novidades.slice(0, 30).forEach(function (n) {
          linhas.push('• ' + quando(n.ocorrido_em) + ' · ' + limpo(n.titulo, 120) + ' — ' + (ORIGENS[n.origem] || 'Sistema') + ': ' + limpo(n.resumo, 300));
        });
      }
      var msgs = estado.esclarecer_lista || [];
      if (msgs.length) {
        linhas.push('', 'E-MAILS PARA VOCÊ OLHAR');
        msgs.slice(0, 30).forEach(function (m) {
          var motivo = MOTIVOS[m.motivo] ? ' (' + MOTIVOS[m.motivo] + ')' : '';
          linhas.push('• ' + quando(m.recebida_em) + ' · ' + limpo(m.remetente, 120) + ' — "' + limpo(m.assunto, 160) + '"' + motivo);
          var url = gmail(m.gmail_thread_id, estado.conta_gmail);
          if (url) linhas.push('  ' + url);
        });
        if (msgs.length > 30) linhas.push('  … e mais ' + (msgs.length - 30) + ' na Triagem.');
      }
    } else {
      var mapa = mapaDasTarefas(estado.mapa, tarefas);
      tarefas.forEach(function (t) { linhas.push(titulo(t, mapa) + (/^\d{2}\.\d{3}$/.test(t.centro_custo || '') ? ' · ' + t.centro_custo : '')); });
    }
    // Auditoria semanal usa contagens, sem reproduzir assuntos pessoais em avisos.
    if (new Date(hoje + 'T12:00:00Z').getUTCDay() === 1) linhas.push('', 'Auditoria semanal: revise a fila Rotina no site.');
    linhas.push('', site(estado.site_url));
    return linhas.join('\n');
  }
  return { textoResumoDiario: textoResumoDiario, textoAviso: textoAviso };
})();
if (typeof module !== 'undefined') module.exports = VigiaResumo;

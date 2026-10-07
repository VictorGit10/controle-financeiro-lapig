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
  function textoAviso(evento) {
    var mapa = mapaDasTarefas(evento.mapa || { pessoas: evento.pessoas || [] }, [evento]);
    var tipos = { alerta_prazo: 'Prazo requer atenção', sugestao: 'Passo aguarda confirmação', mensagem: 'Mensagem requer atenção', esclarecer: 'Mensagem aguarda revisão', saude: 'Vigia requer atenção' };
    var centro = /^\d{2}\.\d{3}$/.test(evento.centro_custo || '') ? ' · ' + evento.centro_custo : '';
    return titulo(evento, mapa) + centro + '\n' + (tipos[evento.tipo] || 'Revisão pendente') + '\n' + site(evento.site_url);
  }
  function textoResumoDiario(estado, hoje) {
    var tarefas = (estado.tarefas || []).filter(function (t) { return ['concluida','cancelada'].indexOf(t.status) < 0; });
    var linhas = ['Vigia · ' + hoje, 'Tarefas abertas: ' + tarefas.length, 'Precisam de você: ' + tarefas.filter(function (t) { return t.precisa_atencao; }).length,
      'Mensagens para esclarecer: ' + (estado.esclarecer == null ? 'indisponível' : estado.esclarecer), 'Rotina: ' + (estado.rotina == null ? 'indisponível' : estado.rotina),
      'Saúde: ' + (estado.saude === 'ok' ? 'checagem em dia' : 'checagem requer atenção')];
    var mapa = mapaDasTarefas(estado.mapa, tarefas);
    tarefas.forEach(function (t) { linhas.push(titulo(t, mapa) + (/^\d{2}\.\d{3}$/.test(t.centro_custo || '') ? ' · ' + t.centro_custo : '')); });
    // Auditoria semanal usa contagens, sem reproduzir assuntos pessoais em avisos.
    if (new Date(hoje + 'T12:00:00Z').getUTCDay() === 1) linhas.push('Auditoria semanal: revise a fila Rotina no site.');
    linhas.push(site(estado.site_url));
    return linhas.join('\n');
  }
  return { textoResumoDiario: textoResumoDiario, textoAviso: textoAviso };
})();
if (typeof module !== 'undefined') module.exports = VigiaResumo;

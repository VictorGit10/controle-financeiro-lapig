var VigiaTriagem = (function () {
  var U = typeof module !== 'undefined' ? require('./00-util.js') : VigiaUtil;
  function sinaisTecnicos(msg, config) {
    config = config || {};
    var s = [], assunto = U.normalizar(msg.assunto);
    if (/ausencia|resposta automatica|out of office|automatic reply|ferias|vacation/.test(assunto)) s.push('ausencia');
    var auto = U.cabecalho(msg, 'Auto-Submitted');
    if (auto && U.normalizar(auto) !== 'no') s.push('auto_submitted');
    if (U.cabecalho(msg, 'List-Id')) s.push('lista');
    if (U.cabecalho(msg, 'List-Unsubscribe')) s.push('lista');
    if (/bulk|list|junk/i.test(U.cabecalho(msg, 'Precedence'))) s.push('bulk');
    if (/text\/calendar/i.test(msg.content_type || U.cabecalho(msg, 'Content-Type')) || /^(aceito|aceite|accepted|recusado|declined|convite|invitation)\s*:/.test(assunto)) s.push('agenda');
    var automaticos = config.remetentesAutomaticos || ['notifications@github.com', 'noreply@github.com'];
    if (U.emails(msg.de).some(function (e) { return automaticos.some(function (a) { return e === a.toLowerCase(); }); })) s.push('remetente_automatico');
    return s.filter(function (v, i, todos) { return todos.indexOf(v) === i; });
  }
  function filaInicial(msg, config, candidatos) {
    var spamComVinculo = msg.spam === true && (candidatos || []).some(function (c) { return c.forca === 'forte' || c.forca === 'media'; });
    if (msg.spam === true && !spamComVinculo) return { fila: 'rotina', motivo: 'spam' };
    var sinais = sinaisTecnicos(msg, config);
    if (spamComVinculo) return { fila: sinais.length && sinais.indexOf('ausencia') < 0 ? 'rotina' : 'avaliar', motivo: 'spam_com_vinculo' };
    if (sinais.indexOf('ausencia') >= 0) return { fila: 'avaliar', motivo: 'ausencia' };
    return sinais.length ? { fila: 'rotina', motivo: sinais[0] } : { fila: 'avaliar', motivo: 'sem_sinal_tecnico' };
  }
  return { sinaisTecnicos: sinaisTecnicos, filaInicial: filaInicial };
})();
if (typeof module !== 'undefined') module.exports = VigiaTriagem;

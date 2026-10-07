var VigiaPrazos = (function () {
  var U = typeof module !== 'undefined' ? require('./00-util.js') : VigiaUtil;
  function alertasDevidos(tarefa, hoje, jaEmitidos) {
    if (!tarefa.prazo || ['concluida', 'cancelada'].indexOf(tarefa.status) >= 0) return [];
    var prazo = U.diaSP(tarefa.prazo), dia = U.diaSP(hoje);
    var dias = Math.round((Date.parse(prazo + 'T00:00:00Z') - Date.parse(dia + 'T00:00:00Z')) / 86400000);
    var nivel = dias < 0 ? 'vencido' : dias === 0 ? 'D-0' : dias <= 2 ? 'D-2' : dias <= 5 ? 'D-5' : null;
    if (!nivel) return [];
    var chave = 'prazo:' + tarefa.id + ':' + prazo + ':' + nivel;
    if ((jaEmitidos || []).some(function (e) { return (typeof e === 'string' ? e : e.chave) === chave; })) return [];
    return [{ chave: chave, tarefa_id: tarefa.id, tipo: 'alerta_prazo', origem: 'vigia', resumo: 'Prazo ' + nivel, ocorrido_em: dia + 'T08:00:00-03:00', detalhe: { prazo: prazo, nivel: nivel }, precisa_victor: true }];
  }
  return { alertasDevidos: alertasDevidos };
})();
if (typeof module !== 'undefined') module.exports = VigiaPrazos;

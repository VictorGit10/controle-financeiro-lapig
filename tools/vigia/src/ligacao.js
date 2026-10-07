var VigiaLigacao = (function () {
  var U = typeof module !== 'undefined' ? require('./00-util.js') : VigiaUtil;
  function candidatos(msg, tarefasAbertas) {
    var texto = U.normalizar(U.texto(msg) + '\n' + (msg.de || '') + '\n' + (msg.para || '') + '\n' + (msg.cc || ''));
    return (tarefasAbertas || []).map(function (t) {
      var razoes = [];
      (t.chaves || []).forEach(function (ch) {
        var valor = U.normalizar(ch.valor), bate = false;
        if (!valor) return;
        if (ch.tipo === 'thread') bate = String(ch.valor) === String(msg.gmail_thread_id);
        else if (ch.tipo === 'centro_custo') bate = (texto.match(/\b\d{2}\.\d{3}\b/g) || []).indexOf(valor) >= 0;
        else {
          var inicio = texto.indexOf(valor);
          while (inicio >= 0) {
            var antes = texto[inicio - 1] || '', depois = texto[inicio + valor.length] || '';
            if (!/[a-z0-9]/.test(antes) && !/[a-z0-9]/.test(depois)) { bate = true; break; }
            inicio = texto.indexOf(valor, inicio + 1);
          }
        }
        if (bate && razoes.indexOf(ch.tipo) < 0) razoes.push(ch.tipo);
      });
      var forca = razoes.indexOf('thread') >= 0 || razoes.indexOf('numero') >= 0 ? 'forte' : razoes.indexOf('centro_custo') >= 0 && razoes.indexOf('pessoa') >= 0 ? 'media' : 'fraca';
      return { tarefa_id: t.id, forca: forca, razoes: razoes };
    }).filter(function (c) { return c.razoes.length; }).sort(function (a, b) {
      var ordem = { forte: 0, media: 1, fraca: 2 };
      return ordem[a.forca] - ordem[b.forca] || String(a.tarefa_id).localeCompare(String(b.tarefa_id));
    });
  }
  function decidirPorRegra(cands) {
    var fortes = cands.filter(function (c) { return c.forca === 'forte'; });
    return fortes.length === 1 ? { vinculos: [{ tarefa_id: fortes[0].tarefa_id, origem: 'regra', estado: 'sugerido' }], candidatos: cands, decidiu: true } : { vinculos: [], candidatos: cands, decidiu: false };
  }
  return { candidatos: candidatos, decidirPorRegra: decidirPorRegra };
})();
if (typeof module !== 'undefined') module.exports = VigiaLigacao;

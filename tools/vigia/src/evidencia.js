var VigiaEvidencia = (function () {
  var U = typeof module !== 'undefined' ? require('./00-util.js') : VigiaUtil;
  var T = typeof module !== 'undefined' ? require('./triagem.js') : VigiaTriagem;
  function avaliarPasso(regra, msg, tarefa, config) {
    var nao = { cumpre: false, trecho: '' };
    var restricoes = U.restricoesTexto(msg);
    if (!regra || regra.tipo === 'manual' || T.sinaisTecnicos(msg, config).length || U.mensagemPropria(msg, config) || restricoes.injecao || restricoes.negacao) return nao;
    var criada = (tarefa || {}).criada_em || msg.tarefa_criada_em;
    if (!criada || !(U.instante(msg.ocorrido_em || msg.recebida_em) > U.instante(criada))) return nao;
    if (regra.tipo === 'mensagem_na_thread') return String(regra.thread) === String(msg.gmail_thread_id) ? { cumpre: true, trecho: String(msg.corpo || msg.assunto || '') } : nao;
    if (regra.tipo !== 'email') return nao;
    var de = U.emails(msg.de), para = U.emails(msg.para), cc = U.emails(msg.cc);
    if (regra.de && de.indexOf(U.normalizar(regra.de)) < 0) return nao;
    if (regra.para_dominio && !para.some(function (e) { return e.split('@')[1] === U.normalizar(regra.para_dominio); })) return nao;
    var copias = Array.isArray(regra.cc_inclui) ? regra.cc_inclui : regra.cc_inclui ? [regra.cc_inclui] : [];
    if (!copias.every(function (e) { return cc.indexOf(U.normalizar(e)) >= 0; })) return nao;
    var texto = U.normalizar(U.texto(msg));
    if (!(regra.contem_todos || []).every(function (v) { return texto.indexOf(U.normalizar(v)) >= 0; })) return nao;
    if ((regra.contem_algum || []).length && !regra.contem_algum.some(function (v) { return texto.indexOf(U.normalizar(v)) >= 0; })) return nao;
    // O consumidor mascara antes de cortar: truncar primeiro quebra padrões de CPF/e-mail.
    return { cumpre: true, trecho: U.texto(msg) };
  }
  return { avaliarPasso: avaliarPasso };
})();
if (typeof module !== 'undefined') module.exports = VigiaEvidencia;

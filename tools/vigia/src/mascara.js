var VigiaMascara = (function () {
  function mascarar(texto, mapa) {
    mapa = mapa || {};
    if (!mapa.codigos) mapa.codigos = Object.create(null);
    var dominios = mapa.dominiosInstitucionais || ['funape.org.br', 'ufg.br', 'tjgo.jus.br'];
    function codigo(valor, tipo) {
      var chave = tipo + ':' + valor.toLowerCase();
      if (tipo === 'numero') chave = tipo + ':' + valor.replace(/\D/g, '');
      if (!Object.prototype.hasOwnProperty.call(mapa.codigos, chave)) mapa.codigos[chave] = Object.keys(mapa.codigos).length + 1;
      var dominio = tipo === 'email' ? valor.split('@')[1].toLowerCase() : '';
      return '[P' + mapa.codigos[chave] + (dominios.some(function (d) { return d.toLowerCase() === dominio || dominio.endsWith('.' + d.toLowerCase()); }) ? '@' + dominio : '') + ']';
    }
    var s = String(texto == null ? '' : texto);
    s = s.replace(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, function (v) { return codigo(v, 'email'); });
    s = s.replace(/\b\d{3}\.?\d{3}\.?\d{3}[- ]?\d{2}\b/g, function (v) { return codigo(v, 'numero'); });
    s = s.replace(/\b(RG|registro geral)\s*[: nº.°-]*\s*([\d. -]{5,}[\dXx])/gi, function (_, rotulo, v) { return rotulo + ': ' + codigo(v, 'rg'); });
    s = s.replace(/\b\d{1,2}\.\d{3}\.\d{3}-[\dXx]\b/g, function (v) { return codigo(v, 'rg'); });
    s = s.replace(/\b(ag[eê]ncia|ag\.|conta(?: corrente| poupança)?|c\/c|PIX(?:\s+chave)?|chave\s+PIX)\s*(?:n[ºo°.]\s*)?[:=-]?\s*([a-z0-9][a-z0-9.-]*(?:[ .-]\d+)*)/gi, function (_, rotulo, v) { return rotulo + ': ' + codigo(v, 'banco'); });
    s = s.replace(/(?:\+?55[ .-]?)?\(?\b[1-9]\d\)?[ .-]?(?:9[ .-]?)?\d{4}[ .-]?\d{4}\b/g, function (v) { return codigo(v, 'numero'); });
    s = s.replace(/\b(telefone|fone|celular|tel\.)\s*[:=-]?\s*(\d{4,5}[ .-]?\d{4})\b/gi, function (_, rotulo, v) { return rotulo + ': ' + codigo(v, 'numero'); });
    (mapa.pessoas || []).slice().sort(function (a, b) { return b.length - a.length; }).forEach(function (p) {
      if (p.length < 3) return;
      var escape = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      s = s.replace(new RegExp('(^|[^\\p{L}\\p{N}])(' + escape + ')(?=$|[^\\p{L}\\p{N}])', 'giu'), function (_, antes, nome) { return antes + codigo(nome, 'pessoa'); });
    });
    return s;
  }
  function aindaTemCpf(texto) { return /(?:^|\D)\d{3}[.\s\u200b-]*\d{3}[.\s\u200b-]*\d{3}[-.\s\u200b]*\d{2}(?!\d)/.test(String(texto)); }
  function tirarCitacoes(texto) {
    var novo = [], encaminhado = [], destino = novo, cortado = false;
    String(texto || '').split(/\r?\n/).forEach(function (linha) {
      if (/^-{2,}\s*(?:Forwarded message|Mensagem encaminhada)/i.test(linha) || /^In[ií]cio da mensagem encaminhada:/i.test(linha)) { destino = encaminhado; cortado = false; return; }
      if (/^\s*(?:Em\s.+escreveu:|On\s.+wrote:|-{2,}\s*(?:Original Message|Mensagem original)\s*-*)\s*$/i.test(linha)) { cortado = true; return; }
      if (!cortado && !/^\s*>/.test(linha)) destino.push(linha);
    });
    return { novo: novo.join('\n').trim(), encaminhado: encaminhado.join('\n').trim() };
  }
  return { mascarar: mascarar, aindaTemCpf: aindaTemCpf, tirarCitacoes: tirarCitacoes };
})();
if (typeof module !== 'undefined') module.exports = VigiaMascara;

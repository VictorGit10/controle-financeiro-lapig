var VigiaUtil = (function () {
  function normalizar(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function texto(msg) { return [msg.assunto || '', msg.corpo || ''].join('\n'); }
  function emails(s) { return String(s || '').toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []; }
  function restricoesTexto(msg) {
    var s = normalizar(texto(msg));
    var injecao = /\b(?:ignore|ignorar|desconsidere)\b.{0,40}\b(?:instrucoes|instructions|prompt)\b|\bignore\b.{0,30}\bprevious instructions\b/.test(s);
    var negacao = /\b(?:ainda )?nao\b.{0,35}\b(?:consegui|conseguimos|enviei|enviamos|enviar|enviado|encaminhei|encaminhar|conclui|concluido)\b|\b(?:faco|farei|enviarei|vou enviar|vou encaminhar)\b.{0,25}\bamanha\b/.test(s);
    // Defesa conservadora para comandos dirigidos ao classificador e negação de cumprimento.
    return {
      injecao: injecao, negacao: negacao,
      alegacao: !injecao && !negacao && /\bja (?:enviei|enviamos|encaminhei|encaminhamos|conclui|concluimos)\b/.test(s)
    };
  }
  function mensagemPropria(msg, config) {
    config = config || {};
    var enderecos = emails(config.emailVictor).concat(config.emailsVictor || []);
    return emails(msg.de).some(function (e) { return enderecos.some(function (v) { return e === String(v).toLowerCase().trim(); }); });
  }
  function cabecalho(msg, nome) {
    var h = msg.headers || {};
    var k = Object.keys(h).find(function (key) { return key.toLowerCase() === nome.toLowerCase(); });
    return k ? String(h[k]) : '';
  }
  function diaSP(valor) {
    if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
      var d = new Date(valor + 'T00:00:00Z');
      if (!isNaN(d) && d.toISOString().slice(0, 10) === valor) return valor;
      throw new Error('data_invalida');
    }
    var data = new Date(valor);
    if (isNaN(data)) throw new Error('data_invalida');
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(data);
  }
  function instante(valor) {
    if (!valor) return NaN;
    var s = String(valor);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00-03:00';
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) s += '-03:00';
    return new Date(s).getTime();
  }
  function dataEncaminhada(s) {
    var m = String(s).match(/^(?:Date|Data|Enviado(?: em)?):\s*(.+)$/im);
    if (!m) return null;
    var v = m[1].trim(), br = v.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[^\d]+(\d{1,2}):(\d{2}))?/);
    if (br) v = br[3] + '-' + br[2].padStart(2, '0') + '-' + br[1].padStart(2, '0') + 'T' + (br[4] || '00').padStart(2, '0') + ':' + (br[5] || '00') + ':00-03:00';
    // Gmail em português: "ter., 6 de out. de 2026 às 10:30".
    var pt = normalizar(v).match(/(\d{1,2}) de (jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z.]* de (\d{4})(?:.*?(\d{1,2}):(\d{2}))?/);
    if (pt) v = pt[3] + '-' + String(['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'].indexOf(pt[2]) + 1).padStart(2, '0') + '-' + pt[1].padStart(2, '0') + 'T' + (pt[4] || '00').padStart(2, '0') + ':' + (pt[5] || '00') + ':00-03:00';
    var n = instante(v);
    return isNaN(n) ? null : new Date(n).toISOString();
  }
  return { normalizar: normalizar, texto: texto, emails: emails, restricoesTexto: restricoesTexto, mensagemPropria: mensagemPropria, cabecalho: cabecalho, diaSP: diaSP, instante: instante, dataEncaminhada: dataEncaminhada };
})();
if (typeof module !== 'undefined') module.exports = VigiaUtil;

var VigiaGmail = (function () {
  function extrair(mensagem, passadaSpam) {
    var headers = {};
    ['Auto-Submitted','List-Id','List-Unsubscribe','Precedence','Content-Type'].forEach(function (nome) { headers[nome] = mensagem.getHeader(nome) || ''; });
    return { gmail_message_id: mensagem.getId(), gmail_thread_id: mensagem.getThread().getId(), recebida_em: mensagem.getDate().toISOString(),
      de: mensagem.getFrom(), para: mensagem.getTo(), cc: mensagem.getCc(), assunto: mensagem.getSubject(), corpo: mensagem.getPlainBody(),
      headers: headers, content_type: headers['Content-Type'], spam: passadaSpam === true || mensagem.getThread().isInSpam(), anexos: mensagem.getAttachments({ includeInlineImages: false, includeAttachments: true }).length };
  }
  function buscar(cursor, fim) {
    var limite = new Date(fim).getTime();
    // Bootstrap conservador: um dia; o histórico mais antigo continua no Gmail.
    var inicio = cursor ? new Date(cursor).getTime() - 86400000 : limite - 86400000;
    if (!isFinite(inicio) || !isFinite(limite) || inicio > limite) throw new Error('janela_invalida');
    var base = ' after:' + (Math.floor(inicio / 1000) - 1) + ' before:' + (Math.ceil(limite / 1000) + 1);
    var consultas = ['in:anywhere -in:trash -in:spam' + base, 'in:spam -in:trash' + base];
    var vistos = Object.create(null), mensagens = [];
    consultas.forEach(function (query) {
      var inicioPagina = 0, pagina;
      do {
        pagina = GmailApp.search(query, inicioPagina, 100);
        pagina.forEach(function (thread) {
          thread.getMessages().forEach(function (m) {
            var data = m.getDate().getTime();
            if (data >= inicio && data <= limite && !m.isInTrash()) {
              if (vistos[m.getId()]) { if (query.indexOf('in:spam') === 0) mensagens[vistos[m.getId()] - 1].spam = true; }
              else { mensagens.push(extrair(m, query.indexOf('in:spam') === 0)); vistos[m.getId()] = mensagens.length; }
            }
          });
        });
        inicioPagina += pagina.length;
        // Não anuncia janela completa se atingir o teto operacional.
        if (inicioPagina >= 1000 && pagina.length === 100) throw new Error('janela_incompleta');
      } while (pagina.length === 100);
    });
    mensagens.sort(function (a, b) { return Date.parse(a.recebida_em) - Date.parse(b.recebida_em) || a.gmail_message_id.localeCompare(b.gmail_message_id); });
    return { mensagens: mensagens, janela: { inicio: new Date(inicio).toISOString(), fim: new Date(limite).toISOString(), completa: true } };
  }
  function porId(id) {
    var msg = GmailApp.getMessageById(id);
    if (!msg || msg.isInTrash()) throw new Error('mensagem_indisponivel');
    return extrair(msg);
  }
  return { extrair: extrair, buscar: buscar, porId: porId };
})();

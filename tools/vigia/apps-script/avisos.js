var VigiaAvisos = (function () {
  function enviar(config, texto, titulo, prioridade) {
    if (config.NTFY_TOPICO) {
      try {
        var response = UrlFetchApp.fetch('https://ntfy.sh/' + encodeURIComponent(config.NTFY_TOPICO), { method: 'post', payload: texto,
          headers: { Title: titulo || 'Vigia LAPIG', Priority: String(prioridade || 3) }, muteHttpExceptions: true });
        if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) return { estado: 'enviado', canal: 'ntfy' };
      } catch (_) { /* Reserva pelo e-mail, sem registrar erro com segredo. */ }
    }
    try {
      if (!config.EMAIL_AVISO) return { estado: 'falhou', motivo: 'sem_canal' };
      MailApp.sendEmail({ to: config.EMAIL_AVISO, subject: titulo || 'Vigia LAPIG', body: texto });
      return { estado: 'enviado', canal: 'email' };
    } catch (_) { return { estado: 'falhou', motivo: 'envio_falhou' }; }
  }
  // Resumo diário (057): só por e-mail, da conta do Victor para ela mesma. Nunca pelo ntfy, porque leva
  // o conteúdo (assuntos, o que a equipe escreveu) e o ntfy é um serviço de fora.
  function enviarEmail(config, texto, titulo) {
    try {
      if (!config.EMAIL_AVISO) return { estado: 'falhou', motivo: 'sem_canal' };
      MailApp.sendEmail({ to: config.EMAIL_AVISO, subject: titulo || 'Vigia LAPIG', body: texto });
      return { estado: 'enviado', canal: 'email' };
    } catch (_) { return { estado: 'falhou', motivo: 'envio_falhou' }; }
  }
  return { enviar: enviar, enviarEmail: enviarEmail };
})();

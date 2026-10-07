var VigiaOllama = (function () {
  function criar(config) {
    if (!config.OLLAMA_API_KEY) return null;
    return function (prompt) {
      var inicio = Date.now(), limite = Number(config.OLLAMA_TIMEOUT_MS || 45000);
      var response = UrlFetchApp.fetch('https://ollama.com/api/chat', { method: 'post', contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + config.OLLAMA_API_KEY }, muteHttpExceptions: true,
        payload: JSON.stringify({ model: config.OLLAMA_MODEL || 'glm-5.3-flash', messages: [{ role: 'user', content: prompt }], format: 'json', stream: false, options: { temperature: 0, num_predict: 4096 } }) });
      // UrlFetchApp não oferece timeout cancelável. Rejeita a resposta tardia;
      // falhas/timeout da plataforma também retornam à captura via processar.
      if (Date.now() - inicio > limite) throw new Error('modelo_timeout');
      if (response.getResponseCode() !== 200) throw new Error('modelo_http_' + response.getResponseCode());
      var data;
      try { data = JSON.parse(response.getContentText()); } catch (_) { throw new Error('modelo_envelope_invalido'); }
      if (!data.message || typeof data.message.content !== 'string') throw new Error('modelo_sem_conteudo');
      return data.message.content;
    };
  }
  return { criar: criar };
})();

var VigiaSupabase = (function () {
  function criar(config) {
    var token = null, expira = 0;
    function requisicao(caminho, payload, bearer) {
      var response = UrlFetchApp.fetch(config.SUPABASE_URL.replace(/\/$/, '') + caminho, { method: 'post', contentType: 'application/json',
        headers: { apikey: config.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + (bearer || config.SUPABASE_ANON_KEY) }, payload: JSON.stringify(payload), muteHttpExceptions: true });
      return { status: response.getResponseCode(), body: response.getContentText() };
    }
    function entrar() {
      var res = requisicao('/auth/v1/token?grant_type=password', { email: config.VIGIA_EMAIL, password: config.VIGIA_SENHA });
      if (res.status !== 200) throw new Error('login_http_' + res.status);
      var auth;
      try { auth = JSON.parse(res.body); } catch (_) { throw new Error('login_resposta_invalida'); }
      if (!auth.access_token) throw new Error('login_sem_token');
      token = auth.access_token; expira = Date.now() + (Number(auth.expires_in || 3600) - 60) * 1000;
    }
    function rpc(nome, args) {
      if (['vigia_contexto','vigia_capturar','vigia_registrar','vigia_expurgar'].indexOf(nome) < 0) throw new Error('rpc_nao_permitida');
      if (!token || Date.now() >= expira) entrar();
      var res = requisicao('/rest/v1/rpc/' + nome, args || {}, token);
      if (res.status === 401) { entrar(); res = requisicao('/rest/v1/rpc/' + nome, args || {}, token); }
      if (res.status < 200 || res.status >= 300) throw new Error('rpc_' + nome + '_http_' + res.status);
      try { return res.body ? JSON.parse(res.body) : null; } catch (_) { throw new Error('rpc_resposta_invalida'); }
    }
    return { rpc: rpc };
  }
  return { criar: criar };
})();

// Regressão: duas tools em paralelo não podem abrir dois logins.
//
// O cliente MCP chama tools concorrentemente. `entrar()` publicava o cliente em
// `cliente` ANTES de autenticar, então a segunda chamada pegava esse cliente
// ainda anônimo e seguia com ele. O efeito não era erro: policy `to
// authenticated` devolve ZERO LINHA para anon, então `listar_centros_de_custo`
// respondia `total: 0` — indistinguível de "esse login não enxerga nada".
// Observado em 2026-08-31 com um admin que enxerga 17 centros.
//
// Aqui não há mock: sobe-se um GoTrue/PostgREST dublê que atrasa o login e
// devolve `[]` a quem chega com a anon key, que é o que o banco real faz. É a
// única forma de a corrida acontecer de verdade.
//
//   node scripts/login-concorrente.js

import { createServer } from 'node:http';
import { consultar } from '../src/client.js';

const ANON = 'anon-key-dublê';
const TOKEN = 'access-token-do-usuario';
const ATRASO_LOGIN = 150;

let loginsRecebidos = 0;

const servidor = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const responder = (corpo) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(corpo));
  };

  if (url.pathname.startsWith('/auth/v1/token')) {
    loginsRecebidos += 1;
    // O atraso é o teste: é durante ele que a segunda chamada decide o que fazer.
    setTimeout(() => {
      responder({
        access_token: TOKEN,
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'refresh-dublê',
        user: {
          id: '00000000-0000-4000-8000-000000000001',
          aud: 'authenticated',
          role: 'authenticated',
          email: 'dublê@local.test',
        },
      });
    }, ATRASO_LOGIN);
    return;
  }

  if (url.pathname === '/rest/v1/projects') {
    const auth = String(req.headers.authorization || '');
    // Espelha o RLS: sem JWT de usuário não é erro, é lista vazia.
    if (auth === `Bearer ${TOKEN}`) {
      return responder([{ id: 'p1', name: 'CEMPA FAPEG', code: '30.068' }]);
    }
    return responder([]);
  }

  responder({});
});

await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const { port } = servidor.address();

process.env.CF_SUPABASE_URL = `http://127.0.0.1:${port}`;
process.env.CF_SUPABASE_ANON_KEY = ANON;
process.env.CF_EMAIL = 'dublê@local.test';
process.env.CF_PASSWORD = 'senha-dublê';

const buscar = () =>
  consultar('projetos', (sb) => sb.from('projects').select('id,name,code').order('name'));

// O ponto: as duas partem juntas, com o cache de sessão vazio.
const [a, b] = await Promise.all([buscar(), buscar()]);

const falhas = [];
const conferir = (nome, ok, detalhe) => {
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas.push(nome);
};

conferir(
  'chamada 1 enxerga os centros',
  a.length === 1,
  `recebeu ${a.length} linha(s)`
);
conferir(
  'chamada 2 concorrente enxerga os mesmos centros',
  b.length === 1,
  `recebeu ${b.length} linha(s)${b.length === 0 ? ' — leu com a anon key (a corrida voltou)' : ''}`
);
conferir(
  'um único login para as duas chamadas',
  loginsRecebidos === 1,
  `${loginsRecebidos} login(s) no GoTrue`
);

// `closeAllConnections` antes do close: o supabase-js deixa socket keep-alive
// aberto, e sair com ele vivo derruba o libuv no Windows.
servidor.closeAllConnections();
servidor.close();
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nlogin concorrente: ok');
process.exitCode = falhas.length ? 1 : 0;

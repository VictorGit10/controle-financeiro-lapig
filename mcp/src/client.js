// Cliente Supabase autenticado como um usuário real.
//
// É o login que traz o escopo de graça: o RLS das migrações 033/034 e os guards
// `assert_project_allowed` das RPCs são a barreira, e este servidor não tem uma
// única linha de lógica de permissão própria. Um professor logado aqui enxerga
// exatamente os centros de custo que enxerga no site — nem mais, nem menos.
//
// Nada neste arquivo escreve em stdout: o transporte do MCP é stdio, e qualquer
// print fora do protocolo corrompe a sessão. Log vai para stderr.

import { createClient } from '@supabase/supabase-js';

const OBRIGATORIAS = ['CF_SUPABASE_URL', 'CF_SUPABASE_ANON_KEY', 'CF_EMAIL', 'CF_PASSWORD'];

let cliente = null;
let usuario = null;
let login = null; // login em voo, compartilhado por quem chegar durante ele

function config() {
  const faltando = OBRIGATORIAS.filter((k) => !process.env[k]);
  if (faltando.length) {
    throw new Error(
      `Variáveis de ambiente faltando: ${faltando.join(', ')}. ` +
        'Configure-as no bloco "env" do servidor MCP — ver mcp/README.md.'
    );
  }
  return {
    url: process.env.CF_SUPABASE_URL,
    anonKey: process.env.CF_SUPABASE_ANON_KEY,
    email: process.env.CF_EMAIL,
    senha: process.env.CF_PASSWORD,
  };
}

async function entrar() {
  const { url, anonKey, email, senha } = config();
  // O cliente só é publicado em `cliente` DEPOIS de autenticado. Publicá-lo antes
  // (o que se fazia aqui) deixava uma chamada concorrente ler com a anon key, e
  // policy `to authenticated` devolve zero linha em vez de erro — uma lista vazia
  // com cara de resposta, indistinguível de "esse login não vê nada".
  const sb = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
  });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
  if (error) {
    throw new Error(
      `Não foi possível entrar como ${email}: ${error.message}. ` +
        'Confira CF_EMAIL/CF_PASSWORD e se o usuário existe no Supabase.'
    );
  }
  usuario = data.user;
  cliente = sb;
  console.error(`[cf-mcp] logado como ${email}`);
  return cliente;
}

/**
 * Um login por vez. O cliente MCP chama tools em paralelo, e sem isso duas
 * chamadas simultâneas abriam dois logins — a segunda seguindo com o cliente
 * ainda anônimo da primeira. Quem chega durante um login em voo espera a mesma
 * promessa; se ele falhar, `login` volta a null e a próxima chamada tenta de novo.
 */
async function conectado() {
  if (cliente) return cliente;
  if (!login) {
    login = entrar().finally(() => {
      login = null;
    });
  }
  return login;
}

/** Sessão morta (expirada ou revogada): vale uma única tentativa de relogin. */
function sessaoMorta(error) {
  if (!error) return false;
  const codigo = error.code || '';
  const msg = String(error.message || '');
  return codigo === 'PGRST301' || codigo === '401' || /JWT|token .*expired|not authenticated/i.test(msg);
}

/**
 * Traduz o erro do Postgres para algo que faça sentido a quem lê a resposta.
 * Os dois casos que importam vêm da camada de segurança e são esperados, não
 * defeitos: acesso negado a centro de custo alheio (guard das RPCs) e função
 * fora de alcance (revoke da migração 035).
 */
function traduzir(error, contexto) {
  const msg = String(error.message || error);
  if (error.code === 'P0001' && /acesso negado/i.test(msg)) {
    return new Error(
      `${msg}. Esse centro de custo não está entre os que ${process.env.CF_EMAIL} pode ver. ` +
        'Use listar_centros_de_custo para ver os disponíveis.'
    );
  }
  if (error.code === '42501') {
    return new Error(
      `${msg}. A sessão não tem permissão de executar essa função — confira se o login está ativo.`
    );
  }
  return new Error(`${contexto}: ${msg}${error.hint ? ` (${error.hint})` : ''}`);
}

/** Chama uma RPC, com um relogin de cortesia se a sessão tiver expirado. */
export async function rpc(fn, args) {
  let sb = await conectado();
  let { data, error } = await sb.rpc(fn, args);
  if (sessaoMorta(error)) {
    console.error(`[cf-mcp] sessão expirada em ${fn}, refazendo login`);
    cliente = null;
    sb = await conectado();
    ({ data, error } = await sb.rpc(fn, args));
  }
  if (error) throw traduzir(error, `RPC ${fn}`);
  return data;
}

/** Leitura direta de tabela (já escopada pelo RLS). */
export async function consultar(contexto, montaQuery) {
  let sb = await conectado();
  let { data, error } = await montaQuery(sb);
  if (sessaoMorta(error)) {
    cliente = null;
    sb = await conectado();
    ({ data, error } = await montaQuery(sb));
  }
  if (error) throw traduzir(error, contexto);
  return data;
}

export async function quemSouEu() {
  await conectado();
  const perfil = await consultar('perfil do usuário', (sb) =>
    sb.from('app_users').select('role').eq('user_id', usuario.id).maybeSingle()
  );
  return { email: usuario.email, papel: perfil?.role ?? 'desconhecido' };
}

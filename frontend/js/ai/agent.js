/* ============================================================
   Agente — laço de tool calling no browser
   ============================================================
   Fase 3 da camada de IA. O laço roda aqui, e não na Edge
   Function, por três razões:

   1. As tools chamam as RPCs pelo `supabaseClient` já logado —
      mesmo JWT, mesmo RLS, mesmo caminho que o resto do site.
      Executá-las no servidor exigiria repassar o JWT e manter
      uma segunda cópia do adaptador em Deno.
   2. A tela mostra AO VIVO qual RPC está sendo consultada. Isso
      não é enfeite: a regra da camada é que todo número sai de
      RPC, e o passo visível é como o usuário confere isso.
   3. Ajustar prompt e descrição não exige deploy.

   A Edge Function `assistente` ficou com o que só ela pode
   fazer: guardar a OLLAMA_API_KEY, que não pode ir num bundle
   público.

   Protocolo: `/api/chat` nativo do Ollama. `tool_calls[].function
   .arguments` chega como OBJETO (não string, como na API da
   OpenAI) e não há `id` — mas modelos treinados no formato da
   OpenAI às vezes emitem os dois, então o laço aceita as duas
   formas. O resultado volta como `{ role: 'tool', tool_name,
   content }`.
   ============================================================ */

import { especificacoes, executarTool } from './tools.js';

// Teto de idas ao modelo por pergunta. Uma pergunta comparativa legítima
// ("onde coloco esta bolsa?") gasta 2 ou 3: listar, simular, responder. Seis é
// folga com fim — sem teto, um modelo em laço queimaria crédito em silêncio.
const MAX_RODADAS = 6;

// Teto do resultado de UMA tool. O que estoura contexto não é a conversa, é um
// panorama de muitos centros de custo repetido a cada rodada. Cortar JSON no
// meio produziria um objeto inválido que o modelo tentaria interpretar mesmo
// assim, então o resultado grande é SUBSTITUÍDO por um aviso acionável.
const MAX_RESULTADO_CHARS = 60_000;

/* ── Enquadramento ────────────────────────────────────────────
   Cópia deliberada do `instructions` do handshake do MCP
   (`mcp/src/index.js`). As quatro regras são idênticas palavra
   por palavra porque os dois consumidores leem as mesmas RPCs:
   se o MCP e a aba divergirem no enquadramento, divergem na
   leitura do mesmo número. `tests/ai-tools.test.js` trava isso.

   O que muda aqui é só o contexto de uso: no MCP a sessão é de
   um cliente de IA de terceiros; aqui a pessoa já está logada
   no site, olhando as mesmas telas.
   ─────────────────────────────────────────────────────────── */
export const INSTRUCOES = `
Controle financeiro do LAPIG/UFG. Responde sobre centros de custo (projetos):
quanto sobra, onde cabe um gasto, o que foi orçado, o que já saiu e quais bolsas
vencem.

Escopo: a sessão está logada como uma pessoa e o banco filtra tudo por ela — um
professor enxerga só os centros de custo dele. Lista curta ou resultado vazio
pode ser escopo, não ausência; "quem_sou_eu" diz com qual login e papel.

Quatro regras valem para todas as tools:

1. Não calcule. Todo número sai das RPCs. Somar, projetar ou reordenar por conta
   própria produz um segundo resultado, que vai discordar do site.

2. Não recomende — apresente. As tools de decisão devolvem shortlist com
   justificativa. A ordem mede urgência de gasto, e urgência não é mérito: se um
   bolsista se justifica dentro do objeto daquele projeto é decisão humana e não
   está em tabela nenhuma. Exponha as opções com o porquê de cada uma; escolher
   é de quem coordena.

3. Diga o que o número cobre quando isso muda a leitura. Os campos existem para
   isso: compromissos_cobertura, situacao_dado, caixa.cobertura,
   risco_devolucao.base, truncado. Saldo alto sem balancete é previsto integral
   com realizado zero por falta de dado — não é dinheiro sobrando.

4. "panorama" descreve, "simular_alocacao" ranqueia. A ordem do panorama é
   alfabética e não significa prioridade.

Como responder: em português do Brasil, com o número pedido e a ressalva que
muda a leitura dele. Não devolva o JSON inteiro, não enumere campo por campo e
não repita as notas da tool palavra por palavra. Ressalva que não muda a decisão
não precisa aparecer. Valores em reais no formato R$ 1.234,56.

Quem pergunta está dentro do próprio sistema e vê as mesmas telas: pode citar
onde conferir (Fechamento Mensal, Plano de Trabalho, Bolsistas) em vez de
descrever o dado inteiro.
`.trim();

/* ── Transporte ───────────────────────────────────────────── */

function cliente() {
  if (!window.supabaseClient) throw new Error('Sessão do Supabase não iniciada.');
  return window.supabaseClient;
}

/**
 * A Edge Function devolve o erro no corpo, e `functions.invoke` embrulha a
 * resposta não-2xx num FunctionsHttpError cujo `context` é o Response cru.
 * Sem desembrulhar, todo problema vira "Edge Function returned a non-2xx
 * status code" — inútil para quem precisa saber que faltou fazer o deploy.
 */
async function detalharErro(error) {
  const generico = error && error.message ? error.message : 'Erro ao chamar o assistente.';
  const resposta = error && error.context;
  if (!resposta || typeof resposta.json !== 'function') return generico;
  try {
    const corpo = await resposta.json();
    if (corpo && corpo.error) return corpo.error;
  } catch {
    /* corpo não-JSON: fica o genérico */
  }
  if (resposta.status === 404) {
    // O comando de deploy só serve para quem tem o painel do Supabase. Para o
    // professor é ruído sem ação possível — ver `detalheTecnico` em
    // supabase-config.js, mesma regra.
    const admin = typeof Auth !== 'undefined' && Auth.isAdmin?.();
    return admin
      ? 'A Edge Function "assistente" não está publicada neste projeto. ' +
        'Rode: supabase functions deploy assistente'
      : 'O assistente está indisponível no momento. Avise o administrador do sistema.';
  }
  return generico;
}

async function invocar(body) {
  const { data, error } = await cliente().functions.invoke('assistente', { body });
  if (error) throw new Error(await detalharErro(error));
  if (data && data.error) throw new Error(data.error);
  return data;
}

/** Modelos liberados pela allowlist da Edge Function (ela é a fonte da verdade). */
export async function listarModelos() {
  const data = await invocar({ acao: 'modelos' });
  return { modelos: data.modelos || [], padrao: data.padrao || null };
}

/* ── Laço ─────────────────────────────────────────────────── */

/** `arguments` vem como objeto no Ollama nativo e como string no formato OpenAI. */
function lerArgumentos(bruto) {
  if (bruto == null) return {};
  if (typeof bruto === 'object') return bruto;
  try {
    return JSON.parse(bruto);
  } catch {
    throw new Error(`Argumentos não são JSON válido: ${String(bruto).slice(0, 200)}`);
  }
}

function serializar(resultado) {
  const texto = JSON.stringify(resultado);
  if (texto.length <= MAX_RESULTADO_CHARS) return { texto, truncado: false };
  return {
    texto: JSON.stringify({
      erro: 'Resultado grande demais para caber na conversa.',
      tamanho_chars: texto.length,
      teto_chars: MAX_RESULTADO_CHARS,
      dica:
        'Refaça a consulta restringindo `centros_de_custo` a um ou dois centros, ' +
        'ou use uma tool mais específica. Não estime o número que faltou.',
    }),
    truncado: true,
  };
}

/**
 * Conversa uma vez: manda o histórico ao modelo, executa as tools que ele pedir,
 * devolve quando ele responder em texto.
 *
 * @param {object}   opts
 * @param {Array}    opts.mensagens  histórico completo, incluindo o system
 * @param {string}   opts.modelo
 * @param {Function} opts.onEvento   ({tipo, ...}) — 'pensando' | 'tool' | 'tool_ok'
 *                                   | 'tool_erro'; usado pela tela para mostrar
 *                                   o passo a passo ao vivo
 * @returns {Promise<{mensagens: Array, conteudo: string, passos: Array}>}
 */
export async function conversar({ mensagens, modelo, onEvento }) {
  const emitir = (tipo, dados) => {
    if (typeof onEvento === 'function') onEvento({ tipo, ...dados });
  };

  const msgs = mensagens.slice();
  const tools = especificacoes();
  const passos = [];

  for (let rodada = 1; rodada <= MAX_RODADAS; rodada++) {
    emitir('pensando', { rodada });

    const resposta = await invocar({ messages: msgs, tools, model: modelo });
    const message = resposta.message || {};
    msgs.push(message);

    const chamadas = Array.isArray(message.tool_calls) ? message.tool_calls : [];

    if (!chamadas.length) {
      let conteudo = String(message.content || '').trim();
      // 'length' significa que o modelo foi cortado no limite de contexto. Sem
      // dizer isso, uma resposta pela metade chega parecendo completa.
      if (resposta.done_reason === 'length') {
        conteudo +=
          (conteudo ? '\n\n' : '') +
          '**Resposta interrompida no limite de contexto** — limpe a conversa ou ' +
          'peça um recorte menor.';
      }
      return { mensagens: msgs, conteudo, passos, modelo: resposta.model || modelo };
    }

    for (const chamada of chamadas) {
      const fn = chamada.function || {};
      const nome = fn.name;
      const inicio = Date.now();
      let args = {};

      try {
        args = lerArgumentos(fn.arguments);
      } catch (e) {
        args = {};
        emitir('tool_erro', { nome, args, erro: e.message });
        passos.push({ nome, args, ok: false, erro: e.message });
        msgs.push(mensagemDeTool(chamada, nome, JSON.stringify({ erro: e.message })));
        continue;
      }

      emitir('tool', { nome, args });

      try {
        const resultado = await executarTool(nome, args);
        const { texto, truncado } = serializar(resultado);
        const ms = Date.now() - inicio;
        emitir('tool_ok', { nome, args, ms, truncado, resultado });
        passos.push({ nome, args, ok: true, ms, truncado, resultado });
        msgs.push(mensagemDeTool(chamada, nome, texto));
      } catch (e) {
        // Erro de tool volta para o modelo como resultado, não como exceção: um
        // nome ambíguo ("cerrado" batendo em três centros) é recuperável — a
        // mensagem já lista os candidatos e o modelo tenta de novo. Estourar
        // aqui obrigaria o usuário a reformular o que a máquina resolve.
        const ms = Date.now() - inicio;
        emitir('tool_erro', { nome, args, ms, erro: e.message });
        passos.push({ nome, args, ok: false, ms, erro: e.message });
        msgs.push(mensagemDeTool(chamada, nome, JSON.stringify({ erro: e.message })));
      }
    }
  }

  return {
    mensagens: msgs,
    conteudo:
      `Parei após ${MAX_RODADAS} consultas seguidas sem chegar a uma resposta. ` +
      'Tente uma pergunta mais específica (um centro de custo por vez, por exemplo).',
    passos,
    modelo,
    estourou: true,
  };
}

function mensagemDeTool(chamada, nome, conteudo) {
  const msg = { role: 'tool', tool_name: nome, content: conteudo };
  // Só aparece em modelos que emitem o formato da OpenAI; quando existe, tem que
  // voltar, ou o modelo não casa a resposta com a chamada.
  if (chamada && chamada.id) msg.tool_call_id = chamada.id;
  return msg;
}

/** Histórico novo, já com o enquadramento na posição de system. */
export function conversaNova() {
  return [{ role: 'system', content: INSTRUCOES }];
}

if (typeof window !== 'undefined') {
  window.CFAgent = { INSTRUCOES, conversar, conversaNova, listarModelos, MAX_RODADAS };
}

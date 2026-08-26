// Edge Function: assistente
//
// Proxy fino entre a aba "Assistente" do site e o Ollama Cloud. Existe por um
// motivo só: a OLLAMA_API_KEY não pode ir no browser. O bundle do frontend é
// público (GitHub Pages, repositório aberto), então qualquer chave embutida ali
// estaria publicada.
//
// O que esta função NÃO faz, de propósito:
//
//   - não executa tool nenhuma. O laço de tool calling roda no browser
//     (frontend/js/ai/agent.js) e as tools chamam as RPCs pelo supabaseClient
//     já logado — o mesmo caminho, o mesmo JWT e o mesmo RLS que o resto do
//     site. Executar as RPCs aqui exigiria repassar o JWT e reimplementar o
//     adaptador em Deno, criando uma segunda cópia de `mcp/src/tools.js`.
//   - não tem uma linha de lógica financeira. Todo número sai de RPC.
//   - não guarda conversa. Cada chamada é independente; o histórico mora na
//     aba do navegador e morre com ela.
//
// Sobre o escopo desta função: ela é um gateway de LLM para quem tem login no
// sistema. Isso é deliberado e o limite é honesto — quem tem login já enxerga
// (pelo RLS) o dado que o assistente consulta. O que a função impede é (a) que
// a chave vaze e (b) que anônimo a use. Os tetos abaixo existem para que um
// erro de laço no cliente não vire uma fatura.
//
// Auth: exige JWT do Supabase.
// Secrets: OLLAMA_API_KEY (obrigatório), ASSISTENTE_MODELOS (opcional).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const OLLAMA_ENDPOINT = "https://ollama.com/api/chat";

// Modelos oferecidos no seletor da tela. Precisam suportar **tool calling** —
// sem isso o assistente não consulta RPC nenhuma e passa a inventar número, que
// é exatamente o que a arquitetura evita.
//
// Para trocar a lista sem redeploy:
//   supabase secrets set ASSISTENTE_MODELOS="modelo-a:cloud,modelo-b:cloud"
// O primeiro da lista é o padrão.
const MODELOS_PADRAO = [
  "glm-5.2:cloud",
  "kimi-k2.6:cloud",
  "gemma4:31b-cloud",
];

// Tetos. Não são segurança — são o freio de mão contra laço infinito no cliente.
const MAX_MENSAGENS = 80;
const MAX_TOOLS = 30;
const MAX_PAYLOAD_CHARS = 400_000;
const TIMEOUT_MS = 120_000;

// Fixos no servidor, não no cliente: são parâmetros de qualidade da resposta,
// e deixá-los ajustáveis pelo browser só criaria um jeito de degradar a
// resposta sem deixar rastro. `num_ctx` é generoso porque um panorama com
// muitos centros de custo, mais o histórico, enche contexto pequeno depressa.
const OPCOES_MODELO = { temperature: 0.2, num_ctx: 32768 };

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

function modelosPermitidos(): string[] {
  const bruto = Deno.env.get("ASSISTENTE_MODELOS");
  if (!bruto) return MODELOS_PADRAO;
  const lista = bruto.split(",").map((m) => m.trim()).filter(Boolean);
  return lista.length ? lista : MODELOS_PADRAO;
}

/** O que o cliente pode mandar: papéis conhecidos e conteúdo textual. */
const PAPEIS = new Set(["system", "user", "assistant", "tool"]);

function validarMensagens(raw: unknown): { erro?: string; messages?: unknown[] } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { erro: "'messages' ausente ou vazio." };
  }
  if (raw.length > MAX_MENSAGENS) {
    return { erro: `Conversa longa demais (${raw.length} mensagens, teto ${MAX_MENSAGENS}). Limpe a conversa.` };
  }
  for (const m of raw as Record<string, unknown>[]) {
    if (!m || typeof m !== "object") return { erro: "Mensagem inválida." };
    if (typeof m.role !== "string" || !PAPEIS.has(m.role)) {
      return { erro: `Papel inválido em 'messages': ${String(m.role)}.` };
    }
  }
  return { messages: raw as unknown[] };
}

async function chamarOllama(
  body: Record<string, unknown>,
  apiKey: string,
): Promise<Record<string, unknown>> {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(OLLAMA_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controle.signal,
    });
    if (!resp.ok) {
      const texto = await resp.text().catch(() => "");
      throw new Error(`Ollama HTTP ${resp.status}: ${texto.slice(0, 500)}`);
    }
    return await resp.json();
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error(`O modelo não respondeu em ${TIMEOUT_MS / 1000}s.`);
    }
    throw e;
  } finally {
    clearTimeout(relogio);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  // ── Auth ───────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnon) {
    return json({ error: "Edge Function mal configurada (env)." }, 500);
  }
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: authErr } = await supabase.auth.getUser();
  if (authErr || !userRes?.user) return json({ error: "Não autenticado." }, 401);

  // ── Payload ────────────────────────────────────────────────────────────
  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  const permitidos = modelosPermitidos();

  // Ação "modelos": alimenta o seletor da tela a partir da allowlist, para o
  // frontend não precisar adivinhar (nem versionar) nome de modelo.
  if (payload.acao === "modelos") {
    return json({ modelos: permitidos, padrao: permitidos[0] });
  }

  const { erro, messages } = validarMensagens(payload.messages);
  if (erro) return json({ error: erro }, 400);

  const tools = Array.isArray(payload.tools) ? payload.tools : [];
  if (tools.length > MAX_TOOLS) {
    return json({ error: `'tools' excede o teto de ${MAX_TOOLS}.` }, 400);
  }

  const model = typeof payload.model === "string" && payload.model
    ? payload.model
    : permitidos[0];
  if (!permitidos.includes(model)) {
    return json({
      error: `Modelo "${model}" não está liberado. Disponíveis: ${permitidos.join(", ")}. ` +
        "Para mudar a lista: supabase secrets set ASSISTENTE_MODELOS=\"...\".",
    }, 400);
  }

  const corpo: Record<string, unknown> = {
    model,
    stream: false,
    messages,
    options: OPCOES_MODELO,
  };
  if (tools.length) corpo.tools = tools;

  const tamanho = JSON.stringify(corpo).length;
  if (tamanho > MAX_PAYLOAD_CHARS) {
    return json({
      error: `Payload de ${tamanho} chars excede o teto de ${MAX_PAYLOAD_CHARS}. ` +
        "Limpe a conversa ou peça um recorte menor.",
    }, 413);
  }

  const apiKey = Deno.env.get("OLLAMA_API_KEY");
  if (!apiKey) return json({ error: "OLLAMA_API_KEY não configurada." }, 500);

  let resultado: Record<string, unknown>;
  try {
    resultado = await chamarOllama(corpo, apiKey);
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }

  const message = resultado?.message;
  if (!message) return json({ error: "Resposta do modelo veio sem 'message'." }, 502);

  // Devolve só o que o laço do cliente precisa. `done_reason` entra porque
  // distingue "acabou de responder" de "estourou o contexto" — sem isso, uma
  // resposta cortada chega ao usuário parecendo completa.
  return json({
    message,
    model,
    done_reason: resultado?.done_reason ?? null,
    eval_count: resultado?.eval_count ?? null,
  }, 200);
});

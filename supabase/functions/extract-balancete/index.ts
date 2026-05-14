// Edge Function: extract-balancete
//
// Recebe o texto bruto extraído de um PDF de Balancete Contábil
// Analítico da FUNAPE e devolve um JSON estruturado pronto para o
// RPC upsert_balancete.
//
// Auth: exige JWT do Supabase.
// Secret: OLLAMA_API_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const OLLAMA_ENDPOINT = "https://ollama.com/api/chat";
const OLLAMA_MODEL = "gemma4:31b-cloud";

interface Lancamento {
  conta_codigo: string;
  conta_descricao: string | null;
  valor_debito: number;
  valor_credito: number;
  saldo_atual: number;
}

interface BalanceteExtraido {
  project_code: string | null;
  data_referencia: string | null;
  data_emissao: string | null;
  periodo_inicio: string | null;
  saldo_disponivel: number | null;
  rendimento_liquido: number | null;
  total_debitos: number | null;
  total_creditos: number | null;
  lancamentos: Lancamento[];
}

const SYSTEM_PROMPT = `Você é um extrator estruturado de Balancetes Contábeis Analíticos da FUNAPE (em pt-BR).

Recebe o TEXTO BRUTO de um PDF e devolve JSON conforme schema abaixo. Retorne APENAS JSON válido, sem markdown.

Schema:
{
  "project_code":     string|null,        // ex.: "30.099" ou "30.113" — vem da linha "1.1.1.02.02.XXXXX 30.099 22813-3 BB/FU PROJETO..."
  "data_referencia":  "YYYY-MM-DD"|null,  // data FINAL do período (cabeçalho "01/01/2000 a DD/MM/AAAA")
  "data_emissao":     "YYYY-MM-DD"|null,  // linha "Emissão: DD/MM/AAAA"
  "periodo_inicio":   "YYYY-MM-DD"|null,  // data INICIAL do período (raramente diferente de 2000-01-01)
  "saldo_disponivel":   number|null,      // "SALDO DISPONÍVEL PÓS IR/IOF ESTIMADO S/ REND. APL. FINANCEIRA == >> R$ X"
  "rendimento_liquido": number|null,      // "RENDIMENTO LÍQUIDO APURADO ==>> R$ X"
  "total_debitos":      number|null,      // "TOTAL DE DÉBITOS : X"
  "total_creditos":     number|null,      // "TOTAL DE CRÉDITOS: X"
  "lancamentos": [
    {
      "conta_codigo":    string,          // ex.: "7.1.3.02", "7.1.3.05.01.99520" (apenas linhas com código)
      "conta_descricao": string|null,     // "DIÁRIAS", "FUNDO LOCAL CIP", etc.
      "valor_debito":    number,          // valor da coluna "Débitos" (positivo, NÃO use parênteses negativos)
      "valor_credito":   number,          // valor da coluna "Créditos"
      "saldo_atual":     number           // valor da coluna "Saldo Atual" (positivo para despesas em 7.x)
    }
  ]
}

Regras CRÍTICAS:
- Inclua TODAS as linhas de detalhe com código contábil (1.x, 2.x, 7.x), MESMO as agregadoras (ex.: 7.1.3 "CUSTOS/DESPESAS"). NÃO inclua linhas sem código (cabeçalhos como "ATIVO CIRCULANTE" sem número, ou totais finais).
- Foque especialmente em **7.1.3.x** — são as contas de despesa/realizado que serão mapeadas para rubricas do plano. Inclua tanto as agregadoras (7.1.3.02 DIÁRIAS) quanto as folhas (7.1.3.02.01.00002 DIÁRIAS NO EXTERIOR).
- Valores entre parênteses no PDF significam negativos contábeis — converta. Mas para os campos numéricos use SEMPRE o valor absoluto positivo (a coluna "Débitos" às vezes mostra "(225,80)" — registre como 225.80).
- Normalize datas no padrão brasileiro: "15 de Abril de 2026" → "2026-04-15"; "13/04/2026" → "2026-04-13".
- Normalize valores: "143.260,76" → 143260.76. "R$ 4.213,69" → 4213.69. Remova R$, pontos de milhar, vírgula vira ponto decimal.
- project_code: procure SEMPRE pelo formato XX.XXX (dois dígitos, ponto, três dígitos) — encontrado na descrição de contas 1.1.1.02.02.XXXXX como "30.099" ou "30.113". Se não encontrar, deixe null.
- Se um campo não estiver presente, use null. NUNCA invente.

Exemplo (trecho de BALANCETE_18441_30.113.pdf):
Cabeçalho: "01/01/2000 a 13/04/2026 ... Emissão: 15/04/2026 11:44"
Linha: "1.1.1.02.02.98491 98491 30.113 24036-2 BB/FU PROJ CIRAND   0,00   496.182,96  (496.182,96)   0,00   0,00"
Linha: "7.1.3.02 2521323 DIÁRIAS   0,00   21.496,58   0,00   21.496,58   21.496,58"
Linha: "7.1.3.05.01.99520 2599520 FUNDO LOCAL CIP   0,00   6.036,56   0,00   6.036,56   6.036,56"
Rodapé: "SALDO DISPONÍVEL PÓS IR/IOF ESTIMADO S/ REND. APL. FINANCEIRA == >> R$ 143.260,76"
Rodapé: "RENDIMENTO LÍQUIDO APURADO ==>> R$ 4.213,69"
Rodapé: "GOIÂNIA, 15 de Abril de 2026"

Saída (parcial):
{
  "project_code": "30.113",
  "data_referencia": "2026-04-13",
  "data_emissao": "2026-04-15",
  "periodo_inicio": "2000-01-01",
  "saldo_disponivel": 143260.76,
  "rendimento_liquido": 4213.69,
  "lancamentos": [
    { "conta_codigo": "1.1.1.02.02.98491", "conta_descricao": "30.113 24036-2 BB/FU PROJ CIRAND", "valor_debito": 496182.96, "valor_credito": 496182.96, "saldo_atual": 0 },
    { "conta_codigo": "7.1.3.02", "conta_descricao": "DIÁRIAS", "valor_debito": 21496.58, "valor_credito": 0, "saldo_atual": 21496.58 },
    { "conta_codigo": "7.1.3.05.01.99520", "conta_descricao": "FUNDO LOCAL CIP", "valor_debito": 6036.56, "valor_credito": 0, "saldo_atual": 6036.56 }
  ]
}
`;

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

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function dateISO(s: unknown): string | null {
  if (typeof s !== "string" || !s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function normalizeBalancete(raw: unknown): { data: BalanceteExtraido; warnings: string[] } {
  const warnings: string[] = [];
  const obj = (raw ?? {}) as Record<string, unknown>;

  const lancsIn = Array.isArray(obj.lancamentos) ? obj.lancamentos : [];
  const lancamentos: Lancamento[] = [];
  for (const l of lancsIn as Record<string, unknown>[]) {
    const codigo = typeof l.conta_codigo === "string" ? l.conta_codigo.trim() : "";
    if (!codigo || !/^[\d.]+$/.test(codigo)) continue;
    const saldo = Number(l.saldo_atual);
    const debito = Number(l.valor_debito);
    const credito = Number(l.valor_credito);
    lancamentos.push({
      conta_codigo: codigo,
      conta_descricao: typeof l.conta_descricao === "string" ? l.conta_descricao.trim() : null,
      valor_debito: isNum(debito) ? Math.abs(debito) : 0,
      valor_credito: isNum(credito) ? Math.abs(credito) : 0,
      saldo_atual: isNum(saldo) ? saldo : 0,
    });
  }

  const num = (k: string): number | null => {
    const v = obj[k];
    if (v == null) return null;
    const n = typeof v === "number" ? v : Number(v);
    return isNum(n) ? n : null;
  };

  const data: BalanceteExtraido = {
    project_code: typeof obj.project_code === "string" ? obj.project_code : null,
    data_referencia: dateISO(obj.data_referencia),
    data_emissao: dateISO(obj.data_emissao),
    periodo_inicio: dateISO(obj.periodo_inicio),
    saldo_disponivel: num("saldo_disponivel"),
    rendimento_liquido: num("rendimento_liquido"),
    total_debitos: num("total_debitos"),
    total_creditos: num("total_creditos"),
    lancamentos,
  };

  // Sanity checks
  if (data.total_debitos != null && data.total_creditos != null) {
    const diff = Math.abs(data.total_debitos - data.total_creditos);
    if (diff > 1) {
      warnings.push(`Total de débitos (${data.total_debitos}) difere do total de créditos (${data.total_creditos}).`);
    }
  }
  if (data.data_referencia == null) {
    warnings.push("data_referencia não foi extraída — preencha manualmente.");
  }
  if (data.project_code == null) {
    warnings.push("project_code não foi detectado no PDF — selecione o projeto manualmente.");
  }
  if (lancamentos.length === 0) {
    warnings.push("Nenhum lançamento extraído — confira o documento manualmente.");
  }

  return { data, warnings };
}

async function callOllama(text: string, apiKey: string): Promise<unknown> {
  const resp = await fetch(OLLAMA_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      options: { temperature: 0.05, num_ctx: 32768 },
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Ollama API HTTP ${resp.status}: ${body.slice(0, 500)}`);
  }
  const result = await resp.json();
  const content: string = result?.message?.content ?? "";
  if (!content) throw new Error("Resposta do Ollama vazia.");
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error(`Resposta do Ollama não é JSON válido: ${(e as Error).message}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnon) return json({ error: "Edge Function mal configurada (env)." }, 500);
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: authErr } = await supabase.auth.getUser();
  if (authErr || !userRes?.user) return json({ error: "Não autenticado." }, 401);

  let payload: { text?: unknown } = {};
  try { payload = await req.json(); } catch { return json({ error: "JSON inválido." }, 400); }
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (text.length < 100) return json({ error: "'text' ausente ou muito curto." }, 400);
  if (text.length > 250_000) return json({ error: "Texto excede 250.000 chars." }, 413);

  const apiKey = Deno.env.get("OLLAMA_API_KEY");
  if (!apiKey) return json({ error: "OLLAMA_API_KEY não configurada." }, 500);

  let raw: unknown;
  try { raw = await callOllama(text, apiKey); }
  catch (e) { return json({ error: (e as Error).message }, 502); }

  const { data, warnings } = normalizeBalancete(raw);
  return json({ data, warnings, raw_extraction: raw }, 200);
});

// Edge Function: extract-plano-trabalho
//
// Recebe o texto bruto extraído de um DOCX (Plano de Trabalho UFG/FUNAPE),
// envia para o Ollama Cloud (kimi-k2.6:cloud) e devolve um JSON estruturado
// pronto para o RPC upsert_plano_trabalho.
//
// Auth: exige JWT do Supabase (Authorization: Bearer ...).
// Secret: OLLAMA_API_KEY (defina via `supabase secrets set OLLAMA_API_KEY=...`).
//
// Endpoint: POST /functions/v1/extract-plano-trabalho
// Body: { "text": "<conteúdo do DOCX>" }
// Resposta 200: { "data": { ...JSON do plano... }, "warnings": [...] }
// Resposta 4xx/5xx: { "error": "..." }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

// ------------------------- Tipos & Constantes -------------------------

const OLLAMA_ENDPOINT = "https://ollama.com/api/chat";
const OLLAMA_MODEL = "kimi-k2.6:cloud";

const RUBRICA_CODES = new Set([
  "a", "a.colab", "a.enc", "a.cons", "a.estag", "a.bolsas", "a.outros",
  "b", "c", "d", "e", "f", "g",
  "cip_ufg", "cip_ua", "dao",
]);

interface RubricaItem {
  rubrica_code: string;
  descricao_livre: string | null;
  valor_previsto: number;
}

interface Desembolso {
  parcela: number;
  data_prevista: string | null;
  data_texto: string | null;
  valor: number | null;
  valor_texto: string | null;
}

interface PlanoExtraido {
  titulo: string | null;
  coordenador: string | null;
  prazo_inicio: string | null;
  prazo_fim: string | null;
  valor_total_plano: number | null;
  valor_despesas_projeto: number | null;
  valor_cip: number | null;
  valor_dao: number | null;
  receita_origem: string | null;
  rubricas: RubricaItem[];
  desembolsos: Desembolso[];
}

// ----------------------------- Prompt --------------------------------

const SYSTEM_PROMPT = `Você é um extrator estruturado de Planos de Trabalho da UFG/FUNAPE (em pt-BR).

Você receberá o TEXTO BRUTO de um DOCX. Extraia as informações no JSON abaixo. Retorne APENAS JSON válido, sem markdown, sem comentários, sem texto extra.

Schema:
{
  "titulo": string|null,                  // "Título do Projeto" (Seção I)
  "coordenador": string|null,             // nome do coordenador (Seção I)
  "prazo_inicio": "YYYY-MM-DD"|null,      // I.c "Início"
  "prazo_fim":    "YYYY-MM-DD"|null,      // I.c "Término"
  "valor_total_plano":      number|null,  // II.f "Total do plano"
  "valor_despesas_projeto": number|null,  // II.f "Previsão de despesas do projeto"
  "valor_cip":              number|null,  // II.d "Total" (CIP UFG + CIP UA)
  "valor_dao":              number|null,  // II.f "D.A.O da Fundação"
  "receita_origem": string|null,          // II.a (texto curto)
  "rubricas": [
    { "rubrica_code": <um dos códigos abaixo>,
      "descricao_livre": string|null,
      "valor_previsto": number }
  ],
  "desembolsos": [
    { "parcela": integer,
      "data_prevista": "YYYY-MM-DD"|null,
      "data_texto": string|null,
      "valor": number|null,
      "valor_texto": string|null }
  ]
}

Códigos válidos para rubrica_code (use EXATAMENTE estes):
  "a"        → linha-total "a-Pessoal"
  "a.colab"  → "Colaboradores eventuais (pessoal CLT)"
  "a.enc"    → "Encargos s/ CLT"
  "a.cons"   → "Consultorias (STPF-RPA) + Encargos s/ serviços"
  "a.estag"  → "Estagiários"
  "a.bolsas" → "Bolsas"
  "a.outros" → "Outros encargos"
  "b"        → linha-total "Serviços de Terceiros P. Jurídica"
  "c"        → linha-total "Passagens e Despesas com Locomoção"
  "d"        → linha-total "Despesas com diárias"
  "e"        → linha-total "Material de Consumo"
  "f"        → linha-total "Investimento"
  "g"        → "Ganho econômico"
  "cip_ufg"  → "Custos indiretos para a UFG"
  "cip_ua"   → "Custos indiretos para a UA/Órgão"
  "dao"      → "D.A.O da Fundação"

Regras CRÍTICAS para "rubricas":
- Use "descricao_livre" SOMENTE para sub-itens de b, e e f que o documento liste com nomes próprios (ex.: "Serviços de transporte" sob b; "Material de Expediente" sob e; "Equipamentos e Material Permanente" sob f). NUNCA preencha descricao_livre para 'a' (use a.bolsas etc.) nem para c, d, g, cip_ufg, cip_ua, dao.
- NÃO DUPLIQUE valores. Se a linha-total de uma rubrica (b/e/f) bate exatamente com a soma dos sub-itens, registre APENAS os sub-itens. Se o documento só mostra o total (sem sub-itens), registre só a linha-total (sem descricao_livre).
- Para 'a' (Pessoal), se houver detalhamento, registre cada sub-rubrica (a.bolsas, a.estag etc.) e NÃO inclua a linha "a" total — soma é implícita.
- Inclua APENAS rubricas com valor > 0. Pule "------------", "0,00", linhas vazias.

Regras de normalização:
- Valores: "R$ 138.600,00" → 138600.00. Remova R$, pontos de milhar; vírgula vira ponto decimal.
- Datas Mês/AA: "Julho/25" → "2025-07-01"; "07/2025" → "2025-07-01"; "Outubro/25" → "2025-10-01". Use o primeiro dia do mês.
- Quando o documento diz textos como "assinatura contrato" ou "mediante cálculo de gastos", preencha *_texto e deixe data_prevista/valor como null.
- Use null (NUNCA invente) quando o campo não estiver presente.

Exemplo (parcial, Plano Acelen):
Trecho: "a-Pessoal ... 396.000,00 / Bolsas 396.000,00 / b – Serviços de Terceiros P. Jurídica Total 10.000,00 / Serviços de Terceiros P. Jurídica em geral 10.000,00 / c – Passagens ... Total 20.000,00 / d – Despesas com diárias Total 26.820,00 / e – Material de Consumo Total 20.000,00 / Material de Consumo em geral 20.000,00 / f– Investimento Total 40.000,00 / Investimentos em geral 40.000,00"

Saída esperada para "rubricas":
[
  { "rubrica_code":"a.bolsas",  "descricao_livre": null, "valor_previsto": 396000.00 },
  { "rubrica_code":"b",         "descricao_livre": "Serviços de Terceiros P. Jurídica em geral", "valor_previsto": 10000.00 },
  { "rubrica_code":"c",         "descricao_livre": null, "valor_previsto": 20000.00 },
  { "rubrica_code":"d",         "descricao_livre": null, "valor_previsto": 26820.00 },
  { "rubrica_code":"e",         "descricao_livre": "Material de Consumo em geral", "valor_previsto": 20000.00 },
  { "rubrica_code":"f",         "descricao_livre": "Investimentos em geral",       "valor_previsto": 40000.00 }
]
`;

// --------------------------- Helpers ---------------------------------

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

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function coerceDateISO(s: unknown): string | null {
  if (typeof s !== "string" || !s) return null;
  // Aceita "YYYY-MM-DD" diretamente.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function normalizePlano(raw: unknown): { data: PlanoExtraido; warnings: string[] } {
  const warnings: string[] = [];
  const obj = (raw ?? {}) as Record<string, unknown>;

  const rubricasIn = Array.isArray(obj.rubricas) ? obj.rubricas : [];
  const rubricas: RubricaItem[] = [];
  for (const r of rubricasIn as Record<string, unknown>[]) {
    const code = typeof r.rubrica_code === "string" ? r.rubrica_code.trim() : "";
    const valor = typeof r.valor_previsto === "number"
      ? r.valor_previsto
      : Number(r.valor_previsto);
    if (!RUBRICA_CODES.has(code)) {
      warnings.push(`rubrica_code desconhecido descartado: "${code}"`);
      continue;
    }
    if (!isFiniteNumber(valor) || valor <= 0) {
      continue; // pula entradas sem valor real
    }
    const descricao = typeof r.descricao_livre === "string" && r.descricao_livre.trim()
      ? r.descricao_livre.trim()
      : null;
    rubricas.push({ rubrica_code: code, descricao_livre: descricao, valor_previsto: valor });
  }

  const desembolsosIn = Array.isArray(obj.desembolsos) ? obj.desembolsos : [];
  const desembolsos: Desembolso[] = [];
  for (const d of desembolsosIn as Record<string, unknown>[]) {
    const parcela = Number(d.parcela);
    if (!Number.isInteger(parcela) || parcela < 1) continue;
    const valor = typeof d.valor === "number" ? d.valor : (d.valor != null ? Number(d.valor) : null);
    desembolsos.push({
      parcela,
      data_prevista: coerceDateISO(d.data_prevista),
      data_texto: typeof d.data_texto === "string" ? d.data_texto : null,
      valor: isFiniteNumber(valor) ? valor : null,
      valor_texto: typeof d.valor_texto === "string" ? d.valor_texto : null,
    });
  }

  const num = (k: string): number | null => {
    const v = obj[k];
    if (v == null) return null;
    const n = typeof v === "number" ? v : Number(v);
    return isFiniteNumber(n) ? n : null;
  };

  const data: PlanoExtraido = {
    titulo: typeof obj.titulo === "string" ? obj.titulo : null,
    coordenador: typeof obj.coordenador === "string" ? obj.coordenador : null,
    prazo_inicio: coerceDateISO(obj.prazo_inicio),
    prazo_fim: coerceDateISO(obj.prazo_fim),
    valor_total_plano: num("valor_total_plano"),
    valor_despesas_projeto: num("valor_despesas_projeto"),
    valor_cip: num("valor_cip"),
    valor_dao: num("valor_dao"),
    receita_origem: typeof obj.receita_origem === "string" ? obj.receita_origem : null,
    rubricas,
    desembolsos,
  };

  // Sanity check: soma das rubricas a-g (top-level + sub-rubricas de a) deve
  // bater com valor_despesas_projeto, com tolerância de 1%.
  if (data.valor_despesas_projeto != null && rubricas.length > 0) {
    const soma = rubricas
      .filter((r) => !r.rubrica_code.startsWith("cip_") && r.rubrica_code !== "dao")
      .reduce((acc, r) => acc + r.valor_previsto, 0);
    const diff = Math.abs(soma - data.valor_despesas_projeto);
    const tol = Math.max(1, data.valor_despesas_projeto * 0.01);
    if (diff > tol) {
      warnings.push(
        `Soma das rubricas (a-g) = ${soma.toFixed(2)} difere de valor_despesas_projeto = ` +
        `${data.valor_despesas_projeto.toFixed(2)} (Δ ${diff.toFixed(2)}).`,
      );
    }
  }

  if (rubricas.length === 0) {
    warnings.push("Nenhuma rubrica extraída — confira o documento manualmente.");
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
      options: {
        temperature: 0.1,
        num_ctx: 32768,
      },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Ollama API HTTP ${resp.status}: ${body.slice(0, 500)}`);
  }

  const result = await resp.json();
  // Ollama /api/chat retorna { message: { role, content }, ... } com content em JSON string.
  const content: string = result?.message?.content ?? "";
  if (!content) throw new Error("Resposta do Ollama vazia.");
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error(`Resposta do Ollama não é JSON válido: ${(e as Error).message}`);
  }
}

// ----------------------------- Handler -------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return json({ error: "Método não permitido. Use POST." }, 405);
  }

  // Auth: exige JWT do Supabase válido.
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
  if (authErr || !userRes?.user) {
    return json({ error: "Não autenticado." }, 401);
  }

  // Body.
  let payload: { text?: unknown } = {};
  try {
    payload = await req.json();
  } catch {
    return json({ error: "JSON inválido no corpo da requisição." }, 400);
  }
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (text.length < 100) {
    return json({ error: "Campo 'text' ausente ou muito curto (mín. 100 chars)." }, 400);
  }
  if (text.length > 200_000) {
    return json({ error: "Texto excede 200.000 caracteres." }, 413);
  }

  const apiKey = Deno.env.get("OLLAMA_API_KEY");
  if (!apiKey) {
    return json({ error: "OLLAMA_API_KEY não configurada no servidor." }, 500);
  }

  let raw: unknown;
  try {
    raw = await callOllama(text, apiKey);
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }

  const { data, warnings } = normalizePlano(raw);
  return json({ data, warnings, raw_extraction: raw }, 200);
});

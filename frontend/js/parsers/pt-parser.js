/* ============================================================
   pt-parser.js
   Parser determinístico de Plano de Trabalho UFG/FUNAPE (DOCX).

   Entrada:  HTML já convertido a partir do DOCX (via mammoth.js,
             chamado no browser).
   Saída:    { data, warnings }
             — formato compatível com upsert_plano_trabalho RPC.

   Estratégia:
     1. Localiza a tabela canônica "Plano de Aplicação dos
        Recursos Financeiros".
     2. Itera linhas extraindo (nome, valor).
     3. Mapeia nomes para rubrica_code via aliases canônicos.
     4. Captura cabeçalho (título, coordenador, prazos, CIP, DAO)
        por labels conhecidos no resto do HTML.

   Falha-rápido: se a tabela canônica não existir, lança
   PtFormatError — o caller deve mostrar mensagem clara ao
   usuário e NÃO chamar nenhum fallback de IA.
   ============================================================ */

import { parseBRL } from '../pure-fns.js';
import { lookupRubrica, normalizeForLookup } from './pt-rubrica-lookup.js';

export class PtFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PtFormatError';
  }
}

const TABELA_TITULO = 'plano de aplicação dos recursos financeiros';

// Rubricas-pai top-level: "a-Pessoal", "b – Serviços...", "c – Passagens...", etc.
// Aceita "a-", "a -", "a –", "a—", maiúscula/minúscula. Captura a letra.
const RE_TOPLEVEL = /^\s*([a-h])\s*[-–—]/i;

// Linha "Total" no final da tabela (não é rubrica).
const RE_TOTAL_FINAL = /^\s*total\s*$/i;

// Header da tabela ("Item", "Valor (R$)", "1- Previsão de Despesas (...)").
const RE_HEADER_LIKE = /^\s*(item|valor\s*\(?r?\$?\)?|1-?\s*previs[aã]o)/i;

// Aliases para mapear letras top-level a um rubrica_code (quando há subitens
// genéricos, o subitem herda o code do pai).
const TOPLEVEL_TO_CODE = {
  a: 'a',         // 'a' é só agrupador — não cria linha sozinho (vide regras)
  b: 'b',
  c: 'c',
  d: 'd',
  e: 'e',
  f: 'f',
  g: 'g',
  h: 'g',         // alguns DOCX usam 'h' para "Ganho econômico" (era 'g' antes)
};

// ── Helpers de DOM ─────────────────────────────────────────

function htmlToDom(html) {
  if (typeof DOMParser === 'undefined') {
    throw new Error('DOMParser não disponível (precisa rodar no browser).');
  }
  const parser = new DOMParser();
  return parser.parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
}

function textOf(node) {
  if (!node) return '';
  return (node.textContent || '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isStrongCell(td) {
  if (!td) return false;
  // Considera strong se houver ao menos um <strong> com conteúdo significativo.
  const strongs = td.querySelectorAll('strong, b');
  for (const s of strongs) {
    if ((s.textContent || '').trim().length > 0) return true;
  }
  return false;
}

function findTabelaCanonica(doc) {
  // Procura a célula que contém o título e sobe para a <table> ancestral.
  const cells = doc.querySelectorAll('th, td');
  for (const c of cells) {
    const t = textOf(c).toLowerCase();
    if (t.includes(TABELA_TITULO)) {
      let p = c;
      while (p && p.tagName !== 'TABLE') p = p.parentElement;
      if (p) return p;
    }
  }
  return null;
}

// ── Parse de linhas da tabela ──────────────────────────────

function parseLinhas(tabela) {
  const out = [];
  const trs = tabela.querySelectorAll('tr');
  let currentTop = null;             // letra a–h do pai atual
  let pendingTopValue = null;        // valor agregador do top-level lido
  let pendingTopWasUsed = false;

  for (const tr of trs) {
    const cells = Array.from(tr.children);
    if (cells.length === 0) continue;

    // Pega texto de cada cell em ordem.
    const cellTexts = cells.map(textOf).filter(Boolean);
    if (cellTexts.length === 0) continue;

    // Identifica nome e valor: o último texto numericamente parseável é o valor.
    let valueIdx = -1;
    for (let i = cellTexts.length - 1; i >= 0; i--) {
      if (parseBRL(cellTexts[i]) != null && /\d/.test(cellTexts[i])) {
        valueIdx = i;
        break;
      }
    }
    const valor = valueIdx >= 0 ? parseBRL(cellTexts[valueIdx]) : null;
    const nameParts = cellTexts.slice(0, valueIdx >= 0 ? valueIdx : cellTexts.length);
    const nome = nameParts.join(' ').trim();
    if (!nome) continue;

    // Pula títulos/cabeçalho.
    const nomeLower = nome.toLowerCase();
    if (nomeLower.includes(TABELA_TITULO)) continue;
    if (RE_HEADER_LIKE.test(nome))         continue;
    if (RE_TOTAL_FINAL.test(nome))         continue;
    if (/^\s*$/.test(nome))                continue;

    // É top-level (a-/b-/...)? Geralmente está em <strong>.
    const isStrong = cells.some(isStrongCell);
    const topMatch = nome.match(RE_TOPLEVEL);

    if (topMatch && isStrong) {
      // Encerra o top-level anterior — se ele não gerou nenhuma linha-filha
      // mas tem valor, vira uma linha-folha (caso 'c – Passagens' isolado).
      if (currentTop && pendingTopValue != null && !pendingTopWasUsed) {
        const code = TOPLEVEL_TO_CODE[currentTop];
        if (code && code !== 'a') {
          out.push({
            rubrica_code: code,
            descricao_livre: null,
            valor_previsto: pendingTopValue,
          });
        }
      }
      currentTop = topMatch[1].toLowerCase();
      pendingTopValue = (valor != null && valor > 0) ? valor : null;
      pendingTopWasUsed = false;
      continue;
    }

    // Sub-rubrica (linha sem strong, ou linha indented).
    if (valor != null && valor > 0) {
      const sub = lookupRubrica(nome, currentTop);
      sub.valor_previsto = valor;
      out.push(sub);
      pendingTopWasUsed = true;
    }
  }

  // Flush do último top-level que não teve sub-rubrica.
  if (currentTop && pendingTopValue != null && !pendingTopWasUsed) {
    const code = TOPLEVEL_TO_CODE[currentTop];
    if (code && code !== 'a') {
      out.push({
        rubrica_code: code,
        descricao_livre: null,
        valor_previsto: pendingTopValue,
      });
    }
  }

  return out;
}

// ── Cabeçalho (título, prazos, CIP, DAO, etc.) ──────────────

function extractCabecalho(doc) {
  const fullText = textOf(doc.body || doc.documentElement);

  // CIP total (II.d "Total") e DAO (II.f "D.A.O da Fundação").
  let valor_cip = null, valor_dao = null;
  const mCip = fullText.match(/CIP[\s\S]{0,300}?Total[\s\S]{0,60}?R?\$?\s*([\d.,]+)/i);
  if (mCip) valor_cip = parseBRL(mCip[1]);

  const mDao = fullText.match(/D\.?\s*A\.?\s*O[^\d]{0,200}?R?\$?\s*([\d.,]+)/i);
  if (mDao) valor_dao = parseBRL(mDao[1]);

  // Datas "01/06/2025" (início) e "31/12/2026" (fim) — formato comum em II.c.
  // Sem confiança alta, deixa para usuário preencher se não achar.
  let prazo_inicio = null, prazo_fim = null;
  const mPrazo = fullText.match(/(\d{2})\/(\d{2})\/(\d{4})[^\d]{1,30}(\d{2})\/(\d{2})\/(\d{4})/);
  if (mPrazo) {
    prazo_inicio = `${mPrazo[3]}-${mPrazo[2]}-${mPrazo[1]}`;
    prazo_fim    = `${mPrazo[6]}-${mPrazo[5]}-${mPrazo[4]}`;
  }

  return {
    titulo: null,
    coordenador: null,
    prazo_inicio,
    prazo_fim,
    valor_cip,
    valor_dao,
    valor_total_plano: null,
    valor_despesas_projeto: null,
    receita_origem: null,
  };
}

// ── Parser principal ───────────────────────────────────────

export function parsePtFromHtml(html) {
  if (typeof html !== 'string' || html.length < 100) {
    throw new PtFormatError('HTML do plano vazio ou muito curto.');
  }

  const doc = htmlToDom(html);
  const tabela = findTabelaCanonica(doc);
  if (!tabela) {
    throw new PtFormatError(
      'Tabela "Plano de Aplicação dos Recursos Financeiros" não encontrada. ' +
      'Use o modelo padrão UFG/FUNAPE.'
    );
  }

  const rubricas = parseLinhas(tabela);
  const cabecalho = extractCabecalho(doc);

  // Total do plano = soma das rubricas previstas (sanidade).
  const valor_total_plano = rubricas.reduce((s, r) => s + (r.valor_previsto || 0), 0);
  const data = {
    ...cabecalho,
    valor_total_plano: cabecalho.valor_total_plano ?? valor_total_plano,
    rubricas,
    desembolsos: [],
  };

  const warnings = [];
  if (rubricas.length === 0) {
    warnings.push('Tabela encontrada mas nenhuma rubrica com valor extraída — confira o documento.');
  }
  // Aviso quando algum nome cair em fallback genérico
  for (const r of rubricas) {
    if (r._fallback) {
      warnings.push(`Rubrica "${r._raw_name}" classificada como fallback ${r.rubrica_code} — confira.`);
      delete r._fallback;
      delete r._raw_name;
    }
  }
  if (cabecalho.valor_cip == null) warnings.push('Valor CIP não detectado — preencha manualmente se aplicável.');
  if (cabecalho.valor_dao == null) warnings.push('Valor DAO não detectado — preencha manualmente se aplicável.');

  return { data, warnings };
}

// Helper exposto para teste/debug.
export const __internal = {
  findTabelaCanonica,
  parseLinhas,
  normalizeForLookup,
  TABELA_TITULO,
};

// ── Browser bridge ─────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.parsePtFromHtml = parsePtFromHtml;
  window.PtFormatError = PtFormatError;
}

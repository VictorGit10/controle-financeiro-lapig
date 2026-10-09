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
import { detectPtModel } from './pt-model-detect.js';

export class PtFormatError extends Error {
  /** @param {string} message @param {string} [modelo] id devolvido por detectPtModel */
  constructor(message, modelo) {
    super(message);
    this.name = 'PtFormatError';
    this.modelo = modelo || 'desconhecido';
  }
}

const TABELA_TITULO = 'plano de aplicação dos recursos financeiros';

// Rubricas-pai top-level: "a-Pessoal", "b – Serviços...", "c – Passagens...", etc.
// Aceita "a-", "a -", "a –", "a—", maiúscula/minúscula. Captura a letra.
const RE_TOPLEVEL = /^\s*([a-h])\s*[-–—]/i;

// Linha "Total" no final da tabela (não é rubrica).
const RE_TOTAL_FINAL = /^\s*total\s*$/i;

// Header da tabela ("Item", "Valor (R$)", "1- Previsão de Despesas (...)").
const RE_HEADER_LIKE = /^\s*(item|valor\s*\(?r?\$?\)?|[12]\s*[-–—]?\s*(previs[aã]o|receita))/i;

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
  const trs = Array.from(tabela.querySelectorAll('tr'));
  const inicioDespesas = trs.findIndex((tr, i) =>
    /^(?:[12]\s*[-–—]?\s*)?previs[ãa]o de despesas\b/i.test(textOf(tr.firstElementChild))
    && trs.slice(i + 1).some(linha => RE_TOPLEVEL.test(textOf(linha))));
  // O Word pode juntar receita, desembolso e despesas na mesma tabela.
  // Só abre a seção se houver rubrica a–h depois; resumo final não descarta rubricas.
  const linhas = inicioDespesas < 0 ? trs : trs.slice(inicioDespesas + 1);
  let currentTop = null;             // letra a–h do pai atual
  let pendingTopValue = null;        // valor agregador do top-level lido
  let pendingTopWasUsed = false;

  for (const tr of linhas) {
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

// Só a data explicitamente rotulada; não confundir vigência ou assinatura.
export function extractDataDocumento(texto) {
  const m = texto.match(/data\s+(?:do\s+)?documento\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  if (d.getUTCFullYear() !== Number(m[3]) || d.getUTCMonth() + 1 !== Number(m[2])
      || d.getUTCDate() !== Number(m[1])) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
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
    data_documento: extractDataDocumento(fullText),
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

// Despesas do projeto são comparáveis às rubricas; o total geral pode incluir
// CIP e DAO. O resumo pode estar em outra tabela, fora da tabela canônica.
function totalDeclarado(tabela, doc) {
  let despesas = null, receita = null, total = null, totalPlano = null;
  let cip = null, dao = null;
  for (const tr of doc.querySelectorAll('tr')) {
    const cells = Array.from(tr.children).map(textOf);
    const label = cells[0] || '';
    const previsao = /^(?:[12]\s*[-–—]?\s*)?previs[ãa]o de despesas\b/i.test(label);
    const entrada = /^1\s*[-–—]?\s*receita\b/i.test(label);
    const final = /^total$/i.test(label) && tabela.contains(tr);
    const geral = /^(?:valor\s+)?total do plano$/i.test(label);
    const indiretos = /^previs[ãa]o de custos indiretos\b/i.test(label);
    const administrativo = /^d\.?\s*a\.?\s*o\b/i.test(label);
    if (!previsao && !entrada && !final && !geral && !indiretos && !administrativo) continue;
    for (let i = cells.length - 1; i > 0; i--) {
      if (!/\d/.test(cells[i]) || parseBRL(cells[i]) == null) continue;
      const valor = parseBRL(cells[i]);
      if (previsao) despesas = valor;
      else if (geral) totalPlano = valor;
      else if (final) total ??= valor; // não trocar o total geral pelo subtotal de CIP
      else if (indiretos) cip = valor;
      else if (administrativo) dao = valor;
      else receita = valor;
      break;
    }
  }
  const m = textOf(doc.body || doc.documentElement)
    .match(/valor total do plano\s*:?\s*r?\$?\s*([\d.,]+)/i);
  return { despesas, total: totalPlano ?? total ?? receita ?? (m ? parseBRL(m[1]) : null), cip, dao };
}

// ── Parser principal ───────────────────────────────────────

export function parsePtFromHtml(html) {
  if (typeof html !== 'string' || html.length < 100) {
    throw new PtFormatError('HTML do plano vazio ou muito curto.');
  }

  const doc = htmlToDom(html);
  const tabela = findTabelaCanonica(doc);
  if (!tabela) {
    // Sem a tabela canônica não há o que ler. Nomear o modelo transforma
    // "não encontrei" em "é este outro modelo, faça assim" — ver pt-model-detect.js.
    const modelo = detectPtModel(textOf(doc.body || doc.documentElement));
    throw new PtFormatError(modelo.message, modelo.id);
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
  const declaracao = totalDeclarado(tabela, doc);
  const declarado = declaracao.despesas ?? declaracao.total;
  const cip = declaracao.cip ?? cabecalho.valor_cip;
  const dao = declaracao.dao ?? cabecalho.valor_dao;
  // Só comparar com custos adicionais quando ambos foram lidos. Ausência
  // não é zero; as rubricas e o valor extraído continuam intactos.
  const comCustos = declaracao.despesas == null && cip != null && dao != null
    ? valor_total_plano + cip + dao : null;
  const rubricasBatem = declarado != null && Math.abs(valor_total_plano - declarado) < 0.01;
  const comCustosBate = comCustos != null && declarado != null && Math.abs(comCustos - declarado) < 0.01;
  if (declarado != null && !rubricasBatem && !comCustosBate) {
    warnings.push(
      `A soma das rubricas (${valor_total_plano.toFixed(2)}) não bate com o total declarado ` +
      `no plano (${declarado.toFixed(2)}). ` +
      (comCustos != null ? `Com CIP e DAO declarados, a soma é ${comCustos.toFixed(2)}. ` : '') +
      'Confira antes de salvar.'
    );
  }
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

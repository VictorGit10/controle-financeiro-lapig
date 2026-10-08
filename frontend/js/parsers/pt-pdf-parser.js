/* ============================================================
   pt-pdf-parser.js
   Parser determinístico do Plano de Trabalho padrão PROAD/UFG
   quando ele chega em PDF (plano já assinado).

   Entrada:  texto do PDF (text layer do pdf.js, via extractPdfText
             em plano-trabalho.js).
   Saída:    { data, warnings } — mesmo formato de pt-parser.js.

   Por que um parser separado do DOCX:
   o pt-parser.js trabalha sobre a <table> do mammoth, onde cada
   linha da tabela é uma <tr> e o valor está numa <td> própria. O
   pdf.js não entrega tabela — entrega texto com quebras por
   coordenada Y. Não dá para reaproveitar parseLinhas().

   Estratégia (a diferença que importa):
     No PDF, as linhas de rubrica-pai são sempre limpas e trazem o
     próprio total — "a- Pessoal   Total   864.000,00". As folhas
     é que podem se desalinhar: um rótulo longo quebra e o valor
     cai na linha seguinte.

     Então o TOTAL DECLARADO DE CADA LETRA é a fonte da verdade, e
     as folhas só são usadas quando somam exatamente esse total.
     Quando não somam, emite-se uma única linha com o total da
     letra e um aviso — o valor global nunca fica errado, só perde
     detalhe. É o oposto de confiar nas folhas e sair 86 mil reais
     abaixo do total sem ninguém perceber.

   Falha-rápido: sem a seção "II.d" lança PtFormatError e o caller
   manda o usuário ao preenchimento manual.
   ============================================================ */

import { parseBRL } from '../pure-fns.js';
import { lookupRubrica } from './pt-rubrica-lookup.js';
import { PtFormatError, extractDataDocumento } from './pt-parser.js';
import { detectPtModel, normalizeDocText } from './pt-model-detect.js';

const TITULO_SECAO = 'plano de aplicacao dos recursos financeiros';

// "a- Pessoal Total 864.000,00" / "b – Serviços de Terceiros P. Jurídica Total 73.000,00"
const RE_TOPLEVEL   = /^([a-h])\s*[-–—]\s*(.+?)\s+total\s+([\d.,]+)$/i;
const RE_RECEITA    = /^1\s*[-–—]\s*receita\s+total\s+([\d.,]+)$/i;
const RE_DESPESAS   = /^2\s*[-–—]\s*previs[ãa]o de despesas\b.*?\btotal\s+([\d.,]+)$/i;
// Folha: "Bolsas 864.000,00" — rótulo + valor no fim da linha.
const RE_FOLHA      = /^(.*[a-zà-ú].*?)\s+([\d][\d.,]*)$/i;
// Linha que é só um número (o valor que escapou do rótulo anterior).
const RE_SO_VALOR   = /^[\d][\d.,]*$/;
// Fim da seção II.d.
const RE_FIM_SECAO  = /^(detalhamento\s+dao|rubrica\s+percentual|iii\s*[-–—]|ii\.?\s*[a-z]\.|quadro de pessoal)/i;
// Cabeçalho da tabela, não é rubrica.
const RE_CABECALHO  = /^(item|valor\s*\(?\s*r?\$?\s*\)?)/i;

const MESES = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const TOPLEVEL_TO_CODE = { a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f', g: 'g', h: 'g' };

// ── Helpers ────────────────────────────────────────────────

function toLines(text) {
  return String(text)
    .split(/\r?\n/)
    .map(l => l.replace(/ /g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Último dia do mês (para prazo_fim escrito como "Novembro/2027"). */
function fimDoMes(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** "Novembro/2025" → { ano: 2025, mes: 11 }; devolve null se não casar. */
function parseMesAno(s) {
  const m = normalizeDocText(s).match(/\b([a-z]+)\s*\/\s*(\d{4})\b/);
  if (!m) return null;
  const mes = MESES[m[1]];
  return mes ? { ano: Number(m[2]), mes } : null;
}

/**
 * Junta o rótulo cujo valor caiu na linha seguinte.
 * No PDF real: "Inscrição em eventos" / "8.000,00" são duas linhas.
 * Só junta quando a linha seguinte é SÓ um número — um rótulo seguido
 * de outro rótulo (ex.: "Outros serviços") continua sem valor.
 */
function mergeValoresOrfaos(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const atual = lines[i];
    const prox  = lines[i + 1];
    const temValor = RE_FOLHA.test(atual) || RE_TOPLEVEL.test(atual);
    if (!temValor && prox && RE_SO_VALOR.test(prox) && parseBRL(prox) != null) {
      out.push(`${atual} ${prox}`);
      i++;                       // consome a linha do valor
      continue;
    }
    out.push(atual);
  }
  return out;
}

/** Recorta as linhas da seção II.d (do título até o próximo bloco). */
function recortarSecao(lines) {
  const inicio = lines.findIndex(l => normalizeDocText(l).includes(TITULO_SECAO));
  if (inicio < 0) return null;
  const resto = lines.slice(inicio + 1);
  const fim = resto.findIndex(l => RE_FIM_SECAO.test(l));
  return fim < 0 ? resto : resto.slice(0, fim);
}

// ── Rubricas ───────────────────────────────────────────────

function parseRubricas(secao, warnings) {
  const letras = [];              // [{ letra, nome, total, folhas: [{nome, valor}] }]
  let receita = null;
  let despesas = null;
  let atual = null;

  for (const linha of secao) {
    if (RE_CABECALHO.test(linha)) continue;

    const mRec = linha.match(RE_RECEITA);
    if (mRec) { receita = parseBRL(mRec[1]); continue; }

    const mDesp = linha.match(RE_DESPESAS);
    if (mDesp) { despesas = parseBRL(mDesp[1]); continue; }

    const mTop = linha.match(RE_TOPLEVEL);
    if (mTop) {
      atual = {
        letra: mTop[1].toLowerCase(),
        nome: mTop[2].trim(),
        total: parseBRL(mTop[3]),
        folhas: [],
      };
      letras.push(atual);
      continue;
    }

    const mFolha = linha.match(RE_FOLHA);
    if (mFolha && atual) {
      const valor = parseBRL(mFolha[2]);
      if (valor != null && valor > 0) {
        atual.folhas.push({ nome: mFolha[1].trim(), valor });
      }
    }
    // Linha sem valor dentro de uma letra é rótulo de grupo ou texto
    // corrido ("Despesas com locomoção, ... incluindo") — ignorada.
  }

  // Monta as rubricas letra a letra, com o total declarado como árbitro.
  const rubricas = [];
  for (const l of letras) {
    if (l.total == null || l.total <= 0) continue;      // linhas zeradas não viram rubrica

    const somaFolhas = l.folhas.reduce((s, f) => s + f.valor, 0);
    const bate = l.folhas.length > 0 && Math.abs(somaFolhas - l.total) < 0.01;

    if (bate) {
      for (const f of l.folhas) {
        const sub = lookupRubrica(f.nome, l.letra);
        sub.valor_previsto = f.valor;
        delete sub._fallback;
        delete sub._raw_name;
        rubricas.push(sub);
      }
      continue;
    }

    if (l.folhas.length > 0) {
      warnings.push(
        `Rubrica "${l.letra} — ${l.nome}": os itens detalhados somam ` +
        `${somaFolhas.toFixed(2)} mas o total declarado é ${l.total.toFixed(2)}. ` +
        'Lançado o total da letra numa linha só — confira o detalhamento no PDF ao lado.'
      );
    }
    rubricas.push({
      rubrica_code: TOPLEVEL_TO_CODE[l.letra] || 'b',
      descricao_livre: l.folhas.length > 0 ? l.nome : null,
      valor_previsto: l.total,
    });
  }

  return { rubricas, receita, despesas };
}

// ── Cabeçalho ──────────────────────────────────────────────

function parseCabecalho(lines, texto) {
  const norm = normalizeDocText(texto);

  let titulo = null;
  const iTit = lines.findIndex(l => /^t[íi]tulo do projeto\s*:?\s*$/i.test(l));
  if (iTit >= 0) {
    const partes = [];
    for (const l of lines.slice(iTit + 1, iTit + 4)) {
      if (/^(identifica[çc][ãa]o|institui[çc][ãa]o|unidade|coordenador)/i.test(l)) break;
      partes.push(l);
    }
    titulo = partes.join(' ').trim() || null;
  }

  const mCoord = texto.match(/coordenador\(a\)\s*:?\s*(.+?)\s+CPF\s*:/i);
  const coordenador = mCoord ? mCoord[1].trim() : null;

  // "Início Final" seguido de "Novembro/2025 Novembro/2027"
  let prazo_inicio = null, prazo_fim = null;
  const iPrazo = lines.findIndex(l => /^in[íi]cio\s+final$/i.test(l));
  if (iPrazo >= 0 && lines[iPrazo + 1]) {
    const partes = lines[iPrazo + 1].split(/\s{1,}/);
    const meio = Math.ceil(partes.length / 2);
    const ini = parseMesAno(partes.slice(0, meio).join(' '));
    const fim = parseMesAno(partes.slice(meio).join(' '));
    if (ini) prazo_inicio = `${ini.ano}-${String(ini.mes).padStart(2, '0')}-01`;
    if (fim) prazo_fim = `${fim.ano}-${String(fim.mes).padStart(2, '0')}-${fimDoMes(fim.ano, fim.mes)}`;
  }
  // Fallback: par de datas dd/mm/aaaa (mesmo formato que o DOCX usa).
  if (!prazo_inicio) {
    const m = texto.match(/(\d{2})\/(\d{2})\/(\d{4})[^\d]{1,30}(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) {
      prazo_inicio = `${m[3]}-${m[2]}-${m[1]}`;
      prazo_fim    = `${m[6]}-${m[5]}-${m[4]}`;
    }
  }

  const mTotal = norm.match(/valor total do plano\s*:?\s*r?\$?\s*([\d.,]+)/);
  const valor_total_plano = mTotal ? parseBRL(mTotal[1]) : null;

  const mCip = norm.match(/\bcip\b[^\d]{0,120}?r?\$?\s*([\d.,]+)/);
  const valor_cip = mCip ? parseBRL(mCip[1]) : null;

  return { titulo, coordenador, prazo_inicio, prazo_fim, valor_total_plano, valor_cip };
}

// ── Parser principal ───────────────────────────────────────

export function parsePtFromPdfText(text) {
  if (typeof text !== 'string' || text.length < 100) {
    throw new PtFormatError('Texto do PDF vazio ou muito curto.', 'desconhecido');
  }

  const lines = mergeValoresOrfaos(toLines(text));
  const secao = recortarSecao(lines);
  if (!secao || secao.length === 0) {
    const modelo = detectPtModel(text);
    throw new PtFormatError(modelo.message, modelo.id);
  }

  const warnings = [];
  const { rubricas, receita, despesas } = parseRubricas(secao, warnings);
  const cab = parseCabecalho(lines, text);

  if (rubricas.length === 0) {
    throw new PtFormatError(
      'Seção "Plano de Aplicação dos Recursos Financeiros" encontrada no PDF, ' +
      'mas nenhuma rubrica com valor foi lida. Preencha manualmente.',
      'proad'
    );
  }

  // Conferência final: a soma tem de bater com o total que o próprio
  // documento declara. É a rede que impede um plano silenciosamente errado.
  const soma = rubricas.reduce((s, r) => s + (r.valor_previsto || 0), 0);
  const declarado = despesas ?? receita ?? cab.valor_total_plano;
  if (declarado != null && Math.abs(soma - declarado) >= 0.01) {
    warnings.push(
      `A soma das rubricas (${soma.toFixed(2)}) não bate com o total declarado ` +
      `no plano (${declarado.toFixed(2)}). Confira antes de salvar.`
    );
  }

  // DAO: o valor vem da própria rubrica quando ela existe.
  const linhaDao = rubricas.find(r => r.rubrica_code === 'dao');

  const data = {
    data_documento: extractDataDocumento(text),
    titulo: cab.titulo,
    coordenador: cab.coordenador,
    prazo_inicio: cab.prazo_inicio,
    prazo_fim: cab.prazo_fim,
    valor_total_plano: cab.valor_total_plano ?? receita ?? soma,
    valor_despesas_projeto: despesas,
    valor_cip: cab.valor_cip,
    valor_dao: linhaDao ? linhaDao.valor_previsto : null,
    receita_origem: null,
    rubricas,
    desembolsos: [],
  };

  if (data.prazo_inicio == null) warnings.push('Vigência não detectada — preencha as datas manualmente.');
  if (data.valor_cip == null)    warnings.push('Valor CIP não detectado — preencha manualmente se aplicável.');

  return { data, warnings };
}

// Helper exposto para teste/debug.
export const __internal = { toLines, mergeValoresOrfaos, recortarSecao, parseMesAno };

// ── Browser bridge ─────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.parsePtFromPdfText = parsePtFromPdfText;
}

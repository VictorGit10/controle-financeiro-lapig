/* ============================================================
   balancete-parser.js
   Parser determinístico para Balancete Contábil Analítico FUNAPE.
   Recebe o texto bruto extraído de um PDF (via pdf.js) e devolve
   o mesmo formato { data, warnings } que a Edge Function antiga
   (extract-balancete) — drop-in replacement, sem chamada de IA.

   Saída:
     {
       data: {
         project_code, data_referencia, data_emissao, periodo_inicio,
         saldo_disponivel, rendimento_liquido, total_debitos, total_creditos,
         lancamentos: [{ conta_codigo, conta_descricao,
                         valor_debito, valor_credito, saldo_atual }]
       },
       warnings: string[]
     }

   `saldo_atual` é a CONTRIBUIÇÃO AO GASTO (mig. 049): redutoras "( - )"
   de 7.1.3 e recuperações de despesa (7.1.1.08) entram negativas.
   ============================================================ */

import { parseBRL } from '../pure-fns.js';
import { FUNAPE_CONTAS } from './funape-contas.js';

// ── Regexes ────────────────────────────────────────────────

// "01/01/2000 a 13/04/2026" → data_referencia
const RE_DATA_REFERENCIA = /\b(\d{2})\/(\d{2})\/(\d{4})\s+a\s+(\d{2})\/(\d{2})\/(\d{4})\b/i;
// "Emissão: 15/04/2026 11:44"
const RE_DATA_EMISSAO    = /Emiss[ãa]o\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/i;
// Linhas de banco com project code, ex: "1.1.1.02.02.97404 97404 30.099 22813-3 BB/FU PROJETO ACE …"
const RE_PROJECT_CODE    = /^1\.1\.1\.02\.0[2-4]\.\d+\s+\S+\s+(\d{2}\.\d{3})\b/;
// Rodapé. O número termina nos centavos: o layout de 2026-09 fecha a
// frase com ponto ("R$ 1.107.372,93.") e `[\d.,]+` levaria o ponto junto.
const RE_SALDO_DISPONIVEL = /SALDO\s+DISPON[IÍ]VEL[\s\S]{0,200}?R\$\s*([\d.]*\d,\d{2})/i;
const RE_RENDIMENTO_LIQ   = /RENDIMENTO\s+L[IÍ]QUIDO\s+APURADO[\s\S]{0,80}?R\$\s*([\d.]*\d,\d{2})/i;
const RE_TOTAL_DEBITOS    = /TOTAL\s+DE\s+D[ÉE]BITOS\s*:\s*([\d.,()]+)/i;
const RE_TOTAL_CREDITOS   = /TOTAL\s+DE\s+CR[ÉE]DITOS\s*:\s*([\d.,()]+)/i;

// Linha tabular: <conta> <reduzido> <descrição...> <ant> <deb> <cred> <mov> <saldo>
// Aceita números no formato "1.234,56" ou "(1.234,56)" (negativo) ou "0,00"
const RE_LANCAMENTO = /^(\d+(?:\.\d+)+)\s+(\S+)\s+(.+?)\s+([(]?[\d.,]+[)]?)\s+([(]?[\d.,]+[)]?)\s+([(]?[\d.,]+[)]?)\s+([(]?[\d.,]+[)]?)\s+([(]?[\d.,]+[)]?)\s*$/;

// Folha de gasto: linhas 7.X.X.X.XX.XXXXX (6+ níveis = 5+ pontos).
// O balancete FUNAPE usa 4 níveis para a categoria (7.1.3.04 = Pessoa Física),
// 5 níveis para o subgrupo agregador (7.1.3.04.01 = mesma categoria, intermediário),
// e 6+ níveis para a linha real (7.1.3.04.01.09142 = BOLSA DOAÇÃO).
// Salvar 5 níveis duplicaria valores com seus filhos.
const RE_FOLHA_GASTO = /^7(?:\.\d+){5,}$/;

// Prefixos a IGNORAR mesmo sendo folhas: tributos sobre rendimento financeiro
// e despesas financeiras (IOF s/ recebimento). Não pertencem ao plano de
// trabalho — são automaticamente debitados pela conta de aplicação.
const PREFIXOS_IGNORAR = [
  '7.1.3.60.',  // IR/IOF s/ aplicação financeira
  '7.1.3.62.',  // DESPESAS FINANCEIRAS (IOF s/ recebimento)
];

function deveIgnorar(conta) {
  return PREFIXOS_IGNORAR.some((p) => conta.startsWith(p));
}

// ── Sinal ──────────────────────────────────────────────────
// `saldo_atual` é gravado como CONTRIBUIÇÃO AO GASTO: é o que as RPCs
// somam por rubrica (mig. 026/038/047).
//
// O valor sai das colunas Débitos e Créditos, NÃO da coluna Saldo: na
// linha-folha, a conta redutora imprime o Saldo sem parênteses, e só a
// conta-mãe revela que ele é subtraído. Despesa (7.1.3) é débito −
// crédito; receita (7.1.1) é crédito − débito. Assim:
//   • "( - ) FRETES S/ IMPORTAÇÕES" (débito 0, crédito 19.531,30) entra
//     negativo — somado, inflava `b` do 30.068 em R$ 80.737,60;
//   • "( - ) FÉRIAS" de pessoal CLT (débito 15.258,33) entra POSITIVO. O
//     "( - )" no nome não quer dizer redutora — a mig. 049 usava o nome e
//     errou o sinal desses encargos; a 050 conserta.
//
// Recuperação de despesa (7.1.1.08) é receita que estorna gasto: a
// FUNAPE reclassifica o equipamento (sai de 7.1.3.20, volta como doação
// em 7.1.3.50). Grava-se com sinal de gasto, ou seja, negativa.
function valorNoPdf(conta, debito, credito) {
  const d = Math.abs(debito ?? 0);
  const c = Math.abs(credito ?? 0);
  return conta.startsWith('7.1.1.') ? c - d : d - c;
}

function ehRecuperacao(conta) {
  return conta.startsWith('7.1.1.08.');
}

// Conta-mãe de 4 níveis (7.1.3.05). O total que o PDF imprime nela é o
// árbitro: se a soma das folhas não bate, alguma linha foi lida errado ou
// ficou de fora.
const RE_GRUPO_7 = /^7\.\d+\.\d+\.\d+$/;

function grupoDe(conta) {
  return conta.split('.').slice(0, 4).join('.');
}

// ── Código cortado ─────────────────────────────────────────
// Conta-folha tem 5 dígitos no último nível (7.1.3.05.01.00042). Menos
// que isso é corte do PDF, não código curto — ver funape-contas.js.
function ehCortada(conta) {
  return conta.split('.').pop().length < 5;
}

/**
 * Rubrica de uma conta cujo código veio cortado e cujo reduzido não está
 * na tabela. `mapa` é o conta_rubrica_map ativo ([{ conta_prefix,
 * rubrica_code }]).
 *
 * Se nenhuma regra é MAIS ESPECÍFICA que o pedaço visível, o
 * longest-prefix-match dá o mesmo resultado qualquer que seja o resto do
 * código — a rubrica é certa, não palpite (7.1.3.03.01.0… é `e` sempre).
 * Se existe regra escondida no pedaço cortado (7.1.3.05.01.0… pode ser
 * passagens, DAO ou `b`), a resposta é `ambigua` e a revisão pergunta.
 */
export function classificarContaCortada(conta, mapa) {
  const regras = Array.isArray(mapa) ? mapa : [];
  const ambigua = regras.some(m =>
    m.conta_prefix.length > conta.length && m.conta_prefix.startsWith(conta));
  if (ambigua) return { rubrica: null, ambigua: true };
  let melhor = null;
  for (const m of regras) {
    if (conta.startsWith(m.conta_prefix)
        && (!melhor || m.conta_prefix.length > melhor.conta_prefix.length)) melhor = m;
  }
  return { rubrica: melhor ? melhor.rubrica_code : null, ambigua: false };
}

function formatarValor(n) {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Helpers ────────────────────────────────────────────────

/** Converte "1.234,56" ou "(1.234,56)" em number; parênteses = negativo. */
function parseNum(s) {
  if (s == null) return null;
  const str = String(s).trim();
  if (!str) return null;
  const neg = str.startsWith('(') && str.endsWith(')');
  const clean = str.replace(/[()]/g, '');
  const n = parseBRL(clean);
  if (n == null) return null;
  return neg ? -n : n;
}

function isoFromDDMMYYYY(d, m, y) {
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function matchNum(text, regex) {
  const m = text.match(regex);
  if (!m) return null;
  const n = parseNum(m[1]);
  return n == null ? null : n;
}

// ── Parser principal ───────────────────────────────────────

export function parseBalanceteText(text) {
  const warnings = [];

  if (typeof text !== 'string' || text.length < 100) {
    return {
      data: emptyData(),
      warnings: ['Texto do PDF vazio ou muito curto.'],
    };
  }

  // Normaliza espaços em cada linha mas preserva quebras
  const rawLines = text.split(/\r?\n/);
  const lines = rawLines
    .map((l) => l.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean);

  // ── Datas ────────────────────────────────────────────────
  let data_referencia = null;
  let periodo_inicio = null;
  const mRef = text.match(RE_DATA_REFERENCIA);
  if (mRef) {
    periodo_inicio  = isoFromDDMMYYYY(mRef[1], mRef[2], mRef[3]);
    data_referencia = isoFromDDMMYYYY(mRef[4], mRef[5], mRef[6]);
  }

  let data_emissao = null;
  const mEm = text.match(RE_DATA_EMISSAO);
  if (mEm) data_emissao = isoFromDDMMYYYY(mEm[1], mEm[2], mEm[3]);

  // ── Project code ─────────────────────────────────────────
  let project_code = null;
  for (const line of lines) {
    const m = line.match(RE_PROJECT_CODE);
    if (m) { project_code = m[1]; break; }
  }

  // ── Rodapé ───────────────────────────────────────────────
  const saldo_disponivel   = matchNum(text, RE_SALDO_DISPONIVEL);
  const rendimento_liquido = matchNum(text, RE_RENDIMENTO_LIQ);
  const total_debitos      = matchNum(text, RE_TOTAL_DEBITOS);
  const total_creditos     = matchNum(text, RE_TOTAL_CREDITOS);

  // ── Lançamentos (apenas folhas 7.X.X.X.XXXXX) ───────────
  const lancamentos = [];
  const seen = new Set();
  const totaisGrupo = new Map();   // conta-mãe de 4 níveis → total impresso
  const somaFolhas  = new Map();   // conta-mãe de 4 níveis → soma das folhas lidas
  const desconhecidas = [];        // código cortado + reduzido fora da tabela
  for (const line of lines) {
    const m = line.match(RE_LANCAMENTO);
    if (!m) continue;
    const [, contaPdf, reduzido, descricao, , debitos, creditos, /*movimento*/, saldo] = m;
    if (RE_GRUPO_7.test(contaPdf)) {
      if (!totaisGrupo.has(contaPdf)) totaisGrupo.set(contaPdf, parseNum(saldo));
      continue;
    }
    if (!RE_FOLHA_GASTO.test(contaPdf)) continue;
    // Duplicata é a mesma linha repetida na quebra de página. A chave é o
    // reduzido: com o código cortado, contas diferentes ficam com o mesmo
    // "7.1.3.05.01.00" e a segunda seria descartada como repetida.
    const chave = /^\d+$/.test(reduzido) ? reduzido : contaPdf;
    if (seen.has(chave)) continue;
    seen.add(chave);

    const desc    = descricao.replace(/\s+/g, ' ').trim();

    let conta = contaPdf;
    let incompleta = false;
    const daTabela = FUNAPE_CONTAS[reduzido];
    if (ehCortada(contaPdf)) {
      if (daTabela && daTabela[0].startsWith(contaPdf)) {
        conta = daTabela[0];
      } else {
        incompleta = true;
        // Receita (7.1.1.01) não leva rubrica: fica marcada, mas não vira pergunta.
        if (!contaPdf.startsWith('7.1.1.01.')) {
          desconhecidas.push(`${contaPdf}… (reduzido ${reduzido}, ${desc})`);
        }
      }
    } else if (daTabela && daTabela[0] !== contaPdf) {
      warnings.push(`Reduzido ${reduzido} aparece como ${contaPdf}, mas a tabela da FUNAPE o registra como ${daTabela[0]}. Confira a linha "${desc}".`);
    }
    const debito  = parseNum(debitos);
    const credito = parseNum(creditos);
    // Valor na convenção do PDF — como a conta-mãe o soma…
    const noPdf   = Math.round(valorNoPdf(conta, debito, credito) * 100) / 100;
    const g = grupoDe(conta);
    somaFolhas.set(g, (somaFolhas.get(g) || 0) + noPdf);

    if (deveIgnorar(conta)) continue;

    lancamentos.push({
      conta_codigo:    conta,
      conta_descricao: desc || null,
      valor_debito:    debito  == null ? 0 : Math.abs(debito),
      valor_credito:  credito == null ? 0 : Math.abs(credito),
      // …e como contribuição ao gasto, que é o que se grava.
      saldo_atual:    ehRecuperacao(conta) ? -Math.abs(noPdf) : noPdf,
      conta_reduzido: reduzido,
      conta_incompleta: incompleta,
    });
  }
  if (desconhecidas.length > 0) {
    warnings.push(`Código de conta cortado no PDF e fora da tabela da FUNAPE: ${desconhecidas.join('; ')}. A rubrica dessas linhas é conferida na revisão.`);
  }

  // ── Sanity checks → warnings ─────────────────────────────
  if (!data_referencia) {
    warnings.push('Data de referência não detectada — preencha manualmente.');
  }
  if (!project_code) {
    warnings.push('Código do projeto (XX.XXX) não detectado no PDF — selecione o projeto manualmente.');
  }
  if (lancamentos.length === 0) {
    warnings.push('Nenhum lançamento de despesa (7.x) foi extraído — confira o documento.');
  }
  if (saldo_disponivel == null) {
    warnings.push('SALDO DISPONÍVEL não encontrado no rodapé.');
  }
  if (rendimento_liquido == null) {
    warnings.push('RENDIMENTO LÍQUIDO APURADO não encontrado no rodapé.');
  }
  // Só confere a conta-mãe cujas folhas foram lidas: um extrato parcial
  // (sem a linha-mãe, ou sem as folhas) não tem com o que comparar.
  for (const [g, impresso] of totaisGrupo) {
    if (impresso == null || !somaFolhas.has(g)) continue;
    const soma = Math.round(somaFolhas.get(g) * 100) / 100;
    if (Math.abs(soma - impresso) > 0.01) {
      warnings.push(`Conta ${g}: as contas-folha somam ${formatarValor(soma)}, mas o balancete imprime ${formatarValor(impresso)} — algum valor ou sinal foi lido errado. Confira antes de salvar.`);
    }
  }
  if (total_debitos != null && total_creditos != null) {
    const diff = Math.abs(total_debitos - total_creditos);
    if (diff > 1) {
      warnings.push(`Total de débitos (${total_debitos}) difere do total de créditos (${total_creditos}).`);
    }
  }

  return {
    data: {
      project_code,
      data_referencia,
      data_emissao,
      periodo_inicio,
      saldo_disponivel,
      rendimento_liquido,
      total_debitos,
      total_creditos,
      lancamentos,
    },
    warnings,
  };
}

function emptyData() {
  return {
    project_code: null,
    data_referencia: null,
    data_emissao: null,
    periodo_inicio: null,
    saldo_disponivel: null,
    rendimento_liquido: null,
    total_debitos: null,
    total_creditos: null,
    lancamentos: [],
  };
}

// ── Browser bridge ─────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.parseBalanceteText = parseBalanceteText;
  window.classificarContaCortada = classificarContaCortada;
}

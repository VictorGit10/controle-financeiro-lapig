/* ============================================================
   pt-rubrica-lookup.js
   Aliases canônicos para mapear o nome da rubrica (livre, vindo
   do DOCX do Plano de Trabalho) para o rubrica_code estável.

   Catálogo de códigos válidos (espelha frontend/js/pages/plano-trabalho.js):
     a, a.colab, a.enc, a.cons, a.estag, a.bolsas, a.outros,
     b, c, d, e, f, g, cip_ufg, cip_ua, dao
   ============================================================ */

/** Normaliza para comparação: minúsculas, sem acento, sem espaços duplos. */
export function normalizeForLookup(s) {
  if (s == null) return '';
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acentos
    .toLowerCase()
    .replace(/[^a-z0-9\s./()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Aliases exatos (após normalização). Match-first.
const ALIAS_TO_CODE = [
  // sub-rubricas de "a-Pessoal"
  { match: ['bolsas', 'bolsa', 'bolsas de pesquisa', 'bolsa doacao', 'bolsas de doacao'], code: 'a.bolsas' },
  { match: ['colaboradores eventuais', 'colaboradores eventuais (pessoal clt)', 'pessoal clt', 'colaboradores clt'], code: 'a.colab' },
  { match: ['encargos s/ clt', 'encargos s clt', 'encargos sobre clt', 'encargos s/ clt (= 83 %)', 'encargos s/ folha'], code: 'a.enc' },
  { match: ['consultorias', 'consultorias (stpf - rpa)', 'consultorias stpf-rpa', 'consultorias stpf rpa', 'consultorias (stpf - rpa) + encargos s/ servicos (20% inss s/ rpa)'], code: 'a.cons' },
  { match: ['estagiarios', 'estagiarios bolsistas'], code: 'a.estag' },
  { match: ['outros encargos', 'outros encargos sobre pessoal'], code: 'a.outros' },

  // CIP / DAO (quando aparecem nominalmente como linha)
  { match: ['cip ufg', 'cip - ufg', 'cip — ufg', 'custos indiretos ufg', 'custos indiretos para a ufg', 'custos indiretos para ufg'], code: 'cip_ufg' },
  { match: ['cip ua', 'cip - ua', 'cip — ua', 'cip ua/orgao', 'custos indiretos para a ua', 'custos indiretos ua', 'custos indiretos para a ua/orgao'], code: 'cip_ua' },
  { match: ['dao', 'd.a.o', 'd.a.o.', 'd.a.o. da fundacao', 'dao da fundacao', 'despesas administrativas e operacionais', 'despesas administrativas e operacionais da fundacao'], code: 'dao' },

  // Doação (sob g)
  { match: ['ganho economico', 'ganho economico*', 'ganhos economicos'], code: 'g' },
];

/**
 * Resolve um nome livre de rubrica + a letra do pai (top-level a–h)
 * para um RubricaItem { rubrica_code, descricao_livre, valor_previsto:0 }.
 * `valor_previsto` é zero aqui; o caller atribui o valor real depois.
 */
export function lookupRubrica(rawName, parentLetter) {
  const norm = normalizeForLookup(rawName);
  if (!norm) {
    return {
      rubrica_code: parentLetter ? (parentLetter === 'h' ? 'g' : parentLetter) : 'b',
      descricao_livre: null,
      valor_previsto: 0,
      _fallback: true,
      _raw_name: rawName,
    };
  }

  // Tenta match exato e match prefix entre os aliases.
  for (const a of ALIAS_TO_CODE) {
    for (const m of a.match) {
      if (norm === m || norm.startsWith(m + ' ') || norm.endsWith(' ' + m)) {
        return {
          rubrica_code: a.code,
          descricao_livre: null,
          valor_previsto: 0,
        };
      }
    }
  }

  // Fallback baseado no top-level:
  //   - Sub de 'b', 'e', 'f' → herda code do pai com descricao_livre.
  //   - Sob 'a' sem alias    → 'a.outros' (último recurso).
  //   - Sem pai conhecido   → 'b' (fallback geral) com aviso.
  const top = (parentLetter || '').toLowerCase();
  if (top === 'a') {
    return {
      rubrica_code: 'a.outros',
      descricao_livre: rawName,
      valor_previsto: 0,
      _fallback: true,
      _raw_name: rawName,
    };
  }
  if (['b', 'c', 'd', 'e', 'f', 'g', 'h'].includes(top)) {
    return {
      rubrica_code: top === 'h' ? 'g' : top,
      descricao_livre: rawName,
      valor_previsto: 0,
    };
  }

  // Sem pai conhecido — fallback genérico com aviso.
  return {
    rubrica_code: 'b',
    descricao_livre: rawName,
    valor_previsto: 0,
    _fallback: true,
    _raw_name: rawName,
  };
}

// Sobrescreve `valor_previsto` no resultado de lookupRubrica.
// (Mantido em utilidade caso o caller queira encadear, não usado hoje.)
export function withValor(item, valor) {
  return { ...item, valor_previsto: valor };
}

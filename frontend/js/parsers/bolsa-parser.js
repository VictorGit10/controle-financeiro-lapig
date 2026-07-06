/* ============================================================
   bolsa-parser.js
   Parser determinístico para planilha de bolsas FUNAPE (.xlsx).
   Recebe um ArrayBuffer do arquivo XLSX e devolve dados
   estruturados no formato { data, warnings }.

   Colunas esperadas (planilha FUNAPE):
     Nome, CPF, E-mail, Tipo, Formação, Duração,
     Pagamento Automático, Status, Valor,
     Total de Bolsas, Bolsas pagas/em aberto
   ============================================================ */

import { parseBRL } from '../pure-fns.js';

// ── Mapeamento de headers da planilha → chaves canônicas ────

const HEADER_ALIASES = {
  nome:                ['nome'],
  cpf:                 ['cpf'],
  email:               ['e-mail', 'email'],
  tipo:                ['tipo'],
  formacao:            ['formação', 'formacao'],
  duracao:             ['duração', 'duracao'],
  pagamento_automatico: ['pagamento automático', 'pagamento automatico'],
  status_funape:       ['status'],
  valor:               ['valor'],
  total_bolsas:        ['total de bolsas'],
  bolsas_pagas:        ['bolsas pagas/em aberto'],
};

// ── Funções auxiliares ──────────────────────────────────────

/** Normaliza string para lookup: lowercase, sem acentos, trim */
function normalizeHeader(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove formatação do CPF → só dígitos (11 chars) */
function normalizeCPF(raw) {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11) return digits;
  // CPF pode vir como número (ex: 13626629767) — já são 11 dígitos
  if (digits.length >= 11) return digits.slice(0, 11);
  return null; // inválido
}

/** Formata CPF para exibição: XXX.XXX.XXX-XX */
function formatCPF(digits) {
  if (!digits || digits.length !== 11) return '';
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

/** Parse do campo Duração: "01/04/2026 / 31/12/2026" → { inicio, fim } */
function parseDuracao(raw) {
  if (raw == null) return { inicio: null, fim: null };

  // Formato esperado: "DD/MM/YYYY / DD/MM/YYYY"
  const str = String(raw).trim();

  // Se for um número (serial date do Excel), converter
  if (/^\d+$/.test(str) && Number(str) > 40000) {
    const d = new Date((Number(str) - 25569) * 86400000);
    const iso = d.toISOString().substring(0, 10);
    return { inicio: iso, fim: iso };
  }

  // Regex: extrair as duas datas DD/MM/YYYY separadas por " / "
  const match = str.match(/(\d{2}\/\d{2}\/\d{4})\s*\/\s*(\d{2}\/\d{2}\/\d{4})/);
  if (match) {
    return { inicio: parseDDMMYYYY(match[1]), fim: parseDDMMYYYY(match[2]) };
  }

  // Tentar formato único "DD/MM/YYYY a DD/MM/YYYY"
  const matchA = str.match(/(\d{2}\/\d{2}\/\d{4})\s*[aà]\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (matchA) {
    return { inicio: parseDDMMYYYY(matchA[1]), fim: parseDDMMYYYY(matchA[2]) };
  }

  return { inicio: null, fim: null };
}

/** Converte "DD/MM/YYYY" → "YYYY-MM-DD" */
function parseDDMMYYYY(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Status da FUNAPE que significam "bolsa ativa" para comparação */
const ACTIVE_STATUSES = ['ativo', 'aguardando aditamento', 'aguardando preenchimento do bolsista'];

function isAtivoFunape(status) {
  if (!status) return false;
  const s = String(status).trim().toLowerCase();
  return ACTIVE_STATUSES.some(a => s.includes(a));
}

// ── Parser principal ────────────────────────────────────────

/**
 * parseBolsaSpreadsheet(arrayBuffer)
 * @param {ArrayBuffer} arrayBuffer - Conteúdo do arquivo .xlsx
 * @returns {{ data: Array<Object>, warnings: string[] }}
 */
function parseBolsaSpreadsheet(arrayBuffer) {
  const warnings = [];

  if (typeof XLSX === 'undefined') {
    return { data: [], warnings: ['Biblioteca XLSX (SheetJS) não encontrada. Verifique se o CDN carregou corretamente.'] };
  }

  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { data: [], warnings: ['Planilha vazia — nenhuma aba encontrada.'] };
  }

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (rawRows.length === 0) {
    return { data: [], warnings: ['Planilha vazia — nenhuma linha de dados encontrada.'] };
  }

  // Mapear headers da planilha para chaves canônicas
  const rawHeaders = Object.keys(rawRows[0]);
  const headerMap = {};

  for (const rawH of rawHeaders) {
    const norm = normalizeHeader(rawH);
    for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(norm) || norm.includes(aliases[0])) {
        headerMap[rawH] = canonical;
        break;
      }
    }
    // Se não mapeou, ignorar silenciosamente
  }

  // Verificar se mapeamos o mínimo necessário
  const mappedCanonicals = new Set(Object.values(headerMap));
  const requiredKeys = ['nome', 'valor', 'duracao'];
  for (const key of requiredKeys) {
    if (!mappedCanonicals.has(key)) {
      warnings.push(`Coluna obrigatória não encontrada: "${key}". Verifique se a planilha está no formato FUNAPE.`);
    }
  }

  if (warnings.length > 0) {
    return { data: [], warnings };
  }

  // Parsear cada linha
  const data = [];
  let skippedNonActive = 0;

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];

    // Mapear valores usando headerMap
    const mapped = {};
    for (const [rawH, canonical] of Object.entries(headerMap)) {
      mapped[canonical] = row[rawH];
    }

    // Nome obrigatório
    const nome = String(mapped.nome || '').trim();
    if (!nome) continue;

    // CPF
    const cpfRaw = mapped.cpf || null;
    const cpf = normalizeCPF(cpfRaw);

    // Duração
    const duracao = parseDuracao(mapped.duracao);

    // Valor
    const valorRaw = mapped.valor;
    let valor;
    if (typeof valorRaw === 'number') {
      valor = valorRaw;
    } else {
      valor = parseBRL(String(valorRaw));
    }

    // Status FUNAPE
    const statusFunape = String(mapped.status_funape || '').trim();

    // Filtrar: só incluir bolsas ativas ou aguardando para comparação
    if (!isAtivoFunape(statusFunape)) {
      skippedNonActive++;
      continue;
    }

    // Se data de início ou fim não foram parseadas, warning
    if (!duracao.inicio) {
      warnings.push(`Linha ${i + 2}: data de início não reconhecida em "${mapped.duracao}".`);
    }
    if (!duracao.fim) {
      warnings.push(`Linha ${i + 2}: data de fim não reconhecida em "${mapped.duracao}".`);
    }
    if (valor == null || valor <= 0) {
      warnings.push(`Linha ${i + 2}: valor não reconhecido em "${valorRaw}".`);
    }

    data.push({
      nome,
      cpf,                                     // 11 dígitos ou null
      cpf_display: cpf ? formatCPF(cpf) : (cpfRaw ? String(cpfRaw) : ''),
      email: String(mapped.email || '').trim(),
      tipo: String(mapped.tipo || '').trim(),
      formacao: String(mapped.formacao || '').trim(),
      duracao_inicio: duracao.inicio,           // ISO date
      duracao_fim: duracao.fim,                  // ISO date
      pagamento_automatico: String(mapped.pagamento_automatico || '').trim(),
      status_funape: statusFunape,
      valor,                                    // numeric
      total_bolsas: parseInt(mapped.total_bolsas, 10) || null,
      bolsas_pagas: parseInt(mapped.bolsas_pagas, 10) || null,
      _rowIndex: i + 2,                          // 1-indexed (linha na planilha)
    });
  }

  if (skippedNonActive > 0) {
    warnings.push(`${skippedNonActive} bolsas com status diferente de "Ativo" foram ignoradas (Encerrado, etc.).`);
  }

  return { data, warnings };
}

// ── Browser bridge ─────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.parseBolsaSpreadsheet = parseBolsaSpreadsheet;
}
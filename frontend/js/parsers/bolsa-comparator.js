/* ============================================================
   bolsa-comparator.js
   Módulo de comparação para Reconciliação de Bolsas.
   Compara dados parseados da planilha FUNAPE com bolsas
   existentes no banco e categoriza as diferenças.

   Saída:
     {
       novos:    Array — bolsas na planilha mas NÃO no banco
       removidos: Array — bolsas no banco mas NÃO na planilha
       alterados: Array — mesmo bolsista, dados divergentes
       iguais:    Array — match exato, sem ação necessária
     }
   ============================================================ */

// ── Funções auxiliares de normalização ──────────────────────

/** Normaliza nome para matching: lowercase, sem acentos, espaços colapsados */
function normalizeName(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compara duas datas ISO como strings (YYYY-MM-DD) */
function datesEqual(a, b) {
  if (a == null && b == null) return true;
  return a === b;
}

/** Compara valores numéricos com tolerância de 1 centavo */
function amountsEqual(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.01;
}

/** Compara strings de tipo de bolsa (normalizadas) */
function typesEqual(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  // Se ambos vazios, consideramos igual
  if (!na && !nb) return true;
  return na === nb;
}

// ── Comparator principal ────────────────────────────────────

/**
 * compareBolsaData(spreadsheetRows, dbScholarships, allHolders)
 *
 * @param {Array} spreadsheetRows - Dados parseados da planilha (output do bolsa-parser)
 *   Cada item: { nome, cpf, email, tipo, formacao, duracao_inicio, duracao_fim, valor, ... }
 *
 * @param {Array} dbScholarships - Bolsas ativas do PROJETO vindas do Supabase
 *   Cada item: { holder_id, full_name, cpf, email, education_level,
 *                scholarship_id, amount, start_date, end_date, status, scholarship_type }
 *
 * @param {Array} [allHolders] - TODOS os bolsistas cadastrados (universo global), para
 *   evitar criar holders duplicados quando a pessoa já existe via outro projeto.
 *   Cada item: { id, full_name, cpf, email, education_level }
 *
 * @returns {{ novos: Array, removidos: Array, alterados: Array, iguais: Array }}
 *   novos: cada item carrega `existingHolderId` (id do holder se a pessoa já existe
 *   globalmente — "vínculo" — ou null se for pessoa realmente nova) e `matchKind`
 *   ('link' | 'new'), além dos backfills `cpfNew` / `nameNew` / `formacaoNew`.
 */
function compareBolsaData(spreadsheetRows, dbScholarships, allHolders) {
  const novos = [];
  const removidos = [];
  const alterados = [];
  const iguais = [];

  // ── Construir lookups do banco ───────────────────────────

  // Map: cpf (dígitos) → array de { holder, scholarship }
  const cpfMap = new Map();
  // Map: nome normalizado → array de { holder, scholarship }
  const nameMap = new Map();

  for (const db of dbScholarships) {
    const entry = { holder: db, scholarship: db };

    if (db.cpf) {
      if (!cpfMap.has(db.cpf)) cpfMap.set(db.cpf, []);
      cpfMap.get(db.cpf).push(entry);
    }

    const nName = normalizeName(db.full_name);
    if (nName) {
      if (!nameMap.has(nName)) nameMap.set(nName, []);
      nameMap.get(nName).push(entry);
    }
  }

  // ── Lookups GLOBAIS de holders (universo todo, não só este projeto) ──
  // Usados para detectar pessoas que já existem via outro projeto e evitar
  // criar holders duplicados. Match por CPF tem prioridade sobre nome.
  const globalCpfMap = new Map();
  const globalNameMap = new Map();
  for (const h of (allHolders || [])) {
    if (h.cpf && !globalCpfMap.has(h.cpf)) globalCpfMap.set(h.cpf, h);
    const nName = normalizeName(h.full_name);
    if (nName) {
      if (!globalNameMap.has(nName)) globalNameMap.set(nName, []);
      globalNameMap.get(nName).push(h);
    }
  }

  /** Resolve um holder existente no universo global (CPF → nome). */
  function resolveGlobalHolder(ssRow) {
    if (ssRow.cpf && globalCpfMap.has(ssRow.cpf)) {
      return { holder: globalCpfMap.get(ssRow.cpf), method: 'cpf' };
    }
    const nName = normalizeName(ssRow.nome);
    if (nName && globalNameMap.has(nName)) {
      const candidates = globalNameMap.get(nName);
      // Só vincula automaticamente quando há um único holder com esse nome
      // (nomes homônimos ficam como pessoa nova para revisão manual).
      if (candidates.length === 1) return { holder: candidates[0], method: 'name' };
    }
    return null;
  }

  // ── Rastrear quais bolsas do banco foram "claimed" por um match ──
  const claimedScholarshipIds = new Set();

  // ── Step 1: Para cada linha da planilha, tentar matching ─────

  const matchedPairs = []; // { ssRow, dbEntry, matchMethod }

  for (const ssRow of spreadsheetRows) {
    let matchedEntry = null;
    let matchMethod = null;

    // Tier 1: Match por CPF exato
    if (ssRow.cpf && cpfMap.has(ssRow.cpf)) {
      const candidates = cpfMap.get(ssRow.cpf);
      // Pegar a primeira bolsa não-claimada deste holder
      matchedEntry = candidates.find(c => !claimedScholarshipIds.has(c.scholarship.scholarship_id));
      if (matchedEntry) {
        matchMethod = 'cpf';
        claimedScholarshipIds.add(matchedEntry.scholarship.scholarship_id);
      }
    }

    // Tier 2: Match por nome normalizado
    if (!matchedEntry) {
      const nName = normalizeName(ssRow.nome);
      if (nName && nameMap.has(nName)) {
        const candidates = nameMap.get(nName);
        matchedEntry = candidates.find(c => !claimedScholarshipIds.has(c.scholarship.scholarship_id));
        if (matchedEntry) {
          matchMethod = 'name';
          claimedScholarshipIds.add(matchedEntry.scholarship.scholarship_id);
        }
      }
    }

    if (matchedEntry) {
      matchedPairs.push({ ssRow, dbEntry: matchedEntry, matchMethod });
    } else {
      // Não há bolsa desta pessoa NESTE projeto. Antes de tratar como pessoa
      // nova, resolver no universo global de holders para evitar duplicados.
      const global = resolveGlobalHolder(ssRow);
      if (global) {
        const h = global.holder;
        const nameNew = ssRow.nome && normalizeName(ssRow.nome) !== normalizeName(h.full_name)
          ? ssRow.nome
          : (ssRow.nome && ssRow.nome.trim() !== String(h.full_name || '').trim() ? ssRow.nome : null);
        novos.push({
          ...ssRow,
          matchKind: 'link',
          matchMethod: global.method,
          existingHolderId: h.id,
          existingHolderName: h.full_name,
          cpfNew: ssRow.cpf && !h.cpf ? ssRow.cpf : null,
          nameNew,
          formacaoNew: ssRow.formacao && !h.education_level ? ssRow.formacao : null,
        });
      } else {
        // Pessoa realmente nova — não existe em nenhum projeto
        novos.push({
          ...ssRow,
          matchKind: 'new',
          matchMethod: null,
          existingHolderId: null,
        });
      }
    }
  }

  // ── Step 2: Bolsas no banco sem match na planilha → removidos ──

  for (const db of dbScholarships) {
    if (!claimedScholarshipIds.has(db.scholarship_id)) {
      removidos.push({
        holder_id: db.holder_id,
        holder_name: db.full_name,
        holder_cpf: db.cpf || '',
        scholarship_id: db.scholarship_id,
        amount: db.amount,
        start_date: db.start_date,
        end_date: db.end_date,
        scholarship_type: db.scholarship_type || '',
      });
    }
  }

  // ── Step 3: Classificar matched pairs em alterados ou iguais ──

  for (const { ssRow, dbEntry, matchMethod } of matchedPairs) {
    const dbSch = dbEntry.scholarship;
    const dbHolder = dbEntry.holder;

    // Comparar campos relevantes
    const changes = [];

    // Nome: planilha FUNAPE é fonte da verdade. Sinaliza divergência mesmo
    // quando o match foi por CPF (nome cadastrado pode estar diferente).
    const ssNome = String(ssRow.nome || '').trim();
    const dbNome = String(dbHolder.full_name || '').trim();
    const nameNew = ssNome && ssNome !== dbNome ? ssNome : null;
    if (nameNew) {
      changes.push({ field: 'full_name', label: 'Nome', spreadsheet: ssNome, database: dbNome });
    }

    if (!amountsEqual(ssRow.valor, dbSch.amount)) {
      changes.push({ field: 'amount', label: 'Valor Mensal', spreadsheet: ssRow.valor, database: dbSch.amount });
    }
    if (!datesEqual(ssRow.duracao_inicio, dbSch.start_date)) {
      changes.push({ field: 'start_date', label: 'Data Início', spreadsheet: ssRow.duracao_inicio, database: dbSch.start_date });
    }
    if (!datesEqual(ssRow.duracao_fim, dbSch.end_date)) {
      changes.push({ field: 'end_date', label: 'Data Fim', spreadsheet: ssRow.duracao_fim, database: dbSch.end_date });
    }
    if (!typesEqual(ssRow.tipo, dbSch.scholarship_type)) {
      changes.push({ field: 'scholarship_type', label: 'Tipo', spreadsheet: ssRow.tipo, database: dbSch.scholarship_type || '' });
    }

    // CPF novo (planilha tem, banco não)
    const cpfNew = ssRow.cpf && !dbHolder.cpf;
    // Formação nova (planilha tem, banco não)
    const formacaoNew = ssRow.formacao && !dbHolder.education_level;

    if (changes.length > 0 || cpfNew || formacaoNew) {
      alterados.push({
        matchMethod,
        holder_id: dbHolder.holder_id,
        holder_name: dbHolder.full_name,
        holder_cpf: dbHolder.cpf || '',
        scholarship_id: dbSch.scholarship_id,
        changes,
        cpfNew: cpfNew ? ssRow.cpf : null,
        nameNew,
        formacaoNew: formacaoNew ? ssRow.formacao : null,
        spreadsheet: {
          nome: ssRow.nome,
          cpf: ssRow.cpf || '',
          email: ssRow.email,
          tipo: ssRow.tipo,
          formacao: ssRow.formacao,
          duracao_inicio: ssRow.duracao_inicio,
          duracao_fim: ssRow.duracao_fim,
          valor: ssRow.valor,
        },
        database: {
          amount: dbSch.amount,
          start_date: dbSch.start_date,
          end_date: dbSch.end_date,
          scholarship_type: dbSch.scholarship_type || '',
        },
      });
    } else {
      iguais.push({
        matchMethod,
        holder_name: dbHolder.full_name,
        holder_cpf: dbHolder.cpf || '',
        amount: dbSch.amount,
        start_date: dbSch.start_date,
        end_date: dbSch.end_date,
      });
    }
  }

  return { novos, removidos, alterados, iguais };
}

// ── Browser bridge ─────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.compareBolsaData = compareBolsaData;
}
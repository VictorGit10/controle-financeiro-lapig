/* ============================================================
   pt-model-detect.js
   Detector do MODELO de um Plano de Trabalho.

   Entrada:  texto plano do documento (vindo do HTML do mammoth,
             do text layer do pdf.js ou do CSV do SheetJS).
   Saída:    { id, label, isPlano, message }

   Serve a dois propósitos:

   1. Mensagem de erro precisa. Sem isso o usuário recebe
      "tabela não encontrada" e não sabe se o arquivo está
      corrompido, se é o documento errado ou se é só um modelo
      que o leitor automático não cobre.

   2. Roteamento por conteúdo. Um Plano de Trabalho em PDF cai
      no handler de balancete (ambos são .pdf); o detector
      permite devolvê-lo ao handler de plano.

   Só o modelo `proad` é lido automaticamente (pt-parser.js).
   Os demais existem para nomear a exceção e mandar o usuário
   ao preenchimento manual — a tabela de rubricas deles não tem
   equivalência mecânica com o catálogo interno.
   ============================================================ */

/** Normaliza texto de documento p/ comparação: minúsculas, sem acento, espaços colapsados. */
export function normalizeDocText(s) {
  if (s == null) return '';
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const MANUAL_HINT = 'Use "Preencher manualmente" para cadastrar os valores com o documento ao lado.';

// Ordem importa: o primeiro `test` que casar vence.
// `proad` vem primeiro de propósito — um plano da FAPEG que use a
// tabela canônica (acontece: FUNAPE costuma ser interveniente) deve
// ser tratado como PROAD, porque a estrutura é a que sabemos ler.
const MODELOS = [
  {
    id: 'proad',
    label: 'Plano de Trabalho padrão PROAD/UFG',
    isPlano: true,
    test: (t) => t.includes('plano de aplicacao dos recursos financeiros'),
    // Só vira mensagem de erro no caso de borda em que o título existe no
    // texto mas fora de uma tabela (PDF, ou DOCX com a tabela como imagem).
    message:
      'O documento é do padrão PROAD/UFG, mas a tabela "Plano de Aplicação ' +
      'dos Recursos Financeiros" não pôde ser lida como tabela — isso ' +
      'acontece com PDF e com DOCX em que ela foi colada como imagem. ' +
      MANUAL_HINT,
  },
  {
    id: 'fapeg-adequacao',
    label: 'Adequação de Plano de Trabalho (FAPEG — formulários FOR-001…007)',
    isPlano: true,
    test: (t) =>
      t.includes('adequacao de plano de trabalho') ||
      /\bfor\s*[-–—]\s*00[1-7]\b/.test(t),
    message:
      'Documento no modelo de Adequação de Plano de Trabalho da FAPEG ' +
      '(formulários FOR-001 a FOR-007), não o padrão PROAD/UFG. ' +
      'As rubricas ficam nas abas "5_Custeio" (Pessoal, Outros Serviços de ' +
      'Terceiros - PJ, Passagens, Hospedagem e Alimentação, Material de ' +
      'Consumo) e "6_Bens Duráveis" (→ f — Investimento). ' + MANUAL_HINT,
  },
  {
    id: 'prefeitura-fomento',
    label: 'Termo de Fomento / Termo de Colaboração (emenda impositiva)',
    isPlano: true,
    test: (t) =>
      (t.includes('termo de fomento') || t.includes('termo de colaboracao')) &&
      (/emenda\w*\s*impositiva/.test(t) || t.includes('plano de trabalho')),
    message:
      'Documento no modelo Termo de Fomento / Termo de Colaboração ' +
      '(emenda parlamentar impositiva), não o padrão PROAD/UFG. ' +
      'Esse modelo não tem tabela de rubricas: os gastos ficam em ' +
      '"10. Custos" (texto livre, sem código de rubrica) e as parcelas em ' +
      '"16. Cronograma de Desembolso". ' + MANUAL_HINT,
  },
  {
    id: 'fapeg-plano',
    label: 'Plano de Trabalho FAPEG',
    isPlano: true,
    test: (t) =>
      t.includes('fundacao de amparo a pesquisa do estado de goias') &&
      t.includes('plano de trabalho'),
    message:
      'Documento parece ser um Plano de Trabalho da FAPEG fora do padrão ' +
      'PROAD/UFG (sem a tabela "Plano de Aplicação dos Recursos ' +
      'Financeiros"). ' + MANUAL_HINT,
  },
];

const DESCONHECIDO = {
  id: 'desconhecido',
  label: 'Modelo não reconhecido',
  isPlano: false,
  message:
    'Não foi possível reconhecer o modelo do documento — a tabela ' +
    '"Plano de Aplicação dos Recursos Financeiros" não foi encontrada. ' +
    'Confira se é mesmo um Plano de Trabalho. ' + MANUAL_HINT,
};

/**
 * Identifica o modelo do documento a partir do seu texto.
 * Nunca lança: texto vazio ou irreconhecível devolve `desconhecido`.
 */
export function detectPtModel(text) {
  const t = normalizeDocText(text);
  if (!t) return DESCONHECIDO;
  for (const m of MODELOS) {
    if (m.test(t)) {
      return { id: m.id, label: m.label, isPlano: m.isPlano, message: m.message };
    }
  }
  return DESCONHECIDO;
}

// Helper exposto para teste/debug.
export const __internal = { MODELOS, DESCONHECIDO };

// ── Browser bridge ─────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.detectPtModel = detectPtModel;
}

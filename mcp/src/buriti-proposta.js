// Parte PURA do Buriti: PDF → texto → proposta. Não fala com o banco, para
// rodar em lote local (scripts/propor-balancetes-local.js) e nos testes da
// raiz — que no CI não instalam as dependências do MCP.
//
// Uma implementação só: mesma montagem de texto (pdf-texto.js) e MESMO
// parser (balancete-parser.js) da importação do site.

import { textoDaPagina } from '../../frontend/js/parsers/pdf-texto.js';
import { parseBalanceteText, classificarContaCortada } from '../../frontend/js/parsers/balancete-parser.js';
import { SUGESTOES } from './buriti-sugestoes.js';

/**
 * pdf.js só é carregado quando um PDF chega. Ao carregar, ele avisa por
 * console.log (falta do pacote `canvas`, que só serve para desenhar) — em
 * stdout, que é o canal do protocolo MCP. index.js desvia console.log para
 * stderr; o import tardio mantém as tools de leitura sem esse peso.
 */
let pdfjsLib = null;
async function pdfjs() {
  if (!pdfjsLib) pdfjsLib = (await import('pdfjs-dist/legacy/build/pdf.js')).default;
  return pdfjsLib;
}

/** PDF → texto, exatamente como o site monta (pdf-texto.js). */
export async function textoDoPdf(bytes) {
  const lib = await pdfjs();
  const pdf = await lib.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  let full = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    full += textoDaPagina((await page.getTextContent()).items) + '\n';
  }
  return full.trim();
}

const BRL = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
export const DATA = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');

/**
 * Monta a proposta de um balancete a partir do texto. Pura: não fala com
 * o banco, para poder rodar em lote local (scripts/propor-balancetes-local.js).
 *
 * `mapa` é o conta_rubrica_map ativo; sem ele, a dica pelo prefixo some e
 * só ficam as sugestões da semente.
 *
 * `sugestoes` ([{ reduzido, rubrica, item?, justificativa }]) é o julgamento do
 * próprio Buriti — tirado do caderno de decisões dele — e vence a semente,
 * que é só reserva. Ordem: agente > semente > prefixo > nenhuma.
 */
export function montarPropostaBalancete({ texto, arquivoNome, mapa = [], sugestoes = [] }) {
  const doAgente = {};
  (sugestoes || []).forEach((s) => {
    if (s && s.reduzido && s.rubrica) doAgente[String(s.reduzido)] = s;
  });
  const extraido = parseBalanceteText(texto);
  const d = extraido.data;
  const problemas = [];
  if (!d.project_code) problemas.push('Código do centro de custo não encontrado no PDF.');
  if (!d.data_referencia) problemas.push('Data de referência não encontrada no PDF.');

  // Perguntas de classificação: código cortado + reduzido fora da tabela.
  // Receita (7.1.1.01) não leva rubrica — mesma regra da revisão no site.
  const perguntas = d.lancamentos
    .filter((l) => l.conta_incompleta && !l.conta_codigo.startsWith('7.1.1.01.'))
    .map((l) => {
      const agente = doAgente[l.conta_reduzido];
      const semente = SUGESTOES[l.conta_reduzido];
      const dica = classificarContaCortada(l.conta_codigo, mapa);
      let sugestao = null;
      if (agente) {
        sugestao = { rubrica: agente.rubrica, item: agente.item || null, justificativa: agente.justificativa || '', fonte: 'buriti' };
      } else if (semente) {
        sugestao = { rubrica: semente.rubrica, item: semente.item || null, justificativa: semente.justificativa, fonte: 'semente' };
      } else if (!dica.ambigua && dica.rubrica) {
        sugestao = {
          rubrica: dica.rubrica,
          justificativa: `Pelo trecho visível do código (${l.conta_codigo}…), nenhuma regra mais específica do mapa se aplica.`,
          fonte: 'prefixo',
        };
      }
      return {
        conta: l.conta_codigo,
        reduzido: l.conta_reduzido,
        descricao: l.conta_descricao,
        valor: l.saldo_atual,
        ambigua: dica.ambigua,
        sugestao,
      };
    });

  // O aviso do parser sobre contas cortadas já está nas perguntas.
  const avisos = extraido.warnings.filter((w) => !w.startsWith('Código de conta cortado'));
  const contasMaeFecham = !avisos.some((w) => /^Conta 7\./.test(w));

  const partes = [
    `Balancete ${d.project_code || '?'} até ${DATA(d.data_referencia)} (emissão ${DATA(d.data_emissao)})`,
    `saldo disponível ${BRL(d.saldo_disponivel)}`,
    `${d.lancamentos.length} lançamentos`,
    contasMaeFecham ? 'contas-mãe conferidas' : 'CONTAS-MÃE NÃO FECHAM',
  ];
  if (perguntas.length) partes.push(`${perguntas.length} pergunta(s) de classificação`);
  if (avisos.length) partes.push(`${avisos.length} aviso(s)`);

  return {
    ok: problemas.length === 0,
    problemas,
    project_code: d.project_code,
    chave: d.data_referencia,
    resumo: partes.join(' · '),
    payload: {
      versao: 1,
      arquivo_nome: arquivoNome,
      extraido,            // { data, warnings } — o que a revisão do site recebe
      perguntas,
      avisos,
      conferencias: { contas_mae_fecham: contasMaeFecham },
    },
  };
}

// Mesma detecção da 052: formato de CPF + dígitos verificadores. Não exibe
// o valor recusado, inclusive quando ele veio num aviso ou nome de arquivo.
function contemCpf(texto) {
  const candidatos = texto.match(/(?<![0-9])[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2}(?![0-9])/g) || [];
  return candidatos.some(c => {
    const d = c.replace(/\D/g, '').split('').map(Number);
    if (new Set(d).size === 1) return false;
    const dv = n => {
      const resto = d.slice(0, n).reduce((s, v, i) => s + v * (n + 1 - i), 0) % 11;
      return resto < 2 ? 0 : 11 - resto;
    };
    return dv(9) === d[9] && dv(10) === d[10];
  });
}

/** Pura: compara valores já extraídos/RPC, sem somar ou projetar no MCP. */
export function montarPropostaPlano({ extraido, arquivoNome, tipo, planoAtivo = null }) {
  const recusar = motivo => ({ ok: false, problemas: [motivo] });
  if (!['original', 'remanejamento'].includes(tipo)) return recusar('Tipo do plano: original ou remanejamento.');
  if (!extraido?.data || !Array.isArray(extraido.data.rubricas) || !extraido.data.rubricas.length) {
    return recusar('Nenhuma rubrica extraída do plano — confira o documento.');
  }
  if (contemCpf(JSON.stringify({ extraido, arquivoNome }))) {
    return recusar('O conteúdo extraído contém CPF. A proposta não foi criada; retire dados pessoais dos campos do plano.');
  }
  // Projeta só o contrato do parser. HTML bruto e listas de equipe nunca
  // entram no payload; a revisão gera o HTML de novo apenas para exibição.
  const data = {};
  for (const campo of ['titulo', 'coordenador', 'data_documento', 'prazo_inicio', 'prazo_fim',
    'valor_total_plano', 'valor_despesas_projeto', 'valor_cip', 'valor_dao', 'receita_origem']) {
    if (Object.hasOwn(extraido.data, campo)) data[campo] = extraido.data[campo];
  }
  data.rubricas = extraido.data.rubricas.map(r => ({
    rubrica_code: r.rubrica_code, descricao_livre: r.descricao_livre, valor_previsto: r.valor_previsto,
  }));
  data.desembolsos = (extraido.data.desembolsos || []).map(d => ({
    parcela: d.parcela, data_prevista: d.data_prevista, data_texto: d.data_texto,
    valor: d.valor, valor_texto: d.valor_texto,
  }));
  const warnings = [...(extraido.warnings || [])];
  const avisos = [...warnings];
  const totalNovo = data.valor_total_plano;
  const totalAtivo = planoAtivo?.valor_total_plano;
  const totalDiferente = tipo === 'remanejamento' && totalNovo != null && totalAtivo != null
    ? Math.abs(Number(totalNovo) - Number(totalAtivo)) >= 0.01 : null;
  const originalExistente = tipo === 'original' && planoAtivo != null;
  const dataAnterior = data.data_documento && planoAtivo?.data_documento
    ? data.data_documento < planoAtivo.data_documento : null;
  if (totalDiferente) avisos.push(
    `Este remanejamento muda o valor total: plano ativo ${BRL(totalAtivo)}; documento ${BRL(totalNovo)}. Confira antes de aplicar.`
  );
  if (originalExistente) avisos.push('Este plano foi indicado como original, mas já existe um plano ativo neste centro de custo. Confira a ordem das versões.');
  if (dataAnterior) avisos.push(
    `A data do documento (${DATA(data.data_documento)}) é anterior à do plano ativo (${DATA(planoAtivo.data_documento)}). Confira a ordem das versões.`
  );
  return {
    ok: true, problemas: [],
    chave: `${tipo}:${data.data_documento || arquivoNome}`,
    resumo: `${tipo === 'original' ? 'Plano original' : 'Remanejamento'} · ${BRL(totalNovo)} · ${data.rubricas.length} rubrica(s) · ${avisos.length} aviso(s)`,
    payload: { versao: 1, arquivo_nome: arquivoNome, tipo, extraido: { data, warnings }, avisos,
      conferencias: {
        soma_rubricas_diverge: warnings.some(w => w.startsWith('A soma das rubricas')),
        total_remanejamento_diverge: totalDiferente,
        original_com_plano_ativo: originalExistente,
        data_anterior_ao_plano_ativo: dataAnterior,
      },
    },
  };
}

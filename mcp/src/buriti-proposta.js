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
 */
export function montarPropostaBalancete({ texto, arquivoNome, mapa = [] }) {
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
      const semente = SUGESTOES[l.conta_reduzido];
      const dica = classificarContaCortada(l.conta_codigo, mapa);
      let sugestao = null;
      if (semente) {
        sugestao = { rubrica: semente.rubrica, justificativa: semente.justificativa, fonte: 'semente' };
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

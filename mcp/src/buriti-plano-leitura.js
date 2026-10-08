// Leitura determinística: os mesmos parsers usados pelo site.
import { parsePtFromHtml, PtFormatError } from '../../frontend/js/parsers/pt-parser.js';
import { parsePtFromPdfText } from '../../frontend/js/parsers/pt-pdf-parser.js';
import { textoDoPdf } from './buriti-proposta.js';

export async function lerPlano(bytes, arquivoNome) {
  if (/\.pdf$/i.test(arquivoNome)) return parsePtFromPdfText(await textoDoPdf(bytes));
  if (!/\.docx$/i.test(arquivoNome)) {
    throw new PtFormatError('Não há leitor automático para este formato. Use DOCX no padrão PROAD/UFG ou o PDF do plano assinado.');
  }
  const [{ default: mammoth }, { DOMParser }] = await Promise.all([
    import('mammoth'), import('linkedom'),
  ]);
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  // Nenhum await entre instalar e restaurar o global: chamadas concorrentes
  // não observam o DOM alheio, e o parser do browser permanece intacto.
  // linkedom não completa a estrutura html/head para a entrada fragmentária
  // do parser do site. Normaliza o invólucro para que doc.body tenha o mesmo
  // conteúdo que o DOMParser nativo, inclusive datas/CIP/DAO do cabeçalho.
  class PlanoDOMParser extends DOMParser {
    parseFromString(html, type) {
      return super.parseFromString(html
        .replace(/^(<!doctype html>)<body>/i, '$1<html><head></head><body>')
        .replace(/<\/body>$/i, '</body></html>'), type);
    }
  }
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
  Object.defineProperty(globalThis, 'DOMParser', { value: PlanoDOMParser, configurable: true, writable: true });
  try {
    return parsePtFromHtml(html);
  } finally {
    if (anterior) Object.defineProperty(globalThis, 'DOMParser', anterior);
    else delete globalThis.DOMParser;
  }
}

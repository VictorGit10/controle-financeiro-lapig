/* ============================================================
   pdf-texto.js
   Itens de texto de uma página do pdf.js → texto com quebras de linha.

   Existe separado porque DOIS lugares extraem texto de balancete e têm
   de produzir exatamente o mesmo texto para o mesmo PDF: a importação do
   site (plano-trabalho.js) e o Buriti no MCP (mcp/src/buriti.js). Duas
   cópias desta função divergiriam em silêncio — e o parser, que depende
   das quebras de linha, leria coisas diferentes nos dois.
   ============================================================ */

/**
 * Junta os itens de `page.getTextContent().items`. Nova linha quando a
 * coordenada Y muda mais de 2 pontos; dentro da linha, itens separados
 * por espaço (o parser normaliza espaços repetidos).
 */
export function textoDaPagina(items) {
  let lastY = null;
  const partes = [];
  (items || []).forEach((it) => {
    const y = it.transform?.[5];
    if (lastY !== null && Math.abs(y - lastY) > 2) partes.push('\n');
    partes.push(it.str);
    lastY = y;
  });
  return partes.join(' ');
}

if (typeof window !== 'undefined') {
  window.textoDaPagina = textoDaPagina;
}

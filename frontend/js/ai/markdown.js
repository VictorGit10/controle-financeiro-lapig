/* ============================================================
   Markdown mínimo para a resposta do assistente
   ============================================================
   Fica num módulo próprio, e não escondido dentro da página,
   por um motivo: é o ponto onde texto de FORA (o modelo, que
   por sua vez repete nome de bolsista e de projeto vindos do
   banco) vira HTML. Isso é superfície de XSS e precisa de
   teste — ver `tests/ai-markdown.test.js`.

   A regra que faz isso ser seguro é a ORDEM: escapa primeiro,
   formata depois. Ao contrário, um `<img onerror=...>` no
   texto viraria elemento antes de qualquer escape. Ver a nota
   de `escapeAttrJs` em pure-fns.js — é a mesma família de erro.

   Suporte deliberadamente pequeno: negrito, código, listas e
   parágrafos. **Sem itálico por `_`**, porque os nomes de
   campo das RPCs são snake_case (`saldo_livre`,
   `motivo_codigo`, `compromissos_cobertura`) e o par de
   sublinhados os despedaçaria justamente nos termos que a
   resposta mais cita.
   ============================================================ */

function escapar(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Formatação dentro de uma linha JÁ escapada. */
function inline(texto) {
  return texto
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function renderMarkdown(texto) {
  const seguro = escapar(String(texto == null ? '' : texto));
  if (!seguro.trim()) return '';

  return seguro
    .split(/\n{2,}/)
    .map((bloco) => {
      const linhas = bloco.split('\n').filter((l) => l.trim() !== '');
      if (!linhas.length) return '';

      if (linhas.every((l) => /^\s*[-*]\s+/.test(l))) {
        const itens = linhas.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`);
        return `<ul>${itens.join('')}</ul>`;
      }

      if (linhas.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
        const itens = linhas.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`);
        return `<ol>${itens.join('')}</ol>`;
      }

      // Cabeçalho markdown vira negrito: a bolha da conversa não comporta
      // hierarquia de título, e um <h2> ali quebraria a escala tipográfica.
      const corpo = linhas
        .map((l) => l.replace(/^\s*#{1,6}\s+(.*)$/, '<strong>$1</strong>'))
        .join('<br>');
      return `<p>${inline(corpo)}</p>`;
    })
    .join('');
}

if (typeof window !== 'undefined') {
  window.CFMarkdown = { renderMarkdown };
}

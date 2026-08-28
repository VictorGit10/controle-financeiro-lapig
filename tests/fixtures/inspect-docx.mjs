/* ============================================================
   Regenera as fixtures de Plano de Trabalho.

   Converte os DOCX de uma pasta local em HTML via mammoth — o mesmo
   caminho que o browser percorre — e salva em tests/fixtures/pt-html/.
   É o que `tests/pt-parser.test.js` consome; sem essas fixtures aqueles
   testes são pulados (não falham).

   Uso:
     node tests/fixtures/inspect-docx.mjs [pasta-de-origem]
     PT_DOCX_DIR=/caminho/para/docx node tests/fixtures/inspect-docx.mjs

   A pasta de origem NÃO é versionada e a saída também não: os planos
   reais trazem nome, telefone e e-mail do coordenador, e CPFs da equipe.
   O repositório é público — `tests/fixtures/pt-html/` está no .gitignore.
   ============================================================ */

import mammoth from 'mammoth';
import { promises as fs } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Default: a pasta de trabalho local com os documentos originais recebidos
// da FUNAPE/FAPEG/PROAD. Trocável por argumento ou variável de ambiente
// porque cada máquina guarda esses arquivos onde quiser.
const SRC_DIR = process.argv[2]
  || process.env.PT_DOCX_DIR
  || join(__dirname, '..', '..', 'NãoColocarNoGit');
const OUT_DIR = join(__dirname, 'pt-html');

let docs;
try {
  docs = (await fs.readdir(SRC_DIR)).filter((f) => f.endsWith('.docx'));
} catch (err) {
  console.error(`Não consegui ler a pasta de origem: ${SRC_DIR}`);
  console.error(`  (${err.code === 'ENOENT' ? 'a pasta não existe' : err.message})`);
  console.error('');
  console.error('Passe a pasta com os DOCX como argumento:');
  console.error('  node tests/fixtures/inspect-docx.mjs "C:/caminho/para/os/planos"');
  process.exit(1);
}

if (docs.length === 0) {
  console.error(`Nenhum .docx em ${SRC_DIR} — nada a converter.`);
  process.exit(1);
}

await fs.mkdir(OUT_DIR, { recursive: true });

for (const f of docs) {
  const inPath = join(SRC_DIR, f);
  const outPath = join(OUT_DIR, basename(f, '.docx') + '.html');
  const result = await mammoth.convertToHtml({ path: inPath });
  await fs.writeFile(outPath, result.value, 'utf8');
  console.log(`OK ${f} → ${outPath} (${result.value.length} chars, ${result.messages.length} warnings)`);
}

// Helper: converte os DOCX de Registro_e_automatizações em HTML via mammoth
// e salva em tests/fixtures/pt-html/*.html para inspeção/testes.
// Uso: node tests/fixtures/inspect-docx.mjs

import mammoth from 'mammoth';
import { promises as fs } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SRC_DIR = join(__dirname, '..', '..', 'Registro_e_automatizações');
const OUT_DIR = join(__dirname, 'pt-html');

await fs.mkdir(OUT_DIR, { recursive: true });

const docs = (await fs.readdir(SRC_DIR)).filter((f) => f.endsWith('.docx'));
for (const f of docs) {
  const inPath = join(SRC_DIR, f);
  const outPath = join(OUT_DIR, basename(f, '.docx') + '.html');
  const result = await mammoth.convertToHtml({ path: inPath });
  await fs.writeFile(outPath, result.value, 'utf8');
  console.log(`OK ${f} → ${outPath} (${result.value.length} chars, ${result.messages.length} warnings)`);
}

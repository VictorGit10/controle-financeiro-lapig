// Inspeciona como cada DOCX expõe a tabela "Plano de Aplicação dos Recursos Financeiros"
// após conversão para HTML por mammoth. Mostra trecho ao redor do título.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIR = join(__dirname, 'pt-html');

const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.html'));
for (const f of files) {
  const html = await fs.readFile(join(DIR, f), 'utf8');
  const idx = html.toLowerCase().indexOf('plano de aplica');
  if (idx === -1) { console.log(`# ${f}\n  (não encontrou)`); continue; }
  // Pega o que vem ANTES (uns 80 chars para ver o heading wrapper) e DEPOIS até fim da próxima </table>
  const before = html.slice(Math.max(0, idx - 80), idx);
  const after  = html.slice(idx);
  const tblEnd = after.toLowerCase().indexOf('</table>');
  const tableHtml = tblEnd >= 0 ? after.slice(0, tblEnd + 8) : after.slice(0, 4000);
  console.log(`\n========== ${f} ==========`);
  console.log('BEFORE:', JSON.stringify(before));
  console.log('TITLE+TABLE (' + tableHtml.length + ' chars):');
  console.log(tableHtml.substring(0, 3500));
  if (tableHtml.length > 3500) console.log('...[truncado]...');
}

// Roda o Buriti em lote sobre uma pasta de balancetes, SEM banco e sem
// login: mostra as propostas que seriam criadas. Mesma montagem de texto e
// mesmo parser do site e do propor_balancete (src/buriti.js).
//
//   node scripts/propor-balancetes-local.js "C:/caminho/da/pasta" [--json]
//
// Sem o conta_rubrica_map do banco, a dica pelo prefixo não aparece: as
// sugestões vêm só da semente (src/buriti-sugestoes.js).

import fs from 'node:fs/promises';
import path from 'node:path';
import { textoDoPdf, montarPropostaBalancete } from '../src/buriti-proposta.js';

console.log = (...a) => process.stderr.write(a.join(' ') + '\n'); // avisos do pdf.js fora do stdout
const escrever = (s) => process.stdout.write(s + '\n');

const [pasta, ...flags] = process.argv.slice(2);
if (!pasta) {
  process.stderr.write('Uso: node scripts/propor-balancetes-local.js <pasta> [--json]\n');
  process.exit(2);
}
const arquivos = (await fs.readdir(pasta)).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
const saida = [];
for (const f of arquivos) {
  const texto = await textoDoPdf(await fs.readFile(path.join(pasta, f)));
  const p = montarPropostaBalancete({ texto, arquivoNome: f });
  saida.push({ arquivo: f, ...p });
}

if (flags.includes('--json')) {
  escrever(JSON.stringify(saida, null, 2));
} else {
  for (const p of saida) {
    escrever(`\n■ ${p.resumo}`);
    if (!p.ok) escrever(`  NÃO GERARIA PROPOSTA: ${p.problemas.join(' ')}`);
    for (const a of p.payload.avisos) escrever(`  aviso: ${a}`);
    for (const q of p.payload.perguntas) {
      const s = q.sugestao ? `→ ${q.sugestao.rubrica} (${q.sugestao.fonte}): ${q.sugestao.justificativa}` : '→ sem sugestão';
      escrever(`  ? ${q.conta}… red. ${q.reduzido} ${q.descricao} — ${q.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ${s}`);
    }
  }
  const total = saida.reduce((n, p) => n + p.payload.perguntas.length, 0);
  escrever(`\n${saida.length} balancetes · ${saida.filter((p) => p.ok).length} propostas · ${total} perguntas`);
}

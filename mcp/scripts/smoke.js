// Roteiro de fumaça: sobe o servidor como um cliente MCP de verdade (subprocesso
// via stdio) e exercita as tools. Não é mock — passa pelo mesmo caminho que o
// Claude Desktop vai usar: protocolo, login no GoTrue, PostgREST e RLS.
//
//   node scripts/smoke.js            # usa as CF_* do ambiente
//   CF_EMAIL=... CF_PASSWORD=... node scripts/smoke.js
//
// Contra a stack local, veja mcp/README.md para as variáveis.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const servidor = resolve(aqui, '..', 'src', 'index.js');

const passadas = [];
function conferir(nome, ok, detalhe) {
  passadas.push({ nome, ok });
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
}

function texto(resultado) {
  return (resultado.content || []).map((c) => c.text || '').join('\n');
}

function json(resultado) {
  try {
    return JSON.parse(texto(resultado));
  } catch {
    return null;
  }
}

const transporte = new StdioClientTransport({
  command: process.execPath,
  args: [servidor],
  env: { ...process.env },
  stderr: 'inherit',
});
const cliente = new Client({ name: 'smoke', version: '0.1.0' });
await cliente.connect(transporte);

const { tools } = await cliente.listTools();
conferir('servidor anuncia as tools', tools.length === 5, tools.map((t) => t.name).join(', '));

const eu = json(await cliente.callTool({ name: 'quem_sou_eu', arguments: {} }));
conferir('login funciona', Boolean(eu?.email), `${eu?.email} (${eu?.papel})`);

const lista = json(await cliente.callTool({ name: 'listar_centros_de_custo', arguments: {} }));
conferir('lista centros de custo', (lista?.total ?? 0) > 0, `${lista?.total} centros`);

const primeiro = lista.centros[0];
const saldo = json(
  await cliente.callTool({ name: 'saldo_livre', arguments: { centro_de_custo: primeiro.name } })
);
conferir(
  'saldo_livre resolve nome e responde',
  Boolean(saldo?.project_id),
  `${saldo?.project_name} | cobertura declarada: ${saldo?.grupos?.[0]?.compromissos_cobertura ?? saldo?.has_plano === false ? 'sem plano' : 'ok'}`
);

const sim = json(
  await cliente.callTool({
    name: 'simular_alocacao',
    arguments: { tipo: 'bolsa', valor: 2000, meses: 24 },
  })
);
const itens = sim?.projetos ?? [];
conferir('simular_alocacao ranqueia', itens.length > 0, `${itens.length} centros avaliados`);

const formas = new Set(itens.map((i) => Object.keys(i).sort().join('|')));
conferir(
  'todos os itens têm o mesmo conjunto de chaves',
  formas.size === 1,
  `${formas.size} forma(s) distinta(s)`
);

conferir(
  'a nota de shortlist chega ao modelo',
  /SHORTLIST/i.test(String(sim?.nota || '')),
  'campo nota presente'
);

const bolsas = json(
  await cliente.callTool({
    name: 'consultar_bolsas',
    arguments: { centro_de_custo: primeiro.name },
  })
);
const temPII = JSON.stringify(bolsas || {}).match(/\b\d{11}\b|@[\w.-]+\.\w+/);
conferir('consultar_bolsas responde', typeof bolsas?.total === 'number', `${bolsas?.total} bolsas`);
conferir('consultar_bolsas não devolve CPF nem e-mail', !temPII, temPII ? `achou ${temPII[0]}` : '');

const negado = await cliente.callTool({
  name: 'saldo_livre',
  arguments: { centro_de_custo: 'centro-que-nao-existe-xyz' },
});
conferir(
  'centro inexistente vira erro legível',
  negado.isError === true && /Nenhum centro de custo/i.test(texto(negado)),
  texto(negado).slice(0, 60)
);

await cliente.close();

const falhas = passadas.filter((p) => !p.ok);
console.log(`\n${passadas.length - falhas.length}/${passadas.length} conferências passaram`);
process.exit(falhas.length ? 1 : 0);

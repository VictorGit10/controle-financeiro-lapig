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

const ESPERADAS = [
  'listar_centros_de_custo',
  'panorama',
  'saldo_livre',
  'simular_alocacao',
  'consultar_bolsas',
  'previsto_vs_realizado',
  'projecao_de_caixa',
  'plano_de_trabalho',
  'quem_sou_eu',
];

const { tools } = await cliente.listTools();
const nomes = tools.map((t) => t.name).sort();
const faltando = ESPERADAS.filter((n) => !nomes.includes(n));
conferir(
  'servidor anuncia as tools',
  faltando.length === 0 && tools.length === ESPERADAS.length,
  faltando.length ? `faltando: ${faltando.join(', ')}` : `${tools.length} tools`
);

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
  // Sem os parênteses, `??` e `?:` se combinam como `(a ?? b) ? x : y` e o
  // rótulo saía sempre 'sem plano' — inclusive para centro COM plano.
  `${saldo?.project_name} | cobertura declarada: ${
    saldo?.has_plano === false
      ? 'sem plano'
      : (saldo?.grupos?.[0]?.compromissos_cobertura ?? 'sem grupos')
  }`
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

// ---------- bolsas sem filtro e por vencimento ----------
const todas = json(await cliente.callTool({ name: 'consultar_bolsas', arguments: {} }));
conferir(
  'consultar_bolsas aceita chamada sem filtro',
  typeof todas?.total === 'number',
  `${todas?.total} bolsas visíveis${todas?.truncado ? ' (TRUNCADO)' : ''}`
);

const vencendo = json(
  await cliente.callTool({ name: 'consultar_bolsas', arguments: { encerrando_em_meses: 6 } })
);
const dentroDaJanela =
  Array.isArray(vencendo?.bolsas) &&
  vencendo.bolsas.every((b) => b.fim >= new Date().toISOString().slice(0, 10));
conferir(
  'encerrando_em_meses só traz bolsas não vencidas',
  typeof vencendo?.total === 'number' && dentroDaJanela,
  `${vencendo?.total} vencendo até ${vencendo?.filtro?.encerrando_ate}`
);

// ---------- panorama (exige a migração 040) ----------
const pano = json(await cliente.callTool({ name: 'panorama', arguments: {} }));
conferir(
  'panorama responde (migração 040 aplicada?)',
  typeof pano?.resumo?.centros === 'number',
  pano?.resumo?.centros !== undefined
    ? `${pano.resumo.centros} centros | sem balancete: ${pano.resumo.sem_balancete} | defasados: ${pano.resumo.balancete_defasado}`
    : 'sem resumo — se o erro fala em função inexistente, falta rodar database/040_panorama.sql'
);

conferir(
  'panorama declara que não ranqueia',
  /N[ÃA]O RANQUEIA/i.test(String(pano?.nota || '')),
  'campo nota presente'
);

const centrosPano = pano?.centros ?? [];
const formasPano = new Set(centrosPano.map((c) => Object.keys(c).sort().join('|')));
conferir(
  'todos os centros do panorama têm o mesmo conjunto de chaves',
  centrosPano.length === 0 || formasPano.size === 1,
  `${formasPano.size} forma(s) distinta(s)`
);

// Um centro sem plano tem que vir com saldo_livre null — não zero. Confundir
// os dois faria "sem dado" parecer "sem dinheiro" em qualquer soma.
const semPlano = centrosPano.filter((c) => c.situacao_dado === 'sem_plano');
conferir(
  'centro sem plano tem saldo_livre null, não zero',
  semPlano.every((c) => c.saldo_livre === null),
  semPlano.length ? `${semPlano.length} sem plano` : 'nenhum sem plano nesta base'
);

// ---------- as três de leitura ----------
const pvr = json(
  await cliente.callTool({
    name: 'previsto_vs_realizado',
    arguments: { centro_de_custo: primeiro.name },
  })
);
conferir(
  'previsto_vs_realizado responde',
  typeof pvr?.has_plano === 'boolean',
  `has_plano=${pvr?.has_plano} has_balancete=${pvr?.has_balancete}`
);

const proj = json(
  await cliente.callTool({
    name: 'projecao_de_caixa',
    arguments: { centro_de_custo: primeiro.name },
  })
);
conferir(
  'projecao_de_caixa responde',
  Array.isArray(proj?.meses),
  `${proj?.meses?.length ?? 0} meses projetados`
);
conferir(
  'projecao_de_caixa declara o que não projeta',
  /otimista/i.test(String(proj?.nota || '')),
  'campo nota presente'
);

const plano = json(
  await cliente.callTool({
    name: 'plano_de_trabalho',
    arguments: { centro_de_custo: primeiro.name },
  })
);
conferir(
  'plano_de_trabalho responde',
  typeof plano?.has_plano === 'boolean',
  plano?.has_plano
    ? `${plano?.plano?.rubricas?.length ?? 0} rubricas, ${plano?.plano?.desembolsos?.length ?? 0} desembolsos`
    : 'sem plano ativo neste centro'
);

const temPIIPlano = JSON.stringify(plano || {}).match(/\b\d{11}\b/);
conferir('plano_de_trabalho não devolve CPF', !temPIIPlano, temPIIPlano ? `achou ${temPIIPlano[0]}` : '');

// ---------- erro legível ----------
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

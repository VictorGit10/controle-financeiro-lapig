// Roteiro de fumaça: sobe o servidor como um cliente MCP de verdade (subprocesso
// via stdio) e exercita as tools. Não é mock — passa pelo mesmo caminho que o
// Claude Desktop vai usar: protocolo, login no GoTrue, PostgREST e RLS.
//
//   node scripts/smoke.js            # usa as CF_* do ambiente
//   CF_EMAIL=... CF_PASSWORD=... node scripts/smoke.js
//
// Contra a stack local, veja mcp/README.md para as variáveis.
//
// Rode com os DOIS logins (professor e admin): as conferências de escopo mudam
// de expectativa conforme o papel, e é a rodada de professor que prova a
// barreira. `CF_SMOKE_PROJETO_ALHEIO=<uuid>` aponta um centro de custo fora do
// escopo do login; sem ela o teste usa um uuid inexistente, que percorre o mesmo
// caminho no `assert_project_allowed` (não-admin só passa pelo que está em
// `allowed_project_ids()`) e portanto ainda vale como negativo.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const servidor = resolve(aqui, '..', 'src', 'index.js');

const passadas = [];

/**
 * `vazio: true` marca a conferência que passou sem dado nenhum para exercitar.
 * Não é falha — pode ser o estado correto daquela base —, mas some no meio dos
 * "ok" e faz a rodada inteira parecer mais verificada do que foi. Sai contada
 * no rodapé.
 */
function conferir(nome, ok, detalhe, vazio = false) {
  passadas.push({ nome, ok, vazio: Boolean(ok && vazio) });
  const marca = ok ? (vazio ? 'ok~ ' : 'ok  ') : 'FALHA';
  console.log(`${marca} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
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

// O enquadramento transversal vive no handshake, não repetido em cada
// descrição. Se ele sumir, as tools continuam funcionando e o modelo passa a
// ler panorama como ranking — falha silenciosa, então vale conferência.
const instrucoes = cliente.getInstructions() ?? '';
const regras = [/n[ãa]o calcule/i, /n[ãa]o recomende/i, /descreve/i, /escopo/i];
conferir(
  'servidor entrega instructions no handshake',
  regras.every((r) => r.test(instrucoes)),
  `${instrucoes.length} caracteres`
);

const semHint = tools.filter((t) => t.annotations?.readOnlyHint !== true);
conferir(
  'todas as tools se declaram somente-leitura',
  semHint.length === 0,
  semHint.length ? `sem readOnlyHint: ${semHint.map((t) => t.name).join(', ')}` : `${tools.length} tools`
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
conferir(
  'consultar_bolsas não devolve CPF nem e-mail',
  !temPII,
  temPII ? `achou ${temPII[0]}` : '',
  (bolsas?.total ?? 0) === 0
);

// ---------- bolsas sem filtro e por vencimento ----------
const todas = json(await cliente.callTool({ name: 'consultar_bolsas', arguments: {} }));
conferir(
  'consultar_bolsas aceita chamada sem filtro',
  typeof todas?.total === 'number',
  `${todas?.total} bolsas visíveis${todas?.truncado ? ' (TRUNCADO)' : ''}`,
  (todas?.total ?? 0) === 0
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
  `${vencendo?.total} vencendo até ${vencendo?.filtro?.encerrando_ate}`,
  (vencendo?.total ?? 0) === 0
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
  `${formasPano.size} forma(s) distinta(s)`,
  centrosPano.length === 0
);

// Um centro sem plano tem que vir com saldo_livre null — não zero. Confundir
// os dois faria "sem dado" parecer "sem dinheiro" em qualquer soma.
const semPlano = centrosPano.filter((c) => c.situacao_dado === 'sem_plano');
conferir(
  'centro sem plano tem saldo_livre null, não zero',
  semPlano.every((c) => c.saldo_livre === null),
  semPlano.length ? `${semPlano.length} sem plano` : 'nenhum sem plano nesta base',
  semPlano.length === 0
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

// A resposta é projetada, não é a linha da tabela: raw_extraction repetiria
// rubricas e desembolsos inteiros, e o caminho no Storage não serve a ninguém
// que lê. Se um destes reaparecer, alguém devolveu o `to_jsonb(pt.*)` cru.
const cruas = ['raw_extraction', 'arquivo_storage_path', 'created_by', 'project_id'].filter(
  (c) => plano?.plano && c in plano.plano
);
conferir(
  'plano_de_trabalho devolve os campos projetados, não a linha crua',
  cruas.length === 0,
  cruas.length ? `vazaram: ${cruas.join(', ')}` : `${Object.keys(plano?.plano ?? {}).length} campos`,
  plano?.has_plano !== true
);

const temPIIPlano = JSON.stringify(plano || {}).match(/\b\d{11}\b/);
conferir(
  'plano_de_trabalho não devolve CPF',
  !temPIIPlano,
  temPIIPlano ? `achou ${temPIIPlano[0]}` : '',
  plano?.has_plano !== true
);

// ---------- escopo entre usuários ----------
// A conferência que o README mandava fazer à mão. Ela existe porque o resto do
// roteiro roda com UM login e não prova barreira nenhuma: passa igual se o RLS
// estiver desligado.
//
// As expectativas são OPOSTAS conforme o papel, e é por isso que a rodada de
// professor é a que importa — o admin serve de controle (se ele fosse barrado,
// o erro estaria do outro lado).
const ALHEIO = process.env.CF_SMOKE_PROJETO_ALHEIO || '00000000-0000-0000-0000-000000000000';
const alheioExplicito = Boolean(process.env.CF_SMOKE_PROJETO_ALHEIO);
const ehProfessor = eu?.papel === 'professor';
const proprios = new Set((lista?.centros ?? []).map((c) => c.id));

// Sem isto, um uuid mal escolhido faria o negativo "falhar" por ser, na verdade,
// um centro de custo do próprio login.
conferir(
  'o uuid de teste está fora do escopo deste login',
  !proprios.has(ALHEIO),
  alheioExplicito ? `CF_SMOKE_PROJETO_ALHEIO=${ALHEIO.slice(0, 8)}…` : 'uuid inexistente (padrão)'
);

// Caminho 1 — RPC `security definer` com guard: o escopo aparece como ERRO.
// Passa-se o uuid direto porque o resolvedor por nome nem enxerga o que está
// fora do escopo; é o guard do banco que está sendo testado, não o adaptador.
const alheio = await cliente.callTool({
  name: 'saldo_livre',
  arguments: { centro_de_custo: ALHEIO },
});
const respostaAlheio = texto(alheio);
const foiNegado = alheio.isError === true && /acesso negado/i.test(respostaAlheio);

if (ehProfessor) {
  conferir(
    'professor é barrado em centro de custo alheio (guard da RPC)',
    foiNegado,
    foiNegado ? 'assert_project_allowed respondeu' : `veio: ${respostaAlheio.slice(0, 80)}`
  );
} else {
  // O admin não deve ser barrado. Com uuid inexistente o banco responde
  // "Projeto não encontrado" — outro erro, de outra origem, e é justamente a
  // diferença entre as duas mensagens que mostra qual barreira respondeu.
  conferir(
    'admin não é barrado pelo guard (controle do teste acima)',
    !foiNegado,
    alheioExplicito
      ? `acesso permitido${alheio.isError ? ` (erro: ${respostaAlheio.slice(0, 40)})` : ''}`
      : 'uuid inexistente: esperado "Projeto não encontrado"'
  );
}

// Caminho 2 — RPC `security invoker`: aqui o escopo não levanta exceção, ele
// simplesmente OMITE a linha. Um vazamento no invoker passaria despercebido
// pelo teste do guard, então são dois caminhos, não um.
const panoAlheio = json(
  await cliente.callTool({ name: 'panorama', arguments: { centros_de_custo: [ALHEIO] } })
);
const centrosAlheio = panoAlheio?.resumo?.centros;

if (ehProfessor) {
  conferir(
    'centro de custo alheio não vaza pelo panorama (RLS no invoker)',
    centrosAlheio === 0,
    `panorama devolveu ${centrosAlheio} centro(s) para um id fora do escopo`
  );
} else if (alheioExplicito) {
  conferir(
    'admin enxerga o centro alheio pelo panorama (controle)',
    centrosAlheio === 1,
    `${centrosAlheio} centro(s)`
  );
} else {
  conferir(
    'panorama com id inexistente devolve vazio',
    centrosAlheio === 0,
    'sem CF_SMOKE_PROJETO_ALHEIO não há o que comparar no papel de admin',
    true
  );
}

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
const vazias = passadas.filter((p) => p.vazio);
console.log(`\n${passadas.length - falhas.length}/${passadas.length} conferências passaram`);

// Não é falha, é aviso de leitura: sem isto, uma rodada em que não havia dado
// para exercitar se parece com uma rodada verificada.
if (vazias.length) {
  console.log(
    `${vazias.length} passaram COM BASE VAZIA (marcadas "ok~") — não são garantia:\n` +
      vazias.map((p) => `  · ${p.nome}`).join('\n')
  );
}
if (!process.env.CF_SMOKE_PROJETO_ALHEIO) {
  console.log(
    'Escopo conferido contra um uuid inexistente. Para a versão forte, aponte ' +
      'CF_SMOKE_PROJETO_ALHEIO a um centro de custo real fora deste login.'
  );
}
console.log(`papel desta rodada: ${eu?.papel ?? '?'} — rode também com o outro login.`);

process.exit(falhas.length ? 1 : 0);

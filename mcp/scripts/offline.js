// Conferência offline: sobe o servidor como cliente MCP real, mas SEM nenhuma
// credencial. É o que dá para rodar no CI.
//
// Funciona porque o login é preguiçoso: `config()` só é lida dentro de
// `entrar()`, que só é alcançada na primeira chamada de tool. Handshake,
// instructions e listTools não tocam no banco — então o CI verifica o contrato
// (as 9 tools, o enquadramento, os hints, o schema de entrada) sem segredo
// nenhum. O que exige banco continua no `npm run smoke`.
//
//   npm test          # daqui, mcp/
//
// A ausência de credencial é parte do teste: sem CF_*, a primeira chamada de
// tool tem que devolver erro dizendo o que falta — não um stack trace, não uma
// sessão morta.

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

// Sem herdar as CF_* do ambiente: se elas vazassem para cá, o teste "sem
// credencial" viraria um teste com credencial em qualquer máquina de quem usa
// o servidor de verdade — inclusive a do desenvolvedor.
const limpo = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('CF_'))
);

const transporte = new StdioClientTransport({
  command: process.execPath,
  args: [servidor],
  env: limpo,
  stderr: 'inherit',
});
const cliente = new Client({ name: 'offline', version: '0.1.0' });
await cliente.connect(transporte);

const { tools } = await cliente.listTools();
const nomes = tools.map((t) => t.name).sort();
const faltando = ESPERADAS.filter((n) => !nomes.includes(n));
conferir(
  'servidor anuncia exatamente as 9 tools',
  faltando.length === 0 && tools.length === ESPERADAS.length,
  faltando.length ? `faltando: ${faltando.join(', ')}` : `${tools.length} tools`
);

const semDescricao = tools.filter((t) => !t.description || t.description.length < 40);
conferir(
  'toda tool tem descrição',
  semDescricao.length === 0,
  semDescricao.length ? semDescricao.map((t) => t.name).join(', ') : ''
);

const semHint = tools.filter((t) => t.annotations?.readOnlyHint !== true);
conferir(
  'toda tool se declara somente-leitura',
  semHint.length === 0,
  semHint.length ? `sem readOnlyHint: ${semHint.map((t) => t.name).join(', ')}` : ''
);

// O enquadramento transversal (não calcule, não recomende, panorama descreve,
// escopo por login) vive no handshake. Se ele sumir, tudo continua respondendo
// e só a leitura fica errada — falha silenciosa, por isso a conferência.
const instrucoes = cliente.getInstructions() ?? '';
const regras = [
  [/n[ãa]o calcule/i, 'não calcule'],
  [/n[ãa]o recomende/i, 'não recomende'],
  [/panorama.*descreve/is, 'panorama descreve'],
  [/escopo/i, 'escopo por login'],
];
const ausentes = regras.filter(([r]) => !r.test(instrucoes)).map(([, nome]) => nome);
conferir(
  'instructions carrega as regras transversais',
  ausentes.length === 0,
  ausentes.length ? `faltando: ${ausentes.join(', ')}` : `${instrucoes.length} caracteres`
);

// As tools que exigem centro de custo têm que exigir mesmo: um required
// perdido vira chamada sem argumento e erro obscuro do outro lado.
const exigemCentro = ['saldo_livre', 'previsto_vs_realizado', 'projecao_de_caixa', 'plano_de_trabalho'];
const semRequired = exigemCentro.filter((nome) => {
  const t = tools.find((x) => x.name === nome);
  return !(t?.inputSchema?.required ?? []).includes('centro_de_custo');
});
conferir(
  'tools de um centro exigem centro_de_custo',
  semRequired.length === 0,
  semRequired.length ? semRequired.join(', ') : `${exigemCentro.length} conferidas`
);

// Sem credencial, a primeira chamada tem que explicar o que falta.
const semLogin = await cliente.callTool({ name: 'quem_sou_eu', arguments: {} });
const textoErro = (semLogin.content || []).map((c) => c.text || '').join('\n');
conferir(
  'sem credencial, o erro diz o que falta configurar',
  semLogin.isError === true && /CF_SUPABASE_URL|CF_EMAIL/.test(textoErro),
  textoErro.slice(0, 90)
);

await cliente.close();

const falhas = passadas.filter((p) => !p.ok);
console.log(`\n${passadas.length - falhas.length}/${passadas.length} conferências offline passaram`);
console.log('Contrato e protocolo conferidos. Dado real e escopo: npm run smoke.');
process.exit(falhas.length ? 1 : 0);

#!/usr/bin/env node
// Servidor MCP do ControleFinanceiro (LAPIG/UFG).
//
// Adaptador fino sobre as RPCs de decisão do Postgres (migrações 038/039).
// Autentica como um usuário Supabase real: cada pessoa configura o próprio
// e-mail e senha, e o RLS decide o que ela vê. Não há papel, permissão ou regra
// de negócio codificada aqui.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { quemSouEu } from './client.js';
import { listarCentrosDeCusto, saldoLivre, simularAlocacao, consultarBolsas } from './tools.js';

const servidor = new McpServer({ name: 'controle-financeiro-lapig', version: '0.1.0' });

/** Envelopa o handler: erro vira texto legível em vez de estourar a sessão. */
function tool(nome, config, handler) {
  servidor.registerTool(nome, config, async (args) => {
    try {
      const resultado = await handler(args ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(resultado, null, 2) }] };
    } catch (erro) {
      return { content: [{ type: 'text', text: `Erro: ${erro.message}` }], isError: true };
    }
  });
}

tool(
  'listar_centros_de_custo',
  {
    title: 'Listar centros de custo',
    description:
      'Lista os centros de custo (projetos) visíveis para este login, com código, ' +
      'vigência e se estão ativos. Use para descobrir os nomes aceitos pelas outras ' +
      'tools. A lista já vem escopada: um professor vê só os dele.',
    inputSchema: {},
  },
  listarCentrosDeCusto
);

tool(
  'saldo_livre',
  {
    title: 'Saldo livre de um centro de custo',
    description:
      'Quanto sobra de fato num centro de custo, por grupo de rubrica: previsto no ' +
      'plano, menos realizado no balancete, menos os compromissos já assumidos até o ' +
      'fim da vigência (bolsas ativas). Responde "quanto sobrou?" descontando o que ' +
      'já está prometido — o saldo do balancete sozinho parece maior do que é.\n\n' +
      'Leia sempre `compromissos_cobertura` antes de afirmar qualquer coisa: ' +
      '"bolsas" significa que só compromissos de bolsa foram descontados (contrato, ' +
      'diária e equipamento futuros não são previstos por tabela nenhuma) e ' +
      '"nenhuma" significa que nada foi descontado. Não trate o número como ' +
      'verificado sem dizer o que ele cobre.',
    inputSchema: {
      centro_de_custo: z
        .string()
        .describe('Nome, código ou id do centro de custo. Aceita pedaço do nome, se for único.'),
    },
  },
  saldoLivre
);

tool(
  'simular_alocacao',
  {
    title: 'Simular onde alocar um gasto',
    description:
      'Dada uma bolsa recorrente ou uma compra pontual, avalia todos os centros de ' +
      'custo visíveis e devolve uma lista ranqueada por risco de devolução — qual ' +
      'recurso some primeiro se ninguém gastar.\n\n' +
      'É SHORTLIST COM JUSTIFICATIVA, NÃO RECOMENDAÇÃO. Exponha as opções com o ' +
      'porquê de cada uma; não anuncie uma escolha. A ordem mede urgência, e ' +
      'urgência não é mérito: se um bolsista se justifica dentro do objeto de um ' +
      'projeto é decisão humana e não está em tabela nenhuma. Escolher uma posição ' +
      'mais abaixo por razão temática é uso correto.\n\n' +
      'Repasse o campo `resumo.observacao` quando existir, e não omita `avisos`: as ' +
      'direções de erro são opostas e o usuário precisa saber. O orçamento é ' +
      'conservador (compromissos descontados) e o caixa é otimista (a única saída ' +
      'que o banco sabe prever é bolsa). Um centro de custo com ' +
      '`risco_devolucao.base = "apenas_plano"` está no topo possivelmente por falta ' +
      'de balancete importado, não por ter dinheiro sobrando.',
    inputSchema: {
      tipo: z.enum(['bolsa', 'compra']).describe('"bolsa" é recorrente (mensal); "compra" é pontual.'),
      valor: z.number().positive().describe('Valor mensal, para bolsa; valor total, para compra.'),
      rubrica: z
        .string()
        .optional()
        .describe('Código da rubrica alvo (ex.: "f" para equipamento). Se omitido, bolsa assume "a" (pessoal).'),
      inicio: z.string().optional().describe('Data de início, AAAA-MM-DD. Padrão: hoje.'),
      meses: z.number().int().positive().optional().describe('Duração em meses, para bolsa.'),
      centros_de_custo: z
        .array(z.string())
        .optional()
        .describe('Restringe a comparação a estes centros. Se omitido, avalia todos os visíveis.'),
    },
  },
  simularAlocacao
);

tool(
  'consultar_bolsas',
  {
    title: 'Consultar bolsas',
    description:
      'Bolsas de um centro de custo e/ou de um bolsista: valor mensal, início, fim e ' +
      'situação. Responde "quanto fulano recebe e até quando?". Por padrão só as ' +
      'ativas. Não devolve CPF nem e-mail.',
    inputSchema: {
      centro_de_custo: z.string().optional().describe('Nome, código ou id do centro de custo.'),
      bolsista: z.string().optional().describe('Nome ou parte do nome do bolsista.'),
      incluir_encerradas: z
        .boolean()
        .optional()
        .describe('Inclui bolsas não-ativas no resultado. Padrão: false.'),
    },
  },
  consultarBolsas
);

tool(
  'quem_sou_eu',
  {
    title: 'Sessão atual',
    description:
      'Com qual usuário e papel este servidor está logado. Útil quando o resultado ' +
      'parece incompleto: um professor vê só os centros de custo dele.',
    inputSchema: {},
  },
  quemSouEu
);

const transporte = new StdioServerTransport();
await servidor.connect(transporte);
console.error('[cf-mcp] servidor no ar (stdio)');

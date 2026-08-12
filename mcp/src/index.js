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
import {
  listarCentrosDeCusto,
  saldoLivre,
  simularAlocacao,
  consultarBolsas,
  panorama,
  previstoVsRealizado,
  projecaoDeCaixa,
  planoDeTrabalho,
} from './tools.js';

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
  'panorama',
  {
    title: 'Panorama de todos os centros de custo',
    description:
      'Visão consolidada de todos os centros de custo visíveis: saldo livre, ' +
      'saldo em conta e defasagem do balancete, bolsas ativas e custo mensal, ' +
      'vigência restante e alertas. É a resposta para "como estão os projetos?" ' +
      'e o ponto de partida natural antes de qualquer pergunta específica.\n\n' +
      'DESCREVE, NÃO RANQUEIA: a ordem é alfabética e não significa prioridade. ' +
      'Para ordenar por urgência use simular_alocacao — apresentar esta ordem ' +
      'como se fosse prioridade inventa um significado que o dado não tem.\n\n' +
      'Leia `situacao_dado` antes de comparar centros entre si. Um centro ' +
      '"sem_balancete" tem realizado zero por AUSÊNCIA DE DADO, então seu saldo ' +
      'é o previsto integral do plano e não é comparável com o de quem tem ' +
      'balancete; "sem_plano" não tem saldo (null, não zero). Balancete ' +
      'defasado SUBESTIMA o saldo livre, balancete ausente o SUPERESTIMA — as ' +
      'direções são opostas e não se cancelam. Repasse `resumo.observacao` ' +
      'quando existir: ela diz o que o total consolidado está escondendo.\n\n' +
      '`resumo.sem_balancete` e `resumo.balancete_defasado` são a leitura de ' +
      'saúde do Fechamento Mensal — quais centros estão com o dado atrasado.',
    inputSchema: {
      centros_de_custo: z
        .array(z.string())
        .optional()
        .describe('Restringe a estes centros. Se omitido, traz todos os visíveis.'),
      incluir_inativos: z
        .boolean()
        .optional()
        .describe('Inclui projetos inativos. Padrão: false.'),
    },
  },
  panorama
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
      'situação. Responde "quanto fulano recebe e até quando?" e, com ' +
      '`encerrando_em_meses`, "quais bolsas vencem nos próximos N meses?". Sem ' +
      'filtro nenhum devolve todas as bolsas visíveis a este login. Por padrão ' +
      'só as ativas. Não devolve CPF nem e-mail.\n\n' +
      'Se `truncado` vier true, a lista foi cortada no teto e NÃO é o conjunto ' +
      'completo — refine o filtro antes de contar ou somar.',
    inputSchema: {
      centro_de_custo: z.string().optional().describe('Nome, código ou id do centro de custo.'),
      bolsista: z.string().optional().describe('Nome ou parte do nome do bolsista.'),
      incluir_encerradas: z
        .boolean()
        .optional()
        .describe('Inclui bolsas não-ativas no resultado. Padrão: false.'),
      encerrando_em_meses: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Traz só as bolsas que terminam de hoje até N meses à frente. Use para ' +
            'a pergunta "o que vence?" — bolsas já encerradas ficam de fora.'
        ),
    },
  },
  consultarBolsas
);

tool(
  'previsto_vs_realizado',
  {
    title: 'Previsto × realizado por rubrica',
    description:
      'Execução do centro de custo rubrica a rubrica: quanto o plano de trabalho ' +
      'orçou, quanto o balancete mais recente mostra que saiu, o saldo e o ' +
      'percentual executado. Responde "onde o dinheiro está sendo gasto?" e ' +
      '"que rubrica está estourando ou parada?".\n\n' +
      'Olha só para TRÁS: não desconta compromissos futuros já assumidos (bolsas ' +
      'que continuarão a ser pagas). Para decidir se cabe um gasto novo, use ' +
      'saldo_livre, que desconta. `nao_mapeados` são lançamentos do balancete ' +
      'sem rubrica correspondente — em geral despesas tributárias — e não entram ' +
      'em nenhuma linha de rubrica.',
    inputSchema: {
      centro_de_custo: z.string().describe('Nome, código ou id do centro de custo.'),
    },
  },
  previstoVsRealizado
);

tool(
  'projecao_de_caixa',
  {
    title: 'Projeção de caixa mês a mês',
    description:
      'Saldo projetado mês a mês até o fim da vigência, com as saídas de bolsas e ' +
      'as entradas de desembolsos já registrados. Responde "até quando o dinheiro ' +
      'dura?" e "em que mês o saldo fica negativo?".\n\n' +
      'A única saída projetada é BOLSA — diária, equipamento e contrato futuros ' +
      'não existem em tabela nenhuma, então o saldo é otimista. O ponto de ' +
      'partida é o saldo inicial cadastrado no projeto, NÃO o saldo real da conta ' +
      'no balancete: para a projeção ancorada no extrato, use simular_alocacao, ' +
      'que parte do balancete e quantifica a janela cega.',
    inputSchema: {
      centro_de_custo: z.string().describe('Nome, código ou id do centro de custo.'),
      inicio: z.string().optional().describe('Início da projeção, AAAA-MM-DD. Padrão: mês corrente.'),
      fim: z.string().optional().describe('Fim da projeção, AAAA-MM-DD. Padrão: fim da vigência.'),
    },
  },
  projecaoDeCaixa
);

tool(
  'plano_de_trabalho',
  {
    title: 'Plano de trabalho do centro de custo',
    description:
      'O plano de trabalho ATIVO: rubricas com o valor orçado em cada uma, ' +
      'cronograma de desembolso previsto, título, tipo e valor total. Responde ' +
      '"o que foi aprovado neste projeto?" e "quanto tem previsto em ' +
      'equipamento?".\n\n' +
      'É o ORÇADO, não o executado — nada aqui diz o que já foi gasto. Para o ' +
      'executado use previsto_vs_realizado; para o que ainda está livre, ' +
      'saldo_livre. Um centro sem plano ativo não tem previsto por rubrica, e ' +
      'por isso fica de fora de saldo_livre e simular_alocacao: quando a resposta ' +
      'vier com has_plano false, é essa a explicação para ele não aparecer nas ' +
      'outras.',
    inputSchema: {
      centro_de_custo: z.string().describe('Nome, código ou id do centro de custo.'),
      incluir_historico: z
        .boolean()
        .optional()
        .describe('Inclui a lista de versões anteriores do plano. Padrão: false.'),
    },
  },
  planoDeTrabalho
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

#!/usr/bin/env node
// Servidor MCP do ControleFinanceiro (LAPIG/UFG).
//
// Adaptador fino sobre as RPCs de decisão do Postgres (migrações 038/039/040).
// Autentica como um usuário Supabase real: cada pessoa configura o próprio
// e-mail e senha, e o RLS decide o que ela vê. Não há papel, permissão ou regra
// de negócio codificada aqui.

// stdout é o canal do protocolo. Biblioteca que use console.log (o pdf.js
// avisa assim ao carregar) corromperia a sessão: tudo vai para stderr. O SDK
// escreve o protocolo direto em process.stdout, sem passar por aqui.
console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);
console.warn = (...args) => console.error(...args);

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
import { proporBalancete, listarPropostas, perguntar } from './buriti.js';

// Enquadramento que vale para TODAS as tools. Fica aqui, e não repetido dentro
// de cada descrição, por dois motivos: o cliente lê isto uma vez no handshake —
// antes de escolher a tool, que é quando as regras 2 e 4 ainda podem mudar a
// escolha — e a descrição de cada tool volta a falar só do que é dela.
//
// O que sobrou nas descrições é a versão curta da regra, não a explicação: um
// cliente que ignore `instructions` ainda não pode ler o panorama como ranking.
const INSTRUCOES = `
Controle financeiro do LAPIG/UFG. Responde sobre centros de custo (projetos):
quanto sobra, onde cabe um gasto, o que foi orçado, o que já saiu e quais bolsas
vencem.

Escopo: a sessão está logada como uma pessoa e o banco filtra tudo por ela — um
professor enxerga só os centros de custo dele. Lista curta ou resultado vazio
pode ser escopo, não ausência; "quem_sou_eu" diz com qual login e papel.

Quatro regras valem para todas as tools:

1. Não calcule. Todo número sai das RPCs. Somar, projetar ou reordenar por conta
   própria produz um segundo resultado, que vai discordar do site.

2. Não recomende — apresente. As tools de decisão devolvem shortlist com
   justificativa. A ordem mede urgência de gasto, e urgência não é mérito: se um
   bolsista se justifica dentro do objeto daquele projeto é decisão humana e não
   está em tabela nenhuma. Exponha as opções com o porquê de cada uma; escolher
   é de quem coordena.

3. Diga o que o número cobre quando isso muda a leitura. Os campos existem para
   isso: compromissos_cobertura, situacao_dado, caixa.cobertura,
   risco_devolucao.base, truncado. Saldo alto sem balancete é previsto integral
   com realizado zero por falta de dado — não é dinheiro sobrando.

4. "panorama" descreve, "simular_alocacao" ranqueia. A ordem do panorama é
   alfabética e não significa prioridade.

Como responder: o número pedido e a ressalva que muda a leitura dele. Não
devolva o JSON inteiro, não enumere campo por campo e não repita as notas da
tool palavra por palavra. Ressalva que não muda a decisão não precisa aparecer.
`.trim();

const servidor = new McpServer(
  { name: 'controle-financeiro-lapig', version: '0.1.0' },
  { instructions: INSTRUCOES }
);

// As nove tools são de leitura: nenhuma escreve no banco. `readOnlyHint` é dica
// para o cliente (pode dispensar confirmação), não barreira — a barreira é o
// RLS. `openWorldHint` porque consultam um sistema externo, o Supabase.
const SO_LEITURA = { readOnlyHint: true, openWorldHint: true };

/** Envelopa o handler: erro vira texto legível em vez de estourar a sessão. */
function tool(nome, config, handler) {
  servidor.registerTool(nome, { ...config, annotations: SO_LEITURA }, async (args) => {
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
      'vigência e se estão ativos. Use para descobrir os nomes aceitos pelas ' +
      'outras tools.',
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
      'e o ponto de partida antes de qualquer pergunta específica. Ordem ' +
      'alfabética, sem significado — ranking é com simular_alocacao.\n\n' +
      '`situacao_dado` decide se dois centros são comparáveis entre si: ' +
      '"sem_balancete" tem realizado zero por ausência de dado e SUPERESTIMA o ' +
      'saldo; balancete defasado SUBESTIMA; "sem_plano" vem com saldo_livre ' +
      'null, não zero. `resumo.sem_balancete` e `resumo.balancete_defasado` são ' +
      'a leitura de saúde do Fechamento Mensal — quais centros estão com o dado ' +
      'atrasado —, e `resumo.observacao`, quando existir, diz o que o total ' +
      'consolidado está escondendo.',
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
      'fim da vigência (bolsas ativas). O saldo do balancete sozinho parece maior ' +
      'do que é.\n\n' +
      '`compromissos_cobertura` diz o que foi descontado: "bolsas" = só ' +
      'compromissos de bolsa (contrato, diária e equipamento futuros não são ' +
      'previstos por tabela nenhuma); "nenhuma" = nada.',
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
      'custo visíveis e devolve lista ranqueada por risco de devolução — qual ' +
      'recurso some primeiro se ninguém gastar. Shortlist com justificativa, não ' +
      'recomendação.\n\n' +
      'As direções de erro são opostas, e é o que `avisos` traz: o orçamento é ' +
      'conservador (compromissos descontados) e o caixa é otimista (a única saída ' +
      'que o banco sabe prever é bolsa). Um centro com ' +
      '`risco_devolucao.base = "apenas_plano"` pode estar no topo por falta de ' +
      'balancete importado, não por ter dinheiro sobrando. `motivo_codigo` diz ' +
      'qual restrição amarrou cada "não".',
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
      'filtro nenhum devolve todas as visíveis; por padrão, só as ativas. Não ' +
      'devolve CPF nem e-mail.\n\n' +
      '`truncado: true` significa lista cortada no teto — refine o filtro antes ' +
      'de contar ou somar.',
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
      'Execução do centro de custo rubrica a rubrica e item a item do plano: ' +
      'quanto o plano de trabalho orçou, quanto o balancete mais recente mostra ' +
      'que saiu, o saldo e o percentual executado. Responde "onde o dinheiro ' +
      'está sendo gasto?" e "que rubrica está estourando ou parada?". ' +
      '`realizado_sem_item` é gasto ainda não atribuído a um item do plano.\n\n' +
      'Olha só para TRÁS: não desconta compromissos futuros já assumidos (bolsas ' +
      'que continuarão a ser pagas) — para decidir se cabe um gasto novo, use ' +
      'saldo_livre. `nao_mapeados` são lançamentos do balancete sem rubrica ' +
      'correspondente, em geral tributários, e não entram em nenhuma linha.',
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
      'não existem em tabela nenhuma, então o saldo é otimista. Parte do saldo ' +
      'inicial cadastrado no projeto, NÃO do saldo real da conta no balancete: ' +
      'para a projeção ancorada no extrato, use simular_alocacao, que quantifica ' +
      'a janela cega.',
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
      'É o ORÇADO, não o executado. Para o executado use previsto_vs_realizado; ' +
      'para o que ainda está livre, saldo_livre. `has_plano: false` é a ' +
      'explicação de o centro não aparecer nessas duas: sem plano não há ' +
      'previsto por rubrica. Parcelas com `valor` nulo têm só `valor_texto` ' +
      'porque o plano as descreve sem número fechado.',
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

// ── Buriti: as únicas tools que escrevem — e só PROPOSTAS ──────────────────
// Registradas com `buriti(...)` e não `tool(...)` de propósito: existem só no
// MCP, nunca no Assistente do site (tests/ai-tools.test.js confere as duas
// coisas). Só funcionam com login de papel `agente` (mig. 051); com outro
// login, criar_proposta responde "Só o agente cria propostas".
const PROPOE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };

function buriti(nome, config, handler, annotations = PROPOE) {
  servidor.registerTool(nome, { ...config, annotations }, async (args) => {
    try {
      const resultado = await handler(args ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(resultado, null, 2) }] };
    } catch (erro) {
      return { content: [{ type: 'text', text: `Erro: ${erro.message}` }], isError: true };
    }
  });
}

buriti(
  'propor_balancete',
  {
    title: 'Propor balancete (Buriti)',
    description:
      'Lê um balancete da FUNAPE em PDF (caminho local) com o MESMO leitor da ' +
      'importação do site, identifica o centro de custo pelo código no PDF e cria ' +
      'uma PROPOSTA para um humano revisar e aplicar. Não grava nada no balancete.\n\n' +
      'A proposta leva as perguntas de classificação (conta com código cortado no PDF ' +
      'e fora da tabela de reduzidos), cada uma com sugestão e justificativa, e os ' +
      'avisos da conferência das contas-mãe. Refazer a proposta do mesmo balancete ' +
      'substitui a pendente anterior. `simular: true` mostra a proposta sem criá-la.',
    inputSchema: {
      caminho_pdf: z.string().describe('Caminho do PDF no computador onde o MCP roda.'),
      simular: z.boolean().optional().describe('Só mostra a proposta, sem subir o PDF nem criá-la. Padrão: false.'),
      sugestoes: z
        .array(
          z.object({
            reduzido: z.string().describe('Código Reduzido da conta (2ª coluna do balancete).'),
            rubrica: z.string().describe('Código da rubrica sugerida (ex.: "e").'),
            item: z
              .string()
              .optional()
              .describe('Item do plano dentro da rubrica, como escrito no plano (ex.: "Impressão de material gráfico…"). Veja plano_de_trabalho.'),
            justificativa: z.string().describe('Por quê — o humano lê isto na revisão.'),
          })
        )
        .optional()
        .describe(
          'Sua classificação para as perguntas, tirada do caderno de decisões. Vence a ' +
            'sugestão padrão. Rode antes com simular: true para ver as perguntas.'
        ),
    },
  },
  proporBalancete
);

buriti(
  'listar_propostas',
  {
    title: 'Listar propostas do Buriti',
    description:
      'Propostas e perguntas do Buriti e a decisão humana sobre cada uma. `status` ' +
      'rejeitada traz o motivo em `motivo`; pergunta respondida traz a resposta ' +
      'em `motivo`. Leia antes de propor de novo: motivo de rejeição é o que não ' +
      'pode se repetir.',
    inputSchema: {
      status: z
        .enum(['pendente', 'aplicada', 'rejeitada', 'respondida', 'obsoleta', 'todas'])
        .optional()
        .describe('Padrão: pendente.'),
      centro_de_custo: z.string().optional().describe('Código do centro de custo (ex.: 30.068).'),
      limite: z.number().int().positive().optional().describe('Padrão: 50, máximo 200.'),
    },
  },
  listarPropostas,
  SO_LEITURA
);

buriti(
  'perguntar',
  {
    title: 'Perguntar ao Victor (Buriti)',
    description:
      'Deixa uma pergunta na página Buriti do site — o canal do agente com quem ' +
      'decide. Use quando a dúvida muda um número ou uma classificação e nenhuma ' +
      'tabela responde. A resposta volta em listar_propostas (status respondida).',
    inputSchema: {
      texto: z.string().describe('A pergunta, com o contexto necessário para responder sem abrir outro lugar.'),
      centro_de_custo: z.string().optional().describe('Código do centro de custo, se a pergunta for sobre um.'),
    },
  },
  perguntar
);

const transporte = new StdioServerTransport();
await servidor.connect(transporte);
console.error('[cf-mcp] servidor no ar (stdio)');

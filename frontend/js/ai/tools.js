/* ============================================================
   Tools do assistente — adaptador do browser sobre as RPCs
   ============================================================
   Fase 3 da camada de IA. É o irmão de `mcp/src/tools.js` e
   segue a MESMA regra dura: **zero lógica financeira aqui.**
   Cada tool resolve nome → id, chama a RPC e devolve o JSON
   como veio. Nada soma, projeta, ordena ou reinterpreta
   número — a camada de decisão mora no Postgres (migrações
   038/039/040) porque o MCP e esta aba consomem as mesmas
   funções, e duas implementações da mesma conta divergiriam.
   Se um número está errado, o conserto é na migração.

   Por que existem dois adaptadores em vez de um: o MCP é um
   pacote Node (stdio, zod, supabase-js via npm) e o frontend
   não tem build. O que os dois compartilham é o que importa —
   as RPCs e as descrições. `tests/ai-tools.test.js` trava a
   lista de tools contra a do MCP para os dois não separarem
   em silêncio.

   Diferença de encanamento em relação ao MCP: lá o login é
   feito pelo servidor (CF_EMAIL/CF_PASSWORD); aqui o usuário
   já está logado no site e o `supabaseClient` viaja com o JWT
   dele. O RLS das migrações 033/034 é a barreira nos dois
   casos, e nenhum dos dois tem lógica de permissão própria.

   As descrições são o que o modelo lê, e carregam o
   enquadramento das migrações. Ver `agent.js` para as regras
   transversais (que ficam no system prompt, não repetidas
   aqui) e `mcp/README.md` §"Onde mora o enquadramento".
   ============================================================ */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O cliente é criado por supabase-config.js; resolvido na chamada, não na carga. */
function sb() {
  if (!window.supabaseClient) throw new Error('Sessão do Supabase não iniciada.');
  return window.supabaseClient;
}

/**
 * Traduz o erro do Postgres para algo que faça sentido a quem lê a resposta.
 * Os dois casos que importam vêm da camada de segurança e são esperados, não
 * defeitos: acesso negado a centro de custo alheio (guard das RPCs) e função
 * fora de alcance (revoke da migração 035). Mesma tradução do MCP
 * (`mcp/src/client.js`), pelo mesmo motivo: o modelo precisa distinguir
 * "você não tem acesso" de "deu erro".
 */
function traduzir(error, contexto) {
  const msg = String(error.message || error);
  if (error.code === 'P0001' && /acesso negado/i.test(msg)) {
    return new Error(
      `${msg}. Esse centro de custo não está entre os que este login pode ver.`
    );
  }
  if (error.code === '42501') {
    return new Error(`${msg}. A sessão não tem permissão de executar essa função.`);
  }
  if (error.code === 'PGRST202') {
    return new Error(
      `${msg}. Essa RPC não existe neste banco — falta rodar a migração ` +
        'correspondente (038/039/040) em database/.'
    );
  }
  return new Error(`${contexto}: ${msg}${error.hint ? ` (${error.hint})` : ''}`);
}

async function rpc(fn, args) {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw traduzir(error, `RPC ${fn}`);
  return data;
}

async function consultar(contexto, montaQuery) {
  const { data, error } = await montaQuery(sb());
  if (error) throw traduzir(error, contexto);
  return data;
}

async function centrosVisiveis() {
  return consultar('lista de centros de custo', (c) =>
    c.from('projects').select('id,name,code,start_date,end_date,active').order('name')
  );
}

/**
 * Aceita uuid, código ou nome (inteiro ou pedaço). Resolver nome é trabalho de
 * adaptador, não de decisão — por isso a regra é burra e explícita, e
 * ambiguidade vira erro com os candidatos em vez de um palpite.
 */
async function resolverCentro(termo) {
  const alvo = String(termo || '').trim();
  if (!alvo) throw new Error('Informe o centro de custo (nome, código ou id).');
  if (UUID.test(alvo)) return { id: alvo, name: alvo };

  const centros = await centrosVisiveis();
  const norm = (s) => String(s || '').toLowerCase().trim();
  const a = norm(alvo);

  const exatos = centros.filter((c) => norm(c.code) === a || norm(c.name) === a);
  if (exatos.length === 1) return exatos[0];

  const parciais = centros.filter((c) => norm(c.name).includes(a) || norm(c.code).includes(a));
  if (parciais.length === 1) return parciais[0];
  if (parciais.length > 1) {
    throw new Error(
      `"${alvo}" corresponde a mais de um centro de custo: ` +
        parciais.map((c) => `${c.name}${c.code ? ` (${c.code})` : ''}`).join(', ') +
        '. Repita com o nome completo ou o código.'
    );
  }
  throw new Error(
    `Nenhum centro de custo visível corresponde a "${alvo}". ` +
      `Disponíveis: ${centros.map((c) => c.name).join(', ') || '(nenhum)'}.`
  );
}

/** Resolve uma lista opcional de centros para ids; null significa "todos os visíveis". */
async function resolverLista(centros) {
  if (!Array.isArray(centros) || !centros.length) return null;
  const resolvidos = [];
  for (const termo of centros) resolvidos.push(await resolverCentro(termo));
  return resolvidos.map((c) => c.id);
}

/** Data de hoje deslocada em N meses, em AAAA-MM-DD. */
function emMeses(n) {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

// Teto de linhas. Sem filtro nenhum e com escopo de admin, a consulta pegaria a
// base inteira — o corte existe para a resposta caber, e o campo `truncado`
// avisa em vez de mentir por omissão.
const LIMITE_BOLSAS = 500;

// Campos do plano que saem daqui. `get_plano_ativo` devolve `to_jsonb(pt.*)` — a
// linha inteira de planos_trabalho —, e boa parte não serve a quem lê:
// `raw_extraction` é o objeto que o parser tirou do documento, ou seja uma
// SEGUNDA CÓPIA das mesmas rubricas e desembolsos que já vêm estruturados logo
// abaixo, e arquivo_storage_path / created_by / timestamps são encanamento.
// Escolher coluna é trabalho de adaptador e não toca em número nenhum; a poda
// fica aqui e não na RPC porque `get_plano_ativo` é contrato compartilhado com
// as telas do site.
const CAMPOS_PLANO = [
  'versao',
  'tipo',
  'data_documento',
  'titulo',
  'coordenador',
  'prazo_inicio',
  'prazo_fim',
  'valor_total_plano',
  'valor_despesas_projeto',
  'valor_cip',
  'valor_dao',
  'receita_origem',
  'observacoes',
  'arquivo_nome',
];

function enxugarPlano(plano) {
  const enxuto = {};
  for (const campo of CAMPOS_PLANO) {
    if (plano[campo] !== undefined) enxuto[campo] = plano[campo];
  }
  // Os ids de linha também caem: não há tool de escrita aqui, nada os usa de volta.
  enxuto.rubricas = (plano.rubricas || []).map((r) => ({
    rubrica_code: r.rubrica_code,
    rubrica_name: r.rubrica_name,
    parent_code: r.parent_code,
    valor_previsto: r.valor_previsto,
    descricao_livre: r.descricao_livre,
  }));
  enxuto.desembolsos = (plano.desembolsos || []).map((d) => ({
    parcela: d.parcela,
    data_prevista: d.data_prevista,
    data_texto: d.data_texto,
    valor: d.valor,
    valor_texto: d.valor_texto,
  }));
  return enxuto;
}

/* ── As nove tools ────────────────────────────────────────────
   Especificação e execução no mesmo objeto de propósito: no MCP
   elas moram em arquivos diferentes (registro × adaptador) e é
   possível mexer numa sem a outra. Aqui, juntas, um schema não
   pode divergir do handler que o consome.
   ─────────────────────────────────────────────────────────── */

export const TOOLS = [
  {
    nome: 'listar_centros_de_custo',
    rotulo: 'Listar centros de custo',
    descricao:
      'Lista os centros de custo (projetos) visíveis para este login, com código, ' +
      'vigência e se estão ativos. Use para descobrir os nomes aceitos pelas ' +
      'outras tools.',
    parametros: { type: 'object', properties: {} },
    async executar() {
      const centros = await centrosVisiveis();
      return {
        total: centros.length,
        nota:
          'Esta lista já vem escopada pelo RLS: são os centros de custo deste ' +
          'login, não os do banco inteiro.',
        centros,
      };
    },
  },

  {
    nome: 'panorama',
    rotulo: 'Panorama de todos os centros de custo',
    descricao:
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
    parametros: {
      type: 'object',
      properties: {
        centros_de_custo: {
          type: 'array',
          items: { type: 'string' },
          description: 'Restringe a estes centros. Se omitido, traz todos os visíveis.',
        },
        incluir_inativos: {
          type: 'boolean',
          description: 'Inclui projetos inativos. Padrão: false.',
        },
      },
    },
    async executar({ centros_de_custo, incluir_inativos }) {
      return rpc('get_panorama', {
        p_project_ids: await resolverLista(centros_de_custo),
        p_incluir_inativos: incluir_inativos || false,
      });
    },
  },

  {
    nome: 'saldo_livre',
    rotulo: 'Saldo livre de um centro de custo',
    descricao:
      'Quanto sobra de fato num centro de custo, por grupo de rubrica: previsto no ' +
      'plano, menos realizado no balancete, menos os compromissos já assumidos até o ' +
      'fim da vigência (bolsas ativas). O saldo do balancete sozinho parece maior ' +
      'do que é.\n\n' +
      '`compromissos_cobertura` diz o que foi descontado: "bolsas" = só ' +
      'compromissos de bolsa (contrato, diária e equipamento futuros não são ' +
      'previstos por tabela nenhuma); "nenhuma" = nada.',
    parametros: {
      type: 'object',
      required: ['centro_de_custo'],
      properties: {
        centro_de_custo: {
          type: 'string',
          description: 'Nome, código ou id do centro de custo. Aceita pedaço do nome, se for único.',
        },
      },
    },
    async executar({ centro_de_custo }) {
      const centro = await resolverCentro(centro_de_custo);
      return rpc('get_saldo_livre', { p_project_id: centro.id });
    },
  },

  {
    nome: 'simular_alocacao',
    rotulo: 'Simular onde alocar um gasto',
    descricao:
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
    parametros: {
      type: 'object',
      required: ['tipo', 'valor'],
      properties: {
        tipo: {
          type: 'string',
          enum: ['bolsa', 'compra'],
          description: '"bolsa" é recorrente (mensal); "compra" é pontual.',
        },
        valor: {
          type: 'number',
          description: 'Valor mensal, para bolsa; valor total, para compra.',
        },
        rubrica: {
          type: 'string',
          description:
            'Código da rubrica alvo (ex.: "f" para equipamento). Se omitido, bolsa assume "a" (pessoal).',
        },
        inicio: { type: 'string', description: 'Data de início, AAAA-MM-DD. Padrão: hoje.' },
        meses: { type: 'integer', description: 'Duração em meses, para bolsa.' },
        centros_de_custo: {
          type: 'array',
          items: { type: 'string' },
          description: 'Restringe a comparação a estes centros. Se omitido, avalia todos os visíveis.',
        },
      },
    },
    async executar({ tipo, valor, rubrica, inicio, meses, centros_de_custo }) {
      return rpc('simular_alocacao', {
        p_tipo: tipo,
        p_valor: valor,
        p_rubrica: rubrica || null,
        p_inicio: inicio || null,
        p_meses: meses || null,
        p_project_ids: await resolverLista(centros_de_custo),
      });
    },
  },

  {
    nome: 'consultar_bolsas',
    rotulo: 'Consultar bolsas',
    descricao:
      'Bolsas de um centro de custo e/ou de um bolsista: valor mensal, início, fim e ' +
      'situação. Responde "quanto fulano recebe e até quando?" e, com ' +
      '`encerrando_em_meses`, "quais bolsas vencem nos próximos N meses?". Sem ' +
      'filtro nenhum devolve todas as visíveis; por padrão, só as ativas. Não ' +
      'devolve CPF nem e-mail.\n\n' +
      '`truncado: true` significa lista cortada no teto — refine o filtro antes ' +
      'de contar ou somar.',
    parametros: {
      type: 'object',
      properties: {
        centro_de_custo: { type: 'string', description: 'Nome, código ou id do centro de custo.' },
        bolsista: { type: 'string', description: 'Nome ou parte do nome do bolsista.' },
        incluir_encerradas: {
          type: 'boolean',
          description: 'Inclui bolsas não-ativas no resultado. Padrão: false.',
        },
        encerrando_em_meses: {
          type: 'integer',
          description:
            'Traz só as bolsas que terminam de hoje até N meses à frente. Use para a ' +
            'pergunta "o que vence?" — bolsas já encerradas ficam de fora.',
        },
      },
    },
    async executar({ centro_de_custo, bolsista, incluir_encerradas, encerrando_em_meses }) {
      // Sem filtro é chamada legítima ("todas as bolsas que eu enxergo"): o RLS
      // já escopa, e exigir filtro só quebrava a pergunta aberta de quem
      // coordena vários centros de custo.
      const centro = centro_de_custo ? await resolverCentro(centro_de_custo) : null;

      const hoje = emMeses(0);
      const limiteFim = encerrando_em_meses ? emMeses(encerrando_em_meses) : null;

      // Colunas explícitas: CPF e e-mail existem em scholarship_holders e nunca
      // saem daqui. Ver a política de PII do projeto.
      const bolsas = await consultar('consulta de bolsas', (c) => {
        let q = c
          .from('scholarships')
          .select(
            'amount,start_date,end_date,status,scholarship_type,funding_source,' +
              'projects!inner(name,code),scholarship_holders!inner(full_name)'
          )
          .order('end_date', { ascending: true })
          .limit(LIMITE_BOLSAS);
        if (centro) q = q.eq('project_id', centro.id);
        if (bolsista) q = q.ilike('scholarship_holders.full_name', `%${bolsista}%`);
        if (!incluir_encerradas) q = q.eq('status', 'active');
        // Janela de vencimento: já encerradas não interessam à pergunta "o que
        // vence?", então o piso é hoje mesmo quando incluir_encerradas é true.
        if (limiteFim) q = q.gte('end_date', hoje).lte('end_date', limiteFim);
        return q;
      });

      return {
        total: bolsas.length,
        truncado: bolsas.length === LIMITE_BOLSAS,
        filtro: {
          centro_de_custo: centro ? centro.name : null,
          bolsista: bolsista || null,
          apenas_ativas: !incluir_encerradas,
          encerrando_ate: limiteFim,
        },
        bolsas: bolsas.map((b) => ({
          bolsista: b.scholarship_holders ? b.scholarship_holders.full_name : null,
          centro_de_custo: b.projects ? b.projects.name : null,
          codigo: b.projects ? b.projects.code : null,
          valor_mensal: b.amount,
          inicio: b.start_date,
          fim: b.end_date,
          status: b.status,
          tipo: b.scholarship_type,
          fonte: b.funding_source,
        })),
      };
    },
  },

  {
    nome: 'previsto_vs_realizado',
    rotulo: 'Previsto × realizado por rubrica',
    descricao:
      'Execução do centro de custo rubrica a rubrica: quanto o plano de trabalho ' +
      'orçou, quanto o balancete mais recente mostra que saiu, o saldo e o ' +
      'percentual executado. Responde "onde o dinheiro está sendo gasto?" e ' +
      '"que rubrica está estourando ou parada?".\n\n' +
      'Olha só para TRÁS: não desconta compromissos futuros já assumidos (bolsas ' +
      'que continuarão a ser pagas) — para decidir se cabe um gasto novo, use ' +
      'saldo_livre. `nao_mapeados` são lançamentos do balancete sem rubrica ' +
      'correspondente, em geral tributários, e não entram em nenhuma linha.',
    parametros: {
      type: 'object',
      required: ['centro_de_custo'],
      properties: {
        centro_de_custo: { type: 'string', description: 'Nome, código ou id do centro de custo.' },
      },
    },
    async executar({ centro_de_custo }) {
      const centro = await resolverCentro(centro_de_custo);
      return rpc('get_previsto_vs_realizado', { p_project_id: centro.id });
    },
  },

  {
    nome: 'projecao_de_caixa',
    rotulo: 'Projeção de caixa mês a mês',
    descricao:
      'Saldo projetado mês a mês até o fim da vigência, com as saídas de bolsas e ' +
      'as entradas de desembolsos já registrados. Responde "até quando o dinheiro ' +
      'dura?" e "em que mês o saldo fica negativo?".\n\n' +
      'A única saída projetada é BOLSA — diária, equipamento e contrato futuros ' +
      'não existem em tabela nenhuma, então o saldo é otimista. Parte do saldo ' +
      'inicial cadastrado no projeto, NÃO do saldo real da conta no balancete: ' +
      'para a projeção ancorada no extrato, use simular_alocacao, que quantifica ' +
      'a janela cega.',
    parametros: {
      type: 'object',
      required: ['centro_de_custo'],
      properties: {
        centro_de_custo: { type: 'string', description: 'Nome, código ou id do centro de custo.' },
        inicio: { type: 'string', description: 'Início da projeção, AAAA-MM-DD. Padrão: mês corrente.' },
        fim: { type: 'string', description: 'Fim da projeção, AAAA-MM-DD. Padrão: fim da vigência.' },
      },
    },
    async executar({ centro_de_custo, inicio, fim }) {
      const centro = await resolverCentro(centro_de_custo);

      // Retorna linhas (não jsonb): a RPC é `returns table`. O envelope existe
      // só para nomear o que as linhas são e o que a projeção NÃO cobre — sem
      // isso, uma tabela de saldos mês a mês se parece com previsão completa.
      const meses = await rpc('calc_project_monthly', {
        p_project_id: centro.id,
        p_start_date: inicio || null,
        p_end_date: fim || null,
      });

      return {
        centro_de_custo: centro.name,
        meses,
        nota:
          'Projeção de caixa mês a mês. As únicas saídas projetadas são BOLSAS ' +
          'ativas; diária, equipamento e contrato futuros não têm previsão em ' +
          'tabela nenhuma, então o saldo projetado é otimista. As entradas são os ' +
          'desembolsos já registrados. O ponto de partida é o saldo inicial ' +
          'cadastrado no projeto, não o saldo do balancete — para a projeção ' +
          'ancorada no extrato real da conta, use simular_alocacao.',
      };
    },
  },

  {
    nome: 'plano_de_trabalho',
    rotulo: 'Plano de trabalho do centro de custo',
    descricao:
      'O plano de trabalho ATIVO: rubricas com o valor orçado em cada uma, ' +
      'cronograma de desembolso previsto, título, tipo e valor total. Responde ' +
      '"o que foi aprovado neste projeto?" e "quanto tem previsto em ' +
      'equipamento?".\n\n' +
      'É o ORÇADO, não o executado. Para o executado use previsto_vs_realizado; ' +
      'para o que ainda está livre, saldo_livre. `has_plano: false` é a ' +
      'explicação de o centro não aparecer nessas duas: sem plano não há ' +
      'previsto por rubrica. Parcelas com `valor` nulo têm só `valor_texto` ' +
      'porque o plano as descreve sem número fechado.',
    parametros: {
      type: 'object',
      required: ['centro_de_custo'],
      properties: {
        centro_de_custo: { type: 'string', description: 'Nome, código ou id do centro de custo.' },
        incluir_historico: {
          type: 'boolean',
          description: 'Inclui a lista de versões anteriores do plano. Padrão: false.',
        },
      },
    },
    async executar({ centro_de_custo, incluir_historico }) {
      const centro = await resolverCentro(centro_de_custo);
      const plano = await rpc('get_plano_ativo', { p_project_id: centro.id });

      if (!plano) {
        return {
          centro_de_custo: centro.name,
          has_plano: false,
          message:
            'Este centro de custo não tem plano de trabalho ativo. Sem plano não ' +
            'há previsto por rubrica: saldo_livre e simular_alocacao não têm o que ' +
            'calcular para ele.',
        };
      }

      const historico = incluir_historico
        ? await rpc('get_planos_historico', { p_project_id: centro.id })
        : null;

      const resposta = {
        centro_de_custo: centro.name,
        has_plano: true,
        plano: enxugarPlano(plano),
        nota:
          'O plano é o ORÇADO, não o executado: `valor_previsto` de cada rubrica é ' +
          'o que foi aprovado pelo financiador, e `desembolsos` é o cronograma de ' +
          'repasse previsto. Para o que de fato saiu, use previsto_vs_realizado ' +
          '(cruza com o balancete); para o que ainda está livre, saldo_livre. ' +
          'Parcelas com `valor` nulo têm só `valor_texto` porque o plano as ' +
          'descreve sem número fechado (ex.: "mediante cálculo de gastos").',
      };
      if (historico) resposta.historico = historico;
      return resposta;
    },
  },

  {
    nome: 'quem_sou_eu',
    rotulo: 'Sessão atual',
    descricao:
      'Com qual usuário e papel esta sessão está logada. Útil quando o resultado ' +
      'parece incompleto: um professor vê só os centros de custo dele.',
    parametros: { type: 'object', properties: {} },
    async executar() {
      const { data } = await sb().auth.getUser();
      const usuario = data && data.user;
      if (!usuario) throw new Error('Sessão não autenticada.');
      const perfil = await consultar('perfil do usuário', (c) =>
        c.from('app_users').select('role').eq('user_id', usuario.id).maybeSingle()
      );
      return { email: usuario.email, papel: (perfil && perfil.role) || 'desconhecido' };
    },
  },
];

/** As tools no formato que o Ollama espera em `/api/chat`. */
export function especificacoes() {
  return TOOLS.map((t) => ({
    type: 'function',
    function: {
      name: t.nome,
      description: t.descricao,
      parameters: t.parametros,
    },
  }));
}

export function rotuloDaTool(nome) {
  const t = TOOLS.find((x) => x.nome === nome);
  return t ? t.rotulo : nome;
}

/** Executa uma tool pelo nome. Nome desconhecido é erro do modelo, não do usuário. */
export async function executarTool(nome, args) {
  const tool = TOOLS.find((t) => t.nome === nome);
  if (!tool) {
    throw new Error(
      `Tool desconhecida: "${nome}". Disponíveis: ${TOOLS.map((t) => t.nome).join(', ')}.`
    );
  }
  return tool.executar(args || {});
}

// Bridge para os scripts clássicos (a aba Assistente é um <script> comum).
if (typeof window !== 'undefined') {
  window.CFTools = { TOOLS, especificacoes, executarTool, rotuloDaTool };
}

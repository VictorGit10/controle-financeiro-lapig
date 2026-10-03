// As tools. Cada uma é fina de propósito: resolve nome para id, chama a RPC e
// devolve o JSON como veio.
//
// Nenhuma soma, projeta, ordena ou reinterpreta número aqui. A camada de decisão
// mora no banco (migrações 038/039) porque a aba do site vai consumir as mesmas
// RPCs — inteligência duplicada no adaptador viraria duas versões divergentes da
// mesma conta. Se um número parece errado, o conserto é na migração.

import { rpc, consultar } from './client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function centrosVisiveis() {
  return consultar('lista de centros de custo', (sb) =>
    sb.from('projects').select('id,name,code,start_date,end_date,active').order('name')
  );
}

/**
 * Aceita uuid, código ou nome (inteiro ou pedaço). Resolver nome é trabalho de
 * adaptador, não de decisão — por isso a regra é burra e explícita, e ambiguidade
 * vira erro com os candidatos em vez de um palpite.
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

export async function listarCentrosDeCusto() {
  const centros = await centrosVisiveis();
  return {
    total: centros.length,
    nota:
      'Esta lista já vem escopada pelo RLS: são os centros de custo deste login, ' +
      'não os do banco inteiro.',
    centros,
  };
}

export async function saldoLivre({ centro_de_custo }) {
  const centro = await resolverCentro(centro_de_custo);
  return rpc('get_saldo_livre', { p_project_id: centro.id });
}

export async function simularAlocacao({ tipo, valor, rubrica, inicio, meses, centros_de_custo }) {
  let ids = null;
  if (Array.isArray(centros_de_custo) && centros_de_custo.length) {
    const resolvidos = await Promise.all(centros_de_custo.map(resolverCentro));
    ids = resolvidos.map((c) => c.id);
  }
  return rpc('simular_alocacao', {
    p_tipo: tipo,
    p_valor: valor,
    p_rubrica: rubrica ?? null,
    p_inicio: inicio ?? null,
    p_meses: meses ?? null,
    p_project_ids: ids,
  });
}

/** Data de hoje deslocada em N meses, em AAAA-MM-DD. */
function emMeses(n) {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

// Teto de linhas. Sem filtro nenhum e com escopo de admin, a consulta
// pegaria a base inteira — o corte existe para a resposta caber, e o campo
// `truncado` avisa em vez de mentir por omissão.
const LIMITE_BOLSAS = 500;

/**
 * A RPC bolsistas_nomes (mig. 052) existe neste banco? Pergunta uma vez por
 * processo. "Função não encontrada" (PGRST202) = migração ainda não aplicada.
 */
let _temBolsistasNomes = null;
async function bolsistasNomesDisponivel() {
  if (_temBolsistasNomes !== null) return _temBolsistasNomes;
  try {
    await rpc('bolsistas_nomes', { p_ids: [], p_busca: null });
    _temBolsistasNomes = true;
  } catch (e) {
    // Só o "função não existe" do PostgREST conta como migração pendente.
    // Qualquer outro erro (rede, sessão) sobe: cair no embed antigo em silêncio
    // daria lista VAZIA ao Buriti depois da 052, com cara de resposta.
    if (/Could not find the function|PGRST202/i.test(String(e.message))) _temBolsistasNomes = false;
    else throw e;
  }
  return _temBolsistasNomes;
}

export async function consultarBolsas({
  centro_de_custo,
  bolsista,
  incluir_encerradas,
  encerrando_em_meses,
}) {
  // Sem filtro é chamada legítima ("todas as bolsas que eu enxergo"): o RLS
  // já escopa, e exigir filtro só quebrava a pergunta aberta de quem
  // coordena vários centros de custo.
  const centro = centro_de_custo ? await resolverCentro(centro_de_custo) : null;

  const hoje = emMeses(0);
  const limiteFim = encerrando_em_meses ? emMeses(encerrando_em_meses) : null;

  // O nome do bolsista NÃO vem por embed de scholarship_holders: desde a mig.
  // 052 o papel agente (Buriti) não lê aquela tabela — ela tem CPF e e-mail —,
  // e o embed `!inner` voltaria lista vazia, sem erro. O nome vem da RPC
  // `bolsistas_nomes`, que devolve só (id, full_name) no escopo de quem pergunta.
  // Antes da 052 a RPC não existe; aí o embed antigo (só full_name) segue valendo.
  const nomesPorRpc = await bolsistasNomesDisponivel();

  let idsDoBolsista = null;
  if (bolsista && nomesPorRpc) {
    const achados = await rpc('bolsistas_nomes', { p_ids: null, p_busca: bolsista });
    idsDoBolsista = (achados || []).map((h) => h.id);
    if (idsDoBolsista.length === 0) idsDoBolsista = ['00000000-0000-0000-0000-000000000000'];
  }

  const bolsas = await consultar('consulta de bolsas', (sb) => {
    let q = sb
      .from('scholarships')
      .select(
        'holder_id,amount,start_date,end_date,status,scholarship_type,funding_source,' +
          'projects!inner(name,code)' +
          (nomesPorRpc ? '' : ',scholarship_holders!inner(full_name)')
      )
      .order('end_date', { ascending: true })
      .limit(LIMITE_BOLSAS);
    if (centro) q = q.eq('project_id', centro.id);
    if (bolsista && idsDoBolsista) q = q.in('holder_id', idsDoBolsista);
    if (bolsista && !nomesPorRpc) q = q.ilike('scholarship_holders.full_name', `%${bolsista}%`);
    if (!incluir_encerradas) q = q.eq('status', 'active');
    // Janela de vencimento: já encerradas não interessam à pergunta "o que
    // vence?", então o piso é hoje mesmo quando incluir_encerradas é true.
    if (limiteFim) q = q.gte('end_date', hoje).lte('end_date', limiteFim);
    return q;
  });

  const nomes = {};
  if (nomesPorRpc && bolsas.length) {
    const ids = [...new Set(bolsas.map((b) => b.holder_id))];
    for (const h of (await rpc('bolsistas_nomes', { p_ids: ids, p_busca: null })) || []) nomes[h.id] = h.full_name;
  }

  return {
    total: bolsas.length,
    truncado: bolsas.length === LIMITE_BOLSAS,
    filtro: {
      centro_de_custo: centro?.name ?? null,
      bolsista: bolsista ?? null,
      apenas_ativas: !incluir_encerradas,
      encerrando_ate: limiteFim,
    },
    bolsas: bolsas.map((b) => ({
      bolsista: (nomesPorRpc ? nomes[b.holder_id] : b.scholarship_holders?.full_name) ?? null,
      centro_de_custo: b.projects?.name ?? null,
      codigo: b.projects?.code ?? null,
      valor_mensal: b.amount,
      inicio: b.start_date,
      fim: b.end_date,
      status: b.status,
      tipo: b.scholarship_type,
      fonte: b.funding_source,
    })),
  };
}

export async function panorama({ centros_de_custo, incluir_inativos }) {
  let ids = null;
  if (Array.isArray(centros_de_custo) && centros_de_custo.length) {
    const resolvidos = await Promise.all(centros_de_custo.map(resolverCentro));
    ids = resolvidos.map((c) => c.id);
  }
  return rpc('get_panorama', {
    p_project_ids: ids,
    p_incluir_inativos: incluir_inativos ?? false,
  });
}

export async function previstoVsRealizado({ centro_de_custo }) {
  const centro = await resolverCentro(centro_de_custo);
  return rpc('get_previsto_vs_realizado', { p_project_id: centro.id });
}

export async function projecaoDeCaixa({ centro_de_custo, inicio, fim }) {
  const centro = await resolverCentro(centro_de_custo);

  // Retorna linhas (não jsonb): a RPC é `returns table`. O envelope existe
  // só para nomear o que as linhas são e o que a projeção NÃO cobre — sem
  // isso, uma tabela de saldos mês a mês se parece com previsão completa.
  const meses = await rpc('calc_project_monthly', {
    p_project_id: centro.id,
    p_start_date: inicio ?? null,
    p_end_date: fim ?? null,
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
}

// O que sai do plano. `get_plano_ativo` devolve `to_jsonb(pt.*)` — a linha
// inteira de planos_trabalho —, e boa parte não serve a quem lê: `raw_extraction`
// é o objeto que o parser tirou do documento, ou seja uma SEGUNDA CÓPIA das
// mesmas rubricas e desembolsos que já vêm estruturados logo abaixo, e
// arquivo_storage_path / created_by / timestamps são encanamento interno.
//
// Escolher coluna é trabalho de adaptador — é o mesmo que consultar_bolsas já
// faz — e não toca em número nenhum. A poda fica aqui e não na RPC de propósito:
// get_plano_ativo é contrato compartilhado com o frontend.
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
  // Os ids de linha também caem: não há tool de escrita aqui, então nada os usa
  // de volta.
  enxuto.rubricas = (plano.rubricas ?? []).map((r) => ({
    rubrica_code: r.rubrica_code,
    rubrica_name: r.rubrica_name,
    parent_code: r.parent_code,
    valor_previsto: r.valor_previsto,
    descricao_livre: r.descricao_livre,
  }));
  enxuto.desembolsos = (plano.desembolsos ?? []).map((d) => ({
    parcela: d.parcela,
    data_prevista: d.data_prevista,
    data_texto: d.data_texto,
    valor: d.valor,
    valor_texto: d.valor_texto,
  }));
  return enxuto;
}

export async function planoDeTrabalho({ centro_de_custo, incluir_historico }) {
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

  return {
    centro_de_custo: centro.name,
    has_plano: true,
    plano: enxugarPlano(plano),
    ...(historico ? { historico } : {}),
    nota:
      'O plano é o ORÇADO, não o executado: `valor_previsto` de cada rubrica é ' +
      'o que foi aprovado pelo financiador, e `desembolsos` é o cronograma de ' +
      'repasse previsto. Para o que de fato saiu, use previsto_vs_realizado ' +
      '(cruza com o balancete); para o que ainda está livre, saldo_livre. ' +
      'Parcelas com `valor` nulo têm só `valor_texto` porque o plano as ' +
      'descreve sem número fechado (ex.: "mediante cálculo de gastos").',
  };
}

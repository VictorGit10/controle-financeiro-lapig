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

  // Colunas explícitas: CPF e e-mail existem em scholarship_holders e nunca saem
  // daqui. Ver a política de PII do projeto.
  const bolsas = await consultar('consulta de bolsas', (sb) => {
    let q = sb
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
      centro_de_custo: centro?.name ?? null,
      bolsista: bolsista ?? null,
      apenas_ativas: !incluir_encerradas,
      encerrando_ate: limiteFim,
    },
    bolsas: bolsas.map((b) => ({
      bolsista: b.scholarship_holders?.full_name ?? null,
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
    plano,
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

import { registroFeito } from '../../frontend/js/components/buriti-tarefas.js';

// Parte pura: escolhe somente os campos do contrato da RPC 054.
// Validação de conteúdo/PII e autorização continuam no banco.
export function montarPayloadTarefa(entrada, projectId) {
  if (!projectId) throw new Error('Informe project_id ou o código do centro de custo.');
  if (!entrada.titulo?.trim()) throw new Error('Título obrigatório.');
  if (!Array.isArray(entrada.passos) || entrada.passos.length < 1 || entrada.passos.length > 50) {
    throw new Error('Use de 1 a 50 passos.');
  }
  const payload = { project_id: projectId, titulo: entrada.titulo.trim(), passos: entrada.passos.map(s => {
    if (!s.descricao?.trim()) throw new Error('Descrição do passo obrigatória.');
    if (s.executor != null && !['buriti', 'pessoa'].includes(s.executor)) throw new Error('Executor do passo: buriti ou pessoa.');
    return { descricao: s.descricao.trim(), ...(s.quem != null ? { quem: s.quem } : {}),
      ...(s.executor != null ? { executor: s.executor } : {}),
      ...(s.evidencia != null ? { evidencia: s.evidencia } : {}) };
  }) };
  for (const campo of ['descricao', 'responsavel', 'prazo', 'prazo_motivo', 'chaves']) {
    if (entrada[campo] !== undefined) payload[campo] = entrada[campo];
  }
  return payload;
}

// Dependências injetáveis: testável sem login, SDK ou rede. Nenhuma decisão
// financeira ou de autorização é feita no adaptador.
function texto(v, rotulo) {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${rotulo} obrigatório.`);
  return v.trim();
}

export function criarToolsTarefas({ rpc, consultar, centroPorCodigo, rpcOperador }) {
  async function resolver(entrada) {
    const termo = entrada.project_id || entrada.centro_de_custo;
    if (!termo) return null;
    if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(termo)) return termo;
    return (await centroPorCodigo(termo)).id;
  }
  return {
    async proporTarefa(entrada) {
      const payload = montarPayloadTarefa(entrada, await resolver(entrada));
      const id = await rpc('propor_tarefa', { p: payload });
      return { proposta_id: id,
        proximo_passo: 'A tarefa só existe depois que o Victor aplica a proposta na página Buriti do site.' };
    },
    // Escritas do Buriti operador (055): o pedido do Victor no chat é o "ok" (AGENTS.md, 07/10/2026).
    async criarTarefa(entrada) {
      const payload = montarPayloadTarefa(entrada, await resolver(entrada));
      delete payload.responsavel;
      const id = await rpcOperador('buriti_criar_tarefa', { p: payload, p_responsavel: entrada.responsavel ?? null });
      return { tarefa_id: id, nota: 'Tarefa criada. Faça os passos do Buriti e avise o responsável.' };
    },
    async concluirMeuPasso({ passo_id, nota }) {
      await rpcOperador('buriti_concluir_passo', { p_passo: texto(passo_id, 'passo_id'), p_nota: texto(nota, 'nota') });
      return { ok: true };
    },
    async confirmarPasso({ passo_id, prova }) {
      await rpcOperador('buriti_confirmar_passo', { p_passo: texto(passo_id, 'passo_id'), p_prova: texto(prova, 'prova') });
      return { ok: true };
    },
    async anotarTarefa({ tarefa_id, texto: t, cobranca = false }) {
      await rpcOperador('buriti_anotar', { p_tarefa: texto(tarefa_id, 'tarefa_id'), p_texto: texto(t, 'texto'), p_cobranca: cobranca === true });
      return { ok: true };
    },
    async pedirAtencao({ tarefa_id, motivo }) {
      await rpcOperador('buriti_pedir_atencao', { p_tarefa: texto(tarefa_id, 'tarefa_id'), p_motivo: texto(motivo, 'motivo') });
      return { ok: true };
    },
    async concluirTarefa({ tarefa_id, nota }) {
      await rpcOperador('buriti_concluir_tarefa', { p_tarefa: texto(tarefa_id, 'tarefa_id'), p_nota: texto(nota, 'nota') });
      return { ok: true };
    },
    async listarTarefas(entrada = {}) {
      const { status = 'abertas', limite = 50 } = entrada;
      const id = await resolver(entrada);
      const teto = Math.min(limite, 200);
      const linhas = await consultar('tarefas', sb => {
        let q = sb.from('tarefas').select('id,project_id,titulo,descricao,responsavel,status,precisa_atencao,' +
          'motivo_atencao,prazo,prazo_motivo,proxima_checagem,criada_em,concluida_em,criada_pelo_buriti,projects(name,code),' +
          'tarefa_passos(id,ordem,descricao,quem,executor,estado,confirmado_em,evento_id,' +
          'feito:tarefa_eventos!ultimo_feito_id(tipo,origem,detalhe)), ' +
          'eventos:tarefa_eventos!tarefa_eventos_tarefa_id_fkey(id,tipo,origem,resumo,detalhe,gmail_thread_id,ocorrido_em,criado_em)')
          .order('prazo', { ascending: true, nullsFirst: false }).order('id')
          .order('ordem', { referencedTable: 'tarefa_passos' })
          .order('criado_em', { referencedTable: 'eventos', ascending: false })
          .order('id', { referencedTable: 'eventos' }).limit(10, { referencedTable: 'eventos' }).limit(teto);
        if (id) q = q.eq('project_id', id);
        if (status === 'abertas') q = q.in('status', ['em_andamento', 'aguardando_terceiro']);
        else if (status !== 'todas') q = q.eq('status', status === 'concluidas' ? 'concluida' : status);
        return q;
      });
      return { tarefas: linhas.map(t => ({ ...t, tarefa_passos: t.tarefa_passos.map(s => ({ ...s, feito: registroFeito(s) })) })), truncado: linhas.length === teto,
        nota: 'Leitura escopada pelo RLS. Eventos limitados aos 10 últimos de cada tarefa; passos sugeridos ainda exigem confirmação humana.' };
    },
  };
}

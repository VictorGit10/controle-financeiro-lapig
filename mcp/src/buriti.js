// O Buriti — agente de gestão financeira. ELE PROPÕE, UM HUMANO APLICA.
//
// Estas tools nunca gravam dado financeiro: o papel `agente` é barrado em
// toda tabela de public por gatilho (mig. 051). O que elas fazem é criar
// PROPOSTAS em `propostas_agente`, que um humano revisa no site e aplica
// pelo caminho normal (upsert_balancete…).
//
// Uma implementação só: o PDF é lido com a mesma montagem de texto
// (frontend/js/parsers/pdf-texto.js) e o MESMO parser
// (frontend/js/parsers/balancete-parser.js) da importação do site. Se a
// proposta disser um número diferente do que o site leria, o conserto é
// no parser — e vale para os dois.

import fs from 'node:fs/promises';
import path from 'node:path';

import { textoDoPdf, montarPropostaBalancete, montarPropostaPlano, DATA } from './buriti-proposta.js';
import { lerPlano } from './buriti-plano-leitura.js';
import { PtFormatError } from '../../frontend/js/parsers/pt-parser.js';
import { rpc, consultar, armazenar } from './client.js';
import { criarToolsTarefas } from './buriti-tarefa.js';
import { rpcOperador } from './operador.js';

export const BUCKET = 'propostas-agente';

export const { proporTarefa, listarTarefas, criarTarefa, concluirMeuPasso, confirmarPasso, anotarTarefa, pedirAtencao,
  concluirTarefa } = criarToolsTarefas({ rpc, consultar, centroPorCodigo, rpcOperador });

async function mapaAtivo() {
  return consultar('mapa conta → rubrica', (sb) =>
    sb.from('conta_rubrica_map').select('conta_prefix, rubrica_code').eq('ativo', true)
  );
}

async function centroPorCodigo(codigo) {
  const centros = await consultar('centros de custo', (sb) =>
    sb.from('projects').select('id,name,code').eq('code', codigo)
  );
  if (!centros || centros.length === 0) {
    throw new Error(
      `O centro de custo ${codigo} não está no escopo deste login (ou não existe). ` +
        'Peça ao Victor para atribuí-lo ao Buriti em Usuários & Centros de Custo.'
    );
  }
  if (centros.length > 1) throw new Error(`Mais de um centro de custo com o código ${codigo}.`);
  return centros[0];
}

export async function proporBalancete({ caminho_pdf, simular = false, sugestoes = [] }) {
  const bytes = await fs.readFile(caminho_pdf);
  const arquivoNome = path.basename(caminho_pdf);
  const texto = await textoDoPdf(bytes);
  const mapa = await mapaAtivo();
  const p = montarPropostaBalancete({ texto, arquivoNome, mapa, sugestoes });
  if (!p.ok) {
    return { criada: false, motivo: p.problemas.join(' '), resumo: p.resumo };
  }
  const centro = await centroPorCodigo(p.project_code);

  // Contexto que o humano quer ver: este balancete é mais novo que o último?
  const ultimo = await consultar('último balancete', (sb) =>
    sb.from('balancetes').select('data_referencia').eq('project_id', centro.id)
      .order('data_referencia', { ascending: false }).limit(1)
  );
  const anterior = ultimo?.[0]?.data_referencia || null;
  if (anterior && anterior >= p.chave) {
    p.payload.avisos.push(
      anterior === p.chave
        ? `Já existe balancete gravado com esta data (${DATA(anterior)}): aplicar SUBSTITUI os lançamentos dele.`
        : `Este balancete (${DATA(p.chave)}) é MAIS ANTIGO que o último gravado (${DATA(anterior)}).`
    );
  }
  p.payload.balancete_anterior = anterior;
  p.payload.project_id = centro.id;

  if (simular) {
    return { criada: false, simulacao: true, centro: centro.name, resumo: p.resumo, perguntas: p.payload.perguntas, avisos: p.payload.avisos };
  }

  const seguro = arquivoNome.replace(/[^\w.-]/g, '_');
  const arquivo = await armazenar(BUCKET, `${centro.id}/${Date.now()}_${seguro}`, bytes, 'application/pdf');
  const id = await rpc('criar_proposta', {
    p_tipo: 'balancete',
    p_project_id: centro.id,
    p_resumo: p.resumo,
    p_payload: p.payload,
    p_arquivo_path: arquivo,
    p_chave: p.chave,
  });
  return {
    criada: true,
    proposta_id: id,
    centro: centro.name,
    resumo: p.resumo,
    perguntas: p.payload.perguntas.length,
    avisos: p.payload.avisos,
    proximo_passo: 'Um humano revisa e aplica na página Buriti do site. Nada foi gravado no balancete.',
  };
}


/** Plano original/remanejamento: nenhuma gravação financeira pelo agente. */
export async function proporPlano({ caminho, centro_de_custo, tipo, simular = false }) {
  if (!centro_de_custo?.trim()) throw new Error('Informe o código do centro de custo: o DOCX do PROAD não o contém.');
  if (!['original', 'remanejamento'].includes(tipo)) throw new Error('Tipo do plano: original ou remanejamento.');
  const arquivoNome = path.basename(caminho);
  let extraido;
  let bytes;
  try {
    // Formato inválido deve ser recusado mesmo se o caminho não existir.
    if (!/\.(docx|pdf)$/i.test(arquivoNome)) {
      return { criada: false, motivo: 'Não há leitor automático para este formato. Use DOCX no padrão PROAD/UFG ou o PDF do plano assinado.' };
    }
    bytes = await fs.readFile(caminho);
    extraido = await lerPlano(bytes, arquivoNome);
  } catch (err) {
    if (err instanceof PtFormatError) return { criada: false, motivo: err.message };
    throw err;
  }
  // Recusa CPF antes de consultar contexto, enviar arquivo ou criar proposta.
  const preliminar = montarPropostaPlano({ extraido, arquivoNome, tipo });
  if (!preliminar.ok) return { criada: false, motivo: preliminar.problemas.join(' ') };
  const centro = await centroPorCodigo(centro_de_custo.trim());
  const planoAtivo = await rpc('get_plano_ativo', { p_project_id: centro.id });
  const p = montarPropostaPlano({ extraido, arquivoNome, tipo, planoAtivo });
  if (simular) return {
    criada: false, simulacao: true, centro: centro.name, resumo: p.resumo,
    avisos: p.payload.avisos, conferencias: p.payload.conferencias,
  };
  const contentType = /\.pdf$/i.test(arquivoNome) ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const seguro = arquivoNome.replace(/[^\w.-]/g, '_');
  const arquivo = await armazenar(BUCKET, `${centro.id}/${Date.now()}_${seguro}`, bytes, contentType);
  const id = await rpc('criar_proposta', {
    p_tipo: 'plano', p_project_id: centro.id, p_resumo: p.resumo,
    p_payload: p.payload, p_arquivo_path: arquivo, p_chave: p.chave,
  });
  return {
    criada: true, proposta_id: id, centro: centro.name, resumo: p.resumo, avisos: p.payload.avisos,
    proximo_passo: 'Um humano revisa e aplica na página Buriti do site. Nada foi gravado no plano de trabalho.',
  };
}

export async function listarPropostas({ status = 'pendente', centro_de_custo, limite = 50 } = {}) {
  const linhas = await consultar('propostas', (sb) => {
    let q = sb.from('propostas_agente')
      .select('id,tipo,project_id,chave,resumo,status,criada_em,decidida_em,motivo,objeto_id')
      .order('criada_em', { ascending: false })
      .limit(Math.min(limite, 200));
    if (status && status !== 'todas') q = q.eq('status', status);
    return q;
  });
  let filtradas = linhas;
  if (centro_de_custo) {
    const c = await centroPorCodigo(centro_de_custo);
    filtradas = linhas.filter((l) => l.project_id === c.id);
  }
  return { total: filtradas.length, propostas: filtradas };
}

export async function perguntar({ texto, centro_de_custo }) {
  const t = String(texto || '').trim();
  if (!t) throw new Error('Escreva a pergunta.');
  const centro = centro_de_custo ? await centroPorCodigo(centro_de_custo) : null;
  const id = await rpc('criar_proposta', {
    p_tipo: 'pergunta',
    p_project_id: centro?.id ?? null,
    p_resumo: t,
    p_payload: {},
  });
  return {
    proposta_id: id,
    proximo_passo: 'A pergunta aparece na página Buriti do site. A resposta volta em listar_propostas (status respondida, campo motivo).',
  };
}

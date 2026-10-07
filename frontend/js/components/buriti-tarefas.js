// Datas de calendário: UTC só para contar dias, sem deslocar o prazo por fuso/DST.
export function seloPrazo(prazo, hoje = new Date()) {
  if (!prazo) return { texto: 'Sem prazo', classe: 'badge--info' };
  const [ano, mes, dia] = prazo.split('-').map(Number);
  const dias = Math.round((Date.UTC(ano, mes - 1, dia) -
    Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())) / 86400000);
  if (dias === 0) return { texto: 'vence hoje', classe: 'badge--warning' };
  const n = Math.abs(dias), unidade = n === 1 ? 'dia' : 'dias';
  return dias < 0
    ? { texto: `vencida há ${n} ${unidade}`, classe: 'badge--ended' }
    : { texto: `faltam ${n} ${unidade}`, classe: dias <= 5 ? 'badge--warning' : 'badge--info' };
}

export function ordenarTarefas(tarefas) {
  return [...tarefas].sort((a, b) => (a.prazo || '9999').localeCompare(b.prazo || '9999') ||
    (a.criada_em || '').localeCompare(b.criada_em || '') || a.id.localeCompare(b.id));
}

export function dataHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function gmailLink(thread) {
  return thread ? `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(thread)}` : null;
}

export function saudeVigia(execucao, agora = new Date()) {
  if (!execucao?.terminada_em) return { texto: 'vigia nunca rodou', atrasado: true };
  const minutos = Math.max(0, Math.floor((agora - new Date(execucao.terminada_em)) / 60000));
  const tempo = minutos < 60 ? `${minutos} min` : `${Math.floor(minutos / 60)} h`;
  const atrasado = agora - new Date(execucao.terminada_em) > 7200000;
  return { texto: atrasado ? `vigia atrasado (última checagem há ${tempo})`
    : `Vigia: última checagem há ${tempo}`, atrasado };
}

export const ESTADOS_PASSO = {
  pendente: { icone: 'circle', texto: 'Pendente' },
  sugerido: { icone: 'circle-help', texto: 'Sugerido' },
  confirmado: { icone: 'circle-check', texto: 'Confirmado' },
  dispensado: { icone: 'circle-minus', texto: 'Dispensado' },
};

// O que a mensagem significa, para o Victor não precisar ler o trecho para saber.
const CLASSIFICACOES = {
  exigencia: { texto: 'Exigência', classe: 'badge--warning' },
  duvida: { texto: 'Dúvida', classe: 'badge--warning' },
  concluido: { texto: 'Diz que concluiu', classe: 'badge--warning' },
  informativo: { texto: 'Informativo', classe: 'badge--info' },
  sem_acao: { texto: 'Sem ação', classe: 'badge--info' },
};

export function seloClassificacao(classificacao) {
  return CLASSIFICACOES[classificacao] || null;
}

const MOTIVOS = {
  demanda_nova: 'Assunto novo, sem tarefa',
  mascara_falhou: 'Dado pessoal não mascarado — conteúdo retido',
  alegacao_sem_evidencia: 'Diz que fez, sem prova no e-mail',
  ausencia: 'Resposta automática de ausência',
  spam: 'Veio do spam',
  spam_com_vinculo: 'Veio do spam, mas parece da tarefa',
  mensagem_propria: 'Mensagem sua',
  regra: 'Ligada por regra',
  modelo: 'Ligada pelo modelo',
  sem_tarefa_relacionada: 'Sem relação com tarefa aberta',
  agenda: 'Convite de agenda',
  lista: 'Lista de envio',
  json_invalido: 'O modelo respondeu fora do formato',
  confianca_baixa: 'O modelo não teve confiança',
};

export function motivoLegivel(motivo) {
  return MOTIVOS[motivo] || motivo || '';
}

// Vínculo que a regra já garante (mesma conversa da tarefa ou mensagem do próprio Victor) e que não pede
// ação: vai para o bloco recolhido "Ligadas automaticamente", para não disputar atenção com o resto.
export function ligadaAutomaticamente(m) {
  return ['regra', 'mensagem_propria'].includes(m.motivo)
    && !['exigencia', 'duvida', 'concluido'].includes(m.classificacao)
    && (m.vigia_vinculos || []).some(v => v.estado === 'sugerido');
}

// Texto livre continua escapado; somente URLs HTTP(S) viram links.
const escapar = texto => String(texto ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function textoComLinks(texto) {
  return String(texto ?? '').split(/(https?:\/\/[^\s<>"']+)/g).map(parte => {
    if (!/^https?:\/\//.test(parte)) return escapar(parte);
    const url = parte.replace(/[.,;!?)]+$/, '');
    try {
      const parsed = new URL(url);
      if (!parsed.hostname || parsed.username || parsed.password) return escapar(parte);
    } catch { return escapar(parte); }
    return '<a href="' + escapar(url) + '" target="_blank" rel="noopener noreferrer">' +
      escapar(url) + '</a>' + escapar(parte.slice(url.length));
  }).join('');
}

export function validarFeito(nota, link = '') {
  if (!nota?.trim() || nota.length > 2000) throw new Error('Escreva uma nota de até 2000 caracteres.');
  const url = link.trim();
  if (url) {
    let parsed;
    try { parsed = new URL(url); } catch { /* mensagem comum abaixo */ }
    if (url.length > 500 || !/^https:\/\//.test(url) || /\s/.test(url) ||
      !parsed?.hostname || parsed.username || parsed.password) {
      throw new Error('Use um link https:// de até 500 caracteres.');
    }
  }
  return { p_nota: nota.trim(), p_link: url || null };
}

// A FK ultimo_feito_id preserva a evidência mesmo após confirmação e muitos eventos.
export function registroFeito(passo) {
  const e = passo.feito;
  if (e?.origem !== 'humano' || e.tipo !== 'sugestao' || !e.detalhe?.por) return null;
  const seguro = valor => typeof valor === 'string' && !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(valor) ? valor : null;
  const link = seguro(e.detalhe.link);
  return { nota: seguro(e.detalhe.nota) || '[Retido]', por: seguro(e.detalhe.por) || '[Retido]',
    link: link && /^https:\/\//.test(link) ? link : null };
}

export function podeRegistrarFeito(tarefa, usuario, admin = false) {
  return ['em_andamento', 'aguardando_terceiro'].includes(tarefa.status) &&
    (admin || Boolean(usuario && tarefa.responsavel_id === usuario));
}

if (typeof window !== 'undefined') {
  window.BuritiTarefas = { seloPrazo, ordenarTarefas, dataHora, gmailLink, saudeVigia, ESTADOS_PASSO,
    seloClassificacao, motivoLegivel, ligadaAutomaticamente, textoComLinks, validarFeito, registroFeito, podeRegistrarFeito };
}

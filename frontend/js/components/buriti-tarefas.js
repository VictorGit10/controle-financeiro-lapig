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

if (typeof window !== 'undefined') {
  window.BuritiTarefas = { seloPrazo, ordenarTarefas, dataHora, gmailLink, saudeVigia, ESTADOS_PASSO };
}

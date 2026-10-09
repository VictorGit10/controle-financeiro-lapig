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

const seguro = valor => typeof valor === 'string' && !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(valor) ? valor : null;
const linkSeguro = valor => { const l = seguro(valor); return l && /^https:\/\//.test(l) ? l : null; };

// A FK ultimo_feito_id preserva a evidência mesmo após confirmação e muitos eventos. Desde a 057 o passo
// também é marcado por uma atualização da pessoa (tipo 'atualizacao', texto em detalhe.texto).
export function registroFeito(passo) {
  const e = passo.feito;
  if (e?.origem !== 'humano' || !['sugestao', 'atualizacao'].includes(e.tipo) || !e.detalhe?.por) return null;
  const nota = e.tipo === 'atualizacao' ? e.detalhe.texto : e.detalhe.nota;
  return { nota: seguro(nota) || '[Retido]', por: seguro(e.detalhe.por) || '[Retido]', link: linkSeguro(e.detalhe.link) };
}

// Situação que o responsável escolhe ao atualizar (057). A ordem é a do formulário.
export const SITUACOES = {
  em_andamento: { texto: 'Em andamento', classe: 'badge--info', icone: 'loader' },
  esperando: { texto: 'Esperando alguém', classe: 'badge--info', icone: 'hourglass' },
  travado: { texto: 'Travado', classe: 'badge--warning', icone: 'octagon-alert' },
  feito: { texto: 'Feito', classe: 'badge--active', icone: 'circle-check' },
};

export function validarAtualizacao(situacao, texto, link = '') {
  if (!SITUACOES[situacao]) throw new Error('Escolha a situação.');
  if (!texto?.trim() || texto.length > 2000) throw new Error('Escreva o que aconteceu (até 2000 caracteres).');
  if (!seguro(texto)) throw new Error('Tire o endereço de e-mail do texto: o sistema não guarda e-mail de pessoas.');
  const { p_nota, p_link } = validarFeito(texto, link);
  return { p_situacao: situacao, p_texto: p_nota, p_link };
}

// Uma atualização da linha do tempo, pronta para mostrar (ou null se não for uma).
export function lerAtualizacao(e) {
  if (e?.tipo !== 'atualizacao' || e.origem !== 'humano' || !SITUACOES[e.detalhe?.situacao]) return null;
  return { situacao: e.detalhe.situacao, texto: seguro(e.detalhe.texto) || '[Retido]',
    por: seguro(e.detalhe.por) || '[Retido]', link: linkSeguro(e.detalhe.link), quando: e.ocorrido_em || null };
}

export function podeRegistrarFeito(tarefa, usuario, admin = false) {
  return ['em_andamento', 'aguardando_terceiro'].includes(tarefa.status) &&
    (admin || Boolean(usuario && tarefa.responsavel_id === usuario));
}

// Quem fez cada coisa na linha do tempo, para o Victor e o Arthur: o vigia e o operador são o Buriti.
const ORIGENS = { buriti: 'Buriti', vigia: 'Buriti (leitura do e-mail)', humano: 'Pessoa', sistema: 'Sistema' };
export function rotuloOrigem(origem) {
  return ORIGENS[origem] || origem || '';
}

// ---------- Tela de Atividades (058) ----------
function diasAte(prazo, hoje = new Date()) {
  if (!prazo) return null;
  const [ano, mes, dia] = prazo.split('-').map(Number);
  return Math.round((Date.UTC(ano, mes - 1, dia) - Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())) / 86400000);
}

const aberta = t => ['em_andamento', 'aguardando_terceiro'].includes(t.status);

// Em que grupo a atividade aparece. "agora": vence em até 2 dias, travou, ou (para o admin) tem passo
// marcado como feito esperando confirmação ou pedido de atenção. "esperando": depende de alguém de fora.
export const GRUPOS = {
  agora: 'Precisa de atenção',
  andamento: 'Em andamento',
  esperando: 'Esperando alguém',
};

export function grupoAtividade(t, { admin = false, hoje = new Date() } = {}) {
  if (!aberta(t)) return 'encerrada';
  const dias = diasAte(t.prazo, hoje);
  const confirmar = admin && (t.tarefa_passos || []).some(s => s.estado === 'sugerido');
  if (t.situacao === 'travado' || confirmar || (admin && (t.precisa_atencao || t.aviso_responsavel)) ||
    (dias !== null && dias <= 2)) return 'agora';
  if (t.status === 'aguardando_terceiro' || t.situacao === 'esperando') return 'esperando';
  return 'andamento';
}

// Por que está em "agora", em poucas palavras (o primeiro motivo que vale).
export function motivoAgora(t, { admin = false, hoje = new Date() } = {}) {
  const dias = diasAte(t.prazo, hoje);
  if (dias !== null && dias < 0) return `vencida há ${-dias} ${dias === -1 ? 'dia' : 'dias'}`;
  if (t.situacao === 'travado') return 'travada';
  if (admin && (t.tarefa_passos || []).some(s => s.estado === 'sugerido')) return 'confirmar';
  if (dias === 0) return 'vence hoje';
  if (dias !== null && dias <= 2) return dias === 1 ? 'vence amanhã' : 'vence em 2 dias';
  if (admin && t.precisa_atencao) return t.motivo_atencao || 'atenção';
  return null;
}

// O que vem a seguir: para o admin, o passo que alguém marcou como feito; senão, o primeiro em aberto.
export function proximoPasso(t, admin = false) {
  const passos = [...(t.tarefa_passos || [])].sort((a, b) => a.ordem - b.ordem);
  const sugerido = admin && passos.find(s => s.estado === 'sugerido');
  if (sugerido) return { texto: sugerido.descricao, confirmar: true, quem: sugerido.quem || null };
  const aberto = passos.find(s => s.estado === 'pendente') || passos.find(s => s.estado === 'sugerido');
  if (!aberto) return null;
  return { texto: aberto.descricao, confirmar: false, quem: aberto.executor === 'buriti' ? 'Buriti' : aberto.quem || null };
}

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export function prazoCurto(prazo, hoje = new Date()) {
  const dias = diasAte(prazo, hoje);
  if (dias === null) return { texto: 'sem prazo', nivel: 'nenhum' };
  if (dias < 0) return { texto: `venceu há ${-dias} ${dias === -1 ? 'dia' : 'dias'}`, nivel: 'vencido' };
  if (dias === 0) return { texto: 'hoje', nivel: 'vencido' };
  if (dias === 1) return { texto: 'amanhã', nivel: 'perto' };
  if (dias <= 6) return { texto: `em ${dias} dias`, nivel: 'perto' };
  const [, mes, dia] = prazo.split('-').map(Number);
  return { texto: `${dia} ${MESES_CURTOS[mes - 1]}`, nivel: 'longe' };
}

// Ordem dentro do grupo: prazo (vencidas primeiro, sem prazo por último), depois a mais antiga.
export function ordenarAtividades(lista) { return ordenarTarefas(lista); }

export const normalizar = texto => String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// "30.068 remanejar rubricas até 20/10 @Arthur": centro (obrigatório), o que fazer, prazo e responsável
// (padrão: quem anota). Recusa em vez de adivinhar: centro desconhecido, data impossível, nome ambíguo.
export function lerCaptura(texto, { centros = [], pessoas = [], eu = null, hoje = new Date() } = {}) {
  let resto = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (!resto) throw new Error('Escreva a atividade.');
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(resto)) throw new Error('Tire o endereço de e-mail: o sistema não guarda e-mail de pessoas.');
  const codigos = resto.match(/\b\d{2}\.\d{3}\b/g) || [];
  if (!codigos.length) throw new Error('Comece pelo código do centro de custo (ex.: 30.068).');
  if (new Set(codigos).size > 1) throw new Error('Use um centro de custo por atividade.');
  const centro = centros.find(c => c.code === codigos[0]);
  if (!centro) throw new Error(`O centro ${codigos[0]} não está cadastrado ou não está no seu acesso.`);
  resto = resto.replace(/\b\d{2}\.\d{3}\b/g, ' ');

  let prazo = null;
  const data = resto.match(/\b(?:até|ate|prazo)?\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/i);
  if (data) {
    const dia = Number(data[1]), mes = Number(data[2]);
    let ano = data[3] ? Number(data[3].length === 2 ? '20' + data[3] : data[3]) : hoje.getFullYear();
    const valida = a => { const d = new Date(Date.UTC(a, mes - 1, dia)); return d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia; };
    if (!valida(ano)) throw new Error(`A data ${data[1]}/${data[2]} não existe.`);
    // Sem ano e já passada há mais de um mês: é do ano que vem (anotar em dezembro algo para janeiro).
    if (!data[3] && diasAte(`${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`, hoje) < -31) ano += 1;
    prazo = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    resto = resto.replace(data[0], ' ');
  }

  let responsavel = pessoas.find(p => p.user_id === eu) || null;
  const marca = resto.match(/@([^\s@]+)/);
  if (marca) {
    const alvo = normalizar(marca[1]);
    const achados = pessoas.filter(p => normalizar(p.display_name).split(/[\s.]+/).some(parte => parte.startsWith(alvo)));
    if (achados.length !== 1) {
      throw new Error(achados.length ? `"@${marca[1]}" serve para mais de uma pessoa: ${achados.map(p => p.display_name).join(', ')}.`
        : `Não achei "@${marca[1]}" entre as pessoas do sistema.`);
    }
    responsavel = achados[0];
    resto = resto.replace(marca[0], ' ');
  }

  const titulo = resto.replace(/\s+/g, ' ').replace(/^[\s:–—-]+|[\s:–—-]+$/g, '').trim();
  // "Remanejamento de rubricas do 30.068": sem o centro, a preposição do fim sobra.
  const limpo = titulo.replace(/\s+(do|da|de|dos|das|no|na|em|para|pro)$/i, '').trim();
  if (!limpo) throw new Error('Falta dizer o que fazer.');
  if (limpo.length > 300) throw new Error('Resuma em até 300 caracteres.');
  return { centro, titulo: limpo[0].toUpperCase() + limpo.slice(1), prazo, responsavel };
}

if (typeof window !== 'undefined') {
  window.BuritiTarefas = { rotuloOrigem, seloPrazo, ordenarTarefas, dataHora, gmailLink, saudeVigia, ESTADOS_PASSO,
    seloClassificacao, motivoLegivel, ligadaAutomaticamente, textoComLinks, validarFeito, registroFeito, podeRegistrarFeito,
    SITUACOES, validarAtualizacao, lerAtualizacao,
    GRUPOS, grupoAtividade, motivoAgora, proximoPasso, prazoCurto, ordenarAtividades, normalizar, lerCaptura };
}

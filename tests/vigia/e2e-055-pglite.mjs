// Teste de ponta a ponta: vigia (núcleo JS real) contra banco com 054+055+057 (PGlite, sem rede).
// Roda o mesmo SQL sintético de tools/replica-local/rodar-054-pglite.mjs, sem as suítes de
// asserção SQL. Depende só de .cache/pglite-054 (instalação descrita em tools/replica-local/README.md).
//
//   node tests/vigia/e2e-055-pglite.mjs
//
// Cenário: o Buriti operador cria uma tarefa com 2 passos seus (executor 'buriti') e 3 da pessoa
// (responsável Arthur Pietro, sintético), um deles com regra de e-mail "Arthur escreve à FUNAPE
// citando 30.068 e Otávio". O Buriti conclui os 2 passos dele. O vigia processa uma mensagem que
// bate com a regra e outra que não bate. Confere: só o passo certo vira 'sugerido', passos do
// Buriti nunca são tocados pelo vigia, nada é confirmado automaticamente e o resumo diário sai.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PGlite } from '../../.cache/pglite-054/node_modules/@electric-sql/pglite/dist/index.js';

const require = createRequire(import.meta.url);
const U = require('../../tools/vigia/src/00-util.js');
const E = require('../../tools/vigia/src/evidencia.js');
const VigiaProcessar = require('../../tools/vigia/src/processar.js');
const VigiaResumo = require('../../tools/vigia/src/resumo.js');

const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const OPERADOR = '00000000-0000-0000-0000-0000000000d1'; // automação 'vigia' = Buriti operador
const ARTHUR = '00000000-0000-0000-0000-0000000000e1';

let falhas = 0;
function ok(cond, motivo) {
  if (!cond) { falhas++; console.error('FALHOU: ' + motivo); return; }
  console.log('ok - ' + motivo);
}
function j(v) { return typeof v === 'string' ? JSON.parse(v) : v; }

const db = new PGlite();
async function arquivo(path) {
  await db.exec((await readFile(new URL('../../' + path, import.meta.url), 'utf8'))
    .replace(/^\\set ON_ERROR_STOP on\r?$/m, ''));
}
async function comoUsuario(uid, sql) {
  await db.exec(`select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated;`);
  try { return j((await db.query(sql)).rows[0]); } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);
  }
}
async function operador(sql) { return comoUsuario(OPERADOR, sql); }

try {
  for (const path of ['tools/replica-local/sintetico/stub.sql',
    'tools/replica-local/sintetico/stub-051.sql', 'tools/replica-local/sintetico/stub-054.sql',
    'database/051_buriti_propostas_do_agente.sql', 'tools/replica-local/sintetico/stub-052.sql',
    'database/052_privacidade_bolsistas_agente.sql', 'database/054_buriti_tarefas.sql',
    'database/055_buriti_administra_tarefas.sql', 'database/057_tarefas_atualizar_e_editar.sql']) await arquivo(path);
  console.log('Migrações 054 e 055 aplicadas.');

  // Centro sintético com código reconhecível pelo núcleo (NN.NNN); admin ativa a automação.
  await db.exec(`insert into public.projects(name,code,start_date,end_date) values
    ('Stub trinta','30.068','2025-01-01','2027-12-31');`);
  const projeto = j((await db.query(`select id from public.projects where code='30.068'`)).rows[0]);
  await comoUsuario(ADMIN, `select public.set_automacao('${OPERADOR}','vigia',true)`);

  // O Buriti cria a tarefa pelo contrato novo da 055, já com o responsável.
  const tarefaPayload = {
    project_id: projeto.id,
    titulo: 'Implantar 2 meses de bolsa no 30.068',
    prazo: '2026-10-30',
    passos: [
      { descricao: 'Conferir a documentação recebida', executor: 'buriti' },
      { descricao: 'Atualizar a planilha de controle', executor: 'buriti' },
      { descricao: 'Atualizar o quadro interno', quem: 'Arthur' },
      { descricao: 'Cadastrar a bolsa no sistema Conecta', quem: 'Arthur' },
      { descricao: 'Enviar a documentação à FUNAPE', quem: 'Arthur',
        evidencia: { tipo: 'email', de: 'arthur@example.org', para_dominio: 'funape.org.br',
          cc_inclui: ['victor@example.org'], contem_todos: ['30.068'], contem_algum: ['Otávio', 'bolsa'] } }
    ],
    chaves: [{ tipo: 'centro_custo', valor: '30.068' }, { tipo: 'termo', valor: 'Otávio' }]
  };
  const criada = await operador(
    `select public.buriti_criar_tarefa('${JSON.stringify(tarefaPayload)}'::jsonb,'Arthur') as id`);
  const tarefaId = criada.id;
  ok(!!tarefaId, 'buriti_criar_tarefa criou a tarefa');
  const passosRows = j((await db.query(
    `select id, ordem, executor, estado from public.tarefa_passos where tarefa_id='${tarefaId}' order by ordem`)).rows);
  ok(passosRows.length === 5 && passosRows.every(p => p.estado === 'pendente')
    && passosRows.slice(0, 2).every(p => p.executor === 'buriti')
    && passosRows.slice(2).every(p => p.executor === 'pessoa'), '5 passos: 2 buriti + 3 pessoa');

  // Contexto do vigia ANTES das conclusões: prova da análise 1a/1c — passos do Buriti aparecem
  // sem o campo executor e com regra vazia; a regra real só vem de tarefa_passos_regras.
  const ctxAntes = j((await operador(`select public.vigia_contexto() as c`)).c);
  const tarefaCtxAntes = ctxAntes.tarefas.find(t => t.id === tarefaId);
  ok(!!tarefaCtxAntes && tarefaCtxAntes.passos.length === 5, 'contexto traz os 5 passos pendentes');
  ok(tarefaCtxAntes.passos.slice(0, 2).every(p => Object.keys(p).indexOf('executor') < 0
    && Object.prototype.hasOwnProperty.call(p, 'evidencia')), 'passos do Buriti chegam sem executor (análise 1a)');
  ok(tarefaCtxAntes.passos.slice(0, 2).every(p => JSON.stringify(p.evidencia) === '{}'),
    'passos do Buriti chegam com regra vazia ({} nunca casa)');
  ok(tarefaCtxAntes.passos[4].evidencia.tipo === 'email'
    && tarefaCtxAntes.passos[4].evidencia.de === 'arthur@example.org',
    'regra real do passo de pessoa vem de tarefa_passos_regras (análise 1c)');
  ok(tarefaCtxAntes.proposta_id === undefined && ctxAntes.versao_esquema === 1,
    'contexto não lê proposta_id/criada_pelo_buriti (análise 1b)');

  // O núcleo nunca casa regra vazia (passo do Buriti), mesmo com mensagem que bateria no critério.
  const agora = Date.now();
  const msgBase = { gmail_thread_id: 'thread-e2e-1', spam: false, anexos: 0,
    headers: { 'Auto-Submitted': 'no' }, content_type: 'text/plain' };
  ok(E.avaliarPasso({}, Object.assign({}, msgBase, { gmail_message_id: 'x',
    de: 'arthur@example.org', para: 'bolsas@funape.org.br', cc: 'victor@example.org',
    assunto: '30.068 Otávio', corpo: 'bolsa 30.068 do Otávio', recebida_em: new Date(agora).toISOString() }),
    { criada_em: new Date(agora - 60000).toISOString() }, {}).cumpre === false,
    'avaliarPasso com regra {} não cumpre (passo do Buriti não é sugerido)');

  // O Buriti conclui os 2 passos dele; o vigia não participa disso.
  await operador(`select public.buriti_concluir_passo('${passosRows[0].id}','Documentação conferida.')`);
  await operador(`select public.buriti_concluir_passo('${passosRows[1].id}','Planilha atualizada.')`);

  // Execução do vigia: início, contexto, captura, processamento pelo núcleo, fim com efeitos.
  const iniciada = new Date(agora).toISOString();
  const aberta = j((await operador(`select public.vigia_registrar('${JSON.stringify({
    versao: 'vigia-1', execucao: { tipo: 'checagem', iniciada_em: iniciada } })}'::jsonb) as r`)).r);
  const execucaoId = aberta.execucao_id;
  ok(!!execucaoId, 'execução de checagem registrada');
  const ctxCrus = j((await operador(`select public.vigia_contexto() as c`)).c);
  const tarefaCtx = ctxCrus.tarefas.find(t => t.id === tarefaId);
  ok(tarefaCtx && tarefaCtx.passos.length === 3 && tarefaCtx.passos.every(p => p.estado === 'pendente'),
    'contexto depois dos feitos: só os 3 passos de pessoa pendentes');
  const ctx = configurarContexto(ctxCrus);
  function configurarContexto(c) {
    c.config = { modelo: 'glm-5.3-flash', emailVictor: 'victor@example.org' };
    c.mapa = { dominiosInstitucionais: ['funape.org.br', 'ufg.br'] };
    return c;
  }

  // Duas mensagens sintéticas: uma bate na regra do passo 5, outra não bate.
  const msg1 = Object.assign({}, msgBase, {
    gmail_message_id: 'msg-e2e-1', recebida_em: new Date(agora + 30000).toISOString(),
    de: 'Arthur <arthur@example.org>', para: 'bolsas@funape.org.br', cc: 'victor@example.org',
    assunto: 'Bolsa 30.068 — enviada à FUNAPE',
    corpo: 'Enviei à FUNAPE a documentação da bolsa 30.068 do Otávio Sintético.' });
  const msg2 = Object.assign({}, msgBase, {
    gmail_message_id: 'msg-e2e-2', recebida_em: new Date(agora + 60000).toISOString(),
    de: 'otavio@example.org', para: 'victor@example.org', cc: '',
    assunto: 'Bolsa 30.068',
    corpo: 'Quando sai o pagamento da bolsa do projeto 30.068? Estou aguardando resposta.' });
  const capturas = [msg1, msg2].map(m => VigiaProcessar.prepararMensagem(m, ctx).registro);
  ok(capturas.every(r => r.estado === 'capturada' && r.remetente.indexOf('@') < 0),
    'captura mascarada dos dois registros');
  const janela = { inicio: new Date(agora - 25 * 3600000).toISOString(),
    fim: new Date(agora + 90000).toISOString(), completa: true, primeira_carga: true };
  const cap = j((await operador(`select public.vigia_capturar('${JSON.stringify({
    execucao_id: execucaoId, janela: janela, mensagens: capturas })}'::jsonb) as r`)).r);
  ok(cap.mensagens_novas === 2, 'as duas mensagens foram capturadas');

  // Núcleo somente regras (modelo desligado): processa as duas.
  const r1 = VigiaProcessar.processarMensagem(msg1, ctx);
  const r2 = VigiaProcessar.processarMensagem(msg2, ctx);
  const passo5 = passosRows[4].id;
  ok(r1.passos_sugeridos.length === 1 && r1.passos_sugeridos[0].passo_id === passo5,
    'núcleo sugere só o passo 5 (Arthur → FUNAPE)');
  ok(r1.passos_sugeridos.every(p => [passosRows[0].id, passosRows[1].id].indexOf(p.passo_id) < 0)
    && r1.registro_mensagem.fila === 'tarefa' && r1.registro_mensagem.motivo === 'regra',
    'passos do Buriti fora da sugestão; mensagem vai para a fila tarefa');
  ok(r2.passos_sugeridos.length === 0 && r2.registro_mensagem.fila === 'esclarecer'
    && r2.registro_mensagem.motivo === 'sem_modelo',
    'mensagem fora da regra vai a esclarecer sem modelo, sem sugerir nada');

  const fim = j((await operador(`select public.vigia_registrar('${JSON.stringify({
    versao: 'vigia-1',
    execucao: { id: execucaoId, terminada_em: new Date(agora + 120000).toISOString(),
      mensagens_novas: 2, chamadas_modelo: 0, alertas: 0, erros: [] },
    resultados: [r1, r2], eventos: [] })}'::jsonb) as r`)).r);
  ok(Array.isArray(fim.avisos), 'registrar devolveu a outbox');

  // Conferências no banco: nada tocado além do passo 5.
  const depois = j((await db.query(
    `select id, estado, confirmado_por from public.tarefa_passos where tarefa_id='${tarefaId}' order by ordem`)).rows);
  ok(depois[0].estado === 'confirmado' && depois[1].estado === 'confirmado'
    && depois[0].confirmado_por === OPERADOR && depois[1].confirmado_por === OPERADOR,
    'passos do Buriti seguem confirmados pelo Buriti, intocados');
  ok(depois[2].estado === 'pendente' && depois[3].estado === 'pendente',
    'passos de pessoa sem evidência seguem pendentes');
  ok(depois[4].estado === 'sugerido' && depois[4].confirmado_por === null,
    'passo 5 sugerido pelo vigia, sem confirmação automática');
  const evVigia = j((await db.query(
    `select count(*)::int as n from public.tarefa_eventos where tarefa_id='${tarefaId}'
     and origem='vigia' and tipo in ('confirmacao','status')`)).rows[0]);
  ok(evVigia.n === 0, 'nenhum evento de confirmação/status produzido pelo vigia');
  const msgs = j((await db.query(
    `select gmail_message_id, fila, motivo, classificacao from public.vigia_mensagens
     where gmail_message_id in ('msg-e2e-1','msg-e2e-2') order by gmail_message_id`)).rows);
  // O núcleo já marca 'informativo' antes de decidir esclarecer/sem_modelo (processar.js:68,92).
  ok(msgs[0].fila === 'tarefa' && msgs[0].classificacao === 'informativo'
    && msgs[1].fila === 'esclarecer' && msgs[1].classificacao === 'informativo',
    'filas persistidas: tarefa e esclarecer');
  const atencao = j((await db.query(
    `select precisa_atencao from public.tarefas where id='${tarefaId}'`)).rows[0]);
  ok(atencao.precisa_atencao === true, 'tarefa pede atenção do Victor (passo sugerido)');
  // 057: sugestão e mensagem a revisar não viram e-mail avulso; ficam 'resumido' e entram no resumo das 8h.
  const resumidos = j((await db.query(
    `select chave, tipo, estado from public.vigia_avisos where tipo in ('sugestao','esclarecer') order by chave`)).rows);
  ok(!fim.avisos.some(a => ['sugestao', 'esclarecer'].includes(a.tipo))
    && resumidos.some(a => a.tipo === 'sugestao' && a.chave === 'aviso:msg:msg-e2e-1:passo:' + passo5 && a.estado === 'resumido')
    && resumidos.some(a => a.tipo === 'esclarecer' && a.estado === 'resumido'),
    'avisos: sugestão do passo 5 e mensagem a revisar ficam para o resumo, fora da fila de envio');

  // Reexecução idempotente: mesmos resultados não repetem efeitos.
  await operador(`select public.vigia_registrar('${JSON.stringify({
    versao: 'vigia-1', resultados: [r1, r2], eventos: [] })}'::jsonb)`);
  // São 2 eventos do vigia: mensagem ligada à tarefa (msg-e2e-1) + sugestão do passo 5.
  // msg-e2e-2 foi a esclarecer sem vínculo, sem evento de tarefa.
  const passosFinal = j((await db.query(
    `select count(*)::int as n from public.tarefa_eventos where tarefa_id='${tarefaId}' and origem='vigia'`)).rows[0]);
  ok(passosFinal.n === 2, 'reexecução não duplica eventos (1 msg + 1 sugestão)');

  // Resumo diário: texto pelo núcleo com o contexto fresco + registro no banco.
  const ctxDia = configurarContexto(j((await operador(`select public.vigia_contexto() as c`)).c));
  const hoje = U.diaSP(new Date().toISOString());
  const texto = VigiaResumo.textoResumoDiario(Object.assign({}, ctxDia, { site_url: 'https://site.example.org' }), hoje);
  ok(texto.indexOf('Tarefas abertas: 1') >= 0 && texto.indexOf('Precisam de você: 1') >= 0
    && texto.indexOf('https://site.example.org') >= 0,
    'texto do resumo diário coerente (1 aberta, 1 pedindo atenção)');
  const tarefasLinhas = texto.split('\n').filter(l => l.startsWith('• 30.068 · '));
  ok(tarefasLinhas.length === 1 && texto.indexOf('Conferir a documentação recebida') < 0
    && texto.indexOf('Atualizar a planilha de controle') < 0,
    'resumo lista a tarefa uma vez por centro+título, sem passos do Buriti (análise 1d)');
  ok(texto.indexOf('PRECISA DE VOCÊ') >= 0 && texto.indexOf('E-MAILS PARA VOCÊ OLHAR') >= 0
    && texto.indexOf('O QUE MUDOU NAS ÚLTIMAS 24 H') >= 0, 'resumo traz o conteúdo da 057 (tarefas, mudanças e e-mails)');
  const resReg = j((await operador(`select public.vigia_registrar('${JSON.stringify({
    versao: 'vigia-1',
    execucao: { tipo: 'resumo_diario', iniciada_em: new Date(agora + 180000).toISOString(),
      terminada_em: new Date(agora + 181000).toISOString() },
    resumo_diario: { chave: 'resumo:' + hoje, dia: hoje } })}'::jsonb) as r`)).r);
  ok(resReg.avisos.some(a => a.tipo === 'resumo_diario' && a.dia === hoje),
    'aviso de resumo diário enfileirado');
  const expurgo = j((await operador(`select public.vigia_expurgar() as r`)).r);
  ok(expurgo.mensagens_expurgadas === 0, 'vigia_expurgar ok');

  if (falhas) throw new Error(falhas + ' asserção(ões) falharam');
  console.log('e2e 054+055 OK: fluxo do vigia contra o banco com passos do Buriti.');
} catch (e) {
  console.error(e.message, e.detail || '', e.where || '');
  process.exitCode = 1;
} finally { await db.close(); }

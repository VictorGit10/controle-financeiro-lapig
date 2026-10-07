// Avaliação manual, somente fixtures sintéticas; não faz parte do npm test.
const fs = require('node:fs');
const path = require('node:path');
const Core = require('./src/processar.js');
const Modelo = require('./src/modelo.js');
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, '../../tests/vigia/fixtures/casos.json'), 'utf8'));
const casos = [
    { nome: 'envio', conferir: r => r.passos_sugeridos.some(p => p.passo_id === 'p3') },
    { nome: 'exigencia', conferir: r => r.registro_mensagem.classificacao === 'exigencia' && r.precisa_victor },
    { nome: 'desconhecida', conferir: r => !r.vinculos.length && (r.registro_mensagem.motivo === 'demanda_nova' && r.precisa_victor || r.registro_mensagem.motivo === 'sem_tarefa_relacionada' && !r.precisa_victor) },
    { nome: 'agenda', conferir: r => r.registro_mensagem.fila === 'rotina' },
    { nome: 'github', conferir: r => r.registro_mensagem.fila === 'rotina' },
    { nome: 'ferias', conferir: r => r.registro_mensagem.motivo === 'ausencia' },
    { nome: 'encaminhada', conferir: r => r.registro_mensagem.encaminhada && r.registro_mensagem.ocorrido_em === '2026-09-20T12:45:00.000Z' },
    { nome: 'cpf', conferir: r => r.registro_mensagem.estado === 'processada' && r.registro_mensagem.motivo !== 'mascara_falhou' },
    { nome: 'cpf_escapa', conferir: r => r.registro_mensagem.motivo === 'mascara_falhou' && !r.chamou_modelo },
    { nome: 'injecao', dificil:true, conferir:r=>['sem_acao','duvida'].includes(r.registro_mensagem.classificacao) && !r.passos_sugeridos.length },
    { nome: 'negacao', dificil:true, conferir:r=>['informativo','duvida'].includes(r.registro_mensagem.classificacao) && !r.passos_sugeridos.length },
    { nome: 'alegacao', dificil:true, conferir:r=>r.precisa_victor && r.registro_mensagem.motivo==='alegacao_sem_evidencia' && !r.passos_sugeridos.length },
    { nome: 'duas_tarefas', dificil:true, conferir:r=>r.vinculos.length===2 && r.vinculos.every(v=>v.estado==='sugerido') },
    { nome: 'victor', dificil:true, conferir:r=>!r.precisa_victor && !r.passos_sugeridos.length },
    { nome: 'balancete', dificil:true, conferir:r=>!r.vinculos.length && !r.precisa_victor && r.registro_mensagem.fila==='rotina' && r.registro_mensagem.motivo==='sem_tarefa_relacionada' },
    { nome: 'spam', dificil:true, conferir:r=>r.registro_mensagem.motivo==='spam' && !r.chamou_modelo },
    { nome: 'spam_fraco', dificil:true, conferir:r=>r.registro_mensagem.motivo==='spam' && !r.chamou_modelo },
    { nome: 'spam_forte', dificil:true, conferir:r=>r.registro_mensagem.motivo==='spam_com_vinculo' && r.registro_mensagem.fila==='tarefa' },
    { nome: 'spam_medio', dificil:true, conferir:r=>r.registro_mensagem.motivo==='spam_com_vinculo' && r.passos_sugeridos.some(p=>p.passo_id==='p3') }
  ];
async function avaliar(opcoes = {}) {
  const requisitar = opcoes.fetch || fetch, log = opcoes.log || console.log;
  let acertos = 0, indisponiveis = 0;
  for (const caso of casos) {
    const contexto = { tarefas: caso.dificil ? fixtures.tarefasDificeis : [fixtures.tarefa], config:fixtures.config, mapa: {} };
    const prep = Core.prepararMensagem(fixtures.mensagens[caso.nome], contexto);
    let prompt, resultado = Core.processarMensagem(fixtures.mensagens[caso.nome], contexto, p => { prompt = p; throw new Error('coletar_prompt'); });
    if (!prompt) {
      const acertou = caso.conferir(resultado);
      if (acertou) acertos++;
      log(caso.nome + ': ' + (acertou ? 'acerto' : 'divergência') + ' (regra, sem modelo)');
      continue;
    }
    const candidatos = JSON.parse(prompt.slice(prompt.lastIndexOf('\nDADOS_CANDIDATOS=') + '\nDADOS_CANDIDATOS='.length));
    try {
      let envelope;
      for (let tentativa = 0; tentativa < 2; tentativa++) {
        try {
          const response = await requisitar('http://localhost:11434/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'glm-5.3-flash:cloud', format: 'json', stream: false, messages: [{ role: 'user', content: Modelo.montarPrompt(prep.mascarada, candidatos) }], options: { temperature: 0 } }), signal: AbortSignal.timeout(90000) });
          if (!response.ok) throw new Error('http_' + response.status);
          envelope = await response.json();
          break;
        } catch (erro) {
          if (tentativa === 1) throw erro;
          log(caso.nome + ': nova tentativa');
        }
      }
      const validada = Modelo.validarResposta(envelope.message?.content, prep.mascarada, candidatos);
      resultado = Core.processarMensagem(fixtures.mensagens[caso.nome], contexto, () => envelope.message?.content);
      // Relata divergência do modelo mesmo quando a defesa do núcleo corrigiu a conclusão.
      const bruto = validada.fila ? {} : JSON.parse(envelope.message.content);
      const semConclusaoIndevida = caso.nome === 'injecao' ? ['sem_acao','duvida'].includes(bruto.classificacao) : caso.nome === 'negacao' ? ['informativo','duvida'].includes(bruto.classificacao) : true;
      const acertou = !validada.fila && semConclusaoIndevida && caso.conferir(resultado);
      if (acertou) acertos++;
      log(caso.nome + ': ' + (acertou ? 'acerto' : 'divergência') + ' (' + (validada.motivo || validada.classificacao) + ')');
    } catch (_) { indisponiveis++; log(caso.nome + ': modelo local indisponível'); }
  }
  log('Acertos: ' + acertos + '/' + casos.length + '; indisponíveis: ' + indisponiveis);
  return {acertos,total:casos.length,indisponiveis};
}
if (require.main === module) avaliar().catch(() => { console.error('Avaliação interrompida'); process.exitCode = 1; });
module.exports = { avaliar, casos };

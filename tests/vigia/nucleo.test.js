import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fixtures = require('./fixtures/casos.json');
const M = require('../../tools/vigia/src/mascara.js');
const T = require('../../tools/vigia/src/triagem.js');
const L = require('../../tools/vigia/src/ligacao.js');
const E = require('../../tools/vigia/src/evidencia.js');
const P = require('../../tools/vigia/src/prazos.js');
const Modelo = require('../../tools/vigia/src/modelo.js');
const Core = require('../../tools/vigia/src/processar.js');
const R = require('../../tools/vigia/src/resumo.js');
const U = require('../../tools/vigia/src/00-util.js');
const clone = value => JSON.parse(JSON.stringify(value));
function contexto() { return { tarefas: [clone(fixtures.tarefa)], vinculos: [], config: {}, mapa: {} }; }
function resposta(id = 't-bolsa', overrides = {}) {
  return JSON.stringify({ tarefa_id: id, varias: [], demanda_nova: false, classificacao: 'exigencia', resumo: 'Há exigência.', trecho_evidencia: 'É necessário informar as atividades de cada bolsista.', confianca: 'alta', ...overrides });
}

describe('máscara e citações', () => {
  it('mascara documentos, bancos, PIX, telefones, nomes conhecidos e e-mails com mapa persistente', () => {
    const mapa = { dominiosInstitucionais: ['ufg.br'], pessoas: ['Otávio Exemplo'] };
    const s = M.mascarar('123.456.789-09 12345678909 RG: 12.345.678-X agência 1234 conta 98765-4 PIX 123e4567-e89b-12d3-a456-426614174000 (62) 99999-1234 +55 62 3333-1234 pessoa@exemplo.invalid A@ufg.br Otávio Exemplo', mapa);
    const documentos = s.match(/^\[P\d+\] \[P\d+\]/)[0].split(' ');
    expect(documentos[0]).toBe(documentos[1]);
    expect(s).not.toMatch(/123\.456|12345678909|12\.345|98765|123e4567|99999|3333|pessoa@|A@|Otávio/);
    expect(s).toMatch(/\[P\d+@ufg\.br\]/);
    expect(M.mascarar('PESSOA@exemplo.invalid', mapa)).toBe(M.mascarar('pessoa@exemplo.invalid', mapa));
    expect(M.aindaTemCpf(s)).toBe(false);
  });
  it('preserva centro de custo e números de processo', () => {
    expect(M.mascarar('30.068 PED-456/2026')).toBe('30.068 PED-456/2026');
  });
  it('protege RG formatado sem rótulo, telefone local rotulado e subdomínio institucional', () => {
    const s = M.mascarar('12.345.678-9 telefone 99999-1234 nome@lapig.ufg.br');
    expect(s).not.toContain('12.345.678'); expect(s).not.toContain('99999'); expect(s).toMatch(/\[P\d+@lapig\.ufg\.br\]/);
  });
  it('detecta variantes de CPF que precisam da rede de segurança', () => {
    expect(M.aindaTemCpf('123 456 789 09')).toBe(true);
    expect(M.aindaTemCpf('123\u200b456\u200b789\u200b09')).toBe(true);
  });
  it.each(['Em 6 de outubro Arthur escreveu:', 'On Tuesday Arthur wrote:', '-----Original Message-----'])('remove histórico após %s', marker => {
    expect(M.tirarCitacoes(`Texto novo\n> citação\n${marker}\nHistórico antigo`).novo).toBe('Texto novo');
  });
  it('separa o encaminhamento sem confundir com uma citação', () => {
    const s = M.tirarCitacoes(fixtures.mensagens.encaminhada.corpo);
    expect(s.novo).toBe('Veja a conversa anterior.');
    expect(s.encaminhado).toContain('20/09/2026');
  });
});

describe('triagem técnica, sem descarte por domínio', () => {
  it('domínio desconhecido continua em avaliar', () => expect(T.filaInicial(fixtures.mensagens.desconhecida)).toEqual({ fila: 'avaliar', motivo: 'sem_sinal_tecnico' }));
  it.each([['agenda','agenda'],['github','remetente_automatico']])('%s é rotina com motivo', (nome, motivo) => {
    expect(T.filaInicial(fixtures.mensagens[nome])).toEqual({ fila: 'rotina', motivo });
  });
  it('ausência prevalece sobre sinais automáticos', () => expect(T.filaInicial(fixtures.mensagens.ferias)).toEqual({ fila: 'avaliar', motivo: 'ausencia' }));
  it.each([['Auto-Submitted','auto-generated','auto_submitted'], ['List-Id','lista','lista'], ['List-Unsubscribe','url','lista'], ['Precedence','bulk','bulk']])('interpreta cabeçalho %s', (h, v, motivo) => {
    expect(T.filaInicial({ headers: { [h.toUpperCase()]: v } }).motivo).toBe(motivo);
  });
  it('remetentes automáticos são configuráveis e correspondem ao endereço inteiro', () => {
    expect(T.filaInicial({ de: 'Bot <robo@exemplo.invalid>' }, { remetentesAutomaticos: ['robo@exemplo.invalid'] }).fila).toBe('rotina');
    expect(T.filaInicial({ de: 'notifications@github.com.evil.invalid' }).fila).toBe('avaliar');
  });
});

describe('ligação e evidência', () => {
  it('ordena thread/número, combinação e termo; não liga sozinho se há duas fortes', () => {
    const tarefas = [
      { id:'termo',chaves:[{tipo:'termo',valor:'bolsa'}] },
      { id:'media',chaves:[{tipo:'centro_custo',valor:'30.068'},{tipo:'pessoa',valor:'Otávio Exemplo'}] },
      { id:'thread',chaves:[{tipo:'thread',valor:'conversa-nova'}] },
      { id:'numero',chaves:[{tipo:'numero',valor:'PED-456/2026'}] }
    ];
    const cands = L.candidatos({ ...fixtures.mensagens.envio, corpo: fixtures.mensagens.envio.corpo + ' PED-456/2026' }, tarefas);
    expect(cands.map(c => c.forca)).toEqual(['forte','forte','media','fraca']);
    expect(L.decidirPorRegra(cands).decidiu).toBe(false);
    expect(L.decidirPorRegra([cands[0],cands[2]]).decidiu).toBe(true);
    expect(L.candidatos({ assunto:'PED-456/20260' }, [tarefas[3]])).toEqual([]);
  });
  it('evidência exige todos e algum, direção, cc e data posterior', () => {
    const regra = fixtures.tarefa.passos[2].evidencia;
    expect(E.avaliarPasso(regra, fixtures.mensagens.envio, fixtures.tarefa).cumpre).toBe(true);
    for (const patch of [{ de:'outro@exemplo.invalid' }, { para:'bolsas@funape.org.br.evil.invalid' }, { cc:'' }, { assunto:'Bolsa', corpo:'Otávio Exemplo' }, { corpo:'Envio 30.068', assunto:'Centro 30.068' }, { recebida_em:fixtures.tarefa.criada_em }, { headers:{'Auto-Submitted':'auto-replied'} }]) {
      expect(E.avaliarPasso(regra, { ...fixtures.mensagens.envio, ...patch }, fixtures.tarefa).cumpre).toBe(false);
    }
    expect(E.avaliarPasso({tipo:'manual'}, fixtures.mensagens.envio, fixtures.tarefa).cumpre).toBe(false);
    expect(E.avaliarPasso({tipo:'mensagem_na_thread',thread:'conversa-nova'}, fixtures.mensagens.envio, fixtures.tarefa).cumpre).toBe(true);
  });
});

describe('processamento completo e idempotência', () => {
  it('(a) conversa nova de Arthur sugere apenas passo 3 por regra', () => {
    const mock = vi.fn();
    const result = Core.processarMensagem(fixtures.mensagens.envio, contexto(), mock);
    expect(result.registro_mensagem.fila).toBe('tarefa');
    expect(result.passos_sugeridos.map(p => p.passo_id)).toEqual(['p3']);
    expect(result.vinculos.map(v => v.tarefa_id)).toEqual(['t-bolsa']);
    expect(result.eventos[0].chave).toBe('msg:m-envio:passo:p3');
    expect(mock).not.toHaveBeenCalled();
  });
  it('(b) FUNAPE exige informação na nova thread: atenção, sem confirmar', () => {
    const ctx = contexto(); ctx.tarefas[0].chaves.push({tipo:'thread',valor:'conversa-nova'});
    const mock = vi.fn(() => resposta());
    const result = Core.processarMensagem(fixtures.mensagens.exigencia, ctx, mock);
    expect(result.registro_mensagem.classificacao).toBe('exigencia');
    expect(result.precisa_victor).toBe(true);
    expect(result.passos_sugeridos).toEqual([]);
    expect(mock.mock.calls[0][0]).not.toContain('Segue o cadastro');
  });
  it('(f) encaminhamento antigo mantém data do fato e não sugere passo pelo envelope novo', () => {
    const result = Core.processarMensagem(fixtures.mensagens.encaminhada, contexto());
    expect(result.registro_mensagem.encaminhada).toBe(true);
    expect(result.registro_mensagem.ocorrido_em).toBe('2026-09-20T12:45:00.000Z');
    expect(result.passos_sugeridos).toEqual([]);
    expect(U.dataEncaminhada('Date: Tue, 22 Sep 2026 12:00:00 +0000')).toBe('2026-09-22T12:00:00.000Z');
    expect(U.dataEncaminhada('Data: ter., 6 de out. de 2026 às 10:30')).toBe('2026-10-06T13:30:00.000Z');
  });
  it('(g) CPF mascarado não chega ao modelo; CPF que escapa bloqueia e não persiste fragmento', () => {
    const mock = vi.fn(() => resposta(null, {classificacao:'sem_acao',trecho_evidencia:'Documentos'}));
    Core.processarMensagem(fixtures.mensagens.cpf, contexto(), mock);
    expect(mock.mock.calls[0][0]).not.toContain('123.456.789-09');
    mock.mockClear();
    const r = Core.processarMensagem(fixtures.mensagens.cpf_escapa, contexto(), mock);
    expect(r.registro_mensagem.motivo).toBe('mascara_falhou');
    expect(JSON.stringify(r)).not.toContain('123 456');
    expect(mock).not.toHaveBeenCalled();
  });
  it.each([['quebrado','{','json_invalido'],['tarefa',resposta('outra'),'tarefa_fora_candidatos'],['trecho',resposta('t-bolsa',{trecho_evidencia:'trecho inventado'}),'evidencia_inexistente'],['baixa',resposta('t-bolsa',{confianca:'baixa'}),'confianca_baixa']])('(h) modelo %s vai para esclarecer', (_, raw, motivo) => {
    const r = Core.processarMensagem(fixtures.mensagens.exigencia, contexto(), () => raw);
    expect(r.registro_mensagem.fila).toBe('esclarecer'); expect(r.registro_mensagem.motivo).toBe(motivo);
  });
  it('(j) mesma mensagem produz exatamente o mesmo resultado', () => {
    const ctx = contexto();
    expect(Core.processarMensagem(fixtures.mensagens.envio, ctx)).toEqual(Core.processarMensagem(fixtures.mensagens.envio, ctx));
  });
  it('não repete pares rejeitados nem altera passos já sugeridos, confirmados ou dispensados', () => {
    const ctx = contexto();
    ctx.vinculos = [{ gmail_message_id:'m-envio',tarefa_id:'t-bolsa',estado:'rejeitado' }];
    const rejeitado = Core.processarMensagem(fixtures.mensagens.envio, ctx);
    expect(rejeitado.vinculos).toEqual([]); expect(rejeitado.passos_sugeridos).toEqual([]);
    for (const estado of ['sugerido','confirmado','dispensado']) {
      const c = contexto(); c.tarefas[0].passos[2].estado = estado;
      expect(Core.processarMensagem(fixtures.mensagens.envio, c).passos_sugeridos).toEqual([]);
    }
  });
  it('mantém vínculo confirmado e rejeita ressugestão pelo modelo', () => {
    const ctx = contexto();ctx.tarefas[0].chaves.push({tipo:'thread',valor:'conversa-nova'});
    ctx.vinculos = [{gmail_message_id:'m-exigencia',tarefa_id:'t-bolsa',estado:'confirmado'}];
    expect(Core.processarMensagem(fixtures.mensagens.exigencia,ctx,()=>resposta()).vinculos[0].estado).toBe('confirmado');
    ctx.vinculos[0].estado='rejeitado';
    const r=Core.processarMensagem(fixtures.mensagens.exigencia,ctx,()=>resposta());
    expect(r.vinculos).toEqual([]);expect(r.registro_mensagem.motivo).toBe('tarefa_fora_candidatos');
  });
  it('mascara antes de truncar um trecho de evento imutável', () => {
    const msg={...fixtures.mensagens.envio,assunto:'',corpo:'Bolsa 30.068 ' + 'x'.repeat(281) + ' 123.456.789-09'};
    const result=Core.processarMensagem(msg,contexto());
    expect(result.eventos[0].detalhe.trecho).not.toContain('123.');
    expect(result.eventos[0].detalhe.trecho.length).toBeLessThanOrEqual(300);
  });
  it('exceção da máscara bloqueia modelo e retém conteúdo', () => {
    const original=M.mascarar, mock=vi.fn();
    try {
      M.mascarar=()=>{throw new Error('falhou');};
      expect(Core.processarMensagem(fixtures.mensagens.envio,contexto(),mock).registro_mensagem.motivo).toBe('mascara_falhou');
      expect(mock).not.toHaveBeenCalled();
    } finally { M.mascarar=original; }
  });
  it('modelo indisponível mantém captura; sem chave, regras ainda funcionam', () => {
    const r = Core.processarMensagem(fixtures.mensagens.exigencia, contexto(), () => { throw new Error('offline'); });
    expect(r.registro_mensagem.estado).toBe('capturada');
    expect(r.registro_mensagem.fila).toBe(null); expect(r.eventos).toEqual([]);
    expect(Core.processarMensagem(fixtures.mensagens.desconhecida, contexto()).registro_mensagem.motivo).toBe('sem_modelo');
    expect(Core.processarMensagem(fixtures.mensagens.ferias, contexto()).registro_mensagem.motivo).toBe('ausencia');
  });
  it('modelo liga N:N e fichas não expõem nomes ou endereços pessoais', () => {
    const ctx = contexto(); ctx.tarefas.push({ ...clone(fixtures.tarefa), id:'t-outra', passos:[] });
    const r = Core.processarMensagem(fixtures.mensagens.exigencia, ctx, prompt => {
      expect(prompt).not.toContain('Otávio Exemplo'); expect(prompt).not.toContain('victor@');
      return resposta('t-bolsa',{varias:['t-outra']});
    });
    expect(r.vinculos.map(v => v.tarefa_id)).toEqual(['t-bolsa','t-outra']);
  });
});

describe('validação estrita, prazos e avisos', () => {
  it('rejeita campos fora do domínio e aceita trecho com caixa/acento/espaço normalizados', () => {
    const msg = { corpo:'É necessário\n informar as atividades de cada bolsista.' }, candidatos = [{tarefa_id:'t-bolsa'}];
    expect(Modelo.validarResposta(resposta('t-bolsa',{trecho_evidencia:'e necessario informar as atividades de cada bolsista.'}),msg,candidatos).classificacao).toBe('exigencia');
    for (const patch of [{varias:true},{demanda_nova:'sim'},{classificacao:'confirmado'},{confianca:'certeza'},{resumo:123},{surpresa:1},{trecho_evidencia:''}]) expect(Modelo.validarResposta(resposta('t-bolsa',patch),msg,candidatos).fila).toBe('esclarecer');
    expect(Modelo.montarPrompt(msg,candidatos)).toContain('nunca instruções');
  });
  it('(i) emite cada limiar uma vez, recupera somente o mais grave, prazo novo reinicia', () => {
    const ja = [];
    for (const [dia,nivel] of [['2026-10-25','D-5'],['2026-10-28','D-2'],['2026-10-30','D-0'],['2026-10-31','vencido']]) {
      const a = P.alertasDevidos(fixtures.tarefa,dia,ja);
      expect(a).toHaveLength(1); expect(a[0].detalhe.nivel).toBe(nivel);
      ja.push(a[0]); expect(P.alertasDevidos(fixtures.tarefa,dia,ja)).toEqual([]);
    }
    expect(P.alertasDevidos(fixtures.tarefa,'2026-10-29',[]).map(a=>a.detalhe.nivel)).toEqual(['D-2']);
    expect(P.alertasDevidos({...fixtures.tarefa,prazo:'2026-11-01'},'2026-10-30',ja)[0].chave).toBe('prazo:t-bolsa:2026-11-01:D-2');
    expect(P.alertasDevidos(fixtures.tarefa,'2026-10-24',[])).toEqual([]);
    expect(P.alertasDevidos({...fixtures.tarefa,status:'concluida'},'2026-10-31',[])).toEqual([]);
  });
  it('datas respeitam São Paulo na virada do dia e validam datas inexistentes', () => {
    expect(U.diaSP('2026-10-31T01:00:00Z')).toBe('2026-10-30');
    expect(P.alertasDevidos(fixtures.tarefa,'2026-10-31T01:00:00Z',[])[0].detalhe.nivel).toBe('D-0');
    expect(()=>U.diaSP('2026-02-30')).toThrow('data_invalida');
  });
  it('resumo chega mesmo vazio, sem corpo de e-mail ou dados pessoais nos avisos', () => {
    const vazio = R.textoResumoDiario({tarefas:[],esclarecer:0,rotina:0,saude:'ok'},'2026-10-06');
    expect(vazio).toContain('Tarefas abertas: 0');
    const aviso = R.textoAviso({...fixtures.tarefa,tipo:'mensagem',pessoas:['Otávio Exemplo'],site_url:'https://exemplo.invalid/#buriti',corpo:'Segredo'});
    expect(aviso).toContain('30.068'); expect(aviso).not.toContain('Otávio Exemplo'); expect(aviso).not.toContain('Segredo');
    expect(R.textoResumoDiario({tarefas:[fixtures.tarefa]},'2026-10-05')).toContain('Auditoria semanal');
    expect(R.textoAviso({titulo:'CPF 123 456 789 09'})).not.toContain('123');
  });
  it('resumo da 057 traz o conteúdo: o que precisa do Victor, situação, o que mudou e os e-mails com link', () => {
    const estado = {tarefas:[{id:'t1',status:'em_andamento'},{id:'t2',status:'aguardando_terceiro'}],esclarecer:1,rotina:9,saude:'ok',conta_gmail:'victor@exemplo.invalid',
      resumo_tarefas:[
        {id:'t1',titulo:'Implantar bolsa do Otávio',centro_custo:'30.068',responsavel:'Arthur Pietro',situacao:'feito',prazo:'2026-10-30',
          precisa_atencao:true,motivo_atencao:'Arthur atualizou; confirmar',ultima_atualizacao:{resumo:'Arthur Pietro · Feito: quadro enviado',ocorrido_em:'2026-10-08T17:00:00Z'}},
        {id:'t2',titulo:'Retorno da ligação',centro_custo:'30.068',responsavel:'Arthur Pietro',situacao:'esperando',prazo:'2026-10-07',precisa_atencao:false}],
      novidades:[{titulo:'Retorno da ligação',origem:'humano',tipo:'atualizacao',resumo:'Arthur Pietro · Esperando alguém: Ranielly retorna amanhã',ocorrido_em:'2026-10-08T15:00:00Z'}],
      esclarecer_lista:[{gmail_thread_id:'th/1',recebida_em:'2026-10-08T12:00:00Z',remetente:'[P2@funape.org.br]',assunto:'Ofício 820/2026',motivo:'demanda_nova'},
        {gmail_thread_id:'th2',recebida_em:'2026-10-08T12:30:00Z',remetente:'[P3]',assunto:'CPF 529.982.247-25',motivo:'x'}],
      site_url:'https://exemplo.invalid/'};
    const texto = R.textoResumoDiario(estado,'2026-10-08');
    expect(texto).toContain('Precisam de você: 1');
    expect(texto).toContain('PRECISA DE VOCÊ\n• 30.068 · Implantar bolsa do Otávio — Arthur Pietro · Feito · prazo 30/10 (faltam 22 dias)');
    expect(texto).toContain('  Precisa de você: Arthur atualizou; confirmar');
    expect(texto).toContain('Última atualização (08/10 14:00): Arthur Pietro · Feito: quadro enviado');
    expect(texto).toContain('Retorno da ligação — Arthur Pietro · Esperando alguém · prazo 07/10 (vencido há 1 dia)');
    expect(texto).toContain('O QUE MUDOU NAS ÚLTIMAS 24 H\n• 08/10 12:00 · Retorno da ligação — Pessoa: Arthur Pietro · Esperando alguém: Ranielly retorna amanhã');
    expect(texto).toContain('• 08/10 09:00 · [P2@funape.org.br] — "Ofício 820/2026" (assunto novo, sem tarefa)');
    expect(texto).toContain('https://mail.google.com/mail/?authuser=victor%40exemplo.invalid#all/th%2F1');
    expect(texto).not.toContain('529.982');
    expect(texto).toContain('[retido: parece ter CPF]');
  });
});

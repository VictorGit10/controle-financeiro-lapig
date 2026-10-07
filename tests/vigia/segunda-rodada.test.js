import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fixtures = require('./fixtures/casos.json');
const Core = require('../../tools/vigia/src/processar.js');
const E = require('../../tools/vigia/src/evidencia.js');
const L = require('../../tools/vigia/src/ligacao.js');
const T = require('../../tools/vigia/src/triagem.js');
const Modelo = require('../../tools/vigia/src/modelo.js');
const copia = v => JSON.parse(JSON.stringify(v));
function contexto() { return {tarefas:copia(fixtures.tarefasDificeis),config:copia(fixtures.config),mapa:{},vinculos:[]}; }
function resposta(nome, patch = {}) {
  return JSON.stringify({tarefa_id:'t-bolsa',varias:[],demanda_nova:false,classificacao:'concluido',resumo:'Interpretação sugerida.',trecho_evidencia:fixtures.mensagens[nome].assunto,confianca:'alta',...patch});
}

describe('spam: auditar sem desperdiçar chamadas de modelo', () => {
  it.each(['spam','spam_fraco'])('%s vai para rotina sem modelo nem evidência', nome => {
    const mock=vi.fn(), r=Core.processarMensagem(fixtures.mensagens[nome],contexto(),mock);
    expect(r.registro_mensagem).toMatchObject({fila:'rotina',motivo:'spam',estado:'processada'});
    expect(r.chamou_modelo).toBe(false);expect(mock).not.toHaveBeenCalled();
    expect(r.vinculos).toEqual([]);expect(r.passos_sugeridos).toEqual([]);
  });
  it('spam forte segue o modelo e conserva o motivo spam_com_vinculo', () => {
    const mock=vi.fn(()=>resposta('spam_forte',{classificacao:'exigencia'}));
    const r=Core.processarMensagem(fixtures.mensagens.spam_forte,contexto(),mock);
    expect(r.registro_mensagem).toMatchObject({fila:'tarefa',motivo:'spam_com_vinculo',classificacao:'exigencia'});
    expect(r.precisa_victor).toBe(true);expect(mock).toHaveBeenCalledOnce();
  });
  it('spam médio segue a evidência por regra, sem promover médio por ligação isolada', () => {
    const mock=vi.fn(), r=Core.processarMensagem(fixtures.mensagens.spam_medio,contexto(),mock);
    expect(r.registro_mensagem.motivo).toBe('spam_com_vinculo');expect(r.passos_sugeridos.map(p=>p.passo_id)).toEqual(['p3']);
    expect(mock).not.toHaveBeenCalled();
    const msg={...fixtures.mensagens.spam_medio,cc:''};
    const cands=L.candidatos(msg,contexto().tarefas);
    expect(cands[0].forca).toBe('media');expect(L.decidirPorRegra(cands).decidiu).toBe(false);
    expect(Core.processarMensagem(msg,contexto(),()=>resposta('spam_medio',{classificacao:'informativo'})).vinculos).toHaveLength(1);
  });
  it('rejeição lembrada impede que spam ganhe a exceção de vínculo', () => {
    const ctx=contexto();ctx.vinculos=[{gmail_message_id:'m-spam-forte',tarefa_id:'t-bolsa',estado:'rejeitado'}];
    const mock=vi.fn(), r=Core.processarMensagem(fixtures.mensagens.spam_forte,ctx,mock);
    expect(r.registro_mensagem.motivo).toBe('spam');expect(mock).not.toHaveBeenCalled();
  });
  it('modelo offline em spam vinculado conserva captura para retry', () => {
    const r=Core.processarMensagem(fixtures.mensagens.spam_forte,contexto(),()=>{throw new Error('offline');});
    expect(r.registro_mensagem).toMatchObject({estado:'capturada',motivo:'spam_com_vinculo',fila:null});
  });
  it('triagem só permite exceção para candidato forte ou médio', () => {
    expect(T.filaInicial(fixtures.mensagens.spam,{},[{forca:'fraca'}])).toEqual({fila:'rotina',motivo:'spam'});
    expect(T.filaInicial(fixtures.mensagens.spam,{},[{forca:'media'}])).toEqual({fila:'avaliar',motivo:'spam_com_vinculo'});
  });
});

describe('fixtures difíceis, mesmo diante de respostas erradas do modelo', () => {
  it.each(['concluido','informativo','exigencia','duvida','sem_acao'])('(a) injeção não vira conclusão ou passo: modelo %s', classificacao => {
    const msg=fixtures.mensagens.injecao;
    const r=Core.processarMensagem(msg,contexto(),()=>resposta('injecao',{classificacao}));
    expect(['sem_acao','duvida']).toContain(r.registro_mensagem.classificacao);
    expect(r.passos_sugeridos).toEqual([]);expect(r.eventos.every(e=>e.tipo!=='sugestao')).toBe(true);
    expect(E.avaliarPasso(contexto().tarefas[0].passos[0].evidencia,msg,contexto().tarefas[0]).cumpre).toBe(false);
  });
  it.each(['concluido','informativo','duvida'])('(b) negação nunca sugere passo 3: modelo %s', classificacao => {
    const msg=fixtures.mensagens.negacao;
    const r=Core.processarMensagem(msg,contexto(),()=>resposta('negacao',{classificacao}));
    expect(['informativo','duvida']).toContain(r.registro_mensagem.classificacao);expect(r.passos_sugeridos).toEqual([]);
    expect(E.avaliarPasso({tipo:'mensagem_na_thread',thread:'thread-original'},msg,contexto().tarefas[0]).cumpre).toBe(false);
  });
  it('(c) alegação aceita como interpretação concluido exige Victor e nunca substitui a regra', () => {
    const r=Core.processarMensagem(fixtures.mensagens.alegacao,contexto(),()=>resposta('alegacao'));
    expect(r.registro_mensagem).toMatchObject({classificacao:'concluido',motivo:'alegacao_sem_evidencia',fila:'tarefa'});
    expect(r.precisa_victor).toBe(true);expect(r.passos_sugeridos).toEqual([]);
    expect(r.eventos[0].detalhe.precisa_victor).toBe(true);
  });
  it('alegação sem prova também pede revisão no modo somente regras', () => {
    const r=Core.processarMensagem(fixtures.mensagens.alegacao,contexto());
    expect(r.registro_mensagem.motivo).toBe('alegacao_sem_evidencia');expect(r.precisa_victor).toBe(true);
  });
  it('com cópia ao Victor e direção certa, alegação pode casar com evidência', () => {
    const msg={...fixtures.mensagens.alegacao,cc:'victor@exemplo.invalid'}, mock=vi.fn();
    const r=Core.processarMensagem(msg,contexto(),mock);
    expect(r.passos_sugeridos.map(p=>p.passo_id)).toEqual(['p3']);expect(mock).not.toHaveBeenCalled();
  });
  it('(d) duas tarefas citadas geram dois vínculos sugeridos, sem passos cumpridos', () => {
    const c=contexto(), original=copia(c.tarefas);
    const r=Core.processarMensagem(fixtures.mensagens.duas_tarefas,c,()=>resposta('duas_tarefas',{classificacao:'exigencia',varias:['t-bolsa-2']}));
    expect(r.vinculos.map(v=>v.tarefa_id)).toEqual(['t-bolsa','t-bolsa-2']);expect(r.vinculos.every(v=>v.estado==='sugerido')).toBe(true);
    expect(r.passos_sugeridos).toEqual([]);expect(c.tarefas).toEqual(original);
  });
  it('(e) Victor não recebe autoavisos e mensagem própria não prova passo de Arthur', () => {
    const c=contexto();c.tarefas[0].passos.push({id:'p-thread',quem:'Arthur',estado:'pendente',evidencia:{tipo:'mensagem_na_thread',thread:'thread-original'}});
    const mock=vi.fn(()=>resposta('victor',{classificacao:'exigencia'})), r=Core.processarMensagem(fixtures.mensagens.victor,c,mock);
    expect(r.precisa_victor).toBe(false);expect(r.registro_mensagem.classificacao).toBe('informativo');
    expect(r.passos_sugeridos).toEqual([]);expect(r.eventos.every(e=>e.detalhe.precisa_victor===false)).toBe(true);expect(mock).not.toHaveBeenCalled();
    expect(E.avaliarPasso(c.tarefas[0].passos[1].evidencia,fixtures.mensagens.victor,c.tarefas[0],c.config).cumpre).toBe(false);
  });
  it('Victor não recebe autoaviso mesmo sem vínculo ou com falha de máscara', () => {
    for(const patch of [{gmail_thread_id:'desconhecida',assunto:'Olá',corpo:'Olá'}, {corpo:'CPF 123 456 789 09'}]) {
      expect(Core.processarMensagem({...fixtures.mensagens.victor,...patch},contexto()).precisa_victor).toBe(false);
    }
  });
  it('(f) centro isolado e assunto alheio ficam fracos; modelo pode recusar a ligação', () => {
    const msg=fixtures.mensagens.balancete, cands=L.candidatos(msg,contexto().tarefas);
    expect(cands).toEqual([{tarefa_id:'t-bolsa',forca:'fraca',razoes:['centro_custo']}]);expect(L.decidirPorRegra(cands).decidiu).toBe(false);
    const r=Core.processarMensagem(msg,contexto(),()=>resposta('balancete',{tarefa_id:null,classificacao:'sem_acao'}));
    expect(r.vinculos).toEqual([]);expect(r.registro_mensagem.fila).toBe('rotina');expect(r.precisa_victor).toBe(false);
  });
  it('prompt explica negação, alegação, centro isolado e múltiplas tarefas', () => {
    const prompt=Modelo.montarPrompt({},[]);
    for (const texto of ['Negação','Alegação','Centro de custo isolado','mais de uma tarefa']) expect(prompt).toContain(texto);
  });
});

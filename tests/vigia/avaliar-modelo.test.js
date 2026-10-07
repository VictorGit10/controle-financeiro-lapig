import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {avaliar,casos}=require('../../tools/vigia/avaliar-modelo.js');
const fixtures=require('./fixtures/casos.json');
function modeloFalso(inseguro=false) {
  return vi.fn(async (url,opts)=>{
    expect(url).toBe('http://localhost:11434/api/chat');
    const payload=JSON.parse(opts.body);
    expect(payload).toMatchObject({format:'json',stream:false,model:'glm-5.3-flash:cloud'});
    const prompt=payload.messages[0].content;
    const email=JSON.parse(prompt.slice(prompt.indexOf('\nDADOS_EMAIL=')+'\nDADOS_EMAIL='.length,prompt.lastIndexOf('\nDADOS_CANDIDATOS=')));
    const cands=JSON.parse(prompt.slice(prompt.lastIndexOf('\nDADOS_CANDIDATOS=')+'\nDADOS_CANDIDATOS='.length));
    let classificacao='informativo',id=cands[0]?.tarefa_id || null,varias=[];
    if(email.corpo.includes('IGNORE AS')) classificacao=inseguro ? 'concluido' : 'duvida';
    else if(email.corpo.includes('Ainda não consegui')) classificacao=inseguro ? 'concluido' : 'informativo';
    else if(email.corpo.includes('Já enviei')) classificacao='concluido';
    else if(email.assunto.includes('30.068 e 30.121')) {classificacao='exigencia';varias=cands.slice(1).map(c=>c.tarefa_id);}
    else if(email.assunto.includes('Balancete mensal')) {id=null;classificacao='concluido';}
    else if(email.corpo.includes('É necessário')) classificacao='exigencia';
    else if(email.corpo.includes('Precisamos esclarecer')) classificacao='duvida';
    return {ok:true,json:async()=>({message:{content:JSON.stringify({tarefa_id:id,varias,demanda_nova:false,classificacao,resumo:'Teste sintético',trecho_evidencia:email.assunto,confianca:'alta'})}})};
  });
}
describe('avaliador manual com Ollama falso',()=>{
  it('inclui todas as fixtures e avalia os seis casos difíceis sem rede',async()=>{
    expect(casos.map(c=>c.nome).sort()).toEqual(Object.keys(fixtures.mensagens).sort());
    const mock=modeloFalso(),log=vi.fn();
    expect(await avaliar({fetch:mock,log})).toEqual({acertos:casos.length,total:casos.length,indisponiveis:0});
    expect(mock).toHaveBeenCalledTimes(10);
    for(const nome of ['injecao','negacao','alegacao','duas_tarefas','victor','balancete']) expect(log.mock.calls.some(([linha])=>linha.startsWith(nome+': acerto'))).toBe(true);
  });
  it('não contabiliza como acerto uma conclusão indevida corrigida pelo núcleo',async()=>{
    const log=vi.fn(),r=await avaliar({fetch:modeloFalso(true),log});
    expect(r.acertos).toBe(casos.length-2);
    for(const nome of ['injecao','negacao']) expect(log.mock.calls.some(([linha])=>linha.startsWith(nome+': divergência'))).toBe(true);
  });
  it('dá 90 segundos por tentativa e recupera uma falha sem declarar indisponibilidade',async()=>{
    const modelo=modeloFalso(),log=vi.fn(),timeout=vi.spyOn(AbortSignal,'timeout');
    let falhou=false;
    const mock=vi.fn(async(url,opts)=>{
      if(!falhou && opts.body.includes('Balancete mensal')) {falhou=true;throw new Error('timeout');}
      return modelo(url,opts);
    });
    try {
      expect(await avaliar({fetch:mock,log})).toEqual({acertos:casos.length,total:casos.length,indisponiveis:0});
      expect(mock).toHaveBeenCalledTimes(11);
      expect(timeout.mock.calls.every(([ms])=>ms===90000)).toBe(true);
      const tentativas=mock.mock.calls.filter(([,opts])=>opts.body.includes('Balancete mensal'));
      expect(tentativas).toHaveLength(2);expect(tentativas[0][1].signal).not.toBe(tentativas[1][1].signal);
      expect(log.mock.calls.some(([linha])=>linha==='balancete: nova tentativa')).toBe(true);
    } finally {timeout.mockRestore();}
  });
  it('declara indisponibilidade somente após duas falhas da mesma fixture',async()=>{
    const modelo=modeloFalso(),log=vi.fn();
    const mock=vi.fn(async(url,opts)=>opts.body.includes('Balancete mensal') ? {ok:false,status:503} : modelo(url,opts));
    expect(await avaliar({fetch:mock,log})).toEqual({acertos:casos.length-1,total:casos.length,indisponiveis:1});
    expect(mock.mock.calls.filter(([,opts])=>opts.body.includes('Balancete mensal'))).toHaveLength(2);
    expect(log.mock.calls.filter(([linha])=>linha==='balancete: modelo local indisponível')).toHaveLength(1);
  });
});

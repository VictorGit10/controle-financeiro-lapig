import { describe,it,expect } from 'vitest';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const fixtures=require('./fixtures/casos.json');
const Core=require('../../tools/vigia/src/processar.js');
const Modelo=require('../../tools/vigia/src/modelo.js');
const classificacoes=['concluido','exigencia','duvida','informativo','sem_acao'];
function contexto() {return {tarefas:JSON.parse(JSON.stringify(fixtures.tarefasDificeis)),config:fixtures.config,mapa:{}};}
function resposta(classificacao,patch={}) {
  return JSON.stringify({tarefa_id:null,varias:[],demanda_nova:false,classificacao,resumo:'Documento recebido.',trecho_evidencia:fixtures.mensagens.balancete.corpo,confianca:'alta',...patch});
}
describe('classificação sem tarefa vinculada',()=>{
  it.each(classificacoes)('sem vínculo e sem demanda preserva %s, sem aviso ou alegação',classificacao=>{
    const r=Core.processarMensagem(fixtures.mensagens.balancete,contexto(),()=>resposta(classificacao));
    expect(r.registro_mensagem).toMatchObject({fila:'rotina',motivo:'sem_tarefa_relacionada',classificacao,estado:'processada'});
    expect(r.precisa_victor).toBe(false);expect(r.vinculos).toEqual([]);expect(r.eventos).toEqual([]);expect(r.passos_sugeridos).toEqual([]);
  });
  it.each(classificacoes)('demanda nova sem vínculo preserva %s e exige revisão',classificacao=>{
    const r=Core.processarMensagem(fixtures.mensagens.balancete,contexto(),()=>resposta(classificacao,{demanda_nova:true}));
    expect(r.registro_mensagem).toMatchObject({fila:'esclarecer',motivo:'demanda_nova',classificacao,estado:'processada'});
    expect(r.precisa_victor).toBe(true);expect(r.vinculos).toEqual([]);expect(r.passos_sugeridos).toEqual([]);
  });
  it('concluido com vínculo somente em varias continua exigindo prova da tarefa vinculada',()=>{
    const r=Core.processarMensagem(fixtures.mensagens.balancete,contexto(),()=>resposta('concluido',{varias:['t-bolsa']}));
    expect(r.vinculos.map(v=>v.tarefa_id)).toEqual(['t-bolsa']);expect(r.precisa_victor).toBe(true);
    expect(r.registro_mensagem.motivo).toBe('alegacao_sem_evidencia');expect(r.passos_sugeridos).toEqual([]);
  });
  it('sem modelo e sem vínculo não presume que uma alegação pertença a uma tarefa',()=>{
    const c=contexto();c.tarefas=[];
    const r=Core.processarMensagem(fixtures.mensagens.alegacao,c);
    expect(r.registro_mensagem.motivo).toBe('sem_modelo');expect(r.vinculos).toEqual([]);
  });
  it('documenta no prompt que concluido só é considerado em relação à tarefa vinculada',()=>{
    const prompt=Modelo.montarPrompt({},[]);
    expect(prompt).toContain('concluido só é considerada em relação a uma tarefa vinculada');
    expect(prompt).toContain('demanda_nova=true');expect(prompt).toContain('envio de documento sem cobrança é demanda_nova=false');
  });
});

// Testes manuais da demo: node --test tools/vigia/demo/demo-local.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { once } = require('node:events');
const Demo = require('../demo-local.js');
const caixa = Demo.carregarCaixa(path.join(__dirname,'caixa.json'));
const env = {SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_ANON_KEY:'chave-sintetica',VIGIA_EMAIL:'vigia@exemplo.invalid',
  VIGIA_SENHA:'senha-sintetica',SITE_URL:'https://site.exemplo.invalid/#buriti',EMAIL_AVISO:'victor@exemplo.invalid',VICTOR_EMAIL:'victor@exemplo.invalid'};
function retorno(body,status=200) {return (typeof body==='string' ? body : JSON.stringify(body))+Demo.MARCA_STATUS+status;}
function configCurl(options,nome) {return JSON.parse(options.input.match(new RegExp('^'+nome+' = (.+)$','m'))[1]);}

test('resposta curl mantém corpo Unicode/multilinha, inclusive marcador dentro do corpo',()=>{
  const body='Justificação do Otávio\n'+Demo.MARCA_STATUS+'999\nFim';
  const r=Demo.respostaCurl(Buffer.from(retorno(body,201)),true);
  assert.equal(r.getResponseCode(),201);assert.equal(r.getContentText(),body);
});
test('muteHttpExceptions devolve 4xx/5xx e erro de formato nunca vira sucesso',()=>{
  assert.equal(Demo.respostaCurl(retorno({erro:'não autorizado'},401),true).getResponseCode(),401);
  assert.throws(()=>Demo.respostaCurl(retorno({},503),false),/http_503/);
  assert.throws(()=>Demo.respostaCurl('{}',true),/curl_resposta_invalida/);
  assert.throws(()=>Demo.respostaCurl(retorno('',0),true),/curl_resposta_invalida/);
});
test('curl recebe método, headers e corpo pelo stdin, sem segredo nos argumentos',()=>{
  const r=Demo.requisicaoCurl('http://localhost:8080/teste',{method:'patch',contentType:'application/json',headers:{Authorization:'Bearer token-sintetico'},payload:'{"texto":"linha\\ncom acento: ação"}'});
  assert.equal(configCurl(r.options,'request'),'PATCH');
  assert.equal(configCurl(r.options,'data-raw'),'{"texto":"linha\\ncom acento: ação"}');
  assert.ok(r.options.input.includes('Content-Type: application/json'));assert.ok(r.options.input.includes('Bearer token-sintetico'));
  assert.ok(!r.args.join(' ').includes('token-sintetico'));assert.equal(r.args[0],'--disable');
  const raw=Demo.requisicaoCurl('http://localhost:8080',{payload:'@arquivo-nao-deve-ser-lido\nlinha 2'});
  assert.equal(configCurl(raw.options,'data-raw'),'@arquivo-nao-deve-ser-lido\nlinha 2');
  assert.throws(()=>Demo.requisicaoCurl('http://localhost:8080',{headers:{Authorization:'token\r\nInjetado: sim'}}),/cabecalho_http_invalido/);
});
test('fachada HTTPS encaminha somente ao Supabase local e preserva POST JSON',()=>{
  const props=Demo.propertiesDoAmbiente(env),chamadas=[];
  assert.equal(props.SUPABASE_URL,'https://127.0.0.1:54321');
  const fetch=Demo.criarUrlFetchApp({env,properties:props,executarCurl:(bin,args,options)=>{chamadas.push({bin,args,options});return retorno({ok:true});}});
  assert.equal(fetch.fetch(props.SUPABASE_URL+'/rest/v1/rpc/vigia_contexto',{method:'post',payload:'{}',contentType:'application/json'}).getResponseCode(),200);
  assert.equal(chamadas[0].bin,'curl');assert.equal(configCurl(chamadas[0].options,'url'),'http://127.0.0.1:54321/rest/v1/rpc/vigia_contexto');
  assert.throws(()=>fetch.fetch('https://outro.exemplo.invalid/'),/destino_http_nao_permitido/);
  assert.throws(()=>Demo.propertiesDoAmbiente({...env,SUPABASE_URL:'https://producao.supabase.co'}),/máquina local/);
});
test('OLLAMA_LOCAL ativa Gas, troca URL e tira Authorization sem alterar payload',()=>{
  const local={...env,OLLAMA_LOCAL:'1'},properties=Demo.propertiesDoAmbiente(local),reqs=[];
  assert.equal(properties.OLLAMA_MODEL,'glm-5.3-flash:cloud');assert.ok(properties.OLLAMA_API_KEY);
  const stub=Demo.criarUrlFetchApp({env:local,properties,executarCurl:(bin,args,options)=>{reqs.push(options);return retorno({message:{content:'{}'}});}});
  const payload=JSON.stringify({model:properties.OLLAMA_MODEL,format:'json',stream:false,messages:[]});
  stub.fetch('https://ollama.com/api/chat',{method:'post',headers:{authorization:'Bearer sentinela'},payload});
  assert.equal(configCurl(reqs[0],'url'),'http://localhost:11434/api/chat');
  assert.equal(configCurl(reqs[0],'data-raw'),payload);assert.ok(!reqs[0].input.toLowerCase().includes('authorization'));
});
test('falha do curl é sanitizada e ntfy só imprime aviso',()=>{
  const properties=Demo.propertiesDoAmbiente(env),avisos=[];
  const stub=Demo.criarUrlFetchApp({env,properties,avisar:a=>avisos.push(a),executarCurl:()=>{throw new Error('senha-sintetica em argumento');}});
  assert.throws(()=>stub.fetch(properties.SUPABASE_URL+'/rest/v1/rpc/vigia_contexto'),{message:'curl_falhou'});
  assert.equal(stub.fetch('https://ntfy.sh/demo',{payload:'Corpo',headers:{Title:'Prazo'}}).getResponseCode(),200);
  assert.deepEqual(avisos,[{canal:'ntfy',titulo:'Prazo',texto:'Corpo'}]);
});
test('Gmail respeita --ate, datas da janela e threads fixas',()=>{
  const gmail=Demo.criarGmailApp(caixa.slice(0,4));
  assert.equal(gmail.getMessageById('DEMO-M5'),null);
  assert.equal(gmail.getMessageById('DEMO-M4').getThread().getId(),'T2');
  assert.equal(gmail.search('in:spam -in:trash after:0 before:9999999999').length,0);
  const de=Math.floor(Date.parse(caixa[3].recebida_em)/1000)-1;
  assert.equal(gmail.search('in:anywhere -in:spam -in:trash after:'+de+' before:9999999999').length,1);
  assert.equal(gmail.getMessageById('DEMO-M4').getAttachments().length,1);
  assert.throws(()=>Demo.argumentos(['--ate','-1']),/Use --ate/);
  assert.equal(Demo.argumentos(['--ate','4']).ate,4);
});
test('curl real faz HTTP síncrono em loopback, com corpo Unicode e cabeçalhos intactos',async()=>{
  // Servidor em outro thread: execFileSync não pode bloquear o loop do servidor HTTP.
  const worker=new Worker(`
    const http=require('node:http');
    const {parentPort}=require('node:worker_threads');
    const server=http.createServer((req,res)=>{
      let body='';req.setEncoding('utf8');req.on('data',c=>body+=c);
      req.on('end',()=>{res.writeHead(201,{'Content-Type':'application/json'});res.end(JSON.stringify({method:req.method,authorization:req.headers.authorization,body}));});
    });
    server.listen(0,'127.0.0.1',()=>parentPort.postMessage(server.address().port));
  `,{eval:true});
  try {
    const [port]=await once(worker,'message');
    const local={...env,SUPABASE_URL:'http://127.0.0.1:'+port};
    const properties=Demo.propertiesDoAmbiente(local),stub=Demo.criarUrlFetchApp({env:local,properties});
    const body='@não-é-arquivo\nJustificação de Otávio: "ação" \\ caminho';
    const response=stub.fetch(properties.SUPABASE_URL+'/echo',{method:'patch',headers:{Authorization:'Bearer token-sintetico'},payload:body});
    assert.equal(response.getResponseCode(),201);
    assert.deepEqual(JSON.parse(response.getContentText()),{method:'PATCH',authorization:'Bearer token-sintetico',body});
  } finally {await worker.terminate();}
});

function bancoFalso() {
  const estado={mensagens:new Map(),vinculos:new Map(),avisos:new Map(),execucoes:0,modelo:0};
  const tarefa={id:'demo-tarefa',project_id:'demo-projeto',titulo:'Implantar 2 meses de bolsa do Otávio',centro_custo:'30.068',responsavel:'Arthur',criada_em:'2026-10-05T12:00:00Z',status:'em_andamento',
    chaves:[{tipo:'thread',valor:'T1'},{tipo:'centro_custo',valor:'30.068'},{tipo:'pessoa',valor:'Otávio'}],
    passos:[{id:'demo-p1',estado:'confirmado',evidencia:{tipo:'manual'}},{id:'demo-p2',estado:'pendente',evidencia:{tipo:'manual'}},
      {id:'demo-p3',estado:'pendente',evidencia:{tipo:'email',de:'arthur@exemplo.invalid',para_dominio:'funape.org.br',cc_inclui:['victor@exemplo.invalid','manuel@ufg.br'],contem_todos:['30.068'],contem_algum:['Otávio','bolsistas']}}]};
  function curl(bin,args,options) {
    const url=configCurl(options,'url'),data=JSON.parse(configCurl(options,'data-raw'));
    if(url.includes('/auth/v1/token')) return retorno({access_token:'jwt-sintetico',expires_in:3600});
    if(url==='http://localhost:11434/api/chat') {
      estado.modelo++;assert.equal(data.model,'glm-5.3-flash:cloud');
      const prompt=data.messages[0].content;
      const email=JSON.parse(prompt.slice(prompt.indexOf('\nDADOS_EMAIL=')+13,prompt.lastIndexOf('\nDADOS_CANDIDATOS=')));
      const nova=email.assunto.includes('Consulta sobre');
      return retorno({message:{content:JSON.stringify({tarefa_id:nova ? null : tarefa.id,varias:[],demanda_nova:nova,classificacao:nova ? 'duvida' : 'exigencia',resumo:'Teste',trecho_evidencia:email.corpo,confianca:'alta'})}});
    }
    const nome=url.split('/').pop(),p=data.p;
    if(nome==='vigia_contexto') return retorno({versao_esquema:1,cursor_em:estado.cursor || null,tarefas:[tarefa],pendentes:[...estado.mensagens.values()].filter(m=>m.estado==='capturada').map(m=>({gmail_message_id:m.gmail_message_id})),vinculos:[...estado.vinculos.values()],alertas_emitidos:[],esclarecer:0,rotina:0,saude:'ok'});
    if(nome==='vigia_capturar') {
      let novas=0;
      for(const m of p.mensagens) if(!estado.mensagens.has(m.gmail_message_id)) {estado.mensagens.set(m.gmail_message_id,m);novas++;}
      estado.cursor=p.janela.fim;
      return retorno({mensagens_novas:novas,processar_ids:p.mensagens.filter(m=>estado.mensagens.get(m.gmail_message_id).estado==='capturada').map(m=>m.gmail_message_id),cursor_em:estado.cursor});
    }
    if(nome==='vigia_registrar') {
      if(p.execucao && !p.execucao.id) return retorno({execucao_id:'demo-exec-'+(++estado.execucoes)});
      for(const r of p.resultados || []) {
        const id=r.registro_mensagem.gmail_message_id;
        estado.mensagens.set(id,r.registro_mensagem);
        for(const v of r.vinculos) estado.vinculos.set(id+':'+v.tarefa_id,v);
        for(const passo of r.passos_sugeridos) {const alvo=tarefa.passos.find(s=>s.id===passo.passo_id);if(alvo.estado==='pendente')alvo.estado='sugerido';}
        if(r.precisa_victor) estado.avisos.set('aviso:'+id,{chave:'aviso:'+id,tipo:r.passos_sugeridos.length ? 'sugestao' : r.vinculos.length ? 'mensagem' : 'esclarecer',tarefa_id:r.vinculos.length ? tarefa.id : null,estado:'pendente'});
      }
      for(const a of p.avisos_resultados || []) estado.avisos.get(a.chave).estado=a.estado;
      return retorno({avisos:[...estado.avisos.values()].filter(a=>a.estado!=='enviado')});
    }
    if(nome==='vigia_expurgar') return retorno({mensagens_expurgadas:0});
    throw new Error('RPC inesperada');
  }
  return {curl,estado,tarefa};
}
test('bundle real roda rodadas --ate 3, 4, 5, 6 e repetição sem efeitos duplicados',()=>{
  const banco=bancoFalso(),logs=[],local={...env,OLLAMA_LOCAL:'1'};
  const rodar=ate=>Demo.executarDemo({env:local,caixa,ate,executarCurl:banco.curl,log:s=>logs.push(s)});
  assert.equal(rodar(3).resultado.estado,'ok');
  assert.equal(banco.estado.mensagens.get('DEMO-M1').motivo,'mensagem_propria');
  assert.equal(banco.estado.mensagens.get('DEMO-M2').fila,'rotina');
  assert.equal(banco.estado.mensagens.get('DEMO-M3').fila,'rotina');
  const quarta=rodar(4);
  assert.equal(banco.tarefa.passos[2].estado,'sugerido');assert.equal(banco.estado.mensagens.get('DEMO-M4').fila,'tarefa');
  assert.equal(quarta.estado.avisos.length,1);
  assert.equal(rodar(4).estado.avisos.length,0);
  rodar(5);assert.equal(banco.estado.mensagens.get('DEMO-M5').classificacao,'exigencia');
  rodar(6);assert.equal(banco.estado.mensagens.get('DEMO-M6').motivo,'demanda_nova');
  assert.equal(banco.estado.mensagens.size,6);assert.equal(banco.estado.modelo,2);
  assert.ok(logs.some(s=>s.startsWith('AVISO:')));assert.ok(logs.some(s=>s.includes('Passos sugeridos nesta rodada: 1')));
  assert.ok(logs.every(s=>!s.includes('senha-sintetica') && !s.includes('jwt-sintetico')));
});

// Executor manual do bundle REAL. Não carrega credenciais de arquivos nem entra no npm test.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const MARCA_STATUS = '\n__VIGIA_CURL_STATUS__:';
const CAMPOS = ['SUPABASE_URL','SUPABASE_ANON_KEY','VIGIA_EMAIL','VIGIA_SENHA','SITE_URL','EMAIL_AVISO','VICTOR_EMAIL','OLLAMA_MODEL',
  'OLLAMA_API_KEY','NTFY_TOPICO','OLLAMA_TIMEOUT_MS','DOMINIOS_INSTITUCIONAIS','REMETENTES_AUTOMATICOS'];

function urlLocal(valor) {
  let url;
  try { url = new URL(valor); } catch (_) { throw new Error('SUPABASE_URL deve ser uma URL local válida.'); }
  if (!['http:','https:'].includes(url.protocol) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) {
    throw new Error('A demonstração exige SUPABASE_URL na máquina local, sem credenciais na URL.');
  }
  return url.origin;
}

function propertiesDoAmbiente(env) {
  const properties = {};
  for (const campo of CAMPOS) if (env[campo]) properties[campo] = env[campo];
  const real = urlLocal(properties.SUPABASE_URL);
  // Fachada HTTPS só para passar pela validação do Gas; o transporte usa a URL real.
  properties.SUPABASE_URL = real.replace(/^http:/, 'https:');
  if (env.OLLAMA_LOCAL === '1') {
    // Apenas ativa o adaptador; esta sentinela é retirada antes da requisição HTTP.
    properties.OLLAMA_API_KEY = 'demo-local-sem-chave';
    properties.OLLAMA_MODEL = 'glm-5.3-flash:cloud';
    if (!properties.OLLAMA_TIMEOUT_MS) properties.OLLAMA_TIMEOUT_MS = '90000';
  }
  return properties;
}

function respostaCurl(stdout, muteHttpExceptions) {
  const texto = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout);
  const separador = texto.lastIndexOf(MARCA_STATUS), codigo = texto.slice(separador + MARCA_STATUS.length).trim();
  if (separador < 0 || !/^[1-5]\d{2}$/.test(codigo)) throw new Error('curl_resposta_invalida');
  const status = Number(codigo), corpo = texto.slice(0, separador);
  if (!muteHttpExceptions && (status < 200 || status >= 300)) throw new Error('http_' + status);
  return { getResponseCode: () => status, getContentText: () => corpo };
}

function quoteCurl(valor) {
  return '"' + String(valor).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
}

function requisicaoCurl(url, opcoes = {}) {
  const metodo = String(opcoes.method || (opcoes.payload != null ? 'post' : 'get')).toUpperCase();
  if (!['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(metodo)) throw new Error('metodo_http_invalido');
  const headers = Object.entries(opcoes.headers || {});
  if (opcoes.contentType && !headers.some(([nome]) => nome.toLowerCase() === 'content-type')) headers.push(['Content-Type',opcoes.contentType]);
  const config = ['url = ' + quoteCurl(url), 'request = ' + quoteCurl(metodo)];
  for (const [nome,valor] of headers) {
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(nome) || /[\r\n]/.test(String(valor))) throw new Error('cabecalho_http_invalido');
    config.push('header = ' + quoteCurl(nome + ': ' + valor));
  }
  if (opcoes.payload != null) {
    let payload = opcoes.payload;
    if (typeof payload === 'object' && !Buffer.isBuffer(payload)) {
      if ((opcoes.contentType || '').includes('application/json')) payload = JSON.stringify(payload);
      else {
        payload = new URLSearchParams(payload).toString();
        if (!headers.some(([nome]) => nome.toLowerCase() === 'content-type')) config.push('header = ' + quoteCurl('Content-Type: application/x-www-form-urlencoded'));
      }
    }
    // data-raw não interpreta @arquivo. Cabeçalhos/senha/corpo ficam no stdin, fora dos argumentos.
    config.push('data-raw = ' + quoteCurl(payload));
  }
  config.push('write-out = ' + quoteCurl(MARCA_STATUS + '%{http_code}'));
  return { args: ['--disable','--silent','--show-error','--connect-timeout','10','--max-time','90','--config','-'],
    options: { input: config.join('\n') + '\n', encoding: 'utf8', timeout: 95000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, stdio: ['pipe','pipe','pipe'] } };
}

function criarUrlFetchApp({env,properties,executarCurl = childProcess.execFileSync,avisar = () => {},observarRpc = () => {}}) {
  const origemReal = urlLocal(env.SUPABASE_URL), origemGas = properties.SUPABASE_URL;
  return { fetch(url, opcoes = {}) {
    const entrada = new URL(url);
    if (entrada.origin === 'https://ntfy.sh') {
      avisar({canal:'ntfy',titulo:(opcoes.headers || {}).Title || 'Vigia LAPIG',texto:String(opcoes.payload || '')});
      return {getResponseCode:()=>200,getContentText:()=>'{"demo":true}'};
    }
    let destino = url, headers = {...opcoes.headers};
    const supabase = entrada.origin === origemGas;
    if (supabase) destino = origemReal + entrada.pathname + entrada.search;
    else if (url === 'https://ollama.com/api/chat') {
      if (env.OLLAMA_LOCAL === '1') {
        destino = 'http://localhost:11434/api/chat';
        headers = Object.fromEntries(Object.entries(headers).filter(([nome])=>nome.toLowerCase() !== 'authorization'));
      } else if (!env.OLLAMA_API_KEY) throw new Error('modelo_cloud_sem_chave');
    } else throw new Error('destino_http_nao_permitido');
    const requisicao = requisicaoCurl(destino,{...opcoes,headers});
    let stdout;
    try { stdout = executarCurl('curl',requisicao.args,requisicao.options); }
    catch (erro) { throw new Error(erro.code === 'ETIMEDOUT' || erro.status === 28 ? 'curl_timeout' : erro.code === 'ENOENT' ? 'curl_nao_encontrado' : 'curl_falhou'); }
    const resposta = respostaCurl(stdout,opcoes.muteHttpExceptions);
    if (supabase && entrada.pathname.startsWith('/rest/v1/rpc/')) {
      let payload,saida;
      try { payload = JSON.parse(opcoes.payload || '{}'); } catch (_) { payload = null; }
      try { saida = JSON.parse(resposta.getContentText()); } catch (_) { saida = null; }
      observarRpc({nome:entrada.pathname.split('/').pop(),entrada:payload,saida,status:resposta.getResponseCode()});
    }
    return resposta;
  } };
}

function carregarCaixa(arquivo) {
  const caixa = JSON.parse(fs.readFileSync(arquivo,'utf8'));
  if (!Array.isArray(caixa) || !caixa.length) throw new Error('caixa_invalida');
  const vistos = new Set();
  let anterior = -Infinity;
  for (const msg of caixa) {
    const data = Date.parse(msg.recebida_em);
    if (!msg.gmail_message_id || !msg.gmail_thread_id || !Number.isFinite(data) || data < anterior || vistos.has(msg.gmail_message_id)) throw new Error('caixa_invalida');
    vistos.add(msg.gmail_message_id); anterior = data;
  }
  return caixa;
}

function criarGmailApp(mensagens) {
  const porId = new Map(),threads = new Map();
  for (const msg of mensagens) {
    if (!threads.has(msg.gmail_thread_id)) threads.set(msg.gmail_thread_id,{id:msg.gmail_thread_id,mensagens:[]});
    const thread = threads.get(msg.gmail_thread_id);
    const objeto = {
      getId:()=>msg.gmail_message_id,getThread:()=>thread.api,getDate:()=>new Date(msg.recebida_em),
      getFrom:()=>msg.de || '',getTo:()=>msg.para || '',getCc:()=>msg.cc || '',getSubject:()=>msg.assunto || '',getPlainBody:()=>msg.corpo || '',
      getHeader:nome=>{const chave=Object.keys(msg.headers || {}).find(k=>k.toLowerCase()===nome.toLowerCase());return chave ? msg.headers[chave] : '';},
      getAttachments:()=>Array.from({length:msg.anexos || 0},()=>({})),isInTrash:()=>msg.lixeira===true,isInSpam:()=>msg.spam===true
    };
    thread.mensagens.push(objeto);porId.set(msg.gmail_message_id,objeto);
  }
  for (const thread of threads.values()) thread.api={getId:()=>thread.id,getMessages:()=>thread.mensagens.slice()};
  return {
    getMessageById:id=>porId.get(id) || null,
    search(query,inicio=0,max=100) {
      const depois=query.match(/\bafter:(\d+)/),antes=query.match(/\bbefore:(\d+)/),spam=query.startsWith('in:spam');
      const encontrados=[...threads.values()].filter(t=>t.mensagens.some(m=>!m.isInTrash() && m.isInSpam()===spam &&
        (!depois || m.getDate().getTime()>Number(depois[1])*1000) && (!antes || m.getDate().getTime()<Number(antes[1])*1000)));
      return encontrados.slice(inicio,inicio+max).map(t=>t.api);
    }
  };
}

function criarScriptApp() {
  let gatilhos=[];
  return {getProjectTriggers:()=>gatilhos.slice(),deleteTrigger:t=>{gatilhos=gatilhos.filter(x=>x!==t);},newTrigger:nome=>{
    const trigger={getHandlerFunction:()=>nome},builder={};
    for (const metodo of ['timeBased','everyMinutes','atHour','everyDays','inTimezone']) builder[metodo]=()=>builder;
    builder.create=()=>{gatilhos.push(trigger);return trigger;};return builder;
  }};
}

function criarSandbox({env,caixa,ate,executarCurl,log = console.log}) {
  const properties=propertiesDoAmbiente(env),mensagens=caixa.slice(0,ate),estado={rpcs:[],avisos:[]};
  const ultima = mensagens.length ? Date.parse(mensagens[mensagens.length-1].recebida_em) : Date.parse(caixa[0].recebida_em);
  const referenciaReal=Date.now(),referenciaDemo=ultima+1000;
  class DataDemo extends Date {
    constructor(...args) {super(...(args.length ? args : [DataDemo.now()]));}
    static now() {return referenciaDemo + (Date.now()-referenciaReal);}
  }
  function avisar(aviso) {estado.avisos.push(aviso);log('AVISO: '+aviso.titulo+' ['+aviso.canal+']\n'+aviso.texto);}
  let bloqueado=false;
  const sandbox={
    Date:DataDemo,Intl,console:{log:(...args)=>log(args.join(' ')),warn:(...args)=>log(args.join(' ')),error:(...args)=>log(args.join(' '))},
    Logger:{log:(...args)=>log(args.join(' '))},
    PropertiesService:{getScriptProperties:()=>({getProperties:()=>({...properties}),getProperty:nome=>properties[nome] || null,setProperty:(nome,valor)=>{properties[nome]=String(valor);}})},
    UrlFetchApp:criarUrlFetchApp({env,properties,executarCurl,avisar,observarRpc:r=>estado.rpcs.push(r)}),
    GmailApp:criarGmailApp(mensagens),MailApp:{sendEmail:aviso=>avisar({canal:'email',titulo:aviso.subject || 'Vigia LAPIG',texto:aviso.body || ''})},
    LockService:{getScriptLock:()=>({tryLock:()=>{if(bloqueado)return false;bloqueado=true;return true;},releaseLock:()=>{bloqueado=false;}})},
    ScriptApp:criarScriptApp(),Utilities:{getUuid:()=>crypto.randomUUID()}
  };
  vm.createContext(sandbox);
  return {sandbox,estado,properties};
}

function textoResumo(estado,resultado,ate,total) {
  const capturas=estado.rpcs.filter(r=>r.nome==='vigia_capturar' && r.status>=200 && r.status<300);
  const registros=estado.rpcs.filter(r=>r.nome==='vigia_registrar' && r.status>=200 && r.status<300);
  const processadas=registros.flatMap(r=>r.entrada?.p?.resultados || []);
  const capturadas=capturas.flatMap(r=>r.entrada?.p?.mensagens || []);
  const novas=capturas.reduce((n,r)=>n+Number(r.saida?.mensagens_novas || 0),0);
  const linhas=['\nRodada --ate '+ate+' ('+ate+'/'+total+' mensagens liberadas)',
    'Execução: '+(resultado?.estado || 'falhou'), 'Capturadas nesta janela: '+capturadas.length+'; novas no banco: '+novas,
    'Filas / processamento:'];
  const idsProcessados=new Set(processadas.map(r=>r.registro_mensagem.gmail_message_id));
  for(const r of processadas) {const m=r.registro_mensagem;linhas.push('  '+m.gmail_message_id+': '+(m.fila || m.estado)+' · '+m.motivo+(m.classificacao ? ' · '+m.classificacao : '')+(r.precisa_victor ? ' · precisa de Victor' : ''));}
  for(const m of capturadas) if(!idsProcessados.has(m.gmail_message_id)) linhas.push('  '+m.gmail_message_id+': já capturada; sem reprocessamento nesta rodada');
  if(!capturadas.length && !processadas.length) linhas.push('  Nenhuma mensagem nesta janela.');
  const vinculos=processadas.flatMap(r=>r.vinculos),passos=processadas.flatMap(r=>r.passos_sugeridos);
  linhas.push('Vínculos desta rodada: '+vinculos.length);
  for(const v of vinculos) linhas.push('  '+v.gmail_message_id+' → '+v.tarefa_id+' ('+v.estado+', '+v.origem+')');
  linhas.push('Passos sugeridos nesta rodada: '+passos.length);
  for(const p of passos) linhas.push('  '+p.tarefa_id+' / '+p.passo_id+' → '+p.estado);
  linhas.push('Avisos simulados: '+estado.avisos.length);
  for(const a of estado.avisos) linhas.push('  '+a.titulo+' ('+a.canal+')');
  linhas.push('Chamadas ao modelo: '+processadas.filter(r=>r.chamou_modelo).length);
  const erros=registros.flatMap(r=>r.entrada?.p?.execucao?.erros || []);
  linhas.push('Erros registrados: '+erros.length);
  for(const e of erros) linhas.push('  '+(e.gmail_message_id ? e.gmail_message_id+': ' : '')+e.codigo);
  return linhas.join('\n');
}

function executarDemo({env=process.env,caixa,ate,arquivoGas=path.join(__dirname,'dist/Vigia.gs'),executarCurl,log=console.log}) {
  const runtime=criarSandbox({env,caixa,ate,executarCurl,log});
  vm.runInContext(fs.readFileSync(arquivoGas,'utf8'),runtime.sandbox,{filename:arquivoGas});
  log('Demonstração local: banco real; Gmail e avisos simulados.');
  runtime.sandbox.testarConfiguracao();
  let resultado,erro;
  try {resultado=runtime.sandbox.checar();} catch(e) {erro=e;}
  log(textoResumo(runtime.estado,resultado,ate,caixa.length));
  if(erro) throw erro;
  return {resultado,estado:runtime.estado};
}

function argumentos(argv) {
  const opcoes={arquivoCaixa:path.join(__dirname,'demo/caixa.json'),ate:null,ajuda:false};
  for(let i=0;i<argv.length;i++) {
    if(argv[i]==='--ajuda' || argv[i]==='--help') opcoes.ajuda=true;
    else if(argv[i]==='--ate' && /^\d+$/.test(argv[i+1] || '')) opcoes.ate=Number(argv[++i]);
    else if(argv[i]==='--caixa' && argv[i+1]) opcoes.arquivoCaixa=path.resolve(argv[++i]);
    else throw new Error('Use --ate N e, opcionalmente, --caixa arquivo.json ou --ajuda.');
  }
  return opcoes;
}
function main(argv=process.argv.slice(2)) {
  const opcoes=argumentos(argv);
  if(opcoes.ajuda) {console.log('node tools/vigia/demo-local.js --ate N [--caixa arquivo.json]\nUso e configuração: tools/vigia/demo/README.md');return;}
  const caixa=carregarCaixa(opcoes.arquivoCaixa),ate=opcoes.ate == null ? caixa.length : opcoes.ate;
  if(!Number.isSafeInteger(ate) || ate<0 || ate>caixa.length) throw new Error('--ate deve estar entre 0 e '+caixa.length+'.');
  const faltantes=['SUPABASE_URL','SUPABASE_ANON_KEY','VIGIA_EMAIL','VIGIA_SENHA','SITE_URL','EMAIL_AVISO'].filter(k=>!process.env[k]);
  if(faltantes.length) throw new Error('Defina as variáveis: '+faltantes.join(', ')+'. Consulte tools/vigia/demo/README.md.');
  return executarDemo({caixa,ate});
}
if(require.main===module) {
  try {main();} catch(erro) {console.error('Demo interrompida: '+erro.message);process.exitCode=1;}
}
module.exports={MARCA_STATUS,propertiesDoAmbiente,respostaCurl,requisicaoCurl,criarUrlFetchApp,carregarCaixa,criarGmailApp,criarSandbox,textoResumo,executarDemo,argumentos};

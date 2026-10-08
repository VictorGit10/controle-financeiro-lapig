// Base descartável em memória; nenhuma conexão com o banco de produção.
// npm install --prefix .cache/pglite-056 --cache .cache/npm --no-save --package-lock=false @electric-sql/pglite
// node tools/replica-local/rodar-056-pglite.mjs
import { readFile } from 'node:fs/promises';
import { PGlite } from '../../.cache/pglite-056/node_modules/@electric-sql/pglite/dist/index.js';
const db = new PGlite();
async function sql(text) { return db.exec(text, { onNotice: n => console.log(n.message) }); }
async function arquivo(path) {
  console.log('Conferindo ' + path);
  await sql((await readFile(new URL('../../' + path, import.meta.url), 'utf8'))
    .replace(/^\\set ON_ERROR_STOP on\r?$/m, ''));
}
const helpers = `select proname,md5(pg_get_functiondef(oid)) assinatura
  from pg_proc where pronamespace='public'::regnamespace and proname in
  ('is_agente','is_admin','allowed_project_ids','assert_project_allowed','contem_cpf','bloqueia_escrita_do_agente')
  order by proname`;
try {
  for (const path of ['tools/replica-local/sintetico/stub.sql',
    'tools/replica-local/sintetico/stub-051.sql', 'tools/replica-local/sintetico/stub-054.sql',
    'database/051_buriti_propostas_do_agente.sql', 'tools/replica-local/sintetico/stub-052.sql',
    'database/052_privacidade_bolsistas_agente.sql', 'database/054_buriti_tarefas.sql',
    'database/055_buriti_administra_tarefas.sql', 'tools/replica-local/sintetico/stub-056.sql']) await arquivo(path);
  // O mesmo roteiro precisa detectar o defeito na base anterior.
  let detectou = false;
  try { await arquivo('tests/sql/test_056_buriti_propoe_plano.sql'); }
  catch (e) {
    if (e.code !== '23514' || !e.message.includes('propostas_agente_tipo_check')) throw e;
    detectou = true;
    console.log('ANTES da 056: roteiro detectou tipo plano recusado (23514).');
  } finally { await sql('rollback;'); }
  if (!detectou) throw new Error('Roteiro não detectou o defeito antes da 056.');

  // Isola também o defeito de atomicidade da RPC da 033, permitindo só o tipo
  // numa transação revertida. A aplicação financeira deixa proposta pendente.
  await sql(`begin;
    alter table public.propostas_agente drop constraint propostas_agente_tipo_check;
    alter table public.propostas_agente add constraint propostas_agente_tipo_check
      check(tipo in ('balancete','bolsas','pergunta','aviso','tarefa','plano'));
    select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',true);
    do $$ declare x uuid; p uuid; plano uuid; begin
      select id into x from public.projects where code='51.X';
      p:=public.criar_proposta('plano',x,'Prova sintética da lacuna');
      perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',true);
      plano:=public.upsert_plano_trabalho(jsonb_build_object('project_id',x,'proposta_id',p));
      if (select status from public.propostas_agente where id=p)<>'pendente'
        or not exists(select 1 from public.planos_trabalho where id=plano) then
        raise exception 'Stub não reproduziu a lacuna de atomicidade da 033';
      end if;
      raise notice 'ANTES da 056: RPC 033 grava plano e deixa proposta pendente (defeito reproduzido).';
    end $$;
    rollback;`);
  const antes = (await db.query(helpers)).rows;
  const aclAntes = (await db.query("select proacl::text from pg_proc where oid='public.upsert_plano_trabalho(jsonb)'::regprocedure")).rows;
  await arquivo('database/056_buriti_propoe_plano.sql');
  await arquivo('tests/sql/test_056_buriti_propoe_plano.sql');
  const depois = (await db.query(helpers)).rows;
  const aclDepois = (await db.query("select proacl::text from pg_proc where oid='public.upsert_plano_trabalho(jsonb)'::regprocedure")).rows;
  if (JSON.stringify(antes) !== JSON.stringify(depois)) throw new Error('056 alterou helper protegido.');
  if (JSON.stringify(aclAntes) !== JSON.stringify(aclDepois)) throw new Error('056 alterou ACL da RPC.');
  console.log('056 OK em PGlite: 6 blocos, defeitos reproduzidos antes, helpers e ACL idênticos.');
} catch (e) {
  console.error(e.message, e.detail || '', e.where || '');
  process.exitCode = 1;
} finally { await db.close(); }

// Alternativa sintética sem Docker. Dependência só em .cache (ignorada).
// npm install --prefix .cache/pglite-054 --cache .cache/npm --no-save --package-lock=false @electric-sql/pglite
// node tools/replica-local/rodar-054-pglite.mjs
import { readFile } from 'node:fs/promises';
import { PGlite } from '../../.cache/pglite-054/node_modules/@electric-sql/pglite/dist/index.js';
const db = new PGlite({ onNotice: n => console.log(n.message) });
async function sql(text) { await db.exec(text); }
async function arquivo(path) {
  console.log('Conferindo ' + path);
  // Só remove a diretiva do cliente psql; o SQL é o mesmo do Docker.
  await sql((await readFile(new URL('../../' + path, import.meta.url), 'utf8')).replace(/^\\set ON_ERROR_STOP on\r?$/m, ''));
}
try {
  for (const path of ['tools/replica-local/sintetico/stub.sql',
    'tools/replica-local/sintetico/stub-051.sql', 'tools/replica-local/sintetico/stub-054.sql',
    'database/051_buriti_propostas_do_agente.sql', 'tools/replica-local/sintetico/stub-052.sql',
    'database/052_privacidade_bolsistas_agente.sql']) await arquivo(path);
  await sql(`select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
    select set_config('test054.prova_y',(select id::text from public.projects where code='51.Y'),false);
    set role authenticated;
    select public.stub_escrita_sem_guard(current_setting('test054.prova_y')::uuid);
    reset role;
    select set_config('request.jwt.claim.sub','',false);
    create schema teste054;
    create table teste054.helpers as select oid,md5(pg_get_functiondef(oid)) assinatura
    from pg_proc where pronamespace='public'::regnamespace and proname in
    ('is_agente','is_admin','allowed_project_ids','assert_project_allowed','contem_cpf','bloqueia_escrita_do_agente');`);
  await arquivo('database/054_buriti_tarefas.sql');
  await arquivo('tests/sql/test_054_buriti_tarefas.sql');
  await arquivo('database/055_buriti_administra_tarefas.sql');
  await arquivo('tests/sql/test_055_buriti_administra_tarefas.sql');
  console.log('054 e 055 OK em PGlite. Concorrência entre conexões exige rodar-054.sh/Docker.');
} catch (e) {
  console.error(e.message, e.detail || '', e.where || '');
  process.exitCode = 1;
} finally { await db.close(); }

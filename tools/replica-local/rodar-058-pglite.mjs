// Base descartável em memória; nenhuma conexão com o banco de produção.
// npm install --prefix .cache/pglite-056 --cache .cache/npm --no-save --package-lock=false @electric-sql/pglite
// node tools/replica-local/rodar-058-pglite.mjs (aplica 054→057 como o rodar-057 e então prova a 058)
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
    'database/052_privacidade_bolsistas_agente.sql']) await arquivo(path);
  // Mesmo preparo do rodar-054-pglite.mjs: o roteiro da 054 confere estes helpers.
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
  for (const path of ['database/054_buriti_tarefas.sql', 'tests/sql/test_054_buriti_tarefas.sql',
    'database/055_buriti_administra_tarefas.sql', 'tests/sql/test_055_buriti_administra_tarefas.sql']) await arquivo(path);
  // Antes da 057 o roteiro tem de falhar: a atualização pelo responsável não existe.
  let detectou = false;
  try { await arquivo('tests/sql/test_057_tarefas_atualizar_e_editar.sql'); }
  catch (e) {
    if (e.code !== '42883' || !e.message.includes('registrar_atualizacao')) throw e;
    detectou = true;
    console.log('ANTES da 057: roteiro detectou a falta de registrar_atualizacao (42883).');
  } finally { await sql('rollback;'); }
  if (!detectou) throw new Error('Roteiro não detectou a lacuna antes da 057.');
  // Aviso avulso que já estava na fila antes da 057 tem de sair dela.
  // Falha do vigia ainda não entregue é essencial: fica na fila (achado da revisão de 08/10).
  await sql(`insert into public.vigia_avisos(chave,texto,tipo) values('antigo:esclarecer','Há uma mensagem para revisar.','esclarecer'),
    ('antigo:saude','A checagem requer revisão.','saude');`);
  const antes = (await db.query(helpers)).rows;
  await arquivo('database/057_tarefas_atualizar_e_editar.sql');
  await arquivo('tests/sql/test_057_tarefas_atualizar_e_editar.sql');
  // Produção hoje: save_user_assignments da 033. Antes da 058 o roteiro tem de falhar.
  await arquivo('tools/replica-local/sintetico/stub-058.sql');
  let lacuna = false;
  try { await arquivo('tests/sql/test_058_atividades.sql'); }
  catch (e) {
    if (e.code !== '42883' || !e.message.includes('criar_tarefa_na_tela')) throw e;
    lacuna = true;
    console.log('ANTES da 058: roteiro detectou a falta de criar_tarefa_na_tela (42883).');
  } finally { await sql('rollback;'); }
  if (!lacuna) throw new Error('Roteiro não detectou a lacuna antes da 058.');
  // O defeito de produção sozinho: atribuir centros ao agente é recusado com a função da 033.
  let papel = false;
  try {
    await sql(`begin; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
      set local role authenticated;
      select public.save_user_assignments('00000000-0000-0000-0000-0000000000c1','agente',null);`);
  } catch (e) {
    if (!e.message.includes('Papel inválido: agente')) throw e;
    papel = true;
    console.log('ANTES da 058: "Papel inválido: agente", como na tela em 09/10.');
  } finally { await sql('rollback;'); }
  if (!papel) throw new Error('Stub não reproduziu o erro de produção.');
  const antes058 = (await db.query(helpers)).rows;
  await arquivo('database/058_atividades.sql');
  await arquivo('tests/sql/test_058_atividades.sql');
  // As regras anteriores continuam valendo depois da 058.
  await arquivo('tests/sql/test_055_buriti_administra_tarefas.sql');
  await arquivo('tests/sql/test_057_tarefas_atualizar_e_editar.sql');
  const depois = (await db.query(helpers)).rows;
  if (JSON.stringify(antes058) !== JSON.stringify(depois)) throw new Error('058 alterou helper protegido.');
  console.log('058 OK em PGlite: lacuna e erro de produção provados antes; 055 e 057 seguem passando; helpers idênticos.');
} catch (e) {
  console.error(e.message, e.detail || '', e.where || '');
  process.exitCode = 1;
} finally { await db.close(); }

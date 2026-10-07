#!/usr/bin/env bash
# Apenas um container novo, sem portas, mounts, dumps ou credenciais reais.
# Uso (Git Bash, na raiz): bash tools/replica-local/rodar-054.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
docker info >/dev/null
container="cf-054-$(date +%s)-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$container" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
ready=false
for ((i=0;i<60;i++)); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then docker logs "$container"; exit 1; fi
run_sql() {
  echo "Conferindo $1"
  docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < "$1"
}
run_sql tools/replica-local/sintetico/stub.sql
run_sql tools/replica-local/sintetico/stub-051.sql
run_sql tools/replica-local/sintetico/stub-054.sql
run_sql database/051_buriti_propostas_do_agente.sql
run_sql tools/replica-local/sintetico/stub-052.sql
run_sql database/052_privacidade_bolsistas_agente.sql
# Prova do defeito anterior: login dedicado, fora do projeto Y, ainda consegue
# escrever numa RPC definer sem guard. Depois da 054 o MESMO caminho é negado.
docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 <<'SQL'
select id as projeto_y from public.projects where code='51.Y' \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select public.stub_escrita_sem_guard(:'projeto_y'::uuid);
reset role;
select set_config('request.jwt.claim.sub','',false);
SQL
# Guardar definições antes: o teste prova que a 054 não tocou os helpers.
docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 <<'SQL'
create schema teste054;
create table teste054.helpers as select oid,md5(pg_get_functiondef(oid)) assinatura
from pg_proc where pronamespace='public'::regnamespace and proname in
('is_agente','is_admin','allowed_project_ids','assert_project_allowed','contem_cpf','bloqueia_escrita_do_agente');
SQL
run_sql database/054_buriti_tarefas.sql
run_sql tests/sql/test_054_buriti_tarefas.sql

# Duas conexões reais: pg_stat_activity confirma a espera antes de observar os
# locks. NOWAIT prova que o lote não travou a mensagem/tarefa de maior ID antes
# da tarefa/mensagem de menor ID. Lotes deliberadamente enviados ao contrário.
logs=$(mktemp -d)
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -f "$logs"/*.log
  rmdir "$logs"
}
conn() { docker exec -i -e "PGAPPNAME=$1" -e 'PGOPTIONS=-c statement_timeout=25000' "$container" psql -X -U postgres -v ON_ERROR_STOP=1; }
await_state() {
  for ((i=0;i<100;i++)); do
    if [[ $(docker exec "$container" psql -X -U postgres -Atc "select count(*) from pg_stat_activity where application_name='$1' and ($2)") == 1 ]]; then return; fi
    sleep .1
  done
  cat "$logs"/*.log
  echo "054 FALHOU: conexão $1 não atingiu a espera esperada" >&2
  exit 1
}
finish_pair() {
  if ! wait "$pid_a"; then cat "$logs"/*.log; exit 1; fi
  if ! wait "$pid_b"; then cat "$logs"/*.log; exit 1; fi
}
conn preparo <<'SQL'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select public.set_automacao('00000000-0000-0000-0000-0000000000d1','vigia',true);
SQL

conn ordem_tarefa_a >"$logs/tarefa-a.log" 2>&1 <<'SQL' &
begin;
select id from public.tarefas where id=(select menor from teste054.concorrencia) for update;
select pg_sleep(12);
commit;
SQL
pid_a=$!
await_state ordem_tarefa_a "wait_event='PgSleep'"
conn ordem_tarefa_b >"$logs/tarefa-b.log" 2>&1 <<'SQL' &
select lote::text as lote from teste054.concorrencia \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select public.vigia_registrar(:'lote'::jsonb);
SQL
pid_b=$!
await_state ordem_tarefa_b "wait_event_type='Lock'"
conn observar_tarefa <<'SQL'
begin;
select gmail_message_id from public.vigia_mensagens where gmail_message_id in ('lock-a','lock-b') order by gmail_message_id for update nowait;
select id from public.tarefas where id=(select maior from teste054.concorrencia) for update nowait;
rollback;
SQL
finish_pair

conn ordem_msg_a >"$logs/msg-a.log" 2>&1 <<'SQL' &
begin;
select gmail_message_id from public.vigia_mensagens where gmail_message_id='lock-a' for update;
select pg_sleep(12);
commit;
SQL
pid_a=$!
await_state ordem_msg_a "wait_event='PgSleep'"
conn ordem_msg_b >"$logs/msg-b.log" 2>&1 <<'SQL' &
select lote::text as lote from teste054.concorrencia \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select public.vigia_registrar(:'lote'::jsonb);
SQL
pid_b=$!
await_state ordem_msg_b "wait_event_type='Lock'"
conn observar_msg <<'SQL'
begin;
select gmail_message_id from public.vigia_mensagens where gmail_message_id='lock-b' for update nowait;
rollback;
SQL
finish_pair

# Humano x vigia, e vigia x vigia com ordens opostas: ambas as transações
# terminam e o replay não altera tentativas/eventos. Nenhum deadlock é aceito.
for tipo in humano vigia; do
  conn "${tipo}_a" >"$logs/$tipo-a.log" 2>&1 <<SQL &
select menor::text as tarefa, lote::text as lote from teste054.concorrencia \gset
begin;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000$([[ $tipo == humano ]] && echo a1 || echo d1)',false);
set local role authenticated;
$(if [[ $tipo == humano ]]; then echo "select public.vincular_mensagem('lock-a',:'tarefa'::uuid,true);"; else echo "select public.vigia_registrar(:'lote'::jsonb);"; fi)
select pg_sleep(4);
commit;
SQL
  pid_a=$!
  await_state "${tipo}_a" "wait_event='PgSleep'"
  conn "${tipo}_b" >"$logs/$tipo-b.log" 2>&1 <<'SQL' &
select jsonb_build_object('resultados',(select jsonb_agg(value order by ord desc) from jsonb_array_elements(lote->'resultados') with ordinality e(value,ord)))::text as lote
from teste054.concorrencia \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select public.vigia_registrar(:'lote'::jsonb);
SQL
  pid_b=$!
  await_state "${tipo}_b" "wait_event_type='Lock'"
  finish_pair
done

# Cursor concorrente: B chega com uma janela que termina ANTES da de A. Ele
# espera o lock de A e, ao gravar, não pode fazer o cursor voltar (monotônico).
# (Recusar B por falta de sobreposição seria impossível de provar aqui: como o
# cursor só avança, a exigência "início <= cursor - 1 dia" só afrouxa.)
conn cursor_a >"$logs/cursor-a.log" 2>&1 <<'SQL' &
select jsonb_build_object('janela',jsonb_build_object('inicio',cursor_inicial-interval '1 day',
  'fim',cursor_inicial+interval '1 minute','completa',true))::text as lote from teste054.concorrencia \gset
begin;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set local role authenticated;
select public.vigia_capturar(:'lote'::jsonb);
select pg_sleep(4);
commit;
SQL
pid_a=$!
await_state cursor_a "wait_event='PgSleep'"
conn cursor_b >"$logs/cursor-b.log" 2>&1 <<'SQL' &
select set_config('test054.lote',jsonb_build_object('janela',jsonb_build_object('inicio',cursor_inicial-interval '1 day',
  'fim',cursor_inicial+interval '30 seconds','completa',true))::text,false) from teste054.concorrencia;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select public.vigia_capturar(current_setting('test054.lote')::jsonb);
SQL
pid_b=$!
await_state cursor_b "wait_event_type='Lock'"
finish_pair
conn conferir <<'SQL'
do $$ begin
  if exists(select 1 from public.vigia_mensagens where gmail_message_id in ('lock-a','lock-b') and tentativas<>1)
    or (select count(*) from public.tarefa_eventos where gmail_message_id in ('lock-a','lock-b') and tipo='mensagem')<>4
    or (select ultima_recebida_em from public.vigia_cursor where id=1)<>(select cursor_inicial+interval '1 minute' from teste054.concorrencia) then
    raise exception '054 FALHOU: estado/cursor depois dos cenários concorrentes';
  end if;
end $$;
SQL
# 055 (o Buriti administra as tarefas) sobre o estado final da 054.
run_sql database/055_buriti_administra_tarefas.sql
run_sql tests/sql/test_055_buriti_administra_tarefas.sql
echo '054 e 055: todas as asserções e os cenários concorrentes passaram no Postgres descartável.'

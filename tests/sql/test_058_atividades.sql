-- Autoconferido, roda DEPOIS dos roteiros da 054, 055 e 057 (mesmo banco descartável), com as identidades
-- sintéticas deles: a1 admin "Victor", b1 professor do 51.X, c1 agente (51.X), d1 automação 'vigia' =
-- Buriti operador, e1 professor do 51.Y "Arthur Pietro". Tudo dentro de begin/rollback.
-- Antes da 058 o roteiro falha logo na primeira chamada (criar_tarefa_na_tela não existe); com a
-- save_user_assignments da 033 (stub-058), falha no BLOCO 3 com "Papel inválido: agente".
\set ON_ERROR_STOP on

create or replace function pg_temp.ok(p boolean,p_motivo text) returns void language plpgsql as $$
begin if p is distinct from true then raise exception '058 FALHOU: %',p_motivo; end if; end $$;
create or replace function pg_temp.negado(p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when insufficient_privilege then return;
    when raise_exception then if sqlerrm like 'Acesso negado%' or sqlerrm like 'Só %' or sqlerrm like 'Apenas administradores%' then return; else raise; end if;
  end;
  raise exception '058 FALHOU: operação permitida: %',p_sql;
end $$;
create or replace function pg_temp.invalido(p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when invalid_parameter_value or check_violation or not_null_violation
    or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return;
  end;
  raise exception '058 FALHOU: entrada inválida aceita: %',p_sql;
end $$;

begin;
select set_config('t58.x',(select id::text from public.projects where code='51.X'),false);
select set_config('t58.y',(select id::text from public.projects where code='51.Y'),false);

-- BLOCO 1 — o Victor anota duas atividades: uma dele, sem prazo; outra do Arthur, com prazo.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
select set_config('t58.v',public.criar_tarefa_na_tela(jsonb_build_object('project_id',current_setting('t58.x'),
  'titulo','Remanejamento de rubricas','passos',jsonb_build_array(jsonb_build_object('descricao','Remanejamento de rubricas'))),
  '00000000-0000-0000-0000-0000000000a1')::text,false);
select set_config('t58.a',public.criar_tarefa_na_tela(jsonb_build_object('project_id',current_setting('t58.y'),
  'titulo','Salgados para o evento','prazo','2026-10-31','passos',jsonb_build_array(jsonb_build_object('descricao','Salgados para o evento'))),
  '00000000-0000-0000-0000-0000000000e1')::text,false);
reset role;
select pg_temp.ok((select criada_na_tela and not criada_pelo_buriti and proposta_id is null and responsavel='Victor'
  and responsavel_id='00000000-0000-0000-0000-0000000000a1' and prazo is null and status='em_andamento'
  and criada_por='00000000-0000-0000-0000-0000000000a1' from public.tarefas where id=current_setting('t58.v')::uuid),
  'atividade do Victor gravada como anotada na tela');
select pg_temp.ok((select prazo='2026-10-31' and responsavel='Arthur Pietro' from public.tarefas where id=current_setting('t58.a')::uuid),
  'atividade do Arthur com prazo e nome do sistema');
select pg_temp.ok((select count(*)=1 and min(executor)='pessoa' and min(quem)='Arthur Pietro' and min(estado)='pendente'
  from public.tarefa_passos where tarefa_id=current_setting('t58.a')::uuid),'um passo de pessoa, pendente, com o responsável');
select pg_temp.ok((select r.evidencia='{}'::jsonb from public.tarefa_passos_regras r join public.tarefa_passos s on s.id=r.passo_id
  where s.tarefa_id=current_setting('t58.a')::uuid),'passo sem regra de evidência');
select pg_temp.ok((select count(*)=1 from public.tarefa_chaves where tarefa_id=current_setting('t58.a')::uuid
  and tipo='centro_custo' and valor='51.Y'),'chave do centro para o vigia');
select pg_temp.ok((select count(*)=2 from public.tarefa_eventos where tarefa_id=current_setting('t58.a')::uuid
  and origem='humano' and tipo in ('criada','status')),'eventos de criação e responsável');

-- O Arthur vê e atualiza a dele; o professor do 51.X vê a do Victor pelo escopo; o agente vê a do 51.X.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',false);
set role authenticated;
select pg_temp.ok((select count(*)=1 from public.tarefas where id=current_setting('t58.a')::uuid),'Arthur lê a atividade dele');
select public.registrar_atualizacao(current_setting('t58.a')::uuid,'feito','Pedido feito com o Prof. Manuel.');
reset role;
select pg_temp.ok((select estado='sugerido' from public.tarefa_passos where tarefa_id=current_setting('t58.a')::uuid),
  'feito pelo Arthur fica para o Victor confirmar');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
set role authenticated;
select pg_temp.ok((select count(*)=1 from public.tarefas where id=current_setting('t58.v')::uuid),'agente lê a atividade do centro dele');
reset role;

-- O Victor conclui a dele: confirma o passo e conclui (o mesmo caminho do botão Concluir da tela).
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
select public.confirmar_passo((select id from public.tarefa_passos where tarefa_id=current_setting('t58.v')::uuid),null);
select public.concluir_tarefa(current_setting('t58.v')::uuid,null);
reset role;
select pg_temp.ok((select status='concluida' from public.tarefas where id=current_setting('t58.v')::uuid),'Victor conclui a própria');

-- BLOCO 2 — só admin humano anota, e a entrada é validada.
do $$ declare u text;
begin
  foreach u in array array['00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c1',
    '00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000e1'] loop
    perform set_config('request.jwt.claim.sub',u,true);
    set local role authenticated;
    perform pg_temp.negado(format('select public.criar_tarefa_na_tela(%L::jsonb)',jsonb_build_object('project_id',current_setting('t58.x'),
      'titulo','x','passos',jsonb_build_array(jsonb_build_object('descricao','x')))));
    reset role;
  end loop;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
select pg_temp.invalido(format('select public.criar_tarefa_na_tela(%L::jsonb)',jsonb_build_object('project_id',current_setting('t58.x'),
  'titulo','Ligar para fulano@funape.org.br','passos',jsonb_build_array(jsonb_build_object('descricao','x')))));
select pg_temp.invalido(format('select public.criar_tarefa_na_tela(%L::jsonb)',jsonb_build_object('project_id',current_setting('t58.x'),
  'titulo','  ','passos',jsonb_build_array(jsonb_build_object('descricao','x')))));
select pg_temp.invalido(format('select public.criar_tarefa_na_tela(%L::jsonb)',jsonb_build_object(
  'titulo','Sem centro','passos',jsonb_build_array(jsonb_build_object('descricao','x')))));
select pg_temp.invalido(format('select public.criar_tarefa_na_tela(%L::jsonb)',jsonb_build_object('project_id',gen_random_uuid(),
  'titulo','Centro inexistente','passos',jsonb_build_array(jsonb_build_object('descricao','x')))));
select pg_temp.invalido(format('select public.criar_tarefa_na_tela(%L::jsonb)',jsonb_build_object('project_id',current_setting('t58.x'),
  'titulo','Passo do Buriti','passos',jsonb_build_array(jsonb_build_object('descricao','x','executor','buriti')))));
select pg_temp.invalido(format('select public.criar_tarefa_na_tela(%L::jsonb)',jsonb_build_object('project_id',current_setting('t58.x'),
  'titulo','Com regra','passos',jsonb_build_array(jsonb_build_object('descricao','x','evidencia',jsonb_build_object('tipo','email'))))));
select pg_temp.invalido(format('select public.criar_tarefa_na_tela(%L::jsonb)',jsonb_build_object('project_id',current_setting('t58.x'),
  'titulo','Prazo torto','prazo','31/10','passos',jsonb_build_array(jsonb_build_object('descricao','x')))));
-- Responsável tem de ser pessoa (admin/professor): o agente e o operador não.
select pg_temp.invalido(format('select public.criar_tarefa_na_tela(%L::jsonb,%L)',jsonb_build_object('project_id',current_setting('t58.x'),
  'titulo','Para o agente','passos',jsonb_build_array(jsonb_build_object('descricao','x'))),'00000000-0000-0000-0000-0000000000c1'));
reset role;
select pg_temp.ok((select count(*)=2 from public.tarefas where criada_na_tela),'nada além das duas atividades válidas');

-- A regra de origem continua barrando tarefa sem proposta, sem Buriti e sem tela.
select pg_temp.invalido(format('insert into public.tarefas(project_id,titulo) values(%L,%L)',current_setting('t58.x'),'Órfã'));

-- BLOCO 3 — Usuários & Centros de Custo: atribuir centros ao Buriti (agente) funciona; tirar o papel, não.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
select public.save_user_assignments('00000000-0000-0000-0000-0000000000c1','agente',
  array[current_setting('t58.x')::uuid,current_setting('t58.y')::uuid]);
select pg_temp.negado(format('select public.save_user_assignments(%L,%L,null)','00000000-0000-0000-0000-0000000000c1','professor'));
select pg_temp.negado(format('select public.save_user_assignments(%L,%L,null)','00000000-0000-0000-0000-0000000000c1','admin'));
reset role;
select pg_temp.ok((select count(*)=2 from public.user_projects where user_id='00000000-0000-0000-0000-0000000000c1'),
  'agente com os dois centros');
select pg_temp.ok((select role='agente' from public.app_users where user_id='00000000-0000-0000-0000-0000000000c1'),'agente segue agente');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
set role authenticated;
select pg_temp.negado(format('select public.save_user_assignments(%L,%L,null)','00000000-0000-0000-0000-0000000000c1','agente'));
reset role;

rollback;
select set_config('request.jwt.claim.sub','',false);

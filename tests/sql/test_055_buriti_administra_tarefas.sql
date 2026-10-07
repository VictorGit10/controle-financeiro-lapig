-- Autoconferido, roda DEPOIS do test_054 (mesmo banco descartável): usa as identidades sintéticas dele
-- (a1 admin "Victor", b1 professor do 51.X, c1 agente, d1 automação 'vigia' = Buriti operador,
-- e1 professor do 51.Y "Arthur Pietro"). Tudo dentro de begin/rollback.
\set ON_ERROR_STOP on

create or replace function pg_temp.ok(p boolean,p_motivo text) returns void language plpgsql as $$
begin if p is distinct from true then raise exception '055 FALHOU: %',p_motivo; end if; end $$;
create or replace function pg_temp.negado(p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when insufficient_privilege then return;
    when raise_exception then if sqlerrm like 'Acesso negado%' or sqlerrm like 'Só %' then return; else raise; end if;
  end;
  raise exception '055 FALHOU: operação permitida: %',p_sql;
end $$;
create or replace function pg_temp.invalido(p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when invalid_parameter_value or check_violation or not_null_violation
    or invalid_text_representation then return;
  end;
  raise exception '055 FALHOU: entrada inválida aceita: %',p_sql;
end $$;

begin;
select set_config('t55.x',(select id::text from public.projects where code='51.X'),false);
select set_config('t55.tarefa','',false);
-- O test_054 termina com o vigia desativado; o admin reativa.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
select public.set_automacao('00000000-0000-0000-0000-0000000000d1','vigia',true);
reset role;

-- O operador cria a tarefa já com o responsável (fora do escopo dele) e passos do Buriti e da pessoa.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select pg_temp.ok(public.is_automacao('vigia'),'d1 é o Buriti operador');
select pg_temp.invalido(format('select public.buriti_criar_tarefa(%L::jsonb,%L)',jsonb_build_object(
  'project_id',current_setting('t55.x'),'titulo','Responsável inexistente',
  'passos',jsonb_build_array(jsonb_build_object('descricao','x'))),'Fulano'));
select pg_temp.invalido(format('select public.buriti_criar_tarefa(%L::jsonb)',jsonb_build_object(
  'project_id',current_setting('t55.x'),'titulo','Executor inválido',
  'passos',jsonb_build_array(jsonb_build_object('descricao','x','executor','robo')))));
select pg_temp.invalido(format('select public.buriti_criar_tarefa(%L::jsonb)',jsonb_build_object(
  'project_id',gen_random_uuid(),'titulo','Projeto inexistente','passos',jsonb_build_array(jsonb_build_object('descricao','x')))));
select set_config('t55.tarefa',public.buriti_criar_tarefa(jsonb_build_object(
  'project_id',current_setting('t55.x'),'titulo','Implantar 2 meses de bolsa','prazo','2026-10-30',
  'passos',jsonb_build_array(
    jsonb_build_object('descricao','Levantar os dados','executor','buriti'),
    jsonb_build_object('descricao','Atualizar o quadro','quem','Arthur'),
    jsonb_build_object('descricao','Enviar à FUNAPE','quem','Arthur','evidencia',jsonb_build_object('de','pessoa@exemplo.invalid')),
    jsonb_build_object('descricao','Passo que o Victor dispensa','quem','Arthur')),
  'chaves',jsonb_build_array(jsonb_build_object('tipo','centro_custo','valor','51.X'))),'arthur')::text,false);
reset role;
select pg_temp.ok((select criada_pelo_buriti and proposta_id is null and responsavel='Arthur Pietro'
  and responsavel_id='00000000-0000-0000-0000-0000000000e1' from public.tarefas where id=current_setting('t55.tarefa')::uuid),
  'criada pelo Buriti, sem proposta, responsável resolvido pelo prefixo do nome');
select pg_temp.ok((select array_agg(executor order by ordem)=array['buriti','pessoa','pessoa','pessoa']
  and (array_agg(quem order by ordem))[1]='Buriti' from public.tarefa_passos where tarefa_id=current_setting('t55.tarefa')::uuid),
  'executor e rótulo dos passos');
select pg_temp.ok((select count(*)=2 from public.tarefa_eventos where tarefa_id=current_setting('t55.tarefa')::uuid and origem='buriti'),
  'eventos de criação e responsável com origem buriti');
select pg_temp.ok((select count(*)=1 from public.tarefa_passos_regras r join public.tarefa_passos s on s.id=r.passo_id
  where s.tarefa_id=current_setting('t55.tarefa')::uuid and r.evidencia ? 'de'),'regra de evidência guardada no lugar restrito');
select set_config('t55.p1',(select id::text from public.tarefa_passos where tarefa_id=current_setting('t55.tarefa')::uuid and ordem=1),false);
select set_config('t55.p2',(select id::text from public.tarefa_passos where tarefa_id=current_setting('t55.tarefa')::uuid and ordem=2),false);
select set_config('t55.p3',(select id::text from public.tarefa_passos where tarefa_id=current_setting('t55.tarefa')::uuid and ordem=3),false);
select set_config('t55.p4',(select id::text from public.tarefa_passos where tarefa_id=current_setting('t55.tarefa')::uuid and ordem=4),false);

-- O Arthur vê a tarefa, registra "feito" só no passo de pessoa, não no do Buriti.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',false);
set role authenticated;
select pg_temp.ok((select count(*)=1 from public.tarefas where id=current_setting('t55.tarefa')::uuid),'responsável lê a tarefa criada pelo Buriti');
select pg_temp.invalido(format('select public.registrar_feito(%L,%L)',current_setting('t55.p1'),'Fiz o do Buriti'));
select public.registrar_feito(current_setting('t55.p2')::uuid,'Quadro atualizado.');
select public.registrar_feito(current_setting('t55.p4')::uuid,'Também registrei este.');
-- Pessoas não usam as RPCs do operador.
select pg_temp.negado(format('select public.buriti_confirmar_passo(%L,%L)',current_setting('t55.p2'),'eu mesmo'));
select pg_temp.negado(format('select public.buriti_concluir_tarefa(%L,%L)',current_setting('t55.tarefa'),'fim'));
reset role;

-- Agente (login de leitura) e professor do centro não operam como o Buriti.
do $$ declare u text; c text;
begin
  foreach u in array array['00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1'] loop
    perform set_config('request.jwt.claim.sub',u,true);
    set local role authenticated;
    foreach c in array array[
      format('select public.buriti_criar_tarefa(%L::jsonb)',jsonb_build_object('project_id',current_setting('t55.x'),'titulo','x','passos',jsonb_build_array(jsonb_build_object('descricao','x')))),
      format('select public.buriti_concluir_passo(%L,%L)',current_setting('t55.p1'),'x'),
      format('select public.buriti_confirmar_passo(%L,%L)',current_setting('t55.p3'),'x'),
      format('select public.buriti_anotar(%L,%L)',current_setting('t55.tarefa'),'x'),
      format('select public.buriti_pedir_atencao(%L,%L)',current_setting('t55.tarefa'),'x'),
      format('select public.buriti_concluir_tarefa(%L,%L)',current_setting('t55.tarefa'),'x')] loop
      perform pg_temp.negado(c);
    end loop;
    reset role;
  end loop;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select pg_temp.negado('select public._buriti_responsavel(''Arthur'')');
reset role;

-- O operador conclui o próprio passo, confirma o do Arthur com prova, cobra e pede atenção.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select pg_temp.invalido(format('select public.buriti_confirmar_passo(%L,%L)',current_setting('t55.p1'),'prova'));
select pg_temp.invalido(format('select public.buriti_concluir_passo(%L,%L)',current_setting('t55.p2'),'feito'));
select pg_temp.invalido(format('select public.buriti_concluir_passo(%L,%L)',current_setting('t55.p1'),' '));
select pg_temp.invalido(format('select public.buriti_confirmar_passo(%L,%L)',current_setting('t55.p3'),'Veio de pessoa@exemplo.invalid'));
select pg_temp.invalido(format('select public.buriti_anotar(%L,%L)',current_setting('t55.tarefa'),'CPF 529.982.247-25'));
select public.buriti_concluir_passo(current_setting('t55.p1')::uuid,'Dados conferidos no sistema.');
select public.buriti_confirmar_passo(current_setting('t55.p2')::uuid,'Quadro novo salvo na pasta do projeto.');
reset role;
select pg_temp.ok((select precisa_atencao and motivo_atencao like '%registrou um passo; confirmar' from public.tarefas
  where id=current_setting('t55.tarefa')::uuid),'aviso fica enquanto outro passo registrado espera confirmação');
set role authenticated;
select pg_temp.invalido(format('select public.buriti_concluir_tarefa(%L,%L)',current_setting('t55.tarefa'),'cedo demais'));
select public.buriti_anotar(current_setting('t55.tarefa')::uuid,'Arthur, falta enviar à FUNAPE.',true);
select public.buriti_pedir_atencao(current_setting('t55.tarefa')::uuid,'A FUNAPE pediu justificativa assinada.');
reset role;
select pg_temp.ok((select estado='confirmado' and confirmado_por='00000000-0000-0000-0000-0000000000d1'
  from public.tarefa_passos where id=current_setting('t55.p1')::uuid),'passo do Buriti feito pelo Buriti');
select pg_temp.ok((select estado='confirmado' from public.tarefa_passos where id=current_setting('t55.p2')::uuid),'passo do Arthur confirmado com prova');
select pg_temp.ok(exists(select 1 from public.tarefa_eventos where tarefa_id=current_setting('t55.tarefa')::uuid
  and tipo='alerta_prazo' and origem='buriti' and resumo like 'Cobrança:%'),'cobrança na linha do tempo');
select pg_temp.ok((select precisa_atencao and motivo_atencao like 'A FUNAPE pediu%' from public.tarefas where id=current_setting('t55.tarefa')::uuid),
  'pedido de atenção ao Victor');

-- Dispensar continua só do admin; depois o operador conclui.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
select public.dispensar_passo(current_setting('t55.p4')::uuid,'Não se aplica.');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select public.buriti_confirmar_passo(current_setting('t55.p3')::uuid,'E-mail do Arthur à FUNAPE com o 51.X em 08/10.');
select public.buriti_concluir_tarefa(current_setting('t55.tarefa')::uuid,'Bolsa solicitada.');
select pg_temp.invalido(format('select public.buriti_anotar(%L,%L)',current_setting('t55.tarefa'),'depois do fim'));
reset role;
select pg_temp.ok((select status='concluida' and concluida_por='00000000-0000-0000-0000-0000000000d1' and not precisa_atencao
  from public.tarefas where id=current_setting('t55.tarefa')::uuid),'concluída pelo Buriti');

-- Desativado, o operador não opera mais.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
select public.set_automacao('00000000-0000-0000-0000-0000000000d1','vigia',false);
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select pg_temp.negado(format('select public.buriti_criar_tarefa(%L::jsonb)',jsonb_build_object(
  'project_id',current_setting('t55.x'),'titulo','Depois de desligado','passos',jsonb_build_array(jsonb_build_object('descricao','x')))));
reset role;

-- A tarefa antiga (com proposta) segue válida; sem proposta e sem origem Buriti é recusada.
select pg_temp.invalido(format('insert into public.tarefas(project_id,titulo) values(%L,%L)',current_setting('t55.x'),'sem origem'));
select set_config('request.jwt.claim.sub','',false);
rollback;
do $$ begin raise notice '055 OK'; end $$;

-- Autoconferido, roda DEPOIS dos roteiros da 054 e da 055 (mesmo banco descartável), com as identidades
-- sintéticas deles: a1 admin "Victor", b1 professor do 51.X, c1 agente (51.X), d1 automação 'vigia' =
-- Buriti operador, e1 professor do 51.Y "Arthur Pietro". Tudo dentro de begin/rollback.
-- Antes da 057 o roteiro falha logo na primeira chamada (registrar_atualizacao não existe).
\set ON_ERROR_STOP on

create or replace function pg_temp.ok(p boolean,p_motivo text) returns void language plpgsql as $$
begin if p is distinct from true then raise exception '057 FALHOU: %',p_motivo; end if; end $$;
create or replace function pg_temp.negado(p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when insufficient_privilege then return;
    when raise_exception then if sqlerrm like 'Acesso negado%' or sqlerrm like 'Só %' then return; else raise; end if;
  end;
  raise exception '057 FALHOU: operação permitida: %',p_sql;
end $$;
create or replace function pg_temp.invalido(p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when invalid_parameter_value or check_violation or not_null_violation
    or invalid_text_representation or invalid_datetime_format then return;
  end;
  raise exception '057 FALHOU: entrada inválida aceita: %',p_sql;
end $$;
create or replace function pg_temp.passo(p_tarefa text,p_ordem integer) returns text language sql as $$
  select id::text from public.tarefa_passos where tarefa_id=p_tarefa::uuid and ordem=p_ordem $$;

begin;
select set_config('t57.x',(select id::text from public.projects where code='51.X'),false);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
select public.set_automacao('00000000-0000-0000-0000-0000000000d1','vigia',true);
reset role;

-- Tarefa do Buriti (T) para o Arthur: passo do Buriti e dois de pessoa.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select set_config('t57.t',public.buriti_criar_tarefa(jsonb_build_object(
  'project_id',current_setting('t57.x'),'titulo','Prorrogação: retorno da ligação','prazo','2026-10-10',
  'passos',jsonb_build_array(
    jsonb_build_object('descricao','Procurar o ofício no e-mail','executor','buriti'),
    jsonb_build_object('descricao','Ligar para a FUNAPE','quem','Arthur'),
    jsonb_build_object('descricao','Registrar o retorno','quem','Arthur'))),'arthur')::text,false);
reset role;
select set_config('t57.p1',pg_temp.passo(current_setting('t57.t'),1),false);
select set_config('t57.p2',pg_temp.passo(current_setting('t57.t'),2),false);
select set_config('t57.p3',pg_temp.passo(current_setting('t57.t'),3),false);

-- Tarefa do Victor (V), vinda de proposta aplicada: o Buriti não a edita.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
set role authenticated;
select set_config('t57.prop',public.propor_tarefa(jsonb_build_object('project_id',current_setting('t57.x'),
  'titulo','Tarefa do Victor','passos',jsonb_build_array(jsonb_build_object('descricao','Assinar'))))::text,false);
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
select set_config('t57.v',public.aplicar_proposta_tarefa(current_setting('t57.prop')::uuid,
  '00000000-0000-0000-0000-0000000000e1')::text,false);
reset role;
select set_config('t57.vp1',pg_temp.passo(current_setting('t57.v'),1),false);
select set_config('t57.t2',pg_temp.passo(current_setting('t57.t'),2),false);

-- BLOCO 1 — o Arthur atualiza: entradas inválidas recusadas.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',false);
set role authenticated;
select pg_temp.invalido(format('select public.registrar_atualizacao(%L,%L,%L)',current_setting('t57.t'),'quase','Liguei.'));
select pg_temp.invalido(format('select public.registrar_atualizacao(%L,%L,%L)',current_setting('t57.t'),'em_andamento','  '));
select pg_temp.invalido(format('select public.registrar_atualizacao(%L,%L,%L)',current_setting('t57.t'),'em_andamento','Falei com fulano@funape.org.br'));
select pg_temp.invalido(format('select public.registrar_atualizacao(%L,%L,%L)',current_setting('t57.t'),'em_andamento','CPF 529.982.247-25'));
select pg_temp.invalido(format('select public.registrar_atualizacao(%L,%L,%L,%L)',current_setting('t57.t'),'em_andamento','Liguei.','http://inseguro.example'));
select pg_temp.invalido(format('select public.registrar_atualizacao(%L,%L,%L,null,%L::uuid[])',current_setting('t57.t'),'em_andamento','Liguei.',
  '{'||current_setting('t57.p1')||'}'));
select pg_temp.invalido(format('select public.registrar_atualizacao(%L,%L,%L,null,%L::uuid[])',current_setting('t57.t'),'em_andamento','Liguei.',
  '{'||current_setting('t57.vp1')||'}'));

-- Em andamento, marcando o passo da ligação: o passo fica sugerido e o Victor/Buriti confirma.
select set_config('t57.e1',public.registrar_atualizacao(current_setting('t57.t')::uuid,'em_andamento',
  'Liguei; a Ranielly vai procurar o ofício e retorna amanhã.','https://drive.google.com/x',
  array[current_setting('t57.p2')::uuid])::text,false);
reset role;
select pg_temp.ok((select situacao='em_andamento' and status='em_andamento' and ultima_atualizacao_id::text=current_setting('t57.e1')
  and not precisa_atencao and aviso_responsavel='Arthur atualizou; confirmar' from public.tarefas where id=current_setting('t57.t')::uuid),
  'situação, última atualização e pedido de confirmação');
select pg_temp.ok((select estado='sugerido' and ultimo_feito_id::text=current_setting('t57.e1') from public.tarefa_passos
  where id=current_setting('t57.p2')::uuid),'passo marcado fica sugerido');
select pg_temp.ok((select estado='pendente' from public.tarefa_passos where id=current_setting('t57.p3')::uuid),'passo não marcado fica pendente');
select pg_temp.ok((select tipo='atualizacao' and origem='humano' and detalhe->>'situacao'='em_andamento'
  and detalhe->>'por'='Arthur Pietro' and detalhe->>'link'='https://drive.google.com/x'
  and resumo like 'Arthur Pietro · Em andamento: Liguei;%' from public.tarefa_eventos where id=current_setting('t57.e1')::uuid),
  'evento de atualização com situação, autor e link');

-- Esperando alguém → aguardando terceiro. Travado → precisa de você. Sair do travado volta ao "confirmar".
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',false);
set role authenticated;
select public.registrar_atualizacao(current_setting('t57.t')::uuid,'esperando','Aguardando o retorno da Ranielly.');
reset role;
select pg_temp.ok((select status='aguardando_terceiro' and situacao='esperando' and aviso_responsavel='Arthur atualizou; confirmar'
  from public.tarefas where id=current_setting('t57.t')::uuid),'esperando: aguardando terceiro, pedido anterior mantido');
set role authenticated;
select public.registrar_atualizacao(current_setting('t57.t')::uuid,'travado','A FUNAPE diz que o ofício não chegou.');
reset role;
select pg_temp.ok((select status='em_andamento' and aviso_responsavel='Arthur: travado'
  from public.tarefas where id=current_setting('t57.t')::uuid),'travado pede o Victor');
set role authenticated;
select public.registrar_atualizacao(current_setting('t57.t')::uuid,'em_andamento','A FAPEG reenviou; destravou.');
reset role;
select pg_temp.ok((select aviso_responsavel='Arthur atualizou; confirmar'
  from public.tarefas where id=current_setting('t57.t')::uuid),'saiu do travado; passo marcado ainda pede confirmação');

-- Quem não é o responsável não atualiza (professor do centro, agente, operador). Admin pode.
do $$ declare u text;
begin
  foreach u in array array['00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000d1'] loop
    perform set_config('request.jwt.claim.sub',u,true);
    set local role authenticated;
    perform pg_temp.negado(format('select public.registrar_atualizacao(%L,%L,%L)',current_setting('t57.t'),'feito','Não sou eu.'));
    reset role;
  end loop;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
select public.registrar_atualizacao(current_setting('t57.v')::uuid,'em_andamento','Victor atualizou a própria.');
reset role;

-- O agente (MCP de leitura) vê a situação e a atualização da tarefa do centro dele.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
set role authenticated;
select pg_temp.ok((select situacao='em_andamento' from public.tarefas where id=current_setting('t57.t')::uuid),'agente lê a situação');
select pg_temp.ok((select count(*)>=4 from public.tarefa_eventos where tarefa_id=current_setting('t57.t')::uuid and tipo='atualizacao'),
  'agente lê as atualizações');
reset role;

-- BLOCO 2 — o Buriti corrige a tarefa que criou; a do Victor, não.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select pg_temp.negado(format('select public.buriti_editar_tarefa(%L,%L::jsonb,%L)',current_setting('t57.v'),'{"titulo":"x"}','pedido'));
select pg_temp.negado(format('select public.buriti_editar_passos(%L,%L::jsonb,%L)',current_setting('t57.v'),'[{"descricao":"x"}]','pedido'));
select pg_temp.negado(format('select public.buriti_cancelar_tarefa(%L,%L)',current_setting('t57.v'),'pedido'));
select pg_temp.negado(format('select public.buriti_dispensar_passo(%L,%L)',current_setting('t57.vp1'),'pedido'));
select pg_temp.invalido(format('select public.buriti_editar_tarefa(%L,%L::jsonb,%L)',current_setting('t57.t'),'{"status":"concluida"}','pedido'));
select pg_temp.invalido(format('select public.buriti_editar_tarefa(%L,%L::jsonb,%L)',current_setting('t57.t'),'{}','pedido'));
select pg_temp.invalido(format('select public.buriti_editar_tarefa(%L,%L::jsonb,%L)',current_setting('t57.t'),'{"titulo":"CPF 529.982.247-25"}','pedido'));
select pg_temp.invalido(format('select public.buriti_editar_tarefa(%L,%L::jsonb,%L)',current_setting('t57.t'),'{"titulo":"Prorrogação: retorno da ligação"}','pedido'));
select pg_temp.invalido(format('select public.buriti_editar_tarefa(%L,%L::jsonb,%L)',current_setting('t57.t'),'{"titulo":"x"}',' '));
select pg_temp.invalido(format('select public.buriti_editar_tarefa(%L,%L::jsonb,%L)',current_setting('t57.t'),'{"responsavel":"Fulano"}','pedido'));
select public.buriti_editar_tarefa(current_setting('t57.t')::uuid,
  '{"titulo":"30.068 – Retorno da ligação à FUNAPE","descricao":null,"prazo":null,"prazo_motivo":null}'::jsonb,
  'O Victor pediu só o retorno da ligação.');
reset role;
select pg_temp.ok((select titulo='30.068 – Retorno da ligação à FUNAPE' and descricao is null and prazo is null
  and responsavel='Arthur Pietro' from public.tarefas where id=current_setting('t57.t')::uuid),'título, texto e prazo editados; responsável mantido');
select pg_temp.ok((select detalhe->'antes'->>'titulo'='Prorrogação: retorno da ligação' and detalhe->'depois'->>'prazo' is null
  and detalhe->'antes'->>'prazo'='2026-10-10' and origem='buriti' and resumo like 'Editada pelo Buriti a pedido do Victor:%'
  from public.tarefa_eventos where tarefa_id=current_setting('t57.t')::uuid and tipo='edicao'),'edição com antes e depois');

-- Passos: só os que ninguém começou são trocados (p1 do Buriti e p3); p2, já marcado, fica.
set role authenticated;
select pg_temp.invalido(format('select public.buriti_editar_passos(%L,%L::jsonb,%L)',current_setting('t57.t'),'[{"descricao":"CPF 529.982.247-25"}]','pedido'));
select pg_temp.invalido(format('select public.buriti_editar_passos(%L,%L::jsonb,%L)',current_setting('t57.t'),'[{"descricao":"x","executor":"robo"}]','pedido'));
select public.buriti_editar_passos(current_setting('t57.t')::uuid,
  '[{"descricao":"Contar o que a FUNAPE disse na ligação","quem":"Arthur"}]'::jsonb,'Passo único, como o Victor pediu.');
reset role;
select pg_temp.ok((select array_agg(ordem order by ordem)=array[2,3] and bool_or(id::text=current_setting('t57.p2'))
  from public.tarefa_passos where tarefa_id=current_setting('t57.t')::uuid),'p2 mantido, p1/p3 trocados pelo novo passo 3');
select pg_temp.ok((select count(*)=1 from public.tarefa_passos_regras r join public.tarefa_passos s on s.id=r.passo_id
  where s.tarefa_id=current_setting('t57.t')::uuid and s.ordem=3),'regra do passo novo gravada');
select pg_temp.ok((select jsonb_array_length(detalhe->'antes')=2 and detalhe->'depois'->0->>'ordem'='3'
  from public.tarefa_eventos where tarefa_id=current_setting('t57.t')::uuid and tipo='edicao' and resumo like 'Passos refeitos%'),
  'evento lista passos removidos e novos');

-- "Feito" marca todos os passos de pessoa abertos; o Buriti confirma com prova e o aviso some.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',false);
set role authenticated;
select public.registrar_atualizacao(current_setting('t57.t')::uuid,'feito','A Ranielly confirmou que o ofício chegou em 07/10.');
reset role;
select pg_temp.ok((select bool_and(estado='sugerido') from public.tarefa_passos where tarefa_id=current_setting('t57.t')::uuid),
  'feito marca todos os passos de pessoa abertos');
select set_config('t57.t3',pg_temp.passo(current_setting('t57.t'),3),false);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select public.buriti_dispensar_passo(current_setting('t57.t2')::uuid,'A ligação já está no retorno.');
select public.buriti_confirmar_passo(current_setting('t57.t3')::uuid,'Retorno do Arthur registrado em 08/10.');
reset role;
select pg_temp.ok((select not precisa_atencao and aviso_responsavel is null from public.tarefas where id=current_setting('t57.t')::uuid),
  'confirmado o último passo, o pedido de confirmação sai');

-- Pessoas e o agente não usam as RPCs de correção do Buriti.
do $$ declare u text; c text;
begin
  foreach u in array array['00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1',
    '00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000e1'] loop
    perform set_config('request.jwt.claim.sub',u,true);
    set local role authenticated;
    foreach c in array array[
      format('select public.buriti_editar_tarefa(%L,%L::jsonb,%L)',current_setting('t57.t'),'{"titulo":"y"}','x'),
      format('select public.buriti_editar_passos(%L,%L::jsonb,%L)',current_setting('t57.t'),'[{"descricao":"y"}]','x'),
      format('select public.buriti_cancelar_tarefa(%L,%L)',current_setting('t57.t'),'x')] loop
      perform pg_temp.negado(c);
    end loop;
    reset role;
  end loop;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select pg_temp.negado('select public._buriti_tarefa_propria(gen_random_uuid())');
select public.buriti_cancelar_tarefa(current_setting('t57.t')::uuid,'O Victor pediu para recomeçar.');
select pg_temp.invalido(format('select public.buriti_editar_tarefa(%L,%L::jsonb,%L)',current_setting('t57.t'),'{"titulo":"z"}','depois do fim'));
reset role;
select pg_temp.ok((select status='cancelada' and not precisa_atencao and aviso_responsavel is null from public.tarefas where id=current_setting('t57.t')::uuid),'cancelada pelo Buriti');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',false);
set role authenticated;
select pg_temp.invalido(format('select public.registrar_atualizacao(%L,%L,%L)',current_setting('t57.t'),'em_andamento','depois do fim'));
reset role;

-- BLOCO 2b — achados da revisão do GPT-6.1 Sol (08/10): pedido do Buriti não some; dispensar limpa o
-- "confirmar"; passo inexistente é recusado.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select set_config('t57.r',public.buriti_criar_tarefa(jsonb_build_object('project_id',current_setting('t57.x'),
  'titulo','Revisão: pedido pendente','passos',jsonb_build_array(jsonb_build_object('descricao','Ligar','quem','Arthur'))),'arthur')::text,false);
select public.buriti_pedir_atencao(current_setting('t57.r')::uuid,'Autorizar prorrogação pendente.');
reset role;
select set_config('t57.rp',pg_temp.passo(current_setting('t57.r'),1),false);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',false);
set role authenticated;
select public.registrar_atualizacao(current_setting('t57.r')::uuid,'feito','Liguei.');
reset role;
select pg_temp.ok((select precisa_atencao and motivo_atencao='Autorizar prorrogação pendente.' and aviso_responsavel='Arthur atualizou; confirmar'
  from public.tarefas where id=current_setting('t57.r')::uuid),'atualização não sobrescreve o pedido do Buriti');
set role authenticated;
select public.registrar_atualizacao(current_setting('t57.r')::uuid,'travado','Ninguém atende.');
reset role;
select pg_temp.ok((select motivo_atencao='Autorizar prorrogação pendente.' from public.tarefas
  where id=current_setting('t57.r')::uuid),'travado também não sobrescreve o pedido do Buriti');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select public.buriti_confirmar_passo(current_setting('t57.rp')::uuid,'Ligação registrada pelo Arthur.');
reset role;
select pg_temp.ok((select precisa_atencao and motivo_atencao='Autorizar prorrogação pendente.' and aviso_responsavel='Arthur: travado'
  from public.tarefas where id=current_setting('t57.r')::uuid),'confirmar o passo não apaga o pedido pendente nem o travado');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select public.buriti_pedir_atencao(current_setting('t57.r')::uuid,'Autorizar prorrogação pendente; confirmar');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',false);
set role authenticated;
select public.registrar_atualizacao(current_setting('t57.r')::uuid,'em_andamento','Ainda sem retorno.');
reset role;
select pg_temp.ok((select precisa_atencao and motivo_atencao='Autorizar prorrogação pendente; confirmar' from public.tarefas
  where id=current_setting('t57.r')::uuid),'pedido manual com o mesmo final do automático continua');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
-- Dispensar o último passo marcado limpa o "confirmar" (Buriti e admin).
set role authenticated;
select set_config('t57.s',public.buriti_criar_tarefa(jsonb_build_object('project_id',current_setting('t57.x'),
  'titulo','Revisão: dispensar','passos',jsonb_build_array(jsonb_build_object('descricao','A','quem','Arthur'),
    jsonb_build_object('descricao','B','quem','Arthur'))),'arthur')::text,false);
reset role;
select set_config('t57.s1',pg_temp.passo(current_setting('t57.s'),1),false);
select set_config('t57.s2',pg_temp.passo(current_setting('t57.s'),2),false);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',false);
set role authenticated;
select public.registrar_atualizacao(current_setting('t57.s')::uuid,'feito','Os dois.');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select public.buriti_dispensar_passo(current_setting('t57.s1')::uuid,'Não precisa.');
reset role;
select pg_temp.ok((select aviso_responsavel='Arthur atualizou; confirmar' from public.tarefas
  where id=current_setting('t57.s')::uuid),'resta um passo marcado: o confirmar fica');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
select public.dispensar_passo(current_setting('t57.s2')::uuid,'Também não.');
reset role;
select pg_temp.ok((select aviso_responsavel is null from public.tarefas
  where id=current_setting('t57.s')::uuid),'dispensado o último pelo admin, o confirmar sai');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select pg_temp.invalido(format('select public.buriti_dispensar_passo(%L,%L)',gen_random_uuid(),'x'));
select pg_temp.invalido(format('select public.buriti_confirmar_passo(%L,%L)',gen_random_uuid(),'x'));
reset role;

-- BLOCO 3 — avisos: só resumo diário, prazo de hoje/vencido e uma falha do vigia a cada 12 h.
-- Falhas anteriores (de outro roteiro ou da fila antiga) ficam fora da janela de 12 h deste bloco.
update public.vigia_avisos set criado_em=now()-interval '13 hours' where tipo='saude';
insert into public.vigia_avisos(chave,texto,tipo) values
  ('t57:esclarecer','Há uma mensagem para revisar.','esclarecer'),
  ('t57:sugestao','Há uma tarefa para revisar.','sugestao'),
  ('aviso:prazo:t57:2026-10-10:D-2','Há uma tarefa para revisar.','alerta_prazo'),
  ('aviso:prazo:t57:2026-10-10:D-0','Há uma tarefa para revisar.','alerta_prazo'),
  ('aviso:prazo:t57:2026-10-10:vencido','Há uma tarefa para revisar.','alerta_prazo');
insert into public.vigia_avisos(chave,texto,tipo,dia) values('resumo:t57','Resumo diário disponível.','resumo_diario',current_date);
insert into public.vigia_avisos(chave,texto,tipo) values('saude:t57a','A checagem requer revisão.','saude');
insert into public.vigia_avisos(chave,texto,tipo) values('saude:t57b','A checagem requer revisão.','saude');
select pg_temp.ok((select jsonb_object_agg(chave,estado)=jsonb_build_object('t57:esclarecer','resumido','t57:sugestao','resumido',
  'aviso:prazo:t57:2026-10-10:D-2','resumido','aviso:prazo:t57:2026-10-10:D-0','pendente',
  'aviso:prazo:t57:2026-10-10:vencido','pendente','resumo:t57','pendente','saude:t57a','pendente','saude:t57b','resumido')
  from public.vigia_avisos where chave like '%t57%'),'avisos: essenciais pendentes, o resto resumido');
-- O vigia só recebe para entregar o que ficou pendente.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select pg_temp.ok((select not exists(select 1 from jsonb_array_elements(r->'avisos') a where a->>'chave' in ('t57:esclarecer','t57:sugestao','saude:t57b'))
  and exists(select 1 from jsonb_array_elements(r->'avisos') a where a->>'chave'='resumo:t57')
  from (select public.vigia_registrar('{"versao":"t57"}'::jsonb) r) x),'outbox sem os resumidos');

-- BLOCO 4 — o contexto do vigia traz o conteúdo do resumo diário.
select pg_temp.ok((select c ? 'esclarecer_lista' and c ? 'resumo_tarefas' and c ? 'novidades'
  and exists(select 1 from jsonb_array_elements(c->'novidades') n where n->>'tipo'='atualizacao' and n->>'resumo' like 'Arthur Pietro%')
  and exists(select 1 from jsonb_array_elements(c->'resumo_tarefas') t where t->>'id'=current_setting('t57.v')
    and t->>'situacao'='em_andamento' and t->'ultima_atualizacao'->>'resumo' like '%Victor atualizou%')
  from (select public.vigia_contexto() c) x),'contexto com mensagens, situação e novidades');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',false);
set role authenticated;
select pg_temp.negado('select public.vigia_contexto()');
reset role;

select set_config('request.jwt.claim.sub','',false);
rollback;
do $$ begin raise notice '057 OK'; end $$;

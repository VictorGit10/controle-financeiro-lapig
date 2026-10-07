-- Autoconferido. Somente Postgres descartável (rodar-054.sh).
-- JWT e SET ROLE são separados: RPCs definer E RLS/ACL reais são exercitados.
-- Qualquer expectativa falsa levanta exceção; ON_ERROR_STOP aborta o roteiro.
\set ON_ERROR_STOP on

create function pg_temp.ok(p boolean,p_motivo text) returns void language plpgsql as $$
begin if p is distinct from true then raise exception '054 FALHOU: %',p_motivo; end if; end $$;
create function pg_temp.negado(p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when insufficient_privilege then return;
    when raise_exception then if sqlerrm like 'Acesso negado%' then return; else raise; end if;
  end;
  raise exception '054 FALHOU: operação permitida: %',p_sql;
end $$;

-- Builders do teste: abreviam cenários, mas chamam somente o contrato externo
-- v1. Os helpers privados da migração não são chamados pelo roteiro.
create function pg_temp.capturar(p jsonb) returns jsonb language plpgsql as $$
declare e jsonb; r jsonb; q jsonb; c timestamptz;
begin
  c:=(public.vigia_contexto()->>'cursor_em')::timestamptz;
  e:=p->'execucao';
  if e is null and c is null then e:=jsonb_build_object('id',gen_random_uuid(),'iniciada_em',now(),'versao','teste'); end if;
  if e is not null then
    perform public.vigia_registrar(jsonb_build_object('versao',e->>'versao','execucao',e||jsonb_build_object('tipo','checagem')));
  end if;
  q:=jsonb_build_object('janela',jsonb_build_object('inicio',coalesce(c,(e->>'iniciada_em')::timestamptz)-interval '1 day',
    'fim',coalesce((p->>'cursor')::timestamptz,now()),'primeira_carga',c is null,'completa',coalesce((p->>'janela_completa')::boolean,false)),
    'mensagens',coalesce(p->'mensagens','[]'));
  if e is not null then q:=q||jsonb_build_object('execucao_id',e->>'id'); end if;
  r:=public.vigia_capturar(q);
  return r||jsonb_build_object('capturadas',r->'mensagens_novas','cursor',r->'cursor_em');
end $$;
create function pg_temp.registrar(p jsonb) returns jsonb language plpgsql as $$
declare m jsonb; s jsonb; a jsonb; e jsonb; q jsonb; links jsonb; eventos jsonb; passos jsonb;
  resultados jsonb:='[]'; globais jsonb:='[]'; acks jsonb:='[]'; chave text;
begin
  for m in select value from jsonb_array_elements(coalesce(p->'mensagens','[]')) loop
    links:='[]'; eventos:='[]'; passos:='[]';
    for s in select value from jsonb_array_elements(coalesce(m->'vinculos','[]')) loop
      links:=links||jsonb_build_array(jsonb_build_object('gmail_message_id',m->>'gmail_message_id',
        'tarefa_id',s->>'tarefa_id','estado','sugerido','origem','regra'));
    end loop;
    for s in select value from jsonb_array_elements(coalesce(m->'sugestoes','[]')) loop
      chave:='msg:'||(m->>'gmail_message_id')||':passo:'||(s->>'passo_id');
      eventos:=eventos||jsonb_build_array(jsonb_build_object('chave',chave,'tarefa_id',s->>'tarefa_id',
        'tipo','sugestao','origem','vigia','resumo','Evidência sugerida.',
        'detalhe',jsonb_build_object('passo_id',s->>'passo_id'),'gmail_message_id',m->>'gmail_message_id'));
      passos:=passos||jsonb_build_array(jsonb_build_object('tarefa_id',s->>'tarefa_id','passo_id',s->>'passo_id',
        'estado','sugerido','evento_chave',chave));
    end loop;
    resultados:=resultados||jsonb_build_array(jsonb_build_object('registro_mensagem',m-'vinculos'-'sugestoes',
      'vinculos',links,'eventos',eventos,'passos_sugeridos',passos));
  end loop;
  for a in select value from jsonb_array_elements(coalesce(p->'alertas','[]')) loop
    chave:='prazo:'||(a->>'tarefa_id')||':'||(a->>'prazo')||':'||(a->>'nivel');
    globais:=globais||jsonb_build_array(jsonb_build_object('chave',chave,'tarefa_id',a->>'tarefa_id',
      'tipo','alerta_prazo','origem','vigia','detalhe',jsonb_build_object('prazo',a->>'prazo','nivel',a->>'nivel')));
  end loop;
  q:=jsonb_build_object('resultados',resultados,'eventos',globais);
  e:=p->'execucao';
  if e is not null then q:=q||jsonb_build_object('execucao',e||jsonb_build_object('iniciada_em',now())); end if;
  for a in select value from jsonb_array_elements(coalesce(p->'avisos','[]')) loop
    if a->>'chave'='aviso1' then chave:='aviso:msg:m1:passo:'||current_setting('test054.passo');
    elsif a->>'chave'='retry-aviso' then
      chave:='resumo:'||current_date;
      q:=q||jsonb_build_object('resumo_diario',jsonb_build_object('chave',chave,'dia',current_date));
    else chave:=a->>'chave'; end if;
    acks:=acks||jsonb_build_array(jsonb_build_object('chave',chave,'estado',a->>'estado'));
  end loop;
  return public.vigia_registrar(q||jsonb_build_object('avisos_resultados',acks));
end $$;
create function pg_temp.invalido(p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when invalid_parameter_value or check_violation or not_null_violation
    or invalid_text_representation or datetime_field_overflow then return;
  end;
  raise exception '054 FALHOU: entrada inválida aceita: %',p_sql;
end $$;

-- BLOCO 1 da 051: todas as tabelas, exceto propostas, têm barreira.
do $$
declare faltam text;
begin
  select string_agg(c.relname,', ') into faltam from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and c.relname<>'propostas_agente'
    and not exists(select 1 from pg_trigger t where t.tgrelid=c.oid and t.tgname='trg_bloqueia_agente'
      and t.tgtype=30 and t.tgqual is null and t.tgenabled='O'
      and t.tgfoid='public.bloqueia_escrita_do_agente()'::regprocedure);
  perform pg_temp.ok(faltam is null,'BLOCO 1: barreira em todas as tabelas: '||coalesce(faltam,''));
  perform pg_temp.ok((select count(*)=6 from teste054.helpers) and not exists(
    select 1 from teste054.helpers h left join pg_proc p on p.oid=h.oid
    where p.oid is null or md5(pg_get_functiondef(p.oid))<>h.assinatura),'helpers protegidos permaneceram idênticos');
  raise notice 'BLOCO 1 ok: cobertura e helpers protegidos';
end $$;

select set_config('test054.x',(select id::text from public.projects where code='51.X'),false);
select set_config('test054.y',(select id::text from public.projects where code='51.Y'),false);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
-- Histórico do login dedicado: a exceção created_by da 033 não pode vazar
-- bolsistas após a conversão. O storage da 031 tem uma policy global.
update public.scholarship_holders set created_by='00000000-0000-0000-0000-0000000000d1'
  where full_name='Bolsista X Teste';
set role authenticated;
select public.set_automacao('00000000-0000-0000-0000-0000000000d1','vigia',true);
reset role;
select pg_temp.ok(not exists(select 1 from public.user_projects where user_id='00000000-0000-0000-0000-0000000000d1'),'conversão remove escopo');
select pg_temp.negado(format('insert into public.user_projects values(%L,%L)',
  '00000000-0000-0000-0000-0000000000d1',current_setting('test054.x')));
select pg_temp.negado(format('select public.save_user_assignments(%L,%L,array[%L::uuid])',
  '00000000-0000-0000-0000-0000000000d1','professor',current_setting('test054.x')));
select pg_temp.invalido('select public.set_automacao(''00000000-0000-0000-0000-0000000000a1'',''vigia'',true)');
select pg_temp.ok((select role='automacao' from public.app_users where user_id='00000000-0000-0000-0000-0000000000d1'),'papel não regride');

-- Propostas: shape, tamanho, CPF inteiro e escopo, incluindo a porta antiga.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
set role authenticated;
do $$
declare p jsonb; v uuid; v2 uuid;
begin
  p:=jsonb_build_object('project_id',current_setting('test054.x'),'titulo','Trâmite [P1]',
    'prazo',current_date+2,'responsavel','[P2]',
    'passos',jsonb_build_array(jsonb_build_object('descricao','Atualizar quadro'),
      jsonb_build_object('descricao','Cadastrar pedido'),jsonb_build_object('descricao','Enviar pedido')),
    'chaves',jsonb_build_array(jsonb_build_object('tipo','thread','valor','thread-conhecida')));
  perform pg_temp.negado(format('select public.propor_tarefa(%L::jsonb)',p||jsonb_build_object('project_id',current_setting('test054.y'))));
  perform pg_temp.invalido(format('select public.propor_tarefa(%L::jsonb)',p-'project_id'));
  perform pg_temp.invalido(format('select public.propor_tarefa(%L::jsonb)',p||'{"passos":[]}'::jsonb));
  perform pg_temp.invalido(format('select public.propor_tarefa(%L::jsonb)',p||'{"passos":{}}'::jsonb));
  perform pg_temp.invalido(format('select public.propor_tarefa(%L::jsonb)',p||'{"passos":[{}]}'::jsonb));
  perform pg_temp.invalido(format('select public.propor_tarefa(%L::jsonb)',p||'{"chaves":[{"tipo":"outro","valor":"x"}]}'::jsonb));
  perform pg_temp.invalido(format('select public.propor_tarefa(%L::jsonb)',p||'{"descricao":"529.982.247-25"}'::jsonb));
  perform pg_temp.invalido(format('select public.propor_tarefa(%L::jsonb)',p||'{"extra":{"cpf":"52998224725"}}'::jsonb));
  perform pg_temp.invalido(format('select public.propor_tarefa(%L::jsonb)',p||jsonb_build_object('descricao',repeat('x',66000))));
  v:=public.propor_tarefa(p); perform set_config('test054.proposta',v::text,false);
  v2:=public.propor_tarefa(p||'{"titulo":"Outro trâmite [P3]"}'); perform set_config('test054.proposta2',v2::text,false);
  -- A RPC de 052 passou a aceitar tipo tarefa; aplicar revalida, impedindo
  -- contornar a validação de propor_tarefa por esse caminho anterior.
  v:=public.criar_proposta('tarefa',current_setting('test054.x')::uuid,'Inválida','{}');
  perform set_config('test054.invalida',v::text,false);
  raise notice 'BLOCO 2 ok: propostas, forma, CPF e escopo';
end $$;
reset role;

-- Agente não escreve em tabela nova nem sob dono (gatilho não depende de RLS).
do $$
declare t text;
begin
  foreach t in array array['automacoes','tarefas','tarefa_passos','tarefa_passos_regras','tarefa_chaves','tarefa_eventos',
    'vigia_mensagens','vigia_vinculos','vigia_cursor','vigia_execucoes','vigia_avisos'] loop
    perform pg_temp.negado(format('insert into public.%I default values',t));
    perform pg_temp.negado(format('delete from public.%I where false',t));
  end loop;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
create temp table financeiro054_antes as select jsonb_build_object(
  'balancetes',(select coalesce(jsonb_agg(to_jsonb(b) order by id),'[]') from public.balancetes b),
  'lancamentos',(select coalesce(jsonb_agg(to_jsonb(l) order by id),'[]') from public.balancete_lancamentos l),
  'mapas',(select coalesce(jsonb_agg(to_jsonb(m) order by conta_prefix),'[]') from public.conta_rubrica_map m)) valor;
set role authenticated;
select set_config('test054.tarefa',public.aplicar_proposta_tarefa(current_setting('test054.proposta')::uuid)::text,false);
select set_config('test054.tarefa2',public.aplicar_proposta_tarefa(current_setting('test054.proposta2')::uuid)::text,false);
select pg_temp.invalido(format('select public.aplicar_proposta_tarefa(%L)',current_setting('test054.invalida')));
select pg_temp.invalido(format('select public.aplicar_proposta_tarefa(%L)',current_setting('test054.proposta')));
select pg_temp.ok((select count(*)=1 from public.tarefas where proposta_id=current_setting('test054.proposta')::uuid),'aplicação uma única vez');
select pg_temp.ok((select status='pendente' from public.listar_propostas_tarefa_seguras() where id=current_setting('test054.invalida')::uuid),'aplicação inválida sem efeito');
select pg_temp.ok((select status='aplicada' and objeto_id=current_setting('test054.tarefa')::uuid and decidida_por=auth.uid()
  from public.listar_propostas_tarefa_seguras() where id=current_setting('test054.proposta')::uuid),'aplicação atômica');
select set_config('test054.passo',(select id::text from public.tarefa_passos where tarefa_id=current_setting('test054.tarefa')::uuid and ordem=1),false);
select set_config('test054.passo2',(select id::text from public.tarefa_passos where tarefa_id=current_setting('test054.tarefa')::uuid and ordem=2),false);
select set_config('test054.passo3',(select id::text from public.tarefa_passos where tarefa_id=current_setting('test054.tarefa')::uuid and ordem=3),false);
select pg_temp.ok((select count(*)=1 from public.scholarship_holders),'professor continua lendo o bolsista do escopo');
select pg_temp.ok((select count(*)=1 from public.bolsistas_nomes()),'professor continua lendo nomes do escopo');
select pg_temp.invalido(format('select public.concluir_tarefa(%L)',current_setting('test054.tarefa')));
-- Achado 3: o humano autorizado também não pode aplicar uma tarefa pelo legado.
select pg_temp.invalido(format('select public.marcar_proposta_aplicada(%L)',current_setting('test054.invalida')));
select pg_temp.invalido(format('select public.upsert_balancete(%L::jsonb)',jsonb_build_object(
  'project_id',current_setting('test054.x'),'data_referencia',current_date,'saldo_disponivel',98765,
  'new_mappings',jsonb_build_array(jsonb_build_object('conta_prefix','ASTRA054','rubrica_code','a')),
  'lancamentos',jsonb_build_array(jsonb_build_object('conta_codigo','ASTRA054','valor_debito',123)),
  'proposta_id',current_setting('test054.invalida'))));
select pg_temp.ok((select status='pendente' and objeto_id is null from public.listar_propostas_tarefa_seguras()
  where id=current_setting('test054.invalida')::uuid),'legado e financeiro não alteram proposta de tarefa');
reset role;
select pg_temp.ok((select valor=jsonb_build_object(
  'balancetes',(select coalesce(jsonb_agg(to_jsonb(b) order by id),'[]') from public.balancetes b),
  'lancamentos',(select coalesce(jsonb_agg(to_jsonb(l) order by id),'[]') from public.balancete_lancamentos l),
  'mapas',(select coalesce(jsonb_agg(to_jsonb(m) order by conta_prefix),'[]') from public.conta_rubrica_map m))
  from financeiro054_antes),'caminho financeiro recusado desfaz balancete, lançamentos e mapeamentos');

-- Todas as RPCs humanas recusam agente e automação; vigia só é vigia.
do $$
declare usuario text; sql text; t text:=current_setting('test054.tarefa'); s text:=current_setting('test054.passo');
begin
  foreach usuario in array array['00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000d1'] loop
    perform set_config('request.jwt.claim.sub',usuario,false);
    foreach sql in array array[
      format('select public.aplicar_proposta_tarefa(%L)',current_setting('test054.proposta')),
      format('select public.confirmar_passo(%L)',s),format('select public.dispensar_passo(%L)',s),
      format('select public.registrar_nota(%L,%L)',t,'nota'),format('select public.concluir_tarefa(%L)',t),
      format('select public.reabrir_tarefa(%L)',t),format('select public.cancelar_tarefa(%L)',t),
      format('select public.atualizar_prazo(%L,current_date)',t),
      format('select public.vincular_mensagem(%L,%L,true)','m1',t),
      'select public.revisar_mensagem(''m1'',''rotina'')',
      'select public.set_automacao(''00000000-0000-0000-0000-0000000000d1'',''vigia'',false)'
    ] loop perform pg_temp.negado(sql); end loop;
  end loop;
  foreach usuario in array array['00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c1'] loop
    perform set_config('request.jwt.claim.sub',usuario,false);
    perform pg_temp.negado('select public.vigia_contexto()');
    perform pg_temp.negado('select public.vigia_capturar(''{}'')');
    perform pg_temp.negado('select public.vigia_registrar(''{}'')');
    perform pg_temp.negado('select public.vigia_expurgar()');
  end loop;
  raise notice 'BLOCO 3 ok: todos os guards humanos/agente/vigia';
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select pg_temp.ok(public.is_automacao('vigia') and public.is_automacao(null),'identidade vigia');
select pg_temp.ok(cardinality(public.allowed_project_ids())=0,'escopo vazio do vigia');
select pg_temp.ok((select count(*)=0 from public.scholarship_holders),'vigia não lê bolsistas');
select pg_temp.ok((select count(*)=0 from public.bolsistas_nomes()),'vigia não lê nomes por RPC da 052');
select pg_temp.ok((select count(*)=0 from storage.objects),'vigia não lê planilhas de bolsa nem outros buckets');
select pg_temp.negado(format('insert into storage.objects(bucket_id,name) values(''balancete-pdfs'',%L)',current_setting('test054.x')||'/automacao.pdf'));
select pg_temp.ok((select count(*)=0 from public.projects),'vigia não lê projetos');
select pg_temp.negado(format('select public.upsert_balancete(jsonb_build_object(''project_id'',%L,''data_referencia'',current_date))',current_setting('test054.x')));
select pg_temp.negado(format('select public.stub_escrita_sem_guard(%L)',current_setting('test054.x')));
select pg_temp.negado(format('select public.marcar_proposta_aplicada(%L)',current_setting('test054.invalida')));
select pg_temp.negado(format('select public.decidir_proposta(%L,''rejeitada'',''teste'')',current_setting('test054.invalida')));
select pg_temp.negado(format('select public.propor_tarefa(jsonb_build_object(''project_id'',%L))',current_setting('test054.x')));
do $$
declare t text;
begin
  foreach t in array array['automacoes','tarefas','tarefa_passos','tarefa_passos_regras','tarefa_chaves','tarefa_eventos',
    'vigia_mensagens','vigia_vinculos','vigia_cursor','vigia_execucoes','vigia_avisos'] loop
    perform pg_temp.ok(not has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE'),'ACL sem escrita: '||t);
    perform pg_temp.negado(format('insert into public.%I default values',t));
    perform pg_temp.negado(format('delete from public.%I where false',t));
  end loop;
end $$;

-- Captura é persistida ANTES de interpretar. Cursor não é MAX de mensagem.
do $$
declare p jsonb; r jsonb;
begin
  -- Achado 5: inicialização implícita e janela curta eram aceitas antes.
  perform pg_temp.invalido(format('select public.vigia_capturar(%L::jsonb)',jsonb_build_object('janela',
    jsonb_build_object('inicio',now()-interval '1 day','fim',now(),'completa',true))));
  p:=jsonb_build_object('mensagens',jsonb_build_array(
    jsonb_build_object('gmail_message_id','m1','gmail_thread_id','thread1','recebida_em',now()+interval '1 second','assunto','Pedido [P1]','trecho','Enviado [P2]'),
    jsonb_build_object('gmail_message_id','m2','gmail_thread_id','thread2','recebida_em',now()+interval '1 second','assunto','Outro pedido'),
    jsonb_build_object('gmail_message_id','m3','gmail_thread_id','thread3','recebida_em',now()+interval '1 second'),
    jsonb_build_object('gmail_message_id','velha','gmail_thread_id','thread0','recebida_em',now()-interval '91 days','assunto','Expira','trecho','Expira')),
    'cursor',now(),'janela_completa',false,'execucao',jsonb_build_object('id','10000000-0000-0000-0000-000000000001','iniciada_em',now(),'versao','teste'));
  r:=pg_temp.capturar(p);
  perform pg_temp.ok((r->>'capturadas')::integer=4 and r->>'cursor' is null,'captura sem avançar janela incompleta');
  perform pg_temp.invalido(format('select public.vigia_capturar(%L::jsonb)',jsonb_build_object('execucao_id',
    '10000000-0000-0000-0000-000000000001','janela',jsonb_build_object('primeira_carga',true,
      'inicio',now()-interval '23 hours','fim',now(),'completa',true))));
  r:=pg_temp.capturar(p||'{"janela_completa":true}');
  perform pg_temp.ok((r->>'capturadas')::integer=0 and r->>'cursor' is not null,'captura idempotente');
  perform set_config('test054.cursor',r->>'cursor',false);
  perform pg_temp.invalido(format('select public.vigia_capturar(%L::jsonb)',jsonb_build_object('janela',
    jsonb_build_object('inicio',now()+interval '1 minute','fim',now()+interval '2 minutes','completa',true),'mensagens','[]'::jsonb)));
  perform pg_temp.invalido(format('select public.vigia_capturar(%L::jsonb)',jsonb_build_object('janela',
    jsonb_build_object('inicio',now()-interval '23 hours','fim',now()+interval '1 minute','completa',true))));
  perform pg_temp.ok(public.vigia_contexto()->>'cursor_em'=current_setting('test054.cursor'),'janela desconectada não avança cursor');
  r:=pg_temp.capturar(jsonb_build_object('janela_completa',true,'cursor',now()-interval '1 day'));
  perform pg_temp.ok(r->>'cursor'=current_setting('test054.cursor'),'cursor não regride');
  perform pg_temp.ok(jsonb_array_length(public.vigia_contexto()->'mensagens')=4,'capturadas reaparecem no contexto');
  perform pg_temp.invalido('select pg_temp.registrar(''{"mensagens":[{"gmail_message_id":"nao-capturada","motivo":"x"}]}''::jsonb)');
  -- lote inválido não deixa captura parcial nem avança o cursor.
  perform pg_temp.invalido(format('select pg_temp.capturar(%L::jsonb)',jsonb_build_object('mensagens',jsonb_build_array(
    jsonb_build_object('gmail_message_id','rollback','gmail_thread_id','r','recebida_em',now()),
    jsonb_build_object('gmail_thread_id','r','recebida_em',now())))));
  raise notice 'BLOCO 4 ok: captura/cursor/contexto e atomicidade';
end $$;
reset role;
select pg_temp.ok(not exists(select 1 from public.vigia_mensagens where gmail_message_id='rollback'),'lote inválido desfeito');
select pg_temp.ok((select count(*)=4 from public.vigia_mensagens),'captura conservada');

-- Registrar 2x produz o MESMO estado, inclusive tentativas e avisos.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
do $$
declare p jsonb; r jsonb;
begin
  p:=jsonb_build_object('mensagens',jsonb_build_array(jsonb_build_object('gmail_message_id','m1','fila','tarefa',
    'motivo','Ligação por regra','classificacao','exigencia','confianca','alta',
    'vinculos',jsonb_build_array(jsonb_build_object('tarefa_id',current_setting('test054.tarefa')),
      jsonb_build_object('tarefa_id',current_setting('test054.tarefa2'))),
    'sugestoes',jsonb_build_array(jsonb_build_object('tarefa_id',current_setting('test054.tarefa'),'passo_id',current_setting('test054.passo'))))),
    'alertas',jsonb_build_array(jsonb_build_object('tarefa_id',current_setting('test054.tarefa'),'prazo',current_date+2,'nivel','D-2')),
    'avisos',jsonb_build_array(jsonb_build_object('chave','aviso1','texto','Há uma tarefa para revisar.','estado','enviado')),
    'execucao',jsonb_build_object('id','10000000-0000-0000-0000-000000000001','terminada_em',now()+interval '1 second',
      'mensagens_novas',4,'alertas',1,'versao','teste'));
  r:=pg_temp.registrar(p);
  perform pg_temp.ok((r->>'processadas')::int=1 and (r->>'eventos')::int=4,'mensagem N:N, sugestão e prazo');
  perform set_config('test054.lote',p::text,false);
end $$;
reset role;
create temp table antes054 as select jsonb_build_object(
  'tarefas',(select jsonb_agg(to_jsonb(t) order by id) from public.tarefas t),
  'passos',(select jsonb_agg(to_jsonb(t) order by id) from public.tarefa_passos t),
  'eventos',(select jsonb_agg(to_jsonb(t) order by id) from public.tarefa_eventos t),
  'mensagens',(select jsonb_agg(to_jsonb(t) order by gmail_message_id) from public.vigia_mensagens t),
  'vinculos',(select jsonb_agg(to_jsonb(t) order by tarefa_id) from public.vigia_vinculos t),
  'execucoes',(select jsonb_agg(to_jsonb(t) order by id) from public.vigia_execucoes t),
  'avisos',(select jsonb_agg(to_jsonb(t) order by chave) from public.vigia_avisos t)) estado;
set role authenticated;
select pg_temp.registrar(current_setting('test054.lote')::jsonb);
reset role;
select pg_temp.ok((select estado from antes054)=jsonb_build_object(
  'tarefas',(select jsonb_agg(to_jsonb(t) order by id) from public.tarefas t),
  'passos',(select jsonb_agg(to_jsonb(t) order by id) from public.tarefa_passos t),
  'eventos',(select jsonb_agg(to_jsonb(t) order by id) from public.tarefa_eventos t),
  'mensagens',(select jsonb_agg(to_jsonb(t) order by gmail_message_id) from public.vigia_mensagens t),
  'vinculos',(select jsonb_agg(to_jsonb(t) order by tarefa_id) from public.vigia_vinculos t),
  'execucoes',(select jsonb_agg(to_jsonb(t) order by id) from public.vigia_execucoes t),
  'avisos',(select jsonb_agg(to_jsonb(t) order by chave) from public.vigia_avisos t)),'estado integral idempotente');
select pg_temp.ok((select estado='sugerido' and confirmado_em is null from public.tarefa_passos where id=current_setting('test054.passo')::uuid),'vigia só sugere');
select pg_temp.ok((select status='em_andamento' and precisa_atencao and motivo_atencao is not null from public.tarefas where id=current_setting('test054.tarefa')::uuid),'vigia não conclui e indica motivo');
select pg_temp.ok((select count(*)=2 from public.vigia_vinculos where gmail_message_id='m1'),'N:N preservado');

-- RLS: agente lê tarefas no escopo, não triagem; professor Y não vê X.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
set role authenticated;
select pg_temp.ok((select count(*)=2 from public.tarefas),'agente lê tarefas');
select pg_temp.ok((select count(*)=6 from public.tarefa_passos),'agente lê passos');
select pg_temp.ok((select count(*)=2 from public.tarefa_chaves),'agente lê chaves');
select pg_temp.ok((select count(*)=6 from public.tarefa_eventos),'agente lê eventos');
select pg_temp.ok((select count(*)=0 from public.scholarship_holders),'agente continua sem CPF');
select pg_temp.ok((select count(*)=1 from public.bolsistas_nomes()),'agente continua lendo somente nomes');
select pg_temp.ok((select count(*)=0 from public.vigia_mensagens),'agente não lê remetentes');
select pg_temp.ok((select count(*)=0 from public.vigia_vinculos),'agente não lê triagem N:N');
select pg_temp.ok((select count(*)=0 from public.vigia_execucoes),'agente não lê execuções');
select pg_temp.ok((select count(*)=0 from public.vigia_avisos),'agente não lê avisos');
select pg_temp.ok((select count(*)=0 from public.vigia_cursor),'agente não lê cursor');
select pg_temp.ok((select count(*)=0 from public.automacoes),'agente não lê automações');
do $$ declare t text; col text;
begin
  foreach t in array array['automacoes','tarefas','tarefa_passos','tarefa_passos_regras','tarefa_chaves','tarefa_eventos',
    'vigia_mensagens','vigia_vinculos','vigia_cursor','vigia_execucoes','vigia_avisos'] loop
    select attname into col from pg_attribute where attrelid=('public.'||t)::regclass and attnum=1;
    perform pg_temp.negado(format('update public.%I set %I=%I where false',t,col,col));
    perform pg_temp.negado(format('truncate public.%I',t));
  end loop;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',false);
set role authenticated;
select pg_temp.ok((select count(*)=0 from public.tarefas),'professor Y não vê X');
select pg_temp.ok((select count(*)=0 from public.tarefa_passos),'passos herdam escopo');
select pg_temp.ok((select count(*)=0 from public.tarefa_chaves),'chaves herdam escopo');
select pg_temp.ok((select count(*)=0 from public.tarefa_eventos),'eventos herdam escopo');
select pg_temp.ok(not exists(select 1 from public.listar_propostas_tarefa_seguras()),'projeção de propostas também respeita escopo');
select pg_temp.negado(format('select public.confirmar_passo(%L)',current_setting('test054.passo')));
select pg_temp.negado(format('select public.concluir_tarefa(%L)',current_setting('test054.tarefa')));
select pg_temp.negado(format('select public.registrar_nota(%L,''fora'')',current_setting('test054.tarefa')));
reset role;

-- Revisão humana: professor confirma; apenas admin triagem; não regride.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
set role authenticated;
select public.confirmar_passo(current_setting('test054.passo')::uuid,'Conferido.');
select pg_temp.negado(format('select public.vincular_mensagem(''m1'',%L,true)',current_setting('test054.tarefa')));
select pg_temp.negado('select public.revisar_mensagem(''m1'',''rotina'')');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
select public.vincular_mensagem('m1',current_setting('test054.tarefa')::uuid,true);
select public.vincular_mensagem('m2',current_setting('test054.tarefa')::uuid,false);
select public.revisar_mensagem('m1','rotina');
reset role;
select pg_temp.ok(exists(select 1 from public.tarefa_chaves where tarefa_id=current_setting('test054.tarefa')::uuid and tipo='thread' and valor='thread1'),'aceitar acrescenta thread');
select pg_temp.ok(not exists(select 1 from public.tarefa_chaves where tarefa_id=current_setting('test054.tarefa')::uuid and valor='thread2'),'recusar não acrescenta thread');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
do $$ declare p jsonb;
begin
  p:=jsonb_build_object('mensagens',jsonb_build_array(
    jsonb_build_object('gmail_message_id','m2','fila','tarefa','motivo','Nova tentativa','vinculos',
      jsonb_build_array(jsonb_build_object('tarefa_id',current_setting('test054.tarefa'))),
      'sugestoes',jsonb_build_array(jsonb_build_object('tarefa_id',current_setting('test054.tarefa'),'passo_id',current_setting('test054.passo2')))),
    jsonb_build_object('gmail_message_id','m3','fila','tarefa','motivo','Outra mensagem','vinculos',
      jsonb_build_array(jsonb_build_object('tarefa_id',current_setting('test054.tarefa'))),
      'sugestoes',jsonb_build_array(jsonb_build_object('tarefa_id',current_setting('test054.tarefa'),'passo_id',current_setting('test054.passo')))),
    jsonb_build_object('gmail_message_id','velha','fila','tarefa','motivo','Mensagem anterior à tarefa','vinculos',
      jsonb_build_array(jsonb_build_object('tarefa_id',current_setting('test054.tarefa'))),
      'sugestoes',jsonb_build_array(jsonb_build_object('tarefa_id',current_setting('test054.tarefa'),'passo_id',current_setting('test054.passo3'))))));
  perform pg_temp.registrar(p);
  perform pg_temp.registrar(current_setting('test054.lote')::jsonb);
  perform pg_temp.ok((public.vigia_expurgar()->>'mensagens_expurgadas')::integer=1,'expurgo 90 dias');
  perform pg_temp.ok((public.vigia_expurgar()->>'mensagens_expurgadas')::integer=0,'expurgo idempotente');
end $$;
reset role;
select pg_temp.ok((select estado='confirmado' from public.tarefa_passos where id=current_setting('test054.passo')::uuid),'confirmado não regride');
select pg_temp.ok((select estado='pendente' from public.tarefa_passos where id=current_setting('test054.passo2')::uuid),'rejeição lembrada: não sugere');
select pg_temp.ok((select estado='pendente' from public.tarefa_passos where id=current_setting('test054.passo3')::uuid),'mensagem anterior não é evidência');
select pg_temp.ok((select estado='rejeitado' from public.vigia_vinculos where gmail_message_id='m2' and tarefa_id=current_setting('test054.tarefa')::uuid),'vigia não restaura vínculo rejeitado');
select pg_temp.ok((select fila='rotina' and revisada_por is not null from public.vigia_mensagens where gmail_message_id='m1'),'revisão não regride');
select pg_temp.ok((select assunto is null and trecho is null from public.vigia_mensagens where gmail_message_id='velha'),'texto antigo expurgado');

-- Append-only mesmo para dono / admin e chave unique.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select pg_temp.negado('update public.tarefa_eventos set resumo=resumo');
select pg_temp.negado('delete from public.tarefa_eventos');
select pg_temp.negado('truncate public.tarefa_eventos cascade');
set role authenticated;
select pg_temp.negado('update public.tarefa_eventos set resumo=resumo');
select pg_temp.negado('delete from public.tarefa_eventos');
select pg_temp.negado('update public.tarefas set titulo=titulo');
select pg_temp.negado('select public._status_tarefa(null,''concluida'',null)');
select pg_temp.invalido(format('select public.registrar_nota(%L,''52998224725'')',current_setting('test054.tarefa')));
select public.registrar_nota(current_setting('test054.tarefa')::uuid,'Aguardando [P2].');
select public.dispensar_passo(current_setting('test054.passo2')::uuid,'Não necessário.');
select public.confirmar_passo(current_setting('test054.passo3')::uuid);
select public.concluir_tarefa(current_setting('test054.tarefa')::uuid,'Conferido pelo humano.');
select pg_temp.ok((select status='concluida' and concluida_por=auth.uid() and concluida_em is not null
  from public.tarefas where id=current_setting('test054.tarefa')::uuid),'conclusão só humana');
select pg_temp.invalido(format('select public.dispensar_passo(%L)',current_setting('test054.passo')));
select public.reabrir_tarefa(current_setting('test054.tarefa')::uuid);
select pg_temp.ok((select estado='confirmado' from public.tarefa_passos where id=current_setting('test054.passo')::uuid),'reabrir preserva confirmação');
select public.atualizar_prazo(current_setting('test054.tarefa')::uuid,current_date-1,'Prazo revisto.');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select pg_temp.registrar(jsonb_build_object('alertas',jsonb_build_array(
  jsonb_build_object('tarefa_id',current_setting('test054.tarefa'),'prazo',current_date-1,'nivel','vencido'),
  jsonb_build_object('tarefa_id',current_setting('test054.tarefa'),'prazo',current_date-1,'nivel','D-5'))));
reset role;
select pg_temp.ok((select count(*)=2 from public.tarefa_eventos where tarefa_id=current_setting('test054.tarefa')::uuid and tipo='alerta_prazo'),'prazo novo recupera alerta mais grave');

-- Retry de erro, avisos reenviáveis, e revogação (identidade permanece).
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select pg_temp.capturar(jsonb_build_object('mensagens',jsonb_build_array(
  jsonb_build_object('gmail_message_id','retry','gmail_thread_id','retry','recebida_em',now()))));
select pg_temp.registrar('{"mensagens":[{"gmail_message_id":"retry","estado":"erro","fila":"esclarecer","motivo":"Modelo indisponível"}]}');
select pg_temp.ok(jsonb_array_length(public.vigia_contexto()->'mensagens')=1,'erro volta no contexto');
select pg_temp.registrar('{"mensagens":[{"gmail_message_id":"retry","fila":"esclarecer","motivo":"Processada sem modelo"}]}');
select pg_temp.registrar('{"avisos":[{"chave":"retry-aviso","texto":"Há revisão pendente.","estado":"falhou"}],"execucao":{"id":"10000000-0000-0000-0000-000000000002"}}');
select pg_temp.registrar('{"avisos":[{"chave":"retry-aviso","texto":"Há revisão pendente.","estado":"falhou"}],"execucao":{"id":"10000000-0000-0000-0000-000000000002"}}');
select pg_temp.registrar('{"avisos":[{"chave":"retry-aviso","texto":"Há revisão pendente.","estado":"enviado"}],"execucao":{"id":"10000000-0000-0000-0000-000000000003"}}');
reset role;
select pg_temp.ok((select estado='processada' and tentativas=2 from public.vigia_mensagens where gmail_message_id='retry'),'retry de mensagem');
select pg_temp.ok((select estado='enviado' and tentativas=2 from public.vigia_avisos where tipo='resumo_diario' and dia=current_date),'retry de aviso idempotente por execução');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
-- Contrato v1 diretamente, incluindo início sem ID, retry do modelo sem
-- interpretação parcial, falha de máscara, outbox e ack sem execução.
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
set role authenticated;
select set_config('test054.proposta3',public.propor_tarefa(jsonb_build_object('project_id',current_setting('test054.x'),
  'titulo','Tarefa do contrato [P3]','passos',jsonb_build_array(jsonb_build_object('descricao','Enviar bolsa',
  'evidencia',jsonb_build_object('tipo','email','de','sintetico@exemplo.invalid','para_dominio','funape.org.br',
    'contem_todos',jsonb_build_array('51.X'),'contem_algum',jsonb_build_array('bolsa'))))))::text,false);
-- Achado 1: nem a regra nem o payload bruto retornam ao agente proponente.
select pg_temp.ok(not exists(select 1 from public.propostas_agente where tipo='tarefa'),'agente não lê payload bruto');
select pg_temp.ok((select payload->'passos'->0->'evidencia'='{}'::jsonb and to_jsonb(p)::text not like '%@%'
  from public.listar_propostas_tarefa_seguras() p where id=current_setting('test054.proposta3')::uuid),'proposta segura conserva forma e remove regra');
select set_config('test054.proposta_extra',public.criar_proposta('tarefa',current_setting('test054.x')::uuid,
  'Contato externo externo@exemplo.invalid','{"externo@exemplo.invalid":"externo@exemplo.invalid","extra":[{"evidencia":{"de":"outro@exemplo.invalid"}}]}',
  current_setting('test054.x')||'/externo@exemplo.invalid','externo@exemplo.invalid')::text,false);
select pg_temp.ok((select to_jsonb(p)::text not like '%@%' from public.listar_propostas_tarefa_seguras() p
  where id=current_setting('test054.proposta_extra')::uuid),'projeção cobre metadados, chaves e payload legado malformado');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
select set_config('test054.tarefa3',public.aplicar_proposta_tarefa(current_setting('test054.proposta3')::uuid)::text,false);
select set_config('test054.passo4',(select id::text from public.tarefa_passos where tarefa_id=current_setting('test054.tarefa3')::uuid),false);
select pg_temp.ok((select evidencia->>'de'='sintetico@exemplo.invalid' from public.tarefa_passos_regras
  where passo_id=current_setting('test054.passo4')::uuid),'admin lê regra completa');
select pg_temp.ok((select payload->'passos'->0->'evidencia'->>'de'='sintetico@exemplo.invalid'
  from public.propostas_agente where id=current_setting('test054.proposta3')::uuid),'payload restrito guarda regra original');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
set role authenticated;
select pg_temp.ok(not exists(select 1 from public.tarefa_passos_regras),'agente não lê regras');
select pg_temp.ok((select evidencia='{}'::jsonb and to_jsonb(p)::text not like '%@%' from public.tarefa_passos p
  where id=current_setting('test054.passo4')::uuid),'passo público sem endereço');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
set role authenticated;
select pg_temp.ok(not exists(select 1 from public.tarefa_passos_regras),'professor não lê regras completas');
select pg_temp.ok(not exists(select 1 from public.propostas_agente where tipo='tarefa'),'professor usa projeção segura');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
do $$
declare r jsonb; e uuid; p jsonb; s jsonb; msg text; captura jsonb;
begin
  r:=public.vigia_contexto();
  perform pg_temp.ok(exists(select 1 from jsonb_array_elements(r->'tarefas') t,
    lateral jsonb_array_elements(t->'passos') regra where regra->>'id'=current_setting('test054.passo4')
    and regra->'evidencia'->>'de'='sintetico@exemplo.invalid'),'vigia recebe regra completa somente na RPC');
  perform pg_temp.ok(not exists(select 1 from public.tarefa_passos_regras),'vigia não lê regra diretamente');
  perform pg_temp.ok(r->>'versao_esquema'='1' and r ? 'cursor_em' and r ? 'pendentes' and r ? 'alertas_emitidos'
    and r ? 'esclarecer' and r ? 'rotina' and r->>'saude'='ok','campos do contexto v1');
  r:=public.vigia_registrar(jsonb_build_object('versao','vigia-teste','execucao',
    jsonb_build_object('tipo','checagem','iniciada_em',now())));
  e:=(r->>'execucao_id')::uuid;
  perform pg_temp.ok(e is not null and r ? 'avisos','início retorna ID e outbox antiga');
  captura:=jsonb_build_object('execucao_id',e,'janela',jsonb_build_object('inicio',(public.vigia_contexto()->>'cursor_em')::timestamptz-interval '1 day','fim',now(),'completa',true),
    'mensagens',jsonb_build_array(jsonb_build_object('gmail_message_id','contrato','gmail_thread_id','ct','recebida_em',now()),
      jsonb_build_object('gmail_message_id','ausencia','gmail_thread_id','ca','recebida_em',now()),
      jsonb_build_object('gmail_message_id','encaminhada','gmail_thread_id','ce','recebida_em',now(),'encaminhada',true),
      jsonb_build_object('gmail_message_id','mascara','gmail_thread_id','cm','recebida_em',now(),'assunto','CPF 52998224725','remetente','x@exemplo.invalid')));
  r:=public.vigia_capturar(captura);
  perform pg_temp.ok((r->>'mensagens_novas')::int=4 and jsonb_array_length(r->'processar_ids')=4,'captura v1');
  perform pg_temp.invalido('select public.vigia_capturar(''{"janela":{"inicio":"2026-10-07Z","fim":"2026-10-06Z","completa":true}}'')');
  p:=jsonb_build_object('resultados',jsonb_build_array(jsonb_build_object('registro_mensagem',
    jsonb_build_object('gmail_message_id','contrato','estado','capturada','motivo','modelo_indisponivel'),
    'vinculos',jsonb_build_array(jsonb_build_object('gmail_message_id','contrato','tarefa_id',current_setting('test054.tarefa3'),'estado','sugerido')))));
  perform public.vigia_registrar(p);
  perform pg_temp.ok(jsonb_array_length(public.vigia_contexto()->'pendentes')=4,'retry continua pendente');
  -- Achado 2: erro e recaptura com motivos diferentes não apagam retenção.
  perform pg_temp.registrar('{"mensagens":[{"gmail_message_id":"mascara","estado":"erro","motivo":"modelo_indisponivel"}]}');
  perform pg_temp.registrar('{"mensagens":[{"gmail_message_id":"mascara","estado":"capturada","motivo":"nova_tentativa"}]}');
  perform pg_temp.capturar(jsonb_build_object('mensagens',jsonb_build_array(jsonb_build_object(
    'gmail_message_id','mascara','gmail_thread_id','cm','recebida_em',now(),'assunto','Agora parece seguro','mascara_falhou',false))));
  foreach msg in array array['ausencia','encaminhada','mascara','contrato'] loop
    s:=jsonb_build_object('tarefa_id',current_setting('test054.tarefa3'),'passo_id',current_setting('test054.passo4'),
      'estado','sugerido','evento_chave','msg:'||msg||':passo:'||current_setting('test054.passo4'));
    p:=jsonb_build_object('resultados',jsonb_build_array(jsonb_build_object('registro_mensagem',
      jsonb_build_object('gmail_message_id',msg,'estado','processada','fila','tarefa',
        'motivo',case when msg='ausencia' then 'ausencia' else 'regra' end,
        'classificacao',case when msg='contrato' then 'concluido' else 'informativo' end),
      'vinculos',jsonb_build_array(jsonb_build_object('gmail_message_id',msg,'tarefa_id',current_setting('test054.tarefa3'),'estado','sugerido')),
      'eventos',jsonb_build_array(jsonb_build_object('chave',s->>'evento_chave','tarefa_id',current_setting('test054.tarefa3'),
        'tipo','sugestao','origem','vigia','resumo','Texto livre que não deve ser persistido: 52998224725',
        'gmail_message_id',msg,'detalhe',jsonb_build_object('passo_id',current_setting('test054.passo4'),'trecho','Texto [P3]'))),
      'passos_sugeridos',jsonb_build_array(s))));
    if msg='contrato' then perform set_config('test054.payload_v1',p::text,false); end if;
    r:=public.vigia_registrar(p);
    if msg<>'contrato' then perform pg_temp.ok((r->>'eventos')::int<=1,'ausência/encaminhamento/máscara não sugerem passo'); end if;
  end loop;
  r:=public.vigia_capturar(captura);
  perform pg_temp.ok(jsonb_array_length(r->'processar_ids')=0 and (r->>'mensagens_novas')::int=0,'duplicata processada não volta ao executor');
  r:=public.vigia_registrar(jsonb_build_object('execucao',jsonb_build_object('id',e,'terminada_em',now(),'erros',jsonb_build_array(jsonb_build_object('codigo','modelo_indisponivel')))));
  perform pg_temp.ok(jsonb_array_length(r->'avisos')>0,'outbox retornada mesmo sem mensagem nova');
  p:=jsonb_build_object('avisos_resultados',jsonb_build_array(jsonb_build_object('chave','aviso:msg:contrato:passo:'||current_setting('test054.passo4'),
    'estado','enviado','canal','email')));
  perform public.vigia_registrar(p); perform public.vigia_registrar(p);
  -- Um backlog maior que o antigo limite de 200 não pode desaparecer.
  select jsonb_build_object('janela',jsonb_build_object('inicio',(public.vigia_contexto()->>'cursor_em')::timestamptz-interval '1 day','fim',now(),'completa',false),
    'mensagens',jsonb_agg(jsonb_build_object('gmail_message_id','backlog-'||i,'gmail_thread_id','backlog-'||i,'recebida_em',now())))
    into p from generate_series(1,205) i;
  r:=public.vigia_capturar(p);
  perform pg_temp.ok(jsonb_array_length(r->'processar_ids')=205 and jsonb_array_length(public.vigia_contexto()->'pendentes')=205,
    'backlog completo, sem truncamento silencioso');
  perform pg_temp.invalido('select public.vigia_registrar(''{"eventos":[{"tipo":"status"}]}''::jsonb)');
  perform pg_temp.invalido('select public.vigia_registrar(''{"execucao":{"iniciada_em":"2026-10-06T12:00:00Z","erros":[{"codigo":"execucao_falhou","stack":"indevido"}]}}''::jsonb)');
  perform pg_temp.negado('select public._vigia_registrar_base(''{}'')');
  perform pg_temp.negado('select public._vigia_capturar_base(''{}'')');
  perform pg_temp.negado('select public._travar_modulo_tarefas()');
  perform pg_temp.negado('select public._travar_lote_tarefas(''{}'')');
  perform pg_temp.negado('select public._payload_tarefa_publico(''{}'')');
  perform pg_temp.negado('select public.listar_propostas_tarefa_seguras()');
end $$;

-- Fixtures isoladas para o roteiro Docker com duas conexões reais.
-- O login volta a ficar ativo somente neste banco descartável.
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select public.set_automacao('00000000-0000-0000-0000-0000000000d1','vigia',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
select pg_temp.capturar(jsonb_build_object('mensagens',jsonb_build_array(
  jsonb_build_object('gmail_message_id','lock-a','gmail_thread_id','lock-a','recebida_em',now()),
  jsonb_build_object('gmail_message_id','lock-b','gmail_thread_id','lock-b','recebida_em',now()))));
create table teste054.concorrencia as
select least(current_setting('test054.tarefa')::uuid,current_setting('test054.tarefa3')::uuid) menor,
  greatest(current_setting('test054.tarefa')::uuid,current_setting('test054.tarefa3')::uuid) maior,
  (public.vigia_contexto()->>'cursor_em')::timestamptz cursor_inicial;
alter table teste054.concorrencia add column lote jsonb;
update teste054.concorrencia set lote=jsonb_build_object('resultados',jsonb_build_array(
  jsonb_build_object('registro_mensagem',jsonb_build_object('gmail_message_id','lock-b','estado','processada','fila','tarefa','motivo','regra'),
    'vinculos',jsonb_build_array(jsonb_build_object('gmail_message_id','lock-b','tarefa_id',maior,'estado','sugerido'),
      jsonb_build_object('gmail_message_id','lock-b','tarefa_id',menor,'estado','sugerido'))),
  jsonb_build_object('registro_mensagem',jsonb_build_object('gmail_message_id','lock-a','estado','processada','fila','tarefa','motivo','regra'),
    'vinculos',jsonb_build_array(jsonb_build_object('gmail_message_id','lock-a','tarefa_id',menor,'estado','sugerido'),
      jsonb_build_object('gmail_message_id','lock-a','tarefa_id',maior,'estado','sugerido')))));
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
reset role;
select pg_temp.ok((select estado='sugerido' from public.tarefa_passos where id=current_setting('test054.passo4')::uuid),'contrato v1 sugere somente o passo elegível');
select pg_temp.ok((select status='em_andamento' and precisa_atencao from public.tarefas where id=current_setting('test054.tarefa3')::uuid),
  'classificação concluido não conclui tarefa e mensagem informativa não apaga atenção');
select pg_temp.ok((select count(*)=1 from public.tarefa_eventos where tarefa_id=current_setting('test054.tarefa3')::uuid and tipo='sugestao'),'ausência/encaminhamento/máscara não produzem sugestão');
select pg_temp.ok((select estado='processada' and tentativas=2 from public.vigia_mensagens where gmail_message_id='contrato'),'modelo indisponível incrementa e permite retry');
select pg_temp.ok((select mascara_falhou and tentativas=3 and classificacao is null and fila='esclarecer' and motivo='mascara_falhou' and remetente='[Retido]' and trecho=''
  from public.vigia_mensagens where gmail_message_id='mascara'),'captura de máscara falha conserva metadado sem PII');
select pg_temp.ok(not exists(select 1 from public.vigia_vinculos where gmail_message_id='mascara')
  and not exists(select 1 from public.tarefa_eventos where gmail_message_id='mascara'),'falha persistente impede vínculos e eventos após retry');
select pg_temp.ok(not exists(select 1 from public.tarefa_eventos where public.contem_cpf(resumo||detalhe::text)),'resumo livre do modelo não entra nos eventos');
select pg_temp.ok((select tentativas=1 and estado='enviado' and canal='email' from public.vigia_avisos
  where chave='aviso:msg:contrato:passo:'||current_setting('test054.passo4')),'ack v1 enviado idempotente');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
select public.cancelar_tarefa(current_setting('test054.tarefa2')::uuid,'Encerrada.');
select public.set_automacao('00000000-0000-0000-0000-0000000000d1','vigia',false);
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select pg_temp.ok(public.is_automacao(null) and not public.is_automacao('vigia'),'revogação fecha vigia, preserva identidade');
select pg_temp.negado('select public.vigia_contexto()');
select pg_temp.negado(format('select public.confirmar_passo(%L)',current_setting('test054.passo')));
select pg_temp.negado(format('select public.stub_escrita_sem_guard(%L)',current_setting('test054.x')));
select pg_temp.ok((select count(*)=0 from public.scholarship_holders),'vigia revogado continua sem CPF');
select pg_temp.ok((select count(*)=0 from public.bolsistas_nomes()),'vigia revogado continua sem nomes');
select pg_temp.ok((select count(*)=0 from storage.objects),'vigia revogado continua sem storage');
reset role;

-- Visitante sem login: ACL de todas as RPCs e tabelas novas.
select set_config('request.jwt.claim.sub','',false);
do $$ declare f record; t text;
begin
  for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in (
    'is_automacao','set_automacao','listar_propostas_tarefa_seguras','propor_tarefa','aplicar_proposta_tarefa','confirmar_passo','dispensar_passo',
    'registrar_nota','concluir_tarefa','reabrir_tarefa','cancelar_tarefa','atualizar_prazo','vincular_mensagem',
    'revisar_mensagem','vigia_contexto','vigia_capturar','vigia_registrar','vigia_expurgar') loop
    perform pg_temp.ok(not has_function_privilege('anon',f.oid,'EXECUTE'),'anon sem RPC '||f.proname);
  end loop;
  foreach t in array array['automacoes','tarefas','tarefa_passos','tarefa_passos_regras','tarefa_chaves','tarefa_eventos',
    'vigia_mensagens','vigia_vinculos','vigia_cursor','vigia_execucoes','vigia_avisos'] loop
    perform pg_temp.ok(not has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),'anon sem tabela '||t);
  end loop;
  raise notice '054 OK: segurança, RLS, transições, atomicidade, idempotência, retries e expurgo';
end $$;

-- Antes/depois reproduzível: retiramos SOMENTE a proteção de cada achado numa
-- subtransação descartada. A mesma observação deve provar o defeito; qualquer
-- outra falha aborta o teste. Definições, roles e dados são restaurados pelo
-- rollback da exceção privada P5401, não por uma restauração manual incompleta.
create function pg_temp.provar_defeito(p_mutacao text,p_observacao text,p_nome text) returns void language plpgsql as $$
declare vulneravel boolean;
begin
  begin
    execute p_mutacao;
    execute p_observacao into vulneravel;
    perform pg_temp.ok(vulneravel,'mutação não reproduziu defeito: '||p_nome);
    raise exception using errcode='P5401',message='mutação descartada';
  exception when sqlstate 'P5401' then raise notice 'ANTES confirmado, mutação desfeita: %',p_nome;
  end;
end $$;

select pg_temp.provar_defeito($mut$
  select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
  drop policy tarefa_payload_restrito on public.propostas_agente;
  alter table public.tarefa_passos drop constraint tarefa_passos_evidencia_check;
  update public.tarefa_passos p set evidencia=r.evidencia from public.tarefa_passos_regras r where r.passo_id=p.id;
  select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',true);
  set local role authenticated;
$mut$, $obs$
  select exists(select 1 from public.tarefa_passos where evidencia::text like '%@%')
    and exists(select 1 from public.propostas_agente where tipo='tarefa' and payload::text like '%@%')
$obs$,'regra e payload expostos ao agente');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
set role authenticated;
select pg_temp.ok(not exists(select 1 from public.tarefa_passos_regras)
  and not exists(select 1 from public.tarefa_passos where evidencia::text like '%@%')
  and not exists(select 1 from public.propostas_agente where tipo='tarefa'),'DEPOIS: regra e payload restritos');
reset role;

select pg_temp.provar_defeito(replace(pg_get_functiondef('public._aplicar_proposta(uuid,uuid,uuid)'::regprocedure),
  '  if r.tipo=''tarefa'' then raise exception ''Tarefa exige aplicar_proposta_tarefa.'' using errcode=''22023''; end if;', '')||';'||$mut$
  select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',true);
  set local role authenticated;
  select public.marcar_proposta_aplicada(current_setting('test054.invalida')::uuid);
$mut$,$obs$
  select status='aplicada' and objeto_id is null from public.listar_propostas_tarefa_seguras()
    where id=current_setting('test054.invalida')::uuid
$obs$,'legado aplica tarefa sem objeto');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
set role authenticated;
select pg_temp.invalido(format('select public.marcar_proposta_aplicada(%L)',current_setting('test054.invalida')));
reset role;

select pg_temp.provar_defeito(replace(regexp_replace(pg_get_functiondef('public._vigia_registrar_base(jsonb)'::regprocedure),
  '    -- A falha.*?    -- Erro', '    -- Erro','s'),
  '    if v_estado=''processada'' then',
  '    if v_estado=''processada'' then if msg.motivo=''mascara_falhou'' then continue; end if;')||';'||$mut$
  select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
  select public.set_automacao('00000000-0000-0000-0000-0000000000d1','vigia',true);
  select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',true);
  set local role authenticated;
  select pg_temp.capturar(jsonb_build_object('mensagens',jsonb_build_array(jsonb_build_object(
    'gmail_message_id','mutante-mascara','gmail_thread_id','mutante','recebida_em',now(),'assunto','CPF 52998224725'))));
  select pg_temp.registrar('{"mensagens":[{"gmail_message_id":"mutante-mascara","estado":"erro","motivo":"modelo_indisponivel"}]}');
  select pg_temp.registrar(jsonb_build_object('mensagens',jsonb_build_array(jsonb_build_object(
    'gmail_message_id','mutante-mascara','estado','processada','fila','tarefa','motivo','regra',
    'vinculos',jsonb_build_array(jsonb_build_object('tarefa_id',current_setting('test054.tarefa3')))))));
  reset role;
$mut$,$obs$
  select exists(select 1 from public.vigia_vinculos where gmail_message_id='mutante-mascara')
$obs$,'sem guarda persistente, retry interpreta mensagem retida');
select pg_temp.ok((select mascara_falhou and motivo='mascara_falhou' and classificacao is null
  from public.vigia_mensagens where gmail_message_id='mascara') and not exists(
  select 1 from public.vigia_vinculos where gmail_message_id='mascara'),'DEPOIS: máscara permanece bloqueante');

select pg_temp.provar_defeito(regexp_replace(pg_get_functiondef('public.vigia_capturar(jsonb)'::regprocedure),
  '  if cursor_atual is null then.*?  for m in select','  for m in select','s')||';'||$mut$
  select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
  select public.set_automacao('00000000-0000-0000-0000-0000000000d1','vigia',true);
  select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',true);
  set local role authenticated;
  select public.vigia_capturar(jsonb_build_object('janela',jsonb_build_object('inicio',now()+interval '1 minute',
    'fim',now()+interval '2 minutes','completa',true)));
  reset role;
$mut$,$obs$
  select ultima_recebida_em>current_setting('test054.cursor')::timestamptz from public.vigia_cursor where id=1
$obs$,'janela vazia com lacuna avança cursor');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select public.set_automacao('00000000-0000-0000-0000-0000000000d1','vigia',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
set role authenticated;
select pg_temp.invalido(format('select public.vigia_capturar(%L::jsonb)',jsonb_build_object('janela',
  jsonb_build_object('inicio',now()+interval '1 minute','fim',now()+interval '2 minutes','completa',true))));
reset role;
select pg_temp.ok((select ultima_recebida_em=cursor_inicial from public.vigia_cursor cross join teste054.concorrencia),
  'DEPOIS: janela com lacuna recusada sem avanço');
select pg_temp.ok(not exists(select 1 from public.vigia_mensagens where gmail_message_id='mutante-mascara'),
  'mutantes não deixam dados residuais');
select set_config('request.jwt.claim.sub','',false);

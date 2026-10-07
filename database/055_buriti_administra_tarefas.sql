-- 055 — o Buriti administra as tarefas (decisão do Victor em 07/10/2026).
--
-- Até a 054 o Buriti só PROPUNHA tarefas e o Victor aplicava/confirmava tudo. Agora:
--   1. o Buriti cria a tarefa que o Victor pediu no chat (o pedido é o "ok");
--   2. o Buriti marca como feitos os passos que ELE executa (executor 'buriti');
--   3. o Buriti confirma o passo de uma pessoa quando há prova clara (texto da prova obrigatório);
--   4. o Buriti anota, cobra e pede a atenção do Victor; conclui quando todos os passos estão resolvidos.
--
-- Quem age é o login de AUTOMAÇÃO ("Buriti operador", cadastrado como 'vigia' pela set_automacao):
-- o login de papel 'agente' tem a barreira bloqueia_escrita_do_agente em toda tabela (051), que o cofre
-- protege — ele continua só lendo e propondo. O operador não lê dado financeiro nem bolsista (054).
-- Decisões que seguem só do admin: dispensar passo, reabrir, cancelar, mudar prazo, atribuir/trocar
-- responsável. O admin continua podendo tudo o que podia.
begin;

-- Tarefa criada direto pelo Buriti não tem proposta.
alter table public.tarefas alter column proposta_id drop not null;
alter table public.tarefas add column criada_pelo_buriti boolean not null default false;
alter table public.tarefas add constraint tarefas_origem_check
  check (proposta_id is not null or criada_pelo_buriti);

-- Quem executa cada passo: o próprio Buriti ou uma pessoa (o responsável).
alter table public.tarefa_passos add column executor text not null default 'pessoa'
  check (executor in ('buriti','pessoa'));

-- O operador grava a regra de evidência ao criar a tarefa. A tabela continua sem escrita direta (só RPC)
-- e com leitura só do admin (054); sai apenas da lista de tabelas vedadas à automação.
drop trigger trg_bloqueia_automacao on public.tarefa_passos_regras;

-- Tarefa aberta para o Buriti operar (trava o módulo, como as RPCs da 054).
create function public._buriti_tarefa(p_tarefa uuid) returns public.tarefas
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.tarefas;
begin
  perform public._exigir_vigia();
  perform public._travar_modulo_tarefas();
  select * into t from public.tarefas where id=p_tarefa for update;
  if not found then raise exception 'Tarefa inexistente.' using errcode='22023'; end if;
  if t.status in ('concluida','cancelada') then raise exception 'Tarefa encerrada.' using errcode='22023'; end if;
  return t;
end $$;

create function public._buriti_texto(p text,p_rotulo text) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if coalesce(length(btrim(p)),0)=0 or length(p)>2000 then
    raise exception '% obrigatório, até 2000 caracteres.',p_rotulo using errcode='22023'; end if;
  if public.contem_cpf(p) then raise exception 'CPF não entra em tarefa.' using errcode='22023'; end if;
  perform public._texto_tarefa_seguro(p);
  return btrim(p);
end $$;

-- Responsável pelo nome (o Buriti não lê app_users): exato; senão, prefixo único. Só humano.
create function public._buriti_responsavel(p_nome text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v uuid; n integer;
begin
  select count(*),min(user_id::text)::uuid into n,v from public.app_users
   where role in ('admin','professor') and lower(btrim(display_name))=lower(btrim(p_nome));
  if n=0 then
    select count(*),min(user_id::text)::uuid into n,v from public.app_users
     where role in ('admin','professor') and length(btrim(p_nome))>=3
       and lower(display_name) like lower(btrim(p_nome))||'%';
  end if;
  if n<>1 then raise exception 'Responsável "%" não encontrado ou ambíguo: use o nome como está no sistema.',p_nome
    using errcode='22023'; end if;
  return v;
end $$;

create function public.buriti_criar_tarefa(p jsonb,p_responsavel text default null) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v uuid; s jsonb; passo uuid; i integer:=0; resp uuid; nome text;
begin
  perform public._exigir_vigia();
  perform public._travar_modulo_tarefas();
  perform public._validar_tarefa(p);
  if not exists(select 1 from public.projects where id=(p->>'project_id')::uuid) then
    raise exception 'Projeto inexistente.' using errcode='22023'; end if;
  for s in select value from jsonb_array_elements(p->'passos') loop
    if coalesce(s->>'executor','pessoa') not in ('buriti','pessoa') then
      raise exception 'Executor do passo deve ser buriti ou pessoa.' using errcode='22023'; end if;
  end loop;
  if p_responsavel is not null then
    resp:=public._buriti_responsavel(p_responsavel);
    nome:=public._nome_responsavel(resp);
  end if;
  insert into public.tarefas(project_id,titulo,descricao,responsavel,responsavel_id,prazo,prazo_motivo,proxima_checagem,
    proposta_id,criada_pelo_buriti)
  values((p->>'project_id')::uuid,p->>'titulo',p->>'descricao',coalesce(nome,p->>'responsavel'),resp,
    nullif(p->>'prazo','')::date,p->>'prazo_motivo',nullif(p->>'proxima_checagem','')::date,null,true) returning id into v;
  for s in select value from jsonb_array_elements(p->'passos') loop
    i:=i+1;
    insert into public.tarefa_passos(tarefa_id,ordem,descricao,quem,evidencia,executor)
      values(v,i,s->>'descricao',case when coalesce(s->>'executor','pessoa')='buriti' then 'Buriti' else s->>'quem' end,
        '{}',coalesce(s->>'executor','pessoa')) returning id into passo;
    insert into public.tarefa_passos_regras(passo_id,evidencia) values(passo,coalesce(s->'evidencia','{}'));
  end loop;
  for s in select value from jsonb_array_elements(coalesce(p->'chaves','[]')) loop
    insert into public.tarefa_chaves values(v,s->>'tipo',s->>'valor') on conflict do nothing;
  end loop;
  perform public._evento_tarefa(v,'criada:'||v,'criada','buriti','Tarefa criada pelo Buriti a pedido do Victor.');
  if resp is not null then
    perform public._evento_tarefa(v,'responsavel:'||gen_random_uuid(),'status','buriti','Responsável: '||nome);
  end if;
  return v;
end $$;

-- Passo do próprio Buriti: ele marca como feito.
create function public.buriti_concluir_passo(p_passo uuid,p_nota text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.tarefa_passos; t public.tarefas; nota text; v uuid;
begin
  select * into s from public.tarefa_passos where id=p_passo;
  t:=public._buriti_tarefa(s.tarefa_id);
  select * into s from public.tarefa_passos where id=p_passo for update;
  if s.executor<>'buriti' then raise exception 'Passo de pessoa: use buriti_confirmar_passo com a prova.' using errcode='22023'; end if;
  if s.estado not in ('pendente','sugerido') then raise exception 'Passo já resolvido.' using errcode='22023'; end if;
  nota:=public._buriti_texto(p_nota,'O que foi feito');
  v:=public._evento_tarefa(t.id,'buriti:'||gen_random_uuid(),'confirmacao','buriti','Feito pelo Buriti: '||nota,
    jsonb_build_object('passo_id',s.id,'estado','confirmado'));
  update public.tarefa_passos set estado='confirmado',evento_id=v,confirmado_por=auth.uid(),confirmado_em=now() where id=s.id;
  update public.tarefas set atualizada_em=now() where id=t.id;
end $$;

-- Passo de pessoa: o Buriti confirma com a prova (ex.: o e-mail do Arthur à FUNAPE). Na dúvida ele não
-- chama isto: pede a atenção do Victor (buriti_pedir_atencao).
create function public.buriti_confirmar_passo(p_passo uuid,p_prova text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.tarefa_passos; t public.tarefas; prova text; v uuid;
begin
  select * into s from public.tarefa_passos where id=p_passo;
  t:=public._buriti_tarefa(s.tarefa_id);
  select * into s from public.tarefa_passos where id=p_passo for update;
  if s.executor<>'pessoa' then raise exception 'Passo do Buriti: use buriti_concluir_passo.' using errcode='22023'; end if;
  if s.estado not in ('pendente','sugerido') then raise exception 'Passo já resolvido.' using errcode='22023'; end if;
  prova:=public._buriti_texto(p_prova,'Prova');
  v:=public._evento_tarefa(t.id,'buriti:'||gen_random_uuid(),'confirmacao','buriti','Confirmado pelo Buriti: '||prova,
    jsonb_build_object('passo_id',s.id,'estado','confirmado','prova',prova));
  update public.tarefa_passos set estado='confirmado',evento_id=v,confirmado_por=auth.uid(),confirmado_em=now() where id=s.id;
  -- Se só este passo pedia atenção, a confirmação resolve; outro motivo continua de pé.
  update public.tarefas set atualizada_em=now(),
    precisa_atencao=precisa_atencao and coalesce(motivo_atencao,'') not like '%registrou um passo; confirmar',
    motivo_atencao=case when coalesce(motivo_atencao,'') like '%registrou um passo; confirmar' then null else motivo_atencao end
   where id=t.id;
end $$;

-- Anotação ou cobrança (ao responsável) na linha do tempo.
create function public.buriti_anotar(p_tarefa uuid,p_texto text,p_cobranca boolean default false) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.tarefas; texto text;
begin
  t:=public._buriti_tarefa(p_tarefa);
  texto:=public._buriti_texto(p_texto,'Texto');
  perform public._evento_tarefa(t.id,'buriti:'||gen_random_uuid(),
    case when coalesce(p_cobranca,false) then 'alerta_prazo' else 'nota' end,'buriti',
    case when coalesce(p_cobranca,false) then 'Cobrança: ' else '' end||texto);
  update public.tarefas set atualizada_em=now() where id=t.id;
end $$;

-- Algo travou ou é decisão do Victor: o cartão ganha "precisa de você".
create function public.buriti_pedir_atencao(p_tarefa uuid,p_motivo text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.tarefas; motivo text;
begin
  t:=public._buriti_tarefa(p_tarefa);
  motivo:=public._buriti_texto(p_motivo,'Motivo');
  perform public._evento_tarefa(t.id,'buriti:'||gen_random_uuid(),'nota','buriti','Precisa do Victor: '||motivo);
  update public.tarefas set precisa_atencao=true,motivo_atencao=left(motivo,500),atualizada_em=now() where id=t.id;
end $$;

-- Concluir quando todos os passos estão confirmados ou dispensados.
create function public.buriti_concluir_tarefa(p_tarefa uuid,p_nota text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.tarefas; nota text;
begin
  t:=public._buriti_tarefa(p_tarefa);
  if exists(select 1 from public.tarefa_passos where tarefa_id=t.id and estado not in ('confirmado','dispensado')) then
    raise exception 'Há passos em aberto.' using errcode='22023'; end if;
  nota:=public._buriti_texto(p_nota,'Fechamento');
  perform public._evento_tarefa(t.id,'status:'||gen_random_uuid(),'status','buriti','Concluída pelo Buriti: '||nota,
    jsonb_build_object('antes',t.status,'depois','concluida'));
  update public.tarefas set status='concluida',concluida_por=auth.uid(),concluida_em=now(),
    precisa_atencao=false,motivo_atencao=null,atualizada_em=now() where id=t.id;
end $$;

-- O responsável registra "feito" só nos passos de pessoa (o passo do Buriti é do Buriti).
create or replace function public.registrar_feito(p_passo uuid,p_nota text,p_link text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.tarefa_passos; t public.tarefas; nome text; evento uuid;
begin
  select * into s from public.tarefa_passos where id=p_passo;
  t:=public._humano_tarefa(s.tarefa_id,false);
  if not public.is_admin() and t.responsavel_id is distinct from auth.uid() then
    raise exception 'Só o responsável ou admin registra que fez.' using errcode='42501'; end if;
  select * into s from public.tarefa_passos where id=p_passo for update;
  if s.executor='buriti' then raise exception 'Este passo é do Buriti.' using errcode='22023'; end if;
  if t.status in ('concluida','cancelada') or s.estado not in ('pendente','sugerido') then
    raise exception 'Passo ou tarefa encerrados.' using errcode='22023'; end if;
  if coalesce(length(btrim(p_nota)),0)=0 or length(p_nota)>2000 then
    raise exception 'Nota obrigatória, até 2000 caracteres.' using errcode='22023'; end if;
  if p_link is not null and (length(p_link)>500 or p_link !~ '^https://[^/[:space:]?#]+[^[:space:]]*$') then
    raise exception 'Link deve começar com https:// e ter até 500 caracteres.' using errcode='22023'; end if;
  nome:=public._nome_responsavel(auth.uid());
  evento:=public._evento_tarefa(t.id,'feito:'||gen_random_uuid(),'sugestao','humano',
    'Feito por '||nome||': '||btrim(p_nota),
    jsonb_build_object('passo_id',s.id,'nota',btrim(p_nota),'link',p_link,'por',nome));
  update public.tarefa_passos set estado='sugerido',evento_id=evento,ultimo_feito_id=evento where id=s.id;
  update public.tarefas set precisa_atencao=true,motivo_atencao=split_part(nome,' ',1)||' registrou um passo; confirmar',
    atualizada_em=now() where id=t.id;
end $$;

-- Permissões: só usuário logado; as funções internas (prefixo _) nem isso.
do $$
declare f text;
begin
  foreach f in array array['public._buriti_tarefa(uuid)','public._buriti_texto(text,text)','public._buriti_responsavel(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated',f);
  end loop;
  foreach f in array array['public.buriti_criar_tarefa(jsonb,text)','public.buriti_concluir_passo(uuid,text)',
    'public.buriti_confirmar_passo(uuid,text)','public.buriti_anotar(uuid,text,boolean)',
    'public.buriti_pedir_atencao(uuid,text)','public.buriti_concluir_tarefa(uuid,text)',
    'public.registrar_feito(uuid,text,text)'] loop
    execute format('revoke all on function %s from public, anon',f);
    execute format('grant execute on function %s to authenticated',f);
  end loop;
end $$;

-- Asserções: atributos de segurança e ACL das funções novas.
do $$
declare r record;
begin
  for r in select p.oid,p.proname,p.prosecdef,p.proconfig from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname in ('_buriti_tarefa','_buriti_texto','_buriti_responsavel',
      'buriti_criar_tarefa','buriti_concluir_passo','buriti_confirmar_passo','buriti_anotar','buriti_pedir_atencao',
      'buriti_concluir_tarefa','registrar_feito') loop
    if not r.prosecdef or not ('search_path=public, pg_temp'=any(r.proconfig)) or has_function_privilege('anon',r.oid,'EXECUTE') then
      raise exception '055: atributos/ACL incorretos em %',r.proname; end if;
    if left(r.proname,1)='_' and has_function_privilege('authenticated',r.oid,'EXECUTE') then
      raise exception '055: função interna exposta: %',r.proname; end if;
  end loop;
  if not exists(select 1 from pg_constraint where conname='tarefas_origem_check') then
    raise exception '055: falta tarefas_origem_check'; end if;
end $$;

commit;

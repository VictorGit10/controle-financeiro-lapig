-- 057 — tarefas mais simples de responder e de corrigir (pedido do Victor em 08/10/2026).
--
-- 1. O responsável ATUALIZA a tarefa: escolhe a situação (em andamento, esperando alguém, travado, feito),
--    escreve o que aconteceu e, se quiser, põe um link e marca os passos que concluiu. Cada atualização é um
--    evento 'atualizacao' na linha do tempo, que o Victor e o Buriti leem no mesmo lugar. "Feito" marca todos
--    os passos de pessoa ainda abertos como sugeridos: confirmar continua sendo do Victor ou do Buriti com prova.
-- 2. O Buriti (login de automação, 055) CORRIGE a tarefa que ele criou: título, texto, prazo, responsável,
--    passos ainda não começados, dispensar passo e cancelar. Só quando o Victor pede no chat (AGENTS.md); cada
--    mudança vira evento 'edicao' com o antes e o depois. Tarefa criada por humano continua só do admin.
-- 3. AVISOS só no essencial: resumo diário, prazo que vence hoje ou venceu, e falha do vigia (no máximo um a
--    cada 12 h). O resto (mensagem para revisar, passo sugerido, prazo em D-5/D-2) entra no resumo diário e
--    fica registrado como 'resumido' — nada some, só deixa de virar um e-mail avulso.
-- 4. vigia_contexto traz o conteúdo do resumo diário (mensagens a revisar, situação das tarefas e o que
--    mudou nas últimas 24 h), para o e-mail das 8h dizer o que é, e não só "consulte a página".
begin;

-- ---------- 1. Atualização pelo responsável ----------
alter table public.tarefas add column situacao text
  check (situacao in ('em_andamento','esperando','travado','feito'));
alter table public.tarefas add column ultima_atualizacao_id uuid references public.tarefa_eventos(id);

alter table public.tarefa_eventos drop constraint tarefa_eventos_tipo_check;
alter table public.tarefa_eventos add constraint tarefa_eventos_tipo_check check(tipo in
  ('criada','mensagem','sugestao','confirmacao','nota','alerta_prazo','status','vinculo','atualizacao','edicao'));

create function public._rotulo_situacao(p text) returns text
language sql immutable security definer set search_path=public,pg_temp as $$
  select case p when 'em_andamento' then 'Em andamento' when 'esperando' then 'Esperando alguém'
    when 'travado' then 'Travado' when 'feito' then 'Feito' end;
$$;

-- Motivos de "precisa de você" que a própria atualização põe e tira. Os demais (pedido do Buriti, prazo,
-- mensagem do vigia) só saem por quem os resolve.
create function public._motivo_automatico(p text) returns boolean
language sql immutable security definer set search_path=public,pg_temp as $$
  select p is null or p like '%; confirmar' or p like '%: travado';
$$;

-- Sem passo da pessoa esperando confirmação, o aviso "; confirmar" sai. Vale para confirmar e dispensar,
-- pelo Victor na página ou pelo Buriti.
create function public._limpar_confirmar(p_tarefa uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.tarefa_passos where tarefa_id=p_tarefa and estado='sugerido' and ultimo_feito_id is not null) then
    update public.tarefas set precisa_atencao=false,motivo_atencao=null
     where id=p_tarefa and coalesce(motivo_atencao,'') like '%; confirmar';
  end if;
end $$;

-- Decisão do admin (054) com duas correções: passo apagado entre a leitura e o lock é recusado, e o aviso de
-- confirmação sai quando não resta passo marcado pela pessoa.
create or replace function public._decidir_passo(p_passo uuid,p_nota text,p_estado text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.tarefa_passos; t public.tarefas; v uuid;
begin
  select * into s from public.tarefa_passos where id=p_passo;
  t:=public._humano_tarefa(s.tarefa_id);
  select * into s from public.tarefa_passos where id=p_passo for update;
  if not found then raise exception 'Passo inexistente.' using errcode='22023'; end if;
  if t.status in ('concluida','cancelada') or s.estado in ('confirmado','dispensado') then
    raise exception 'Passo ou tarefa encerrados.' using errcode='22023'; end if;
  v:=public._evento_tarefa(t.id,'humano:'||gen_random_uuid(),'confirmacao','humano',
    coalesce(nullif(btrim(p_nota),''),'Passo '||p_estado||'.'),jsonb_build_object('passo_id',s.id,'estado',p_estado));
  update public.tarefa_passos set estado=p_estado,evento_id=v,confirmado_por=auth.uid(),confirmado_em=now() where id=s.id;
  update public.tarefas set atualizada_em=now() where id=t.id;
  perform public._limpar_confirmar(t.id);
end $$;

create function public.registrar_atualizacao(p_tarefa uuid,p_situacao text,p_texto text,
  p_link text default null,p_passos uuid[] default null) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.tarefas; nome text; primeiro text; texto text; evento uuid; marcados uuid[]; motivo text;
begin
  t:=public._humano_tarefa(p_tarefa,false);
  if not public.is_admin() and t.responsavel_id is distinct from auth.uid() then
    raise exception 'Só o responsável ou admin atualiza a tarefa.' using errcode='42501'; end if;
  if t.status in ('concluida','cancelada') then raise exception 'Tarefa encerrada.' using errcode='22023'; end if;
  if p_situacao is null or public._rotulo_situacao(p_situacao) is null then
    raise exception 'Situação inválida: use em_andamento, esperando, travado ou feito.' using errcode='22023'; end if;
  if coalesce(length(btrim(p_texto)),0)=0 or length(p_texto)>2000 then
    raise exception 'Escreva o que aconteceu (até 2000 caracteres).' using errcode='22023'; end if;
  texto:=btrim(p_texto);
  if public.contem_cpf(texto) then raise exception 'CPF não entra em tarefa.' using errcode='22023'; end if;
  if p_link is not null and (length(p_link)>500 or p_link !~ '^https://[^/[:space:]?#]+[^[:space:]]*$') then
    raise exception 'Link deve começar com https:// e ter até 500 caracteres.' using errcode='22023'; end if;
  -- Passos marcados: só de pessoa, desta tarefa e ainda abertos. "Feito" marca todos os abertos.
  perform 1 from public.tarefa_passos where tarefa_id=t.id order by id for update;
  if p_passos is not null and exists(select 1 from unnest(p_passos) x(id) where not exists(
    select 1 from public.tarefa_passos s where s.id=x.id and s.tarefa_id=t.id and s.executor='pessoa'
      and s.estado in ('pendente','sugerido'))) then
    raise exception 'Passo de outra tarefa, do Buriti ou já resolvido.' using errcode='22023'; end if;
  select coalesce(array_agg(s.id order by s.ordem),'{}') into marcados from public.tarefa_passos s
   where s.tarefa_id=t.id and s.executor='pessoa' and s.estado in ('pendente','sugerido')
     and (p_situacao='feito' or s.id=any(coalesce(p_passos,'{}')));
  nome:=coalesce(public._nome_responsavel(auth.uid()),'Usuário');
  primeiro:=split_part(nome,' ',1);
  evento:=public._evento_tarefa(t.id,'atualizacao:'||gen_random_uuid(),'atualizacao','humano',
    nome||' · '||public._rotulo_situacao(p_situacao)||': '||texto,
    jsonb_build_object('situacao',p_situacao,'texto',texto,'link',p_link,'por',nome,'passos',to_jsonb(marcados)));
  update public.tarefa_passos set estado='sugerido',evento_id=evento,ultimo_feito_id=evento where id=any(marcados);
  -- "Precisa de você": travado pede o Victor; passo marcado pede confirmação; saiu do travado, o aviso de
  -- travado sai (ou volta a ser o de confirmar, se ainda há passo da pessoa esperando). Motivo que não é
  -- destes dois automáticos (pedido do Buriti, prazo, mensagem) nunca é sobrescrito: segue até alguém resolver.
  if not public._motivo_automatico(t.motivo_atencao) then motivo:=t.motivo_atencao;
  elsif p_situacao='travado' then motivo:=primeiro||': travado';
  elsif cardinality(marcados)>0 then motivo:=primeiro||' atualizou; confirmar';
  elsif coalesce(t.motivo_atencao,'') like '%: travado' then
    motivo:=case when exists(select 1 from public.tarefa_passos where tarefa_id=t.id and estado='sugerido'
      and ultimo_feito_id is not null) then primeiro||' atualizou; confirmar' end;
  else motivo:=t.motivo_atencao;
  end if;
  update public.tarefas set situacao=p_situacao,ultima_atualizacao_id=evento,
    status=case when p_situacao='esperando' then 'aguardando_terceiro' else 'em_andamento' end,
    precisa_atencao=case when motivo is null then false
      when motivo is distinct from t.motivo_atencao then true else precisa_atencao end,
    motivo_atencao=motivo,atualizada_em=now() where id=t.id;
  return evento;
end $$;

-- O aviso "registrou/atualizou; confirmar" sai quando não resta passo da pessoa esperando confirmação.
create or replace function public.buriti_confirmar_passo(p_passo uuid,p_prova text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.tarefa_passos; t public.tarefas; prova text; v uuid;
begin
  select * into s from public.tarefa_passos where id=p_passo;
  t:=public._buriti_tarefa(s.tarefa_id);
  select * into s from public.tarefa_passos where id=p_passo for update;
  if not found then raise exception 'Passo inexistente.' using errcode='22023'; end if;
  if s.executor<>'pessoa' then raise exception 'Passo do Buriti: use buriti_concluir_passo.' using errcode='22023'; end if;
  if s.estado not in ('pendente','sugerido') then raise exception 'Passo já resolvido.' using errcode='22023'; end if;
  prova:=public._buriti_texto(p_prova,'Prova');
  v:=public._evento_tarefa(t.id,'buriti:'||gen_random_uuid(),'confirmacao','buriti','Confirmado pelo Buriti: '||prova,
    jsonb_build_object('passo_id',s.id,'estado','confirmado','prova',prova));
  update public.tarefa_passos set estado='confirmado',evento_id=v,confirmado_por=auth.uid(),confirmado_em=now() where id=s.id;
  update public.tarefas set atualizada_em=now() where id=t.id;
  perform public._limpar_confirmar(t.id);
end $$;

-- ---------- 2. O Buriti corrige a tarefa que criou ----------
create function public._buriti_tarefa_propria(p_tarefa uuid) returns public.tarefas
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.tarefas;
begin
  t:=public._buriti_tarefa(p_tarefa);
  if not t.criada_pelo_buriti then
    raise exception 'Só tarefa criada pelo Buriti: esta é do Victor (use a página).' using errcode='42501'; end if;
  return t;
end $$;

create function public.buriti_editar_tarefa(p_tarefa uuid,p jsonb,p_motivo text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.tarefas; motivo text; k text; antes jsonb:='{}'; depois jsonb:='{}';
  v_titulo text; v_descricao text; v_prazo date; v_prazo_motivo text; v_resp uuid; v_nome text;
begin
  t:=public._buriti_tarefa_propria(p_tarefa);
  motivo:=public._buriti_texto(p_motivo,'Motivo');
  if p is null or jsonb_typeof(p)<>'object' or p='{}'::jsonb then
    raise exception 'Informe ao menos um campo.' using errcode='22023'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('titulo','descricao','prazo','prazo_motivo','responsavel') then
      raise exception 'Campo não editável: %',k using errcode='22023'; end if;
    if jsonb_typeof(p->k) not in ('string','null') then raise exception 'Campo inválido: %',k using errcode='22023'; end if;
  end loop;
  if public.contem_cpf(p::text) then raise exception 'CPF não entra em tarefa.' using errcode='22023'; end if;
  v_titulo:=t.titulo; v_descricao:=t.descricao; v_prazo:=t.prazo; v_prazo_motivo:=t.prazo_motivo;
  v_resp:=t.responsavel_id; v_nome:=t.responsavel;
  if p ? 'titulo' then
    v_titulo:=btrim(p->>'titulo');
    if coalesce(length(v_titulo),0) not between 1 and 300 then raise exception 'Título de 1 a 300 caracteres.' using errcode='22023'; end if;
  end if;
  if p ? 'descricao' then
    v_descricao:=nullif(btrim(p->>'descricao'),'');
    if length(v_descricao)>10000 then raise exception 'Descrição até 10000 caracteres.' using errcode='22023'; end if;
  end if;
  if p ? 'prazo' then v_prazo:=nullif(p->>'prazo','')::date; end if;
  if p ? 'prazo_motivo' then
    v_prazo_motivo:=nullif(btrim(p->>'prazo_motivo'),'');
    if length(v_prazo_motivo)>1000 then raise exception 'Motivo do prazo até 1000 caracteres.' using errcode='22023'; end if;
  end if;
  if p ? 'responsavel' then
    if nullif(btrim(p->>'responsavel'),'') is null then v_resp:=null; v_nome:=null;
    else v_resp:=public._buriti_responsavel(p->>'responsavel'); v_nome:=public._nome_responsavel(v_resp); end if;
  end if;
  perform public._texto_tarefa_seguro(coalesce(v_titulo,'')||coalesce(v_descricao,'')||coalesce(v_prazo_motivo,''));
  if v_titulo is distinct from t.titulo then antes:=antes||jsonb_build_object('titulo',t.titulo); depois:=depois||jsonb_build_object('titulo',v_titulo); end if;
  if v_descricao is distinct from t.descricao then antes:=antes||jsonb_build_object('descricao',t.descricao); depois:=depois||jsonb_build_object('descricao',v_descricao); end if;
  if v_prazo is distinct from t.prazo then antes:=antes||jsonb_build_object('prazo',t.prazo); depois:=depois||jsonb_build_object('prazo',v_prazo); end if;
  if v_prazo_motivo is distinct from t.prazo_motivo then antes:=antes||jsonb_build_object('prazo_motivo',t.prazo_motivo); depois:=depois||jsonb_build_object('prazo_motivo',v_prazo_motivo); end if;
  if v_resp is distinct from t.responsavel_id then antes:=antes||jsonb_build_object('responsavel',t.responsavel); depois:=depois||jsonb_build_object('responsavel',v_nome); end if;
  if depois='{}'::jsonb then raise exception 'Nada mudou.' using errcode='22023'; end if;
  update public.tarefas set titulo=v_titulo,descricao=v_descricao,prazo=v_prazo,prazo_motivo=v_prazo_motivo,
    responsavel_id=v_resp,responsavel=v_nome,atualizada_em=now() where id=t.id;
  perform public._evento_tarefa(t.id,'edicao:'||gen_random_uuid(),'edicao','buriti',
    'Editada pelo Buriti a pedido do Victor: '||motivo,jsonb_build_object('antes',antes,'depois',depois));
end $$;

-- Troca os passos que ninguém começou (pendentes, sem registro da pessoa nem evidência). Os já sugeridos,
-- confirmados ou dispensados ficam como estão, com a numeração deles; os novos entram depois.
create function public.buriti_editar_passos(p_tarefa uuid,p_passos jsonb,p_motivo text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.tarefas; motivo text; s jsonb; base integer; i integer:=0; passo uuid; antes jsonb; depois jsonb:='[]';
begin
  t:=public._buriti_tarefa_propria(p_tarefa);
  motivo:=public._buriti_texto(p_motivo,'Motivo');
  if p_passos is null or jsonb_typeof(p_passos)<>'array' or jsonb_array_length(p_passos)>50 then
    raise exception 'Passos: lista de até 50.' using errcode='22023'; end if;
  for s in select value from jsonb_array_elements(p_passos) loop
    if jsonb_typeof(s)<>'object' or jsonb_typeof(s->'descricao') is distinct from 'string'
      or length(btrim(s->>'descricao')) not between 1 and 1000
      or coalesce(s->>'executor','pessoa') not in ('buriti','pessoa')
      or (s ? 'quem' and jsonb_typeof(s->'quem') not in ('string','null')) or length(s->>'quem')>300
      or (s ? 'evidencia' and jsonb_typeof(s->'evidencia')<>'object') then
      raise exception 'Passo inválido.' using errcode='22023'; end if;
    if public.contem_cpf(s::text) then raise exception 'CPF não entra em tarefa.' using errcode='22023'; end if;
    perform public._texto_tarefa_seguro(coalesce(s->>'descricao','')||coalesce(s->>'quem',''));
  end loop;
  perform 1 from public.tarefa_passos where tarefa_id=t.id order by id for update;
  select coalesce(jsonb_agg(jsonb_build_object('ordem',ordem,'descricao',descricao) order by ordem),'[]') into antes
    from public.tarefa_passos where tarefa_id=t.id and estado='pendente' and ultimo_feito_id is null and evento_id is null;
  delete from public.tarefa_passos_regras r using public.tarefa_passos x
   where r.passo_id=x.id and x.tarefa_id=t.id and x.estado='pendente' and x.ultimo_feito_id is null and x.evento_id is null;
  delete from public.tarefa_passos
   where tarefa_id=t.id and estado='pendente' and ultimo_feito_id is null and evento_id is null;
  select coalesce(max(ordem),0) into base from public.tarefa_passos where tarefa_id=t.id;
  for s in select value from jsonb_array_elements(p_passos) loop
    i:=i+1;
    insert into public.tarefa_passos(tarefa_id,ordem,descricao,quem,evidencia,executor)
      values(t.id,base+i,btrim(s->>'descricao'),
        case when coalesce(s->>'executor','pessoa')='buriti' then 'Buriti' else s->>'quem' end,
        '{}',coalesce(s->>'executor','pessoa')) returning id into passo;
    insert into public.tarefa_passos_regras(passo_id,evidencia) values(passo,coalesce(s->'evidencia','{}'));
    depois:=depois||jsonb_build_array(jsonb_build_object('ordem',base+i,'descricao',btrim(s->>'descricao')));
  end loop;
  if not exists(select 1 from public.tarefa_passos where tarefa_id=t.id) then
    raise exception 'A tarefa precisa de ao menos um passo.' using errcode='22023'; end if;
  update public.tarefas set atualizada_em=now() where id=t.id;
  perform public._evento_tarefa(t.id,'edicao:'||gen_random_uuid(),'edicao','buriti',
    'Passos refeitos pelo Buriti a pedido do Victor: '||motivo,jsonb_build_object('antes',antes,'depois',depois));
end $$;

create function public.buriti_dispensar_passo(p_passo uuid,p_motivo text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.tarefa_passos; t public.tarefas; motivo text; v uuid;
begin
  select * into s from public.tarefa_passos where id=p_passo;
  t:=public._buriti_tarefa_propria(s.tarefa_id);
  select * into s from public.tarefa_passos where id=p_passo for update;
  if not found then raise exception 'Passo inexistente.' using errcode='22023'; end if;
  if s.estado not in ('pendente','sugerido') then raise exception 'Passo já resolvido.' using errcode='22023'; end if;
  motivo:=public._buriti_texto(p_motivo,'Motivo');
  v:=public._evento_tarefa(t.id,'buriti:'||gen_random_uuid(),'confirmacao','buriti',
    'Passo dispensado pelo Buriti a pedido do Victor: '||motivo,jsonb_build_object('passo_id',s.id,'estado','dispensado'));
  update public.tarefa_passos set estado='dispensado',evento_id=v,confirmado_por=auth.uid(),confirmado_em=now() where id=s.id;
  update public.tarefas set atualizada_em=now() where id=t.id;
  perform public._limpar_confirmar(t.id);
end $$;

create function public.buriti_cancelar_tarefa(p_tarefa uuid,p_motivo text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.tarefas; motivo text;
begin
  t:=public._buriti_tarefa_propria(p_tarefa);
  motivo:=public._buriti_texto(p_motivo,'Motivo');
  perform public._evento_tarefa(t.id,'status:'||gen_random_uuid(),'status','buriti',
    'Cancelada pelo Buriti a pedido do Victor: '||motivo,jsonb_build_object('antes',t.status,'depois','cancelada'));
  update public.tarefas set status='cancelada',precisa_atencao=false,motivo_atencao=null,atualizada_em=now() where id=t.id;
end $$;

-- ---------- 3. Avisos só no essencial ----------
alter table public.vigia_avisos drop constraint vigia_avisos_estado_check;
alter table public.vigia_avisos add constraint vigia_avisos_estado_check
  check (estado in ('pendente','enviado','falhou','resumido'));

create function public._vigia_aviso_essencial() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.tipo='resumo_diario' then return new; end if;
  if new.tipo='alerta_prazo' and new.chave ~ ':(D-0|vencido)$' then return new; end if;
  if new.tipo='saude' and not exists(select 1 from public.vigia_avisos a where a.tipo='saude'
      and a.estado<>'resumido' and a.criado_em>now()-interval '12 hours') then return new; end if;
  new.estado:='resumido';
  return new;
end $$;
create trigger trg_vigia_aviso_essencial before insert on public.vigia_avisos
for each row execute function public._vigia_aviso_essencial();

-- O que já estava na fila para virar e-mail avulso entra no próximo resumo. Falha do vigia ainda não
-- entregue fica na fila: é aviso essencial.
update public.vigia_avisos set estado='resumido',atualizado_em=now()
 where estado in ('pendente','falhou') and tipo not in ('resumo_diario','saude')
   and not (tipo='alerta_prazo' and chave ~ ':(D-0|vencido)$');

-- ---------- 4. Conteúdo do resumo diário ----------
create or replace function public.vigia_contexto() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c jsonb; ultima timestamptz;
begin
  perform public._exigir_vigia();
  c:=public._vigia_contexto_base();
  select max(terminada_em) into ultima from public.vigia_execucoes;
  return c||jsonb_build_object('versao_esquema',1,'cursor_em',c->'cursor','pendentes',c->'mensagens',
    'alertas_emitidos',coalesce((select jsonb_agg(chave) from public.tarefa_eventos where tipo='alerta_prazo'),'[]'),
    'esclarecer',(select count(*) from public.vigia_mensagens where fila='esclarecer'),
    'rotina',(select count(*) from public.vigia_mensagens where fila='rotina'),
    'saude',case when ultima is null then 'indisponivel' when ultima<now()-interval '2 hours' then 'atrasado' else 'ok' end,
    -- Resumo diário (057): o que a mensagem é e o que a tarefa disse, para o e-mail das 8h dizer o conteúdo.
    'esclarecer_lista',coalesce((select jsonb_agg(jsonb_build_object('gmail_thread_id',m.gmail_thread_id,
      'recebida_em',m.recebida_em,'remetente',m.remetente,'assunto',m.assunto,'motivo',m.motivo,
      'classificacao',m.classificacao) order by m.recebida_em desc)
      from (select * from public.vigia_mensagens where fila='esclarecer' and expurgada_em is null
        order by recebida_em desc limit 40) m),'[]'),
    'resumo_tarefas',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'titulo',t.titulo,'centro_custo',pr.code,
      'responsavel',t.responsavel,'status',t.status,'situacao',t.situacao,'prazo',t.prazo,
      'precisa_atencao',t.precisa_atencao,'motivo_atencao',t.motivo_atencao,
      'ultima_atualizacao',(select jsonb_build_object('resumo',e.resumo,'ocorrido_em',e.ocorrido_em)
        from public.tarefa_eventos e where e.id=t.ultima_atualizacao_id),
      'passos_abertos',(select count(*) from public.tarefa_passos s where s.tarefa_id=t.id and s.estado in ('pendente','sugerido')))
      order by t.prazo nulls last,t.criada_em)
      from public.tarefas t join public.projects pr on pr.id=t.project_id
      where t.status in ('em_andamento','aguardando_terceiro')),'[]'),
    'novidades',coalesce((select jsonb_agg(jsonb_build_object('tarefa_id',e.tarefa_id,'titulo',t.titulo,
      'tipo',e.tipo,'origem',e.origem,'resumo',e.resumo,'ocorrido_em',e.ocorrido_em) order by e.criado_em desc)
      from (select * from public.tarefa_eventos where criado_em>now()-interval '26 hours'
        and not (origem='vigia' and tipo='mensagem') order by criado_em desc limit 60) e
      join public.tarefas t on t.id=e.tarefa_id),'[]'));
end $$;

-- ---------- Permissões ----------
do $$
declare f text;
begin
  foreach f in array array['public._rotulo_situacao(text)','public._buriti_tarefa_propria(uuid)',
    'public._vigia_aviso_essencial()','public._motivo_automatico(text)','public._limpar_confirmar(uuid)',
    'public._decidir_passo(uuid,text,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated',f);
  end loop;
  foreach f in array array['public.registrar_atualizacao(uuid,text,text,text,uuid[])',
    'public.buriti_editar_tarefa(uuid,jsonb,text)','public.buriti_editar_passos(uuid,jsonb,text)',
    'public.buriti_dispensar_passo(uuid,text)','public.buriti_cancelar_tarefa(uuid,text)',
    'public.buriti_confirmar_passo(uuid,text)','public.vigia_contexto()'] loop
    execute format('revoke all on function %s from public, anon',f);
    execute format('grant execute on function %s to authenticated',f);
  end loop;
end $$;

-- Asserções: atributos de segurança, ACL e restrições novas.
do $$
declare r record;
begin
  for r in select p.oid,p.proname,p.prosecdef,p.proconfig from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname in ('_rotulo_situacao','_buriti_tarefa_propria',
      '_motivo_automatico','_limpar_confirmar','_decidir_passo',
      '_vigia_aviso_essencial','registrar_atualizacao','buriti_editar_tarefa','buriti_editar_passos',
      'buriti_dispensar_passo','buriti_cancelar_tarefa','buriti_confirmar_passo','vigia_contexto') loop
    if not r.prosecdef or not ('search_path=public, pg_temp'=any(r.proconfig)) or has_function_privilege('anon',r.oid,'EXECUTE') then
      raise exception '057: atributos/ACL incorretos em %',r.proname; end if;
    if left(r.proname,1)='_' and has_function_privilege('authenticated',r.oid,'EXECUTE') then
      raise exception '057: função interna exposta: %',r.proname; end if;
    if left(r.proname,1)<>'_' and not has_function_privilege('authenticated',r.oid,'EXECUTE') then
      raise exception '057: authenticated sem EXECUTE em %',r.proname; end if;
  end loop;
  if not exists(select 1 from pg_trigger where tgname='trg_vigia_aviso_essencial') then
    raise exception '057: falta o gatilho dos avisos'; end if;
  if exists(select 1 from public.vigia_avisos where estado in ('pendente','falhou') and tipo not in ('resumo_diario','alerta_prazo','saude')) then
    raise exception '057: aviso avulso ainda na fila'; end if;
end $$;
commit;

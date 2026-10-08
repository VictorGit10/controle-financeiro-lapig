-- AUTOCONFERIDO, só base sintética (stub-051, 051, 052, 054, 055, stub-056, 056).
-- Usa o papel authenticated de verdade + JWT para exercitar ACL, RLS e gatilhos.
-- ROLLBACK mantém o roteiro repetível e não deixa objetos financeiros de teste.
\set ON_ERROR_STOP on
begin;
set local role authenticated;

-- 1: agente cria plano, refazer substitui pendente; gatilho barra upsert.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',true);
do $$
declare
  x uuid := (select id from public.projects where code='51.X');
  p uuid;
  anterior uuid;
  erro text;
begin
  anterior:=public.criar_proposta('plano',x,'Plano sintético original',
    '{"versao":1,"tipo":"original"}',x::text||'/original.docx','056:original');
  p:=public.criar_proposta('plano',x,'Plano sintético refeito',
    '{"versao":1,"tipo":"original"}',x::text||'/original.docx','056:original');
  if (select status from public.propostas_agente where id=anterior) is distinct from 'obsoleta'
     or (select tipo from public.propostas_agente where id=p) is distinct from 'plano' then
    raise exception '056 FALHOU: criação/substituição da proposta de plano';
  end if;
  perform set_config('test056.proposta',p::text,true);
  begin
    perform public.upsert_plano_trabalho(jsonb_build_object('project_id',x,'titulo','agente barrado','proposta_id',p));
    raise exception '056 FALHOU: agente gravou plano';
  exception when insufficient_privilege then
    get stacked diagnostics erro=message_text;
    if erro not like 'O agente não grava em %' then raise exception '056 FALHOU: recusa não veio do gatilho: %',erro; end if;
  end;
  if exists(select 1 from public.planos_trabalho where titulo='agente barrado') then
    raise exception '056 FALHOU: gravação parcial pelo agente';
  end if;
  raise notice '056 BLOCO 1 ok: agente cria/substitui plano e gatilho barra upsert';
end $$;

-- 2: professor grava cabeçalho + rubricas + desembolsos e proposta juntos.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',true);
do $$
declare
  x uuid := (select id from public.projects where code='51.X');
  p uuid := current_setting('test056.proposta')::uuid;
  plano uuid;
begin
  plano:=public.upsert_plano_trabalho(jsonb_build_object(
    'project_id',x,'tipo','original','titulo','056 aplicado','proposta_id',p,
    'valor_total_plano',1200,'data_documento','2026-10-08',
    'rubricas','[{"rubrica_code":"e","descricao_livre":"Material sintético","valor_previsto":1200}]'::jsonb,
    'desembolsos','[{"parcela":1,"data_prevista":"2026-11-01","valor":1200}]'::jsonb));
  if not exists(select 1 from public.planos_trabalho where id=plano and ativo and valor_total_plano=1200)
    or not exists(select 1 from public.plano_rubricas where plano_id=plano and valor_previsto=1200)
    or not exists(select 1 from public.plano_desembolsos where plano_id=plano and valor=1200)
    or not exists(select 1 from public.propostas_agente where id=p and status='aplicada' and objeto_id=plano
      and decidida_por=auth.uid() and decidida_em is not null) then
    raise exception '056 FALHOU: plano/proposta não aplicados juntos';
  end if;
  perform set_config('test056.plano',plano::text,true);
  raise notice '056 BLOCO 2 ok: humano aplica cabeçalho, rubricas, desembolsos e proposta atomicamente';
end $$;

-- 3: não pendente recusa INSERT e UPDATE; nada parcial, inclusive ativação.
do $$
declare
  x uuid := (select id from public.projects where code='51.X');
  p uuid := current_setting('test056.proposta')::uuid;
  plano uuid := current_setting('test056.plano')::uuid;
  antes integer := (select count(*) from public.planos_trabalho);
  modo text;
  dados jsonb;
begin
  foreach modo in array array['insert','update'] loop
    dados:=jsonb_build_object('project_id',x,'titulo','056 indevido','proposta_id',p,
      'rubricas','[{"rubrica_code":"b","valor_previsto":999}]'::jsonb,
      'desembolsos','[{"parcela":2,"valor":999}]'::jsonb);
    if modo='update' then dados:=dados||jsonb_build_object('id',plano); end if;
    begin
      perform public.upsert_plano_trabalho(dados);
      raise exception '056 FALHOU: reaplicou proposta (%)',modo;
    exception when raise_exception then
      if sqlerrm not like '%não pendente%' then raise; end if;
    end;
  end loop;
  if (select count(*) from public.planos_trabalho)<>antes
    or not exists(select 1 from public.planos_trabalho where id=plano and ativo and titulo='056 aplicado')
    or (select count(*) from public.plano_rubricas where plano_id=plano)<>1
    or not exists(select 1 from public.plano_rubricas where plano_id=plano and valor_previsto=1200)
    or not exists(select 1 from public.plano_desembolsos where plano_id=plano and parcela=1 and valor=1200)
    or exists(select 1 from public.plano_desembolsos where plano_id=plano and parcela=2) then
    raise exception '056 FALHOU: tentativa recusada deixou gravação parcial';
  end if;
  raise notice '056 BLOCO 3 ok: não pendente desfaz INSERT, UPDATE e desativação anterior';
end $$;

-- 4: proposta de X não pode aplicar em Y, mesmo por admin com escopo nos dois.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',true);
do $$
declare x uuid := (select id from public.projects where code='51.X'); p uuid;
begin
  p:=public.criar_proposta('plano',x,'Outro plano sintético','{}',null,'056:outro');
  perform set_config('test056.outra',p::text,true);
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
do $$
declare
  y uuid := (select id from public.projects where code='51.Y');
  p uuid := current_setting('test056.outra')::uuid;
  antes integer := (select count(*) from public.planos_trabalho);
begin
  begin
    perform public.upsert_plano_trabalho(jsonb_build_object(
      'project_id',y,'proposta_id',p,'titulo','056 centro errado',
      'rubricas','[{"rubrica_code":"e","valor_previsto":55}]'::jsonb,
      'desembolsos','[{"parcela":1,"valor":55}]'::jsonb));
    raise exception '056 FALHOU: aplicou proposta de outro centro';
  exception when raise_exception then
    if sqlerrm not like '%outro centro de custo%' then raise; end if;
  end;
  if (select count(*) from public.planos_trabalho)<>antes
    or (select status from public.propostas_agente where id=p) is distinct from 'pendente' then
    raise exception '056 FALHOU: outro centro deixou gravação parcial';
  end if;
  raise notice '056 BLOCO 4 ok: proposta de outro centro recusa sem gravação';
end $$;

-- 5: fluxo antigo, sem proposta_id, segue normal; professor não grava fora do escopo.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',true);
do $$
declare
  x uuid := (select id from public.projects where code='51.X');
  plano uuid;
begin
  plano:=public.upsert_plano_trabalho(jsonb_build_object('project_id',x,'tipo','remanejamento','valor_total_plano',1200));
  if not exists(select 1 from public.planos_trabalho where id=plano and ativo and tipo='remanejamento')
     or (select ativo from public.planos_trabalho where id=current_setting('test056.plano')::uuid) then
    raise exception '056 FALHOU: importação comum ou ativação alterada';
  end if;
  begin
    perform public.upsert_plano_trabalho('{"project_id":"00000000-0000-0000-0000-0000000056ff"}');
    raise exception '056 FALHOU: guard de escopo removido';
  exception when raise_exception then
    if sqlerrm not like 'Acesso negado%' then raise; end if;
  end;
  raise notice '056 BLOCO 5 ok: importação sem proposta e guard de escopo preservados';
end $$;

-- 6: proposta de balancete/bolsas ou inexistente recusa plano com 22023.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',true);
do $$
declare
  x uuid := (select id from public.projects where code='51.X');
  p uuid;
begin
  p:=public.criar_proposta('balancete',x,'Balancete sintético para recusa','{}',null,'056:tipo-balancete');
  perform set_config('test056.balancete',p::text,true);
  p:=public.criar_proposta('bolsas',x,'Bolsas sintéticas para recusa','{}',null,'056:tipo-bolsas');
  perform set_config('test056.bolsas',p::text,true);
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',true);
do $$
declare
  x uuid := (select id from public.projects where code='51.X');
  plano uuid := (select id from public.planos_trabalho where project_id=x and ativo);
  p uuid;
  modo text;
  dados jsonb;
  planos_antes jsonb := (select jsonb_agg(to_jsonb(t) order by id) from public.planos_trabalho t);
  rubricas_antes jsonb := (select jsonb_agg(to_jsonb(t) order by id) from public.plano_rubricas t);
  desembolsos_antes jsonb := (select jsonb_agg(to_jsonb(t) order by id) from public.plano_desembolsos t);
begin
  foreach p in array array[current_setting('test056.balancete')::uuid,
    current_setting('test056.bolsas')::uuid,'00000000-0000-0000-0000-0000000056ee'::uuid] loop
    foreach modo in array array['insert','update'] loop
      dados:=jsonb_build_object('project_id',x,'titulo','056 tipo recusado','proposta_id',p,
        'rubricas','[{"rubrica_code":"b","valor_previsto":999}]'::jsonb,
        'desembolsos','[{"parcela":2,"valor":999}]'::jsonb);
      if modo='update' then dados:=dados||jsonb_build_object('id',plano); end if;
      begin
        perform public.upsert_plano_trabalho(dados);
        raise exception '056 FALHOU: aceitou proposta de outro tipo ou inexistente (%)',modo;
      exception when invalid_parameter_value then
        if sqlerrm <> 'A proposta não existe ou não é do tipo plano.' then raise; end if;
      end;
      if (select jsonb_agg(to_jsonb(t) order by id) from public.planos_trabalho t) is distinct from planos_antes
        or (select jsonb_agg(to_jsonb(t) order by id) from public.plano_rubricas t) is distinct from rubricas_antes
        or (select jsonb_agg(to_jsonb(t) order by id) from public.plano_desembolsos t) is distinct from desembolsos_antes then
        raise exception '056 FALHOU: tipo recusado deixou gravação parcial (%)',modo;
      end if;
    end loop;
  end loop;
  if (select count(*) from public.propostas_agente
    where id in (current_setting('test056.balancete')::uuid,current_setting('test056.bolsas')::uuid)
      and status='pendente' and objeto_id is null and decidida_em is null and decidida_por is null) <> 2 then
    raise exception '056 FALHOU: proposta recusada deixou de estar pendente';
  end if;
  raise notice '056 BLOCO 6 ok: balancete, bolsas e inexistente recusados com 22023; INSERT/UPDATE desfeitos e propostas pendentes';
end $$;
rollback;

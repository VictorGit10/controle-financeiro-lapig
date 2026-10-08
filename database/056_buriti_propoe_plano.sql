-- 056: Buriti propõe plano original ou remanejamento; humano revisa e aplica.
-- Corpo da RPC é o da 033, com proposta_id e aplicação atômica da 054.
-- Não altera os helpers protegidos. CREATE OR REPLACE preserva a ACL.
-- Conferência sintética: tests/sql/test_056_buriti_propoe_plano.sql.
begin;

alter table public.propostas_agente drop constraint propostas_agente_tipo_check;
alter table public.propostas_agente add constraint propostas_agente_tipo_check
  check (tipo in ('balancete','bolsas','pergunta','aviso','tarefa','plano'));

create or replace function public.upsert_plano_trabalho(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_proposta   uuid;
  v_plano_id   uuid;
  v_project_id uuid;
  v_versao     integer;
  v_is_new     boolean;
  r_rubrica    jsonb;
  r_desemb     jsonb;
begin
  v_proposta   := nullif(p_payload->>'proposta_id', '')::uuid;
  v_plano_id   := nullif(p_payload->>'id', '')::uuid;
  v_project_id := (p_payload->>'project_id')::uuid;
  v_is_new     := v_plano_id is null;

  if v_project_id is null then
    raise exception 'project_id é obrigatório no payload';
  end if;

  perform public.assert_project_allowed(v_project_id);

  if v_is_new then
    select coalesce(max(versao), -1) + 1
      into v_versao
      from public.planos_trabalho
     where project_id = v_project_id;

    insert into public.planos_trabalho (
      project_id, versao, tipo, data_documento,
      arquivo_storage_path, arquivo_nome, ativo,
      titulo, coordenador, prazo_inicio, prazo_fim,
      valor_total_plano, valor_despesas_projeto, valor_cip, valor_dao,
      receita_origem, observacoes, raw_extraction, created_by
    ) values (
      v_project_id,
      v_versao,
      coalesce(p_payload->>'tipo', case when v_versao = 0 then 'original' else 'remanejamento' end),
      nullif(p_payload->>'data_documento','')::date,
      p_payload->>'arquivo_storage_path',
      p_payload->>'arquivo_nome',
      coalesce((p_payload->>'ativo')::boolean, true),
      p_payload->>'titulo',
      p_payload->>'coordenador',
      nullif(p_payload->>'prazo_inicio','')::date,
      nullif(p_payload->>'prazo_fim','')::date,
      nullif(p_payload->>'valor_total_plano','')::numeric,
      nullif(p_payload->>'valor_despesas_projeto','')::numeric,
      nullif(p_payload->>'valor_cip','')::numeric,
      nullif(p_payload->>'valor_dao','')::numeric,
      p_payload->>'receita_origem',
      p_payload->>'observacoes',
      p_payload->'raw_extraction',
      auth.uid()
    )
    returning id into v_plano_id;
  else
    update public.planos_trabalho
       set tipo                   = coalesce(p_payload->>'tipo', tipo),
           data_documento         = nullif(p_payload->>'data_documento','')::date,
           arquivo_storage_path   = coalesce(p_payload->>'arquivo_storage_path', arquivo_storage_path),
           arquivo_nome           = coalesce(p_payload->>'arquivo_nome', arquivo_nome),
           titulo                 = p_payload->>'titulo',
           coordenador            = p_payload->>'coordenador',
           prazo_inicio           = nullif(p_payload->>'prazo_inicio','')::date,
           prazo_fim              = nullif(p_payload->>'prazo_fim','')::date,
           valor_total_plano      = nullif(p_payload->>'valor_total_plano','')::numeric,
           valor_despesas_projeto = nullif(p_payload->>'valor_despesas_projeto','')::numeric,
           valor_cip              = nullif(p_payload->>'valor_cip','')::numeric,
           valor_dao              = nullif(p_payload->>'valor_dao','')::numeric,
           receita_origem         = p_payload->>'receita_origem',
           observacoes            = p_payload->>'observacoes',
           raw_extraction         = coalesce(p_payload->'raw_extraction', raw_extraction)
     where id = v_plano_id
       and project_id = v_project_id
    returning id into v_plano_id;

    if not found then
      raise exception 'Plano não encontrado para este projeto';
    end if;
  end if;

  -- Substitui rubricas e desembolsos por completo (mais simples e idempotente).
  delete from public.plano_rubricas    where plano_id = v_plano_id;
  delete from public.plano_desembolsos where plano_id = v_plano_id;

  if jsonb_typeof(p_payload->'rubricas') = 'array' then
    for r_rubrica in select * from jsonb_array_elements(p_payload->'rubricas')
    loop
      insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto, descricao_livre)
      values (
        v_plano_id,
        r_rubrica->>'rubrica_code',
        coalesce((r_rubrica->>'valor_previsto')::numeric, 0),
        nullif(r_rubrica->>'descricao_livre', '')
      );
    end loop;
  end if;

  if jsonb_typeof(p_payload->'desembolsos') = 'array' then
    for r_desemb in select * from jsonb_array_elements(p_payload->'desembolsos')
    loop
      insert into public.plano_desembolsos (plano_id, parcela, data_prevista, data_texto, valor, valor_texto)
      values (
        v_plano_id,
        (r_desemb->>'parcela')::integer,
        nullif(r_desemb->>'data_prevista','')::date,
        r_desemb->>'data_texto',
        nullif(r_desemb->>'valor','')::numeric,
        r_desemb->>'valor_texto'
      );
    end loop;
  end if;

  if v_proposta is not null then
    if not exists (select 1 from public.propostas_agente
      where id = v_proposta and tipo = 'plano') then
      raise exception 'A proposta não existe ou não é do tipo plano.' using errcode = '22023';
    end if;
    perform public._aplicar_proposta(v_proposta, v_project_id, v_plano_id);
  end if;

  return v_plano_id;
end;
$$;

comment on function public.upsert_plano_trabalho(jsonb) is
  'Salva plano, rubricas e desembolsos no escopo do humano. proposta_id opcional marca a proposta aplicada na mesma transação; qualquer recusa desfaz toda a gravação.';

-- Asserções abortáveis: tipos anteriores, ACL e atributos da RPC intactos.
do $$
declare
  v_fn regprocedure := 'public.upsert_plano_trabalho(jsonb)'::regprocedure;
  v_check text;
  v_aceita boolean;
  v_tipo text;
begin
  select pg_get_expr(conbin, conrelid) into v_check from pg_constraint
   where conrelid = 'public.propostas_agente'::regclass
     and conname = 'propostas_agente_tipo_check';
  if v_check is null then raise exception '056: check de tipo ausente'; end if;
  foreach v_tipo in array array['balancete','bolsas','pergunta','aviso','tarefa','plano'] loop
    execute 'select ' || v_check || ' from (select $1::text as tipo) t' into v_aceita using v_tipo;
    if v_aceita is distinct from true then raise exception '056: check recusa %', v_tipo; end if;
  end loop;
  if not exists (select 1 from pg_proc where oid = v_fn and prosecdef
    and proconfig @> array['search_path=public, pg_temp']) then
    raise exception '056: definer/search_path alterados';
  end if;
  if position('assert_project_allowed' in pg_get_functiondef(v_fn)) = 0
     or position('perform public._aplicar_proposta(v_proposta, v_project_id, v_plano_id)' in pg_get_functiondef(v_fn)) = 0 then
    raise exception '056: guard ou aplicação atômica ausentes';
  end if;
  if position('where id = v_proposta and tipo = ''plano''' in pg_get_functiondef(v_fn)) = 0
     or position('errcode = ''22023''' in pg_get_functiondef(v_fn)) = 0 then
    raise exception '056: validação de existência/tipo da proposta ausente';
  end if;
  if not has_function_privilege('authenticated', v_fn, 'execute')
     or has_function_privilege('anon', v_fn, 'execute')
     or exists (select 1 from pg_proc p
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception '056: ACL da RPC incorreta';
  end if;
  raise notice '056 ok: tipos, guard, proposta de plano, aplicação atômica, definer, search_path e ACL';
end $$;

commit;

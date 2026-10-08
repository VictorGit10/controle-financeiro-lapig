-- Complemento sintético: recria a RPC vigente da 033 antes da 056.
-- Só banco descartável; sem documentos nem pessoas reais.
alter table public.planos_trabalho
  add column versao integer not null default 0,
  add column tipo text not null default 'original',
  add column data_documento date, add column arquivo_storage_path text,
  add column arquivo_nome text, add column titulo text, add column coordenador text,
  add column prazo_inicio date, add column prazo_fim date,
  add column valor_total_plano numeric, add column valor_despesas_projeto numeric,
  add column valor_cip numeric, add column valor_dao numeric,
  add column receita_origem text, add column observacoes text,
  add column raw_extraction jsonb, add column created_by uuid,
  add unique(project_id,versao);
alter table public.plano_rubricas add column descricao_livre text;
alter table public.plano_desembolsos add column data_texto text, add column valor_texto text;
create unique index uq_plano_ativo_por_projeto on public.planos_trabalho(project_id) where ativo;

create function public.stub_single_plano_ativo() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.ativo then
    update public.planos_trabalho set ativo=false
      where project_id=new.project_id and id<>new.id and ativo;
  end if;
  return new;
end $$;
create trigger trg_planos_enforce_single_ativo before insert or update of ativo
  on public.planos_trabalho for each row execute function public.stub_single_plano_ativo();

alter table public.planos_trabalho enable row level security;
create policy escopo on public.planos_trabalho for all to authenticated
  using(public.is_admin() or project_id=any(public.allowed_project_ids()))
  with check(public.is_admin() or project_id=any(public.allowed_project_ids()));
alter table public.plano_rubricas enable row level security;
create policy escopo on public.plano_rubricas for all to authenticated
  using(exists(select 1 from public.planos_trabalho p where p.id=plano_id))
  with check(exists(select 1 from public.planos_trabalho p where p.id=plano_id));
alter table public.plano_desembolsos enable row level security;
create policy escopo on public.plano_desembolsos for all to authenticated
  using(exists(select 1 from public.planos_trabalho p where p.id=plano_id))
  with check(exists(select 1 from public.planos_trabalho p where p.id=plano_id));
grant select,insert,update,delete on public.planos_trabalho,public.plano_rubricas,public.plano_desembolsos to authenticated;

insert into public.app_users(user_id,role,display_name)
values('00000000-0000-0000-0000-0000000000c1','agente','Agente sintético') on conflict(user_id) do update set role='agente';

create or replace function public.upsert_plano_trabalho(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plano_id   uuid;
  v_project_id uuid;
  v_versao     integer;
  v_is_new     boolean;
  r_rubrica    jsonb;
  r_desemb     jsonb;
begin
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

  return v_plano_id;
end;
$$;
revoke all on function public.upsert_plano_trabalho(jsonb) from public,anon;
grant execute on function public.upsert_plano_trabalho(jsonb) to authenticated;

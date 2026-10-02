-- ============================================================
-- 051_buriti_propostas_do_agente.sql
--
-- A PORTA DE ESCRITA DO BURITI — o agente de IA de gestão financeira.
-- O Buriti confere balancetes, cobra a FUNAPE e pergunta ao Victor.
-- Regra: IA NÃO GRAVA NÚMERO SOZINHA. O Buriti PROPÕE; um humano
-- logado revisa e aplica pelo caminho que já existe (upsert_balancete,
-- apply_reconciliation…). Nenhuma lógica de importação é duplicada.
--
-- (A) PAPEL `agente` em app_users. Lê os centros de custo do seu
--     escopo (user_projects), como um professor.
--
-- (B) A BARREIRA ESTÁ NO DADO, NÃO NO CAMINHO.
--     O papel sozinho não impediria nada: as policies de escrita da 033
--     ("Escopo insere bolsas/balancetes/planos…") checam ESCOPO, não
--     papel, e as RPCs definer de escrita (upsert_balancete,
--     upsert_plano_trabalho, apply_reconciliation, set_project_code…)
--     checam só assert_project_allowed. Um agente com centro de custo
--     atribuído gravaria por qualquer uma delas.
--     Em vez de remendar cada policy e cada RPC — e esquecer a próxima —,
--     um gatilho de STATEMENT em TODA tabela do schema public recusa
--     INSERT/UPDATE/DELETE quando quem está logado é agente. Gatilho
--     dispara também dentro de função security definer, e auth.uid()
--     continua sendo o do agente ali dentro: fecha o PostgREST direto e
--     todas as RPCs, atuais e futuras, de uma vez. Única exceção:
--     `propostas_agente`, que mesmo assim só se escreve por RPC.
--     Tabela criada DEPOIS desta migração não ganha o gatilho sozinha:
--     a asserção final e o roteiro de teste conferem a cobertura — rode
--     o BLOCO 1 do roteiro depois de cada migração nova.
--     No storage, policy RESTRITIVA (somada às permissivas com AND)
--     confina o agente ao bucket `propostas-agente`.
--
-- (C) `propostas_agente` + 3 RPCs estreitas:
--     • criar_proposta     — só agente, com guard de escopo. Proposta
--                            pendente de mesmo (tipo, centro, chave) vira
--                            `obsoleta`: o Buriti refaz sem empilhar.
--     • decidir_proposta   — só humano: rejeitar (motivo obrigatório)
--                            ou responder/arquivar (pergunta e aviso).
--     • marcar_proposta_aplicada — só humano, depois de aplicar.
--     Para balancete a marcação é ATÔMICA: upsert_balancete aceita
--     `proposta_id` no payload e marca a proposta na mesma transação —
--     não existe "gravou mas a proposta ficou pendente".
--     O agente nunca decide nem aplica: is_agente() é recusado nas duas
--     RPCs, e qualquer escrita dele em tabela financeira cai em (B).
--
-- O agente lê as próprias propostas e a decisão humana (é como ele
-- aprende a resposta de uma pergunta).
--
-- `upsert_balancete`: corpo idêntico ao da 050 + o bloco da proposta.
-- `create or replace` preserva a ACL da 035; definer + search_path +
-- guard repetidos (lição da 036). Funções novas nascem fechadas (035):
-- os GRANTs abaixo são explícitos.
--
-- Conferência: tests/sql/test_051_buriti_propostas.sql
-- ============================================================

begin;

-- ------------------------------------------------------------
-- (A) Papel `agente`
-- ------------------------------------------------------------
do $$
declare
  v_con text;
begin
  select conname into v_con
    from pg_constraint
   where conrelid = 'public.app_users'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%role%';
  if v_con is not null then
    execute format('alter table public.app_users drop constraint %I', v_con);
  end if;
end $$;

alter table public.app_users
  add constraint app_users_role_check check (role in ('admin', 'professor', 'agente'));

comment on column public.app_users.role is
  'admin vê/edita tudo; professor só vê/edita os projetos em user_projects; agente (mig. 051) lê o escopo de user_projects e só escreve propostas.';

create or replace function public.is_agente()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.app_users
     where user_id = auth.uid()
       and role = 'agente'
  );
$$;

-- ------------------------------------------------------------
-- (C) Tabela de propostas
-- ------------------------------------------------------------
create table if not exists public.propostas_agente (
  id               uuid primary key default gen_random_uuid(),
  tipo             text not null check (tipo in ('balancete', 'bolsas', 'pergunta', 'aviso')),
  project_id       uuid references public.projects(id) on delete cascade,
  chave            text,          -- ex.: data de referência do balancete
  resumo           text not null,
  payload          jsonb not null default '{}'::jsonb,
  arquivo_path     text,          -- bucket propostas-agente
  status           text not null default 'pendente'
                     check (status in ('pendente', 'aplicada', 'rejeitada', 'respondida', 'obsoleta')),
  criada_por       uuid not null default auth.uid(),
  criada_em        timestamptz not null default now(),
  decidida_por     uuid,
  decidida_em      timestamptz,
  motivo           text,          -- rejeição, ou a resposta humana
  objeto_id        uuid,          -- o que a aplicação gerou (ex.: balancetes.id)
  -- Decisão humana sempre tem data; pendente e obsoleta, nunca.
  constraint propostas_decisao_ck check (
    (status in ('aplicada', 'rejeitada', 'respondida')) = (decidida_em is not null)
  )
);

create index if not exists idx_propostas_pendentes
  on public.propostas_agente (project_id, tipo) where status = 'pendente';

comment on table public.propostas_agente is
  'Caixa de propostas do Buriti (agente de IA). O agente cria; um humano aplica, rejeita ou responde. Escrita só por RPC (mig. 051).';

alter table public.propostas_agente enable row level security;

drop policy if exists "Escopo lê propostas" on public.propostas_agente;
create policy "Escopo lê propostas" on public.propostas_agente
  for select to authenticated
  using (
    public.is_admin()
    or criada_por = auth.uid()
    or project_id = any(public.allowed_project_ids())
  );

-- Nenhuma policy de escrita: só as RPCs (definer) escrevem.
revoke insert, update, delete, truncate on public.propostas_agente from anon, authenticated;
grant select on public.propostas_agente to authenticated;

-- ------------------------------------------------------------
-- (B) A barreira: gatilho em toda tabela de public
-- ------------------------------------------------------------
create or replace function public.bloqueia_escrita_do_agente()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_agente() then
    raise exception 'O agente não grava em %: ele cria propostas (criar_proposta) e um humano aplica.', TG_TABLE_NAME
      using errcode = '42501';
  end if;
  return null;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and c.relname <> 'propostas_agente'
  loop
    execute format('drop trigger if exists trg_bloqueia_agente on public.%I', r.relname);
    execute format(
      'create trigger trg_bloqueia_agente before insert or update or delete on public.%I
         for each statement execute function public.bloqueia_escrita_do_agente()', r.relname);
  end loop;
end $$;

-- ------------------------------------------------------------
-- (B) Storage: bucket das propostas + confinamento do agente
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('propostas-agente', 'propostas-agente', false)
on conflict (id) do nothing;

-- Caminho: <project_id>/<arquivo>. Lê e grava quem tem o centro no escopo.
drop policy if exists propostas_agente_select on storage.objects;
create policy propostas_agente_select on storage.objects
  for select to authenticated
  using (bucket_id = 'propostas-agente'
         and (public.is_admin()
              or (storage.foldername(name))[1] = any(public.allowed_project_ids()::text[])));

drop policy if exists propostas_agente_insert on storage.objects;
create policy propostas_agente_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'propostas-agente'
              and (public.is_admin()
                   or (storage.foldername(name))[1] = any(public.allowed_project_ids()::text[])));

-- RESTRITIVAS: o agente só escreve no bucket dele (AND com as demais).
drop policy if exists agente_so_no_bucket_dele_ins on storage.objects;
create policy agente_so_no_bucket_dele_ins on storage.objects
  as restrictive for insert to authenticated
  with check (not public.is_agente() or bucket_id = 'propostas-agente');

drop policy if exists agente_so_no_bucket_dele_upd on storage.objects;
create policy agente_so_no_bucket_dele_upd on storage.objects
  as restrictive for update to authenticated
  using (not public.is_agente() or bucket_id = 'propostas-agente')
  with check (not public.is_agente() or bucket_id = 'propostas-agente');

drop policy if exists agente_so_no_bucket_dele_del on storage.objects;
create policy agente_so_no_bucket_dele_del on storage.objects
  as restrictive for delete to authenticated
  using (not public.is_agente() or bucket_id = 'propostas-agente');

-- ------------------------------------------------------------
-- (C) RPCs
-- ------------------------------------------------------------
create or replace function public.criar_proposta(
  p_tipo         text,
  p_project_id   uuid,
  p_resumo       text,
  p_payload      jsonb default '{}'::jsonb,
  p_arquivo_path text  default null,
  p_chave        text  default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.is_agente() then
    raise exception 'Só o agente cria propostas.' using errcode = '42501';
  end if;
  if p_project_id is not null then
    perform public.assert_project_allowed(p_project_id);
  elsif p_tipo not in ('pergunta', 'aviso') then
    raise exception 'Proposta do tipo % precisa de centro de custo.', p_tipo;
  end if;
  if coalesce(btrim(p_resumo), '') = '' then
    raise exception 'Resumo é obrigatório: é o que o humano lê primeiro.';
  end if;
  if p_arquivo_path is not null
     and split_part(p_arquivo_path, '/', 1) is distinct from p_project_id::text then
    raise exception 'O arquivo da proposta tem de ficar na pasta do centro de custo (%/…).', p_project_id;
  end if;

  -- Refazer a mesma proposta substitui a anterior, não empilha.
  if p_chave is not null then
    update public.propostas_agente
       set status = 'obsoleta'
     where status = 'pendente'
       and tipo = p_tipo
       and project_id is not distinct from p_project_id
       and chave = p_chave;
  end if;

  insert into public.propostas_agente (tipo, project_id, chave, resumo, payload, arquivo_path)
  values (p_tipo, p_project_id, p_chave, p_resumo, coalesce(p_payload, '{}'::jsonb), p_arquivo_path)
  returning id into v_id;
  return v_id;
end;
$$;

-- Interna: valida e marca. Chamada por marcar_proposta_aplicada e por
-- upsert_balancete (mesma transação da gravação).
create or replace function public._aplicar_proposta(p_id uuid, p_project_id uuid, p_objeto_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.propostas_agente;
begin
  if public.is_agente() then
    raise exception 'O agente não aplica proposta: só humano.' using errcode = '42501';
  end if;
  select * into r from public.propostas_agente where id = p_id for update;
  if not found then
    raise exception 'Proposta % não existe.', p_id;
  end if;
  if r.status <> 'pendente' then
    raise exception 'Proposta % está %, não pendente.', p_id, r.status;
  end if;
  if r.tipo in ('pergunta', 'aviso') then
    raise exception 'Proposta do tipo % não se aplica: responda-a.', r.tipo;
  end if;
  if r.project_id is distinct from p_project_id then
    raise exception 'A proposta % é de outro centro de custo.', p_id;
  end if;
  perform public.assert_project_allowed(r.project_id);

  update public.propostas_agente
     set status = 'aplicada', decidida_por = auth.uid(), decidida_em = now(), objeto_id = p_objeto_id
   where id = p_id;
end;
$$;

create or replace function public.marcar_proposta_aplicada(p_id uuid, p_objeto_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_proj uuid;
begin
  select project_id into v_proj from public.propostas_agente where id = p_id;
  perform public._aplicar_proposta(p_id, v_proj, p_objeto_id);
end;
$$;

create or replace function public.decidir_proposta(p_id uuid, p_decisao text, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.propostas_agente;
begin
  if public.is_agente() then
    raise exception 'O agente não decide proposta: só humano.' using errcode = '42501';
  end if;
  if p_decisao not in ('rejeitada', 'respondida') then
    raise exception 'Decisão inválida: %. Use rejeitada ou respondida (aplicar é marcar_proposta_aplicada).', p_decisao;
  end if;
  select * into r from public.propostas_agente where id = p_id for update;
  if not found then
    raise exception 'Proposta % não existe.', p_id;
  end if;
  if r.status <> 'pendente' then
    raise exception 'Proposta % está %, não pendente.', p_id, r.status;
  end if;
  if r.project_id is not null then
    perform public.assert_project_allowed(r.project_id);
  elsif not public.is_admin() then
    raise exception 'Proposta sem centro de custo: só admin decide.' using errcode = '42501';
  end if;
  if p_decisao = 'rejeitada' and coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Rejeitar exige o motivo: é o que o agente lê para não repetir o erro.';
  end if;
  if p_decisao = 'respondida' and r.tipo = 'pergunta' and coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Responder uma pergunta exige o texto da resposta.';
  end if;

  update public.propostas_agente
     set status = p_decisao, decidida_por = auth.uid(), decidida_em = now(), motivo = p_motivo
   where id = p_id;
end;
$$;

-- ------------------------------------------------------------
-- upsert_balancete: corpo da 050 + marcação atômica da proposta
-- ------------------------------------------------------------
create or replace function public.upsert_balancete(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id           uuid;
  v_project_id   uuid;
  v_data_ref     date;
  v_proposta     uuid;
  r_lanc         jsonb;
  r_map          jsonb;
begin
  v_project_id := (p_payload->>'project_id')::uuid;
  v_data_ref   := (p_payload->>'data_referencia')::date;

  if v_project_id is null or v_data_ref is null then
    raise exception 'project_id e data_referencia são obrigatórios.';
  end if;

  perform public.assert_project_allowed(v_project_id);

  -- Novos mapeamentos cadastrados pelo usuário durante a revisão.
  -- Inseridos ANTES dos lançamentos para que o trigger auto-resolve
  -- já encontre a rubrica correta.
  if jsonb_typeof(p_payload->'new_mappings') = 'array' then
    for r_map in select * from jsonb_array_elements(p_payload->'new_mappings')
    loop
      if r_map->>'conta_prefix' is not null and r_map->>'rubrica_code' is not null then
        insert into public.conta_rubrica_map (conta_prefix, rubrica_code, descricao)
        values (
          r_map->>'conta_prefix',
          r_map->>'rubrica_code',
          coalesce(r_map->>'descricao', 'Cadastrado via revisão do balancete')
        )
        on conflict (conta_prefix) do update set
          rubrica_code = excluded.rubrica_code,
          ativo        = true;
      end if;
    end loop;
  end if;

  insert into public.balancetes (
    project_id, data_referencia, data_emissao, periodo_inicio,
    saldo_disponivel, rendimento_liquido, total_debitos, total_creditos,
    arquivo_storage_path, arquivo_nome, observacoes, raw_extraction, created_by
  ) values (
    v_project_id, v_data_ref,
    nullif(p_payload->>'data_emissao','')::date,
    nullif(p_payload->>'periodo_inicio','')::date,
    nullif(p_payload->>'saldo_disponivel','')::numeric,
    nullif(p_payload->>'rendimento_liquido','')::numeric,
    nullif(p_payload->>'total_debitos','')::numeric,
    nullif(p_payload->>'total_creditos','')::numeric,
    p_payload->>'arquivo_storage_path',
    p_payload->>'arquivo_nome',
    p_payload->>'observacoes',
    p_payload->'raw_extraction',
    auth.uid()
  )
  on conflict (project_id, data_referencia) do update set
    data_emissao         = excluded.data_emissao,
    periodo_inicio       = excluded.periodo_inicio,
    saldo_disponivel     = excluded.saldo_disponivel,
    rendimento_liquido   = excluded.rendimento_liquido,
    total_debitos        = excluded.total_debitos,
    total_creditos       = excluded.total_creditos,
    arquivo_storage_path = coalesce(excluded.arquivo_storage_path, balancetes.arquivo_storage_path),
    arquivo_nome         = coalesce(excluded.arquivo_nome,         balancetes.arquivo_nome),
    observacoes          = excluded.observacoes,
    raw_extraction       = coalesce(excluded.raw_extraction,       balancetes.raw_extraction),
    updated_at           = now()
  returning id into v_id;

  -- Substitui os lançamentos (idempotente)
  delete from public.balancete_lancamentos where balancete_id = v_id;

  if jsonb_typeof(p_payload->'lancamentos') = 'array' then
    for r_lanc in select * from jsonb_array_elements(p_payload->'lancamentos')
    loop
      insert into public.balancete_lancamentos
        (balancete_id, conta_codigo, conta_descricao, valor_debito, valor_credito, saldo_atual, rubrica_code)
      values (
        v_id,
        r_lanc->>'conta_codigo',
        r_lanc->>'conta_descricao',
        coalesce((r_lanc->>'valor_debito')::numeric, 0),
        coalesce((r_lanc->>'valor_credito')::numeric, 0),
        coalesce((r_lanc->>'saldo_atual')::numeric, 0),
        -- Rubrica respondida na revisão (mig. 050). Nula, o gatilho
        -- trg_auto_resolve_rubrica resolve pelo mapa, como antes.
        nullif(r_lanc->>'rubrica_code', '')
      );
    end loop;
  end if;

  -- Proposta do agente que originou esta gravação (mig. 051): marcada na
  -- MESMA transação. Se a proposta não estiver pendente, nada é gravado.
  v_proposta := nullif(p_payload->>'proposta_id', '')::uuid;
  if v_proposta is not null then
    perform public._aplicar_proposta(v_proposta, v_project_id, v_id);
  end if;

  return v_id;
end;
$$;

comment on function public.upsert_balancete is
  'Cria ou atualiza um balancete a partir do JSON revisado. Guard: assert_project_allowed. Aceita new_mappings opcional (catálogo permissivo), rubrica_code por lançamento (mig. 050) e proposta_id (mig. 051: marca a proposta do agente como aplicada na mesma transação).';

-- ------------------------------------------------------------
-- ACL (funções novas nascem fechadas pela 035)
-- ------------------------------------------------------------
revoke all on function public.is_agente()                                       from public, anon;
revoke all on function public.bloqueia_escrita_do_agente()                      from public, anon, authenticated;
revoke all on function public._aplicar_proposta(uuid, uuid, uuid)               from public, anon, authenticated;
revoke all on function public.criar_proposta(text, uuid, text, jsonb, text, text) from public, anon;
revoke all on function public.decidir_proposta(uuid, text, text)                from public, anon;
revoke all on function public.marcar_proposta_aplicada(uuid, uuid)              from public, anon;

-- is_agente é chamada pelas policies do storage: quem avalia é o usuário.
grant execute on function public.is_agente()                                       to authenticated;
grant execute on function public.criar_proposta(text, uuid, text, jsonb, text, text) to authenticated;
grant execute on function public.decidir_proposta(uuid, text, text)                to authenticated;
grant execute on function public.marcar_proposta_aplicada(uuid, uuid)              to authenticated;

-- ------------------------------------------------------------
-- Asserções
-- ------------------------------------------------------------
do $$
declare
  v_sem text;
begin
  -- Toda tabela de public, exceto a caixa de propostas, tem a barreira.
  select string_agg(c.relname, ', ') into v_sem
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and c.relname <> 'propostas_agente'
     and not exists (select 1 from pg_trigger t
                      where t.tgrelid = c.oid and t.tgname = 'trg_bloqueia_agente');
  if v_sem is not null then
    raise exception '051: tabelas sem a barreira do agente: %', v_sem;
  end if;

  if not exists (select 1 from pg_proc
                  where proname = 'upsert_balancete' and pronamespace = 'public'::regnamespace
                    and prosecdef
                    and pg_get_functiondef(oid) like '%_aplicar_proposta%'
                    and pg_get_functiondef(oid) like '%nullif(r_lanc->>''rubrica_code''%') then
    raise exception '051: upsert_balancete perdeu a 050 ou não marca a proposta.';
  end if;

  if has_function_privilege('authenticated', 'public._aplicar_proposta(uuid, uuid, uuid)', 'execute') then
    raise exception '051: _aplicar_proposta não pode ser chamada direto.';
  end if;
end $$;

commit;

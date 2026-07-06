-- ============================================================
-- CONTROLE FINANCEIRO — Migração 029
-- Reconciliação global de bolsistas + merge de duplicados
--
-- Contexto: a reconciliação (028) resolvia pessoas apenas
-- contra as bolsas do projeto selecionado. Como scholarship_holders
-- é global (1 pessoa = 1 registro, idealmente por CPF), um bolsista
-- já cadastrado via outro projeto — ou com nome divergente / sem CPF —
-- era classificado como "novo" e gerava um holder DUPLICADO.
--
-- Esta migração:
--   1. apply_reconciliation passa a aceitar holder_id em "creates"
--      (vincula bolsa a holder existente em vez de criar duplicado)
--      e adota a planilha FUNAPE como fonte da verdade do nome.
--   2. merge_holders: mescla holders duplicados que já existam,
--      repontando as bolsas e consolidando os campos.
-- ============================================================

-- ============================================================
-- 1. apply_reconciliation (v2)
-- ============================================================
-- creates: [{ holder_id?, nome, cpf, email, tipo, formacao, valor, inicio, fim }]
--   - Se holder_id presente  → VINCULA nova bolsa ao holder existente
--                              e faz backfill (nome FUNAPE manda, cpf, email, formação).
--   - Senão, com cpf         → upsert por CPF (on conflict reusa o holder).
--   - Senão                  → cria holder novo.
-- updates: [{ holder_id, scholarship_id, amount, start_date, end_date,
--             scholarship_type, cpf, full_name, education_level }]
--   - Atualiza a bolsa + backfill do holder (nome FUNAPE manda).
-- ends:    [{ scholarship_id }]  → encerra bolsas removidas.
create or replace function public.apply_reconciliation(
  p_project_id  uuid,
  p_actions     jsonb
)
returns integer
language plpgsql
security definer
as $$
declare
  v_item       jsonb;
  v_holder_id  uuid;
  v_total      integer := 0;
begin
  -- Creates / vínculos
  for v_item in select * from jsonb_array_elements(coalesce(p_actions->'creates', '[]'::jsonb))
  loop
    if (v_item->>'holder_id') is not null and (v_item->>'holder_id') <> '' then
      -- Holder JÁ existe (encontrado na resolução global) → vincula nova bolsa
      -- e faz backfill. Nome da planilha FUNAPE sobrescreve o cadastrado.
      v_holder_id := (v_item->>'holder_id')::uuid;
      update public.scholarship_holders
      set
        full_name       = coalesce(nullif(v_item->>'nome', ''), full_name),
        cpf             = coalesce(nullif(v_item->>'cpf', ''), cpf),
        email           = coalesce(nullif(v_item->>'email', ''), email),
        education_level = coalesce(nullif(v_item->>'formacao', ''), education_level),
        updated_at      = now()
      where id = v_holder_id;

    elsif (v_item->>'cpf') is not null and (v_item->>'cpf') <> '' then
      insert into public.scholarship_holders (full_name, cpf, email, education_level)
      values (
        v_item->>'nome',
        v_item->>'cpf',
        nullif(v_item->>'email', ''),
        nullif(v_item->>'formacao', '')
      )
      on conflict (cpf) do update set
        full_name       = excluded.full_name,
        email           = coalesce(nullif(excluded.email, ''), scholarship_holders.email),
        education_level = coalesce(nullif(excluded.education_level, ''), scholarship_holders.education_level)
      returning id into v_holder_id;

    else
      insert into public.scholarship_holders (full_name, email, education_level)
      values (
        v_item->>'nome',
        nullif(v_item->>'email', ''),
        nullif(v_item->>'formacao', '')
      )
      returning id into v_holder_id;
    end if;

    insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status, scholarship_type, notes)
    values (
      v_holder_id,
      p_project_id,
      (v_item->>'valor')::numeric,
      (v_item->>'inicio')::date,
      (v_item->>'fim')::date,
      'active',
      nullif(v_item->>'tipo', ''),
      null
    );

    v_total := v_total + 1;
  end loop;

  -- Updates: altera bolsa existente + backfill do holder
  for v_item in select * from jsonb_array_elements(coalesce(p_actions->'updates', '[]'::jsonb))
  loop
    update public.scholarships
    set
      amount          = (v_item->>'amount')::numeric,
      start_date      = (v_item->>'start_date')::date,
      end_date        = (v_item->>'end_date')::date,
      scholarship_type = nullif(v_item->>'scholarship_type', ''),
      updated_at      = now()
    where id = (v_item->>'scholarship_id')::uuid
      and project_id = p_project_id;

    if (v_item->>'holder_id') is not null then
      update public.scholarship_holders
      set
        cpf            = coalesce(nullif(v_item->>'cpf', ''), cpf),
        full_name      = coalesce(nullif(v_item->>'full_name', ''), full_name),
        education_level = coalesce(nullif(v_item->>'education_level', ''), education_level),
        updated_at     = now()
      where id = (v_item->>'holder_id')::uuid;
    end if;

    v_total := v_total + 1;
  end loop;

  -- Ends: encerra bolsas que não constam mais na planilha
  for v_item in select * from jsonb_array_elements(coalesce(p_actions->'ends', '[]'::jsonb))
  loop
    update public.scholarships
    set status = 'ended',
        updated_at = now()
    where id = (v_item->>'scholarship_id')::uuid
      and project_id = p_project_id;

    v_total := v_total + 1;
  end loop;

  insert into public.scholarship_audit (project_id, action, changes_count, details)
  values (
    p_project_id,
    'reconciliation',
    v_total,
    jsonb_build_object(
      'created', jsonb_array_length(coalesce(p_actions->'creates', '[]'::jsonb)),
      'updated', jsonb_array_length(coalesce(p_actions->'updates', '[]'::jsonb)),
      'ended',   jsonb_array_length(coalesce(p_actions->'ends', '[]'::jsonb))
    )
  );

  return v_total;
end;
$$;

comment on function public.apply_reconciliation(uuid, jsonb) is
  'Aplica reconciliação de bolsas. creates aceita holder_id (vincula bolsa a holder existente, evitando duplicados); nome da planilha FUNAPE é fonte da verdade.';

-- ============================================================
-- 2. merge_holders — mescla bolsistas duplicados
-- ============================================================
-- Repointa todas as bolsas dos duplicados para o holder canônico,
-- consolida campos (canônico tem precedência; campos nulos são
-- preenchidos a partir dos duplicados) e remove os duplicados.
-- A deleção ocorre ANTES de gravar o cpf consolidado no canônico
-- para não violar a unique constraint de cpf transitoriamente.
create or replace function public.merge_holders(
  p_canonical_id   uuid,
  p_duplicate_ids  uuid[]
)
returns integer
language plpgsql
security definer
as $$
declare
  v_moved  integer := 0;
  v_cpf    text;
  v_email  text;
  v_edu    text;
  v_active boolean;
begin
  if p_canonical_id is null then
    raise exception 'holder canônico não informado';
  end if;

  -- Campos consolidados: canônico tem precedência; preenche nulos
  -- com o primeiro valor não-nulo encontrado nos duplicados.
  select
    coalesce(c.cpf,             (select d.cpf             from public.scholarship_holders d where d.id = any(p_duplicate_ids) and d.id <> p_canonical_id and d.cpf             is not null limit 1)),
    coalesce(c.email,           (select d.email           from public.scholarship_holders d where d.id = any(p_duplicate_ids) and d.id <> p_canonical_id and d.email           is not null limit 1)),
    coalesce(c.education_level, (select d.education_level  from public.scholarship_holders d where d.id = any(p_duplicate_ids) and d.id <> p_canonical_id and d.education_level is not null limit 1)),
    -- Holder fica ativo se o canônico OU qualquer duplicado estiver ativo
    (c.active or coalesce((select bool_or(d.active) from public.scholarship_holders d where d.id = any(p_duplicate_ids) and d.id <> p_canonical_id), false))
  into v_cpf, v_email, v_edu, v_active
  from public.scholarship_holders c
  where c.id = p_canonical_id;

  -- Repointa as bolsas dos duplicados para o canônico
  update public.scholarships
  set holder_id = p_canonical_id, updated_at = now()
  where holder_id = any(p_duplicate_ids)
    and holder_id <> p_canonical_id;
  get diagnostics v_moved = row_count;

  -- Remove duplicados (libera o cpf para o canônico)
  delete from public.scholarship_holders
  where id = any(p_duplicate_ids)
    and id <> p_canonical_id;

  -- Aplica campos consolidados ao canônico
  update public.scholarship_holders
  set cpf = v_cpf, email = v_email, education_level = v_edu, active = v_active, updated_at = now()
  where id = p_canonical_id;

  insert into public.scholarship_audit (project_id, action, changes_count, details)
  values (
    null,
    'merge_holders',
    v_moved,
    jsonb_build_object(
      'canonical', p_canonical_id,
      'duplicates', to_jsonb(p_duplicate_ids),
      'scholarships_moved', v_moved
    )
  );

  return v_moved;
end;
$$;

comment on function public.merge_holders(uuid, uuid[]) is
  'Mescla bolsistas duplicados no holder canônico: repointa bolsas, consolida cpf/email/formação/ativo e remove os duplicados.';

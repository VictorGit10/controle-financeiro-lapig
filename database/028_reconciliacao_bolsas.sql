-- ============================================================
-- CONTROLE FINANCEIRO — Migração 028
-- Reconciliação de Bolsas: CPF em scholarship_holders,
-- tipo de bolsa em scholarships, RPC apply_reconciliation
-- ============================================================

-- 1. Adicionar coluna cpf em scholarship_holders
alter table public.scholarship_holders
  add column if not exists cpf text;

-- CPF armazenado apenas com dígitos (11 caracteres) para matching exato
-- Normaliza CPFs preenchidos manualmente antes de aplicar constraints
update public.scholarship_holders
  set cpf = regexp_replace(cpf, '[^0-9]', '', 'g')
  where cpf is not null;

-- Constraint: CPF deve ter 11 dígitos se preenchido, e ser único
alter table public.scholarship_holders
  add constraint chk_holders_cpf_format
  check (cpf is null or (length(cpf) = 11 and cpf ~ '^\d{11}$'));

alter table public.scholarship_holders
  add constraint uq_holders_cpf
  unique (cpf);

comment on column public.scholarship_holders.cpf is
  'CPF do bolsista (apenas dígitos, 11 caracteres). Nullable para registros anteriores ao fluxo de reconciliação.';

-- 2. Adicionar coluna education_level em scholarship_holders
-- Mapeia o campo "Formação" do FUNAPE (ex: "Ensino Médio", "Doutor")
alter table public.scholarship_holders
  add column if not exists education_level text;

comment on column public.scholarship_holders.education_level is
  'Nível de formação conforme FUNAPE (ex: "Ensino Médio", "Graduado", "Doutor").';

-- 3. Adicionar coluna scholarship_type em scholarships
-- Mapeia o campo "Tipo" do FUNAPE (ex: "COM VINCULAÇÃO IFES (FIXO)")
alter table public.scholarships
  add column if not exists scholarship_type text;

comment on column public.scholarships.scholarship_type is
  'Tipo da bolsa conforme FUNAPE (ex: "COM VINCULAÇÃO IFES (FIXO)", "CONVIDADO(FIXO)").';

-- 4. Índice para busca rápida por CPF
create index if not exists idx_holders_cpf on public.scholarship_holders(cpf)
  where cpf is not null;

-- 5. RPC: apply_reconciliation
-- Aplica mudanças aprovadas pelo usuário na revisão de reconciliação
-- Recebe: p_project_id + p_actions com creates/updates/ends
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
  -- p_actions: { creates: [...], updates: [...], ends: [...] }
  --
  -- creates: [{ nome, cpf, email, tipo, formacao, valor, inicio, fim }]
  --   Cria novo bolsista (se CPF não existir) + nova bolsa ativa
  --
  -- updates: [{ holder_id, scholarship_id, amount, start_date, end_date,
  --             scholarship_type, cpf, education_level }]
  --   Atualiza dados da bolsa + dados do bolsista se CPF/formação forem fornecidos
  --
  -- ends: [{ scholarship_id }]
  --   Encerra bolsas que não constam mais na planilha

  -- Creates: novo holder + nova bolsa
  for v_item in select * from jsonb_array_elements(coalesce(p_actions->'creates', '[]'::jsonb))
  loop
    -- Upsert holder por CPF (se fornecido) ou cria novo
    if (v_item->>'cpf') is not null and (v_item->>'cpf') <> '' then
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

  -- Updates: altera bolsa existente + atualiza holder se CPF/Formação novos
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

    -- Atualiza holder se CPF ou education_level fornecidos
    if (v_item->>'holder_id') is not null then
      update public.scholarship_holders
      set
        cpf            = coalesce(nullif(v_item->>'cpf', ''), cpf),
        education_level = coalesce(nullif(v_item->>'education_level', ''), education_level),
        updated_at     = now()
      where id = (v_item->>'holder_id')::uuid;
    end if;

    v_total := v_total + 1;
  end loop;

  -- Ends: encerra bolsas que não estão mais na planilha
  for v_item in select * from jsonb_array_elements(coalesce(p_actions->'ends', '[]'::jsonb))
  loop
    update public.scholarships
    set status = 'ended',
        updated_at = now()
    where id = (v_item->>'scholarship_id')::uuid
      and project_id = p_project_id;

    v_total := v_total + 1;
  end loop;

  -- Audit log
  insert into public.scholarship_audit (
    project_id,
    action,
    changes_count,
    details
  ) values (
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
  'Aplica mudanças de reconciliação de bolsas: cria holders/bolsas, atualiza valores, encerra bolsas removidas.';
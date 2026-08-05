-- ============================================================
-- Migração 034 — Estender o professor: gerência de projetos + Fechamento
-- ============================================================
-- Antes (mig. 033): Fechamento Mensal, CRUD de projetos (save_project) e
-- reconciliação/merge de bolsas (apply_reconciliation/merge_holders) eram
-- admin-only. O professor só lia/editava bolsas, saldos, desembolsos e
-- observações dos centros de custo atribuídos a ele.
--
-- Agora: TODO professor também **gerencia projetos** (cria/edita os dele) e
-- roda o **Fechamento Mensal** dos projetos dele — "os que ele criar" ou os
-- atribuídos. Decisões do usuário:
--   • Modelo: "Estender o professor" — sem 3º papel; app_users.role continua
--     admin/professor. TODO professor ganha as capacidades, escopadas.
--   • Bolsas: "Reconciliar sim; mesclar só admin" — o professor reconcilia as
--     bolsas dos projetos dele (apply_reconciliation escopado); a mescla de
--     duplicados (merge_holders, global) continua admin-only.
--
-- Segurança no banco (a anon key é pública; security definer burla o RLS — o
-- guard interno é a barreira real):
--   • save_project: admin cria/edita qualquer; professor cria (auto-atribui a
--     si em user_projects) e edita só os seus (assert_project_allowed). Novo
--     guard de cadastro em app_users impede usuário desativado (linha
--     removida) de (re)criar projetos e se auto-atribuir.
--   • apply_reconciliation: guard vira assert_project_allowed(p_project_id) e
--     as 3 mutações de scholarship_holders passam a ser escopadas pelo
--     predicado P — reusa o holder (dedup preservado) mas só muta campos de
--     holders dominados pelo chamador (admin, ou criado por ele, ou com bolsa
--     no p_project_id). Corrige furo onde um professor mutava holder alheio
--     por CPF (o `full_name = excluded.full_name` incondicional zerava o nome).
--   • reconciliacoes: INSERT policy admin-only → escopada (o handler de bolsas
--     registra a reconciliação direto; sem isso o professor toma erro de RLS).
--
-- Sem mudança: merge_holders (admin-only), save_user_assignments (admin-only),
-- app_users.role CHECK, helpers, policies de projects/dashboard_settings
-- (escritas diretas admin-only — professor escreve só via save_project).
-- Aditiva sobre a 033 (create or replace + drop/create policy).
-- ============================================================


-- ============================================================
-- 1. save_project — admin OU professor (escopado) + auto-atribuição
-- ============================================================
-- Recria a função da mig. 033 trocando o guard admin-only por:
--   • checagem de autenticação + cadastro em app_users (defesa contra
--     desativação por remoção de linha);
--   • assert_project_allowed no path de UPDATE (professor só edita os seus);
--   • auto-atribuição em user_projects no path de INSERT (professor que cria
--     fica com acesso automático — vira um dos seus centros de custo).
-- p_include_in_general passa direto: o professor gerencia o próprio projeto e
-- pode incluí-lo na Visão Geral; o RLS direto de dashboard_settings segue
-- admin-only (save_project definer é o caminho controlado).
create or replace function public.save_project(
  p_name                text,
  p_id                  uuid    default null,
  p_code                text    default null,
  p_start_date          date    default null,
  p_end_date            date    default null,
  p_report_dates        text    default null,
  p_notes               text    default null,
  p_active              boolean default true,
  p_include_in_general  boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  -- Impede usuário não cadastrado em app_users (ex.: cadastro removido =
  -- desativação) de (re)criar projetos e se auto-atribuir.
  if not exists (select 1 from public.app_users where user_id = auth.uid()) then
    raise exception 'Usuário não cadastrado em app_users';
  end if;

  -- Professor (não-admin) só edita projeto que já tem acesso. Criação é livre.
  if not public.is_admin() and p_id is not null then
    perform public.assert_project_allowed(p_id);
  end if;

  if p_id is not null then
    update public.projects
       set name            = p_name,
           code            = p_code,
           start_date      = p_start_date,
           end_date        = p_end_date,
           report_dates    = p_report_dates,
           notes           = p_notes,
           active          = p_active
     where id = p_id
    returning id into v_project_id;

    if not found then
      raise exception 'Projeto não encontrado: %', p_id;
    end if;

    insert into public.dashboard_settings (project_id, include_in_general)
    values (v_project_id, p_include_in_general)
    on conflict (project_id) do update
    set include_in_general = p_include_in_general;
  else
    insert into public.projects (
      name, code, start_date, end_date,
      report_dates, notes, active
    ) values (
      p_name, p_code, p_start_date, p_end_date,
      p_report_dates, p_notes, p_active
    ) returning id into v_project_id;

    insert into public.dashboard_settings (project_id, include_in_general)
    values (v_project_id, p_include_in_general);
  end if;

  -- Professor que criou o projeto fica com acesso automático (vira um dos
  -- seus centros de custo). Admin não se auto-atribui.
  if p_id is null and not public.is_admin() then
    insert into public.user_projects (user_id, project_id)
    values (auth.uid(), v_project_id)
    on conflict (user_id, project_id) do nothing;
  end if;

  return v_project_id;
end;
$$;

comment on function public.save_project is
  'Cria ou atualiza um projeto e seu dashboard_settings em uma única transação. Admin cria/edita qualquer; professor cria (auto-atribui a si em user_projects) e edita só os seus (assert_project_allowed).';


-- ============================================================
-- 2. apply_reconciliation — guard por projeto + escopo das mutações de holder
-- ============================================================
-- Recria a função da mig. 033. Duas mudanças:
--
-- (a) Guard: troca o admin-only por assert_project_allowed(p_project_id) —
--   admin continua podendo (assert retorna para admin); professor só roda
--   reconciliação dos projetos dele.
--
-- (b) Escopo das 3 mutações de scholarship_holders pelo predicado P:
--     P := is_admin() OR created_by = auth.uid()
--          OR exists(scholarship do holder no p_project_id)
--   Reusa o holder (dedup preservado: returning id / vínculo da bolsa) mas só
--   MUTA campos (full_name/cpf/email/education_level) de holders dominados
--   pelo chamador. Holder alheio → 0 linhas (Sites A/C) ou no-op CASE (Site B)
--   e a bolsa ainda vincula ao holder existente.
--   Corrige também o `full_name = excluded.full_name` incondicional da 033
--   (que zerava o nome se o item viesse com nome='') → passa a coalesce.
create or replace function public.apply_reconciliation(
  p_project_id  uuid,
  p_actions     jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item       jsonb;
  v_holder_id  uuid;
  v_total      integer := 0;
begin
  -- Admin passa direto (assert retorna); professor só dos projetos dele.
  perform public.assert_project_allowed(p_project_id);

  -- Creates / vínculos
  for v_item in select * from jsonb_array_elements(coalesce(p_actions->'creates', '[]'::jsonb))
  loop
    if (v_item->>'holder_id') is not null and (v_item->>'holder_id') <> '' then
      -- Holder JÁ existe (encontrado na resolução global) → vincula nova bolsa
      -- e faz backfill. Mutação só se o chamador domina o holder (P); holder
      -- alheio → 0 linhas, mas v_holder_id já está setado e a bolsa abaixo
      -- ainda vincula ao holder existente (dedup).
      v_holder_id := (v_item->>'holder_id')::uuid;
      update public.scholarship_holders
      set
        full_name       = coalesce(nullif(v_item->>'nome', ''), full_name),
        cpf             = coalesce(nullif(v_item->>'cpf', ''), cpf),
        email           = coalesce(nullif(v_item->>'email', ''), email),
        education_level = coalesce(nullif(v_item->>'formacao', ''), education_level),
        updated_at      = now()
      where id = v_holder_id
        and (
          public.is_admin()
          or scholarship_holders.created_by = auth.uid()
          or exists (
            select 1 from public.scholarships s
            where s.holder_id = scholarship_holders.id
              and s.project_id = p_project_id
          )
        );

    elsif (v_item->>'cpf') is not null and (v_item->>'cpf') <> '' then
      -- Upsert por CPF. on conflict reusa o holder (dedup link) via returning
      -- id; o SET é condicional por campo (CASE + predicado P): holder alheio
      -- vira no-op (mantém os valores existentes), holder dominado aplica
      -- coalesce com os dados da planilha FUNAPE. (Antes o full_name era
      -- overwrite incondicional — zerava o nome com nome=''.)
      insert into public.scholarship_holders (full_name, cpf, email, education_level)
      values (
        v_item->>'nome',
        v_item->>'cpf',
        nullif(v_item->>'email', ''),
        nullif(v_item->>'formacao', '')
      )
      on conflict (cpf) do update set
        full_name       = case when (
          public.is_admin()
          or scholarship_holders.created_by = auth.uid()
          or exists (select 1 from public.scholarships s where s.holder_id = scholarship_holders.id and s.project_id = p_project_id)
        ) then coalesce(nullif(excluded.full_name, ''), scholarship_holders.full_name)
          else scholarship_holders.full_name end,
        email           = case when (
          public.is_admin()
          or scholarship_holders.created_by = auth.uid()
          or exists (select 1 from public.scholarships s where s.holder_id = scholarship_holders.id and s.project_id = p_project_id)
        ) then coalesce(nullif(excluded.email, ''), scholarship_holders.email)
          else scholarship_holders.email end,
        education_level = case when (
          public.is_admin()
          or scholarship_holders.created_by = auth.uid()
          or exists (select 1 from public.scholarships s where s.holder_id = scholarship_holders.id and s.project_id = p_project_id)
        ) then coalesce(nullif(excluded.education_level, ''), scholarship_holders.education_level)
          else scholarship_holders.education_level end
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
      -- Backfill do holder: mutação só se o chamador domina o holder (P);
      -- holder alheio → 0 linhas (a bolsa acima já ancorou em p_project_id).
      update public.scholarship_holders
      set
        cpf            = coalesce(nullif(v_item->>'cpf', ''), cpf),
        full_name      = coalesce(nullif(v_item->>'full_name', ''), full_name),
        education_level = coalesce(nullif(v_item->>'education_level', ''), education_level),
        updated_at     = now()
      where id = (v_item->>'holder_id')::uuid
        and (
          public.is_admin()
          or scholarship_holders.created_by = auth.uid()
          or exists (
            select 1 from public.scholarships s
            where s.holder_id = scholarship_holders.id
              and s.project_id = p_project_id
          )
        );
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
  'Aplica reconciliação de bolsas. Escopada por projeto (assert_project_allowed): admin ou projetos do chamador. Muta holders só se dominados pelo chamador (admin/criador/com bolsa no projeto) — reusa holder alheio para dedup sem mutá-lo. Mescla global continua admin-only (merge_holders).';


-- ============================================================
-- 3. reconciliacoes — INSERT policy admin-only → escopada
-- ============================================================
-- O handler de bolsas (holders.js) registra a reconciliação em
-- `reconciliacoes` direto após apply_reconciliation. Sem esta policy, o
-- professor rodando o Fechamento toma erro de RLS no insert. SELECT já é
-- escopado (mig. 033); UPDATE/DELETE continuam admin-only (append-mostly).
drop policy if exists "Admin insere reconciliacoes" on public.reconciliacoes;
create policy "Escopo insere reconciliacoes" on public.reconciliacoes
  for insert to authenticated
  with check (public.is_admin() or project_id = any(public.allowed_project_ids()));
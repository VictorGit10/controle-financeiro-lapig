-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Migração 025
-- Plano de Trabalho: rubricas, planos (versionados), desembolsos
-- + RPCs (upsert_plano_trabalho, get_plano_ativo, get_planos_historico)
-- + bucket de Storage para os arquivos .docx
-- + coluna funape_managed em projects (preparação Fase 2 — Balancete)
-- ============================================================
-- O Plano de Trabalho define o orçamento do projeto por rubrica
-- (a-Pessoal, b-Serviços PJ, c-Passagens, d-Diárias, e-Material,
-- f-Investimento, g-Ganho, mais CIP e DAO). Remanejamentos são
-- novas versões do plano. Apenas uma versão fica ativa por projeto.
-- Os valores são extraídos por IA a partir do DOCX (ver Edge
-- Function extract-plano-trabalho).

-- ============================================================
-- 1. TABELA: rubricas (catálogo fixo)
-- ============================================================

create table public.rubricas (
  id           uuid primary key default gen_random_uuid(),
  code         text unique not null,
  parent_code  text,
  name         text not null,
  ordem        integer not null,
  ativo        boolean not null default true,
  constraint fk_rubrica_parent
    foreign key (parent_code) references public.rubricas(code)
);

comment on table public.rubricas is
  'Catálogo de rubricas do Plano de Trabalho. Códigos seguem o template UFG (a-g) mais CIP/DAO.';
comment on column public.rubricas.code is
  'Código curto e estável. Sub-rubricas de Pessoal usam ponto (a.bolsas, a.estag).';
comment on column public.rubricas.parent_code is
  'Código da rubrica pai. NULL para rubricas de topo (a, b, c, d, e, f, g, cip_*, dao).';


-- ============================================================
-- 2. TABELA: planos_trabalho (cabeçalho de cada versão)
-- ============================================================

create table public.planos_trabalho (
  id                       uuid primary key default gen_random_uuid(),
  project_id               uuid not null references public.projects(id) on delete restrict,
  versao                   integer not null,
  tipo                     text not null check (tipo in ('original','remanejamento')),
  data_documento           date,
  arquivo_storage_path     text,
  arquivo_nome             text,
  ativo                    boolean not null default true,
  titulo                   text,
  coordenador              text,
  prazo_inicio             date,
  prazo_fim                date,
  valor_total_plano        numeric(14,2),
  valor_despesas_projeto   numeric(14,2),
  valor_cip                numeric(14,2),
  valor_dao                numeric(14,2),
  receita_origem           text,
  observacoes              text,
  raw_extraction           jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid references auth.users(id),

  constraint uq_plano_project_versao unique (project_id, versao),
  constraint chk_versao_positiva     check (versao >= 0)
);

comment on table public.planos_trabalho is
  'Versões do Plano de Trabalho de cada projeto. versao=0 é o original; 1, 2... são remanejamentos.';
comment on column public.planos_trabalho.raw_extraction is
  'JSON cru retornado pela IA na extração. Mantido para auditoria/depuração.';
comment on column public.planos_trabalho.ativo is
  'Indica a versão atualmente em vigor. Apenas uma por project_id (garantido por índice parcial).';

-- Garante no máximo 1 plano ativo por projeto.
create unique index uq_plano_ativo_por_projeto
  on public.planos_trabalho(project_id)
  where ativo = true;

create index idx_planos_project on public.planos_trabalho(project_id);


-- ============================================================
-- 3. TABELA: plano_rubricas (orçamento por rubrica em cada versão)
-- ============================================================

create table public.plano_rubricas (
  id                uuid primary key default gen_random_uuid(),
  plano_id          uuid not null references public.planos_trabalho(id) on delete cascade,
  rubrica_code      text not null references public.rubricas(code),
  valor_previsto    numeric(14,2) not null default 0,
  descricao_livre   text,

  constraint uq_plano_rubrica
    unique (plano_id, rubrica_code, descricao_livre)
);

comment on table public.plano_rubricas is
  'Valor previsto por rubrica em uma versão do plano. descricao_livre é usada para sub-itens variáveis (ex.: "Serviços de transporte" dentro de b).';

create index idx_plano_rubricas_plano on public.plano_rubricas(plano_id);


-- ============================================================
-- 4. TABELA: plano_desembolsos (cronograma da Seção II.b)
-- ============================================================

create table public.plano_desembolsos (
  id              uuid primary key default gen_random_uuid(),
  plano_id        uuid not null references public.planos_trabalho(id) on delete cascade,
  parcela         integer not null,
  data_prevista   date,
  data_texto      text,
  valor           numeric(14,2),
  valor_texto     text,

  constraint uq_desembolso_parcela unique (plano_id, parcela)
);

comment on table public.plano_desembolsos is
  'Cronograma de desembolso por parcela. data_texto/valor_texto preservam o original quando não é possível normalizar (ex.: WRI diz "mediante cálculo de gastos").';


-- ============================================================
-- 5. Trigger updated_at + enforce_single_ativo
-- ============================================================

create trigger trg_planos_trabalho_updated_at
  before update on public.planos_trabalho
  for each row execute function public.update_updated_at();

-- Antes de ativar um plano, desativa qualquer outro do mesmo projeto.
-- Roda BEFORE para evitar conflito com o índice uq_plano_ativo_por_projeto.
create or replace function public.enforce_single_plano_ativo()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.ativo = true then
    update public.planos_trabalho
       set ativo = false
     where project_id = new.project_id
       and id <> new.id
       and ativo = true;
  end if;
  return new;
end;
$$;

comment on function public.enforce_single_plano_ativo is
  'Garante que apenas um plano de trabalho fique ativo por projeto. Desativa os demais antes do INSERT/UPDATE que marca ativo=true.';

create trigger trg_planos_enforce_single_ativo
  before insert or update of ativo on public.planos_trabalho
  for each row execute function public.enforce_single_plano_ativo();


-- ============================================================
-- 6. RLS — autenticado tem acesso total
-- ============================================================

alter table public.rubricas           enable row level security;
alter table public.planos_trabalho    enable row level security;
alter table public.plano_rubricas     enable row level security;
alter table public.plano_desembolsos  enable row level security;

create policy "Autenticado lê rubricas"     on public.rubricas for select to authenticated using (true);
create policy "Autenticado insere rubricas" on public.rubricas for insert to authenticated with check (true);
create policy "Autenticado edita rubricas"  on public.rubricas for update to authenticated using (true) with check (true);
create policy "Autenticado exclui rubricas" on public.rubricas for delete to authenticated using (true);

create policy "Autenticado lê planos"       on public.planos_trabalho for select to authenticated using (true);
create policy "Autenticado insere planos"   on public.planos_trabalho for insert to authenticated with check (true);
create policy "Autenticado edita planos"    on public.planos_trabalho for update to authenticated using (true) with check (true);
create policy "Autenticado exclui planos"   on public.planos_trabalho for delete to authenticated using (true);

create policy "Autenticado lê plano_rubricas"     on public.plano_rubricas for select to authenticated using (true);
create policy "Autenticado insere plano_rubricas" on public.plano_rubricas for insert to authenticated with check (true);
create policy "Autenticado edita plano_rubricas"  on public.plano_rubricas for update to authenticated using (true) with check (true);
create policy "Autenticado exclui plano_rubricas" on public.plano_rubricas for delete to authenticated using (true);

create policy "Autenticado lê plano_desembolsos"     on public.plano_desembolsos for select to authenticated using (true);
create policy "Autenticado insere plano_desembolsos" on public.plano_desembolsos for insert to authenticated with check (true);
create policy "Autenticado edita plano_desembolsos"  on public.plano_desembolsos for update to authenticated using (true) with check (true);
create policy "Autenticado exclui plano_desembolsos" on public.plano_desembolsos for delete to authenticated using (true);


-- ============================================================
-- 7. Seed de rubricas (idempotente)
-- ============================================================

insert into public.rubricas (code, parent_code, name, ordem) values
  ('a',         null, 'Pessoal',                                    10),
  ('a.colab',   'a',  'Colaboradores eventuais (pessoal CLT)',      11),
  ('a.enc',     'a',  'Encargos s/ CLT',                            12),
  ('a.cons',    'a',  'Consultorias (STPF-RPA) + Encargos',         13),
  ('a.estag',   'a',  'Estagiários',                                14),
  ('a.bolsas',  'a',  'Bolsas',                                     15),
  ('a.outros',  'a',  'Outros encargos',                            16),
  ('b',         null, 'Serviços de Terceiros P. Jurídica',          20),
  ('c',         null, 'Passagens e Despesas com Locomoção',         30),
  ('d',         null, 'Despesas com diárias',                       40),
  ('e',         null, 'Material de Consumo',                        50),
  ('f',         null, 'Investimento',                               60),
  ('g',         null, 'Ganho econômico',                            70),
  ('cip_ufg',   null, 'Custos Indiretos (CIP) — UFG',               80),
  ('cip_ua',    null, 'Custos Indiretos (CIP) — UA/Órgão',          81),
  ('dao',       null, 'Despesas Adm e Operacionais (DAO)',          90)
on conflict (code) do nothing;


-- ============================================================
-- 8. ALTER projects: flag funape_managed (uso na Fase 2)
-- ============================================================

alter table public.projects
  add column if not exists funape_managed boolean not null default false;

comment on column public.projects.funape_managed is
  'Quando true, os gastos virão do balancete mensal da FUNAPE (Fase 2). A página de Gastos esconde projetos com esta flag.';

-- Atualiza save_project para aceitar o novo parâmetro.
-- A assinatura anterior (017) tem 9 args; aqui passamos para 10.
drop function if exists public.save_project(
  text, uuid, text, date, date, text, text, boolean, boolean
);

create or replace function public.save_project(
  p_name                text,
  p_id                  uuid    default null,
  p_code                text    default null,
  p_start_date          date    default null,
  p_end_date            date    default null,
  p_report_dates        text    default null,
  p_notes               text    default null,
  p_active              boolean default true,
  p_include_in_general  boolean default false,
  p_funape_managed      boolean default false
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_project_id uuid;
begin
  if p_id is not null then
    update public.projects
       set name            = p_name,
           code            = p_code,
           start_date      = p_start_date,
           end_date        = p_end_date,
           report_dates    = p_report_dates,
           notes           = p_notes,
           active          = p_active,
           funape_managed  = p_funape_managed
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
      report_dates, notes, active, funape_managed
    ) values (
      p_name, p_code, p_start_date, p_end_date,
      p_report_dates, p_notes, p_active, p_funape_managed
    ) returning id into v_project_id;

    insert into public.dashboard_settings (project_id, include_in_general)
    values (v_project_id, p_include_in_general);
  end if;

  return v_project_id;
end;
$$;

comment on function public.save_project is
  'Cria ou atualiza um projeto e seu dashboard_settings em uma única transação. Inclui flag funape_managed (Fase 2 — Balancete).';


-- ============================================================
-- 9. Supabase Storage: bucket privado para os DOCX
-- ============================================================

insert into storage.buckets (id, name, public)
values ('plano-trabalho-docs', 'plano-trabalho-docs', false)
on conflict (id) do nothing;

-- Policies em storage.objects para o bucket. Padrão: autenticado tudo.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage'
       and tablename  = 'objects'
       and policyname = 'plano_docs_auth_select'
  ) then
    create policy plano_docs_auth_select on storage.objects
      for select to authenticated
      using (bucket_id = 'plano-trabalho-docs');
    create policy plano_docs_auth_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'plano-trabalho-docs');
    create policy plano_docs_auth_update on storage.objects
      for update to authenticated
      using (bucket_id = 'plano-trabalho-docs')
      with check (bucket_id = 'plano-trabalho-docs');
    create policy plano_docs_auth_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'plano-trabalho-docs');
  end if;
end$$;


-- ============================================================
-- 10. RPC: upsert_plano_trabalho (transacional)
-- ============================================================
-- Recebe o JSON revisado pelo usuário e cria/atualiza o plano,
-- substituindo as rubricas e desembolsos atômica.
-- Para inserções, calcula 'versao' = MAX(versao)+1 do projeto.
-- O trigger enforce_single_plano_ativo garante exclusividade do flag ativo.

create or replace function public.upsert_plano_trabalho(p_payload jsonb)
returns uuid
language plpgsql
security definer
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
    returning id into v_plano_id;

    if not found then
      raise exception 'Plano não encontrado: %', v_plano_id;
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

comment on function public.upsert_plano_trabalho is
  'Cria ou atualiza um plano de trabalho a partir do JSON revisado pelo usuário. Recalcula a versão automaticamente em inserções.';


-- ============================================================
-- 11. RPC: ativar_plano_trabalho
-- ============================================================
-- Marca uma versão como ativa (o trigger desativa as demais).

create or replace function public.ativar_plano_trabalho(p_plano_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update public.planos_trabalho
     set ativo = true
   where id = p_plano_id;

  if not found then
    raise exception 'Plano não encontrado: %', p_plano_id;
  end if;
end;
$$;

comment on function public.ativar_plano_trabalho is
  'Torna a versão indicada o plano ativo do projeto (desativa as outras via trigger).';


-- ============================================================
-- 12. RPC: get_plano_ativo (cabeçalho + rubricas + desembolsos)
-- ============================================================

create or replace function public.get_plano_ativo(p_project_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_result jsonb;
begin
  select to_jsonb(pt.*)
       || jsonb_build_object(
            'rubricas', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', pr.id,
                  'rubrica_code', pr.rubrica_code,
                  'rubrica_name', r.name,
                  'parent_code',  r.parent_code,
                  'ordem',        r.ordem,
                  'valor_previsto', pr.valor_previsto,
                  'descricao_livre', pr.descricao_livre
                )
                order by r.ordem, pr.descricao_livre nulls first
              )
              from public.plano_rubricas pr
              join public.rubricas r on r.code = pr.rubrica_code
              where pr.plano_id = pt.id
            ), '[]'::jsonb),
            'desembolsos', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', pd.id,
                  'parcela', pd.parcela,
                  'data_prevista', pd.data_prevista,
                  'data_texto',    pd.data_texto,
                  'valor',         pd.valor,
                  'valor_texto',   pd.valor_texto
                )
                order by pd.parcela
              )
              from public.plano_desembolsos pd
              where pd.plano_id = pt.id
            ), '[]'::jsonb)
          )
    into v_result
    from public.planos_trabalho pt
   where pt.project_id = p_project_id
     and pt.ativo = true
   limit 1;

  return v_result;  -- null se o projeto ainda não tem plano
end;
$$;

comment on function public.get_plano_ativo is
  'Retorna o plano de trabalho ATIVO de um projeto, com rubricas e desembolsos inclusos.';


-- ============================================================
-- 13. RPC: get_planos_historico (versões resumidas)
-- ============================================================

create or replace function public.get_planos_historico(p_project_id uuid)
returns table (
  id                uuid,
  versao            integer,
  tipo              text,
  data_documento    date,
  ativo             boolean,
  titulo            text,
  valor_total_plano numeric,
  arquivo_nome      text,
  created_at        timestamptz
)
language plpgsql
security definer
as $$
begin
  return query
    select pt.id, pt.versao, pt.tipo, pt.data_documento, pt.ativo,
           pt.titulo, pt.valor_total_plano, pt.arquivo_nome, pt.created_at
      from public.planos_trabalho pt
     where pt.project_id = p_project_id
     order by pt.versao desc;
end;
$$;

comment on function public.get_planos_historico is
  'Lista resumida de todas as versões do plano de trabalho de um projeto, da mais recente para a mais antiga.';

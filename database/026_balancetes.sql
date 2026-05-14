-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Migração 026
-- Balancete mensal da FUNAPE: cabeçalho, lançamentos contábeis,
-- mapeamento conta → rubrica, RPCs de Previsto x Realizado,
-- + limpeza/proteção de `expenses` para projetos FUNAPE.
-- ============================================================
-- Para projetos FUNAPE (projects.funape_managed = true), o gasto
-- realizado vem do balancete importado mensalmente. A tabela
-- `expenses` deixa de receber registros para esses projetos.

-- ============================================================
-- 1. TABELA: balancetes (cabeçalho)
-- ============================================================

create table public.balancetes (
  id                       uuid primary key default gen_random_uuid(),
  project_id               uuid not null references public.projects(id) on delete restrict,
  data_referencia          date not null,
  data_emissao             date,
  periodo_inicio           date,
  saldo_disponivel         numeric(14,2),
  rendimento_liquido       numeric(14,2),
  total_debitos            numeric(14,2),
  total_creditos           numeric(14,2),
  observacoes              text,
  arquivo_storage_path     text,
  arquivo_nome             text,
  raw_extraction           jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid references auth.users(id),

  constraint uq_balancete_proj_data unique (project_id, data_referencia)
);

comment on table public.balancetes is
  'Cabeçalho de cada balancete contábil mensal da FUNAPE. Um por projeto+data_referencia.';
comment on column public.balancetes.data_referencia is
  'Data final do período do balancete (cabeçalho "01/01/2000 a DD/MM/AAAA").';
comment on column public.balancetes.saldo_disponivel is
  '"SALDO DISPONÍVEL PÓS IR/IOF ESTIMADO S/ REND. APL. FINANCEIRA" (já inclui rendimento).';
comment on column public.balancetes.rendimento_liquido is
  '"RENDIMENTO LÍQUIDO APURADO" — já somado no saldo_disponivel, registrado separado para discriminar.';

create index idx_balancetes_project on public.balancetes(project_id);
create index idx_balancetes_data    on public.balancetes(project_id, data_referencia desc);

-- ============================================================
-- 2. TABELA: balancete_lancamentos (linhas contábeis)
-- ============================================================

create table public.balancete_lancamentos (
  id               uuid primary key default gen_random_uuid(),
  balancete_id     uuid not null references public.balancetes(id) on delete cascade,
  conta_codigo     text not null,
  conta_descricao  text,
  valor_debito     numeric(14,2) not null default 0,
  valor_credito    numeric(14,2) not null default 0,
  saldo_atual      numeric(14,2) not null default 0,
  rubrica_code     text references public.rubricas(code),

  constraint uq_lancamento unique (balancete_id, conta_codigo)
);

comment on table public.balancete_lancamentos is
  'Lançamentos individuais do balancete (linhas com código contábil 7.1.3.x, 1.1.1.x etc.). rubrica_code é resolvido via conta_rubrica_map (pode ser NULL para contas não mapeadas).';

create index idx_lanc_balancete on public.balancete_lancamentos(balancete_id);
create index idx_lanc_rubrica   on public.balancete_lancamentos(rubrica_code) where rubrica_code is not null;

-- ============================================================
-- 3. TABELA: conta_rubrica_map (catálogo de mapeamento)
-- ============================================================
-- A resolução usa LONGEST-PREFIX-MATCH: '7.1.3.05.01.99520' bate
-- antes de '7.1.3.05'. Permite refinar exceções (CIP, DAO) sem
-- precisar listar cada conta-folha.

create table public.conta_rubrica_map (
  conta_prefix    text primary key,
  rubrica_code    text not null references public.rubricas(code),
  descricao       text,
  ativo           boolean not null default true,
  created_at      timestamptz not null default now()
);

comment on table public.conta_rubrica_map is
  'Mapeamento prefix-based de contas contábeis FUNAPE para rubricas do Plano de Trabalho. Longest-prefix-match resolve hierarquia.';

-- ============================================================
-- 4. Seed do mapeamento (baseado nos balancetes 30.099 e 30.113)
-- ============================================================

insert into public.conta_rubrica_map (conta_prefix, rubrica_code, descricao) values
  -- Linhas de despesa
  ('7.1.3.02',                'd',         'DIÁRIAS'),
  ('7.1.3.03',                'e',         'MATERIAL DE CONSUMO'),
  ('7.1.3.04',                'a.bolsas',  'SERVIÇOS TERCEIROS PESSOA FÍSICA (Bolsa Doação)'),
  ('7.1.3.05',                'b',         'SERVIÇOS TERCEIROS PESSOA JURÍDICA (default)'),
  ('7.1.3.05.01.00051',       'dao',       'DESPESA ADM E OPERACIONAL (DAO)'),
  ('7.1.3.05.01.99520',       'cip_ua',    'FUNDO LOCAL CIP (UA/Órgão)'),
  ('7.1.3.05.01.99521',       'cip_ufg',   'FUNDO INSTITUCIONAL CIP (UFG)'),
  ('7.1.3.06',                'f',         'INVESTIMENTOS (palpite — confirmar)'),
  ('7.1.3.07',                'c',         'PASSAGENS (palpite — confirmar)')
on conflict (conta_prefix) do nothing;

-- Função utilitária: resolve a rubrica de uma conta usando longest-prefix-match.
create or replace function public.resolve_rubrica_for_conta(p_conta text)
returns text
language plpgsql
stable
security definer
as $$
declare
  v_rubrica text;
begin
  select rubrica_code
    into v_rubrica
    from public.conta_rubrica_map
   where ativo = true
     and p_conta like conta_prefix || '%'
   order by length(conta_prefix) desc
   limit 1;

  return v_rubrica;
end;
$$;

comment on function public.resolve_rubrica_for_conta is
  'Resolve uma conta contábil (ex.: 7.1.3.05.01.99520) para a rubrica configurada. Usa longest-prefix-match.';

-- ============================================================
-- 5. Trigger updated_at e auto-resolve rubrica em lançamentos
-- ============================================================

create trigger trg_balancetes_updated_at
  before update on public.balancetes
  for each row execute function public.update_updated_at();

create or replace function public.auto_resolve_rubrica_lancamento()
returns trigger
language plpgsql
as $$
begin
  if new.rubrica_code is null then
    new.rubrica_code := public.resolve_rubrica_for_conta(new.conta_codigo);
  end if;
  return new;
end;
$$;

create trigger trg_auto_resolve_rubrica
  before insert or update of conta_codigo on public.balancete_lancamentos
  for each row execute function public.auto_resolve_rubrica_lancamento();


-- ============================================================
-- 6. RLS
-- ============================================================

alter table public.balancetes              enable row level security;
alter table public.balancete_lancamentos   enable row level security;
alter table public.conta_rubrica_map       enable row level security;

create policy "Autenticado lê balancetes"     on public.balancetes for select to authenticated using (true);
create policy "Autenticado insere balancetes" on public.balancetes for insert to authenticated with check (true);
create policy "Autenticado edita balancetes"  on public.balancetes for update to authenticated using (true) with check (true);
create policy "Autenticado exclui balancetes" on public.balancetes for delete to authenticated using (true);

create policy "Autenticado lê lancamentos"     on public.balancete_lancamentos for select to authenticated using (true);
create policy "Autenticado insere lancamentos" on public.balancete_lancamentos for insert to authenticated with check (true);
create policy "Autenticado edita lancamentos"  on public.balancete_lancamentos for update to authenticated using (true) with check (true);
create policy "Autenticado exclui lancamentos" on public.balancete_lancamentos for delete to authenticated using (true);

create policy "Autenticado lê mapeamento"     on public.conta_rubrica_map for select to authenticated using (true);
create policy "Autenticado insere mapeamento" on public.conta_rubrica_map for insert to authenticated with check (true);
create policy "Autenticado edita mapeamento"  on public.conta_rubrica_map for update to authenticated using (true) with check (true);
create policy "Autenticado exclui mapeamento" on public.conta_rubrica_map for delete to authenticated using (true);


-- ============================================================
-- 7. Limpeza de `expenses` para projetos FUNAPE + proteção
-- ============================================================
-- Política aprovada pelo usuário: para projetos com funape_managed=true,
-- os gastos vêm 100% do balancete. Registros existentes em `expenses`
-- são apagados (one-time) e um trigger bloqueia novas inserções/updates.

delete from public.expenses e
 using public.projects p
 where e.project_id = p.id
   and p.funape_managed = true;

create or replace function public.block_expenses_for_funape()
returns trigger
language plpgsql
as $$
declare
  v_funape boolean;
begin
  select funape_managed into v_funape
    from public.projects
   where id = new.project_id;

  if coalesce(v_funape, false) = true then
    raise exception 'Projeto é gerido pela FUNAPE — gastos devem ser importados via balancete (não pela tabela expenses).'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.block_expenses_for_funape is
  'Bloqueia INSERT/UPDATE em expenses quando o projeto está marcado como funape_managed. Os gastos desses projetos devem vir do balancete.';

create trigger trg_block_expenses_funape
  before insert or update on public.expenses
  for each row execute function public.block_expenses_for_funape();


-- ============================================================
-- 8. Storage: bucket privado para PDFs dos balancetes
-- ============================================================

insert into storage.buckets (id, name, public)
values ('balancete-pdfs', 'balancete-pdfs', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'balancete_auth_select'
  ) then
    create policy balancete_auth_select on storage.objects
      for select to authenticated using (bucket_id = 'balancete-pdfs');
    create policy balancete_auth_insert on storage.objects
      for insert to authenticated with check (bucket_id = 'balancete-pdfs');
    create policy balancete_auth_update on storage.objects
      for update to authenticated using (bucket_id = 'balancete-pdfs') with check (bucket_id = 'balancete-pdfs');
    create policy balancete_auth_delete on storage.objects
      for delete to authenticated using (bucket_id = 'balancete-pdfs');
  end if;
end$$;


-- ============================================================
-- 9. RPC: upsert_balancete (transacional)
-- ============================================================

create or replace function public.upsert_balancete(p_payload jsonb)
returns uuid
language plpgsql
security definer
as $$
declare
  v_id           uuid;
  v_project_id   uuid;
  v_data_ref     date;
  r_lanc         jsonb;
begin
  v_project_id := (p_payload->>'project_id')::uuid;
  v_data_ref   := (p_payload->>'data_referencia')::date;

  if v_project_id is null or v_data_ref is null then
    raise exception 'project_id e data_referencia são obrigatórios.';
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
        (balancete_id, conta_codigo, conta_descricao, valor_debito, valor_credito, saldo_atual)
      values (
        v_id,
        r_lanc->>'conta_codigo',
        r_lanc->>'conta_descricao',
        coalesce((r_lanc->>'valor_debito')::numeric, 0),
        coalesce((r_lanc->>'valor_credito')::numeric, 0),
        coalesce((r_lanc->>'saldo_atual')::numeric, 0)
      );
      -- rubrica_code é setado pelo trigger trg_auto_resolve_rubrica
    end loop;
  end if;

  return v_id;
end;
$$;

comment on function public.upsert_balancete is
  'Cria ou atualiza um balancete a partir do JSON revisado. Os lançamentos são substituídos integralmente. rubrica_code é resolvido automaticamente via mapeamento (trigger).';


-- ============================================================
-- 10. RPC: get_balancetes_by_project (lista + último)
-- ============================================================

create or replace function public.get_balancetes_by_project(p_project_id uuid)
returns table (
  id                 uuid,
  data_referencia    date,
  data_emissao       date,
  saldo_disponivel   numeric,
  rendimento_liquido numeric,
  total_debitos      numeric,
  total_creditos     numeric,
  arquivo_nome       text,
  created_at         timestamptz
)
language plpgsql
security definer
as $$
begin
  return query
    select b.id, b.data_referencia, b.data_emissao,
           b.saldo_disponivel, b.rendimento_liquido,
           b.total_debitos, b.total_creditos,
           b.arquivo_nome, b.created_at
      from public.balancetes b
     where b.project_id = p_project_id
     order by b.data_referencia desc;
end;
$$;


-- ============================================================
-- 11. RPC: get_balancete_detalhado (cabeçalho + lançamentos)
-- ============================================================

create or replace function public.get_balancete_detalhado(p_balancete_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_result jsonb;
begin
  select to_jsonb(b.*)
       || jsonb_build_object('lancamentos', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', l.id,
                'conta_codigo', l.conta_codigo,
                'conta_descricao', l.conta_descricao,
                'valor_debito', l.valor_debito,
                'valor_credito', l.valor_credito,
                'saldo_atual', l.saldo_atual,
                'rubrica_code', l.rubrica_code,
                'rubrica_name', r.name
              )
              order by l.conta_codigo
            )
            from public.balancete_lancamentos l
            left join public.rubricas r on r.code = l.rubrica_code
            where l.balancete_id = b.id
          ), '[]'::jsonb))
    into v_result
    from public.balancetes b
   where b.id = p_balancete_id;

  return v_result;
end;
$$;


-- ============================================================
-- 12. RPC: get_previsto_vs_realizado
-- ============================================================
-- Cruza o plano ativo do projeto com o balancete mais recente,
-- agregando o realizado por rubrica.

create or replace function public.get_previsto_vs_realizado(p_project_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_plano_id           uuid;
  v_balancete_id       uuid;
  v_balancete_data     date;
  v_balancete_saldo    numeric;
  v_balancete_rend     numeric;
  v_rubricas           jsonb;
  v_nao_mapeados       jsonb;
begin
  -- Plano ativo
  select id into v_plano_id
    from public.planos_trabalho
   where project_id = p_project_id and ativo = true
   limit 1;

  -- Balancete mais recente
  select id, data_referencia, saldo_disponivel, rendimento_liquido
    into v_balancete_id, v_balancete_data, v_balancete_saldo, v_balancete_rend
    from public.balancetes
   where project_id = p_project_id
   order by data_referencia desc
   limit 1;

  if v_plano_id is null then
    return jsonb_build_object(
      'has_plano', false,
      'has_balancete', v_balancete_id is not null,
      'message', 'Sem plano de trabalho ativo para este projeto.'
    );
  end if;

  -- Por rubrica: soma previsto (do plano ativo) + soma realizado (do balancete)
  with previsto as (
    select rubrica_code, sum(valor_previsto) as total_previsto
      from public.plano_rubricas
     where plano_id = v_plano_id
     group by rubrica_code
  ),
  realizado as (
    select rubrica_code, sum(saldo_atual) as total_realizado
      from public.balancete_lancamentos
     where balancete_id = v_balancete_id and rubrica_code is not null
     group by rubrica_code
  ),
  todas as (
    select r.code as rubrica_code, r.name, r.parent_code, r.ordem,
           coalesce(p.total_previsto, 0)  as previsto,
           coalesce(rr.total_realizado, 0) as realizado
      from public.rubricas r
      left join previsto  p  on p.rubrica_code  = r.code
      left join realizado rr on rr.rubrica_code = r.code
     where coalesce(p.total_previsto, 0) > 0
        or coalesce(rr.total_realizado, 0) > 0
     order by r.ordem
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'rubrica_code',  rubrica_code,
      'rubrica_name',  name,
      'parent_code',   parent_code,
      'previsto',      previsto,
      'realizado',     realizado,
      'saldo',         (previsto - realizado),
      'perc_executado', case when previsto > 0 then round((realizado / previsto) * 100, 2) else null end
    )
  ), '[]'::jsonb)
    into v_rubricas
    from todas;

  -- Lançamentos não mapeados (rubrica_code null) — geralmente despesas tributárias
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'conta_codigo',    conta_codigo,
      'conta_descricao', conta_descricao,
      'saldo_atual',     saldo_atual
    ) order by conta_codigo
  ), '[]'::jsonb)
    into v_nao_mapeados
    from public.balancete_lancamentos
   where balancete_id = v_balancete_id and rubrica_code is null and saldo_atual > 0;

  return jsonb_build_object(
    'has_plano',          true,
    'has_balancete',      v_balancete_id is not null,
    'balancete_id',       v_balancete_id,
    'data_referencia',    v_balancete_data,
    'saldo_disponivel',   v_balancete_saldo,
    'rendimento_liquido', v_balancete_rend,
    'rubricas',           coalesce(v_rubricas, '[]'::jsonb),
    'nao_mapeados',       v_nao_mapeados
  );
end;
$$;

comment on function public.get_previsto_vs_realizado is
  'Cruza o plano ativo do projeto com o balancete mais recente. Retorna por rubrica: previsto, realizado, saldo e percentual executado, além das contas não mapeadas (tributos, bancárias).';

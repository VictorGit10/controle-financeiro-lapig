-- ============================================================
-- 053_item_do_plano.sql
--
-- CLASSIFICAR POR ITEM DO PLANO, NÃO SÓ PELA LETRA.
--
-- O plano do 30.068 tem três itens em `e` ("componentes eletrônicos —
-- manutenção", "impressão de material gráfico", "componentes
-- eletrônicos — peças de informática"), dois em `f` e três em `b`. O
-- sistema só sabia a letra: o Previsto×Realizado mostrava o previsto de
-- cada item e o realizado da letra inteira, e o detalhe terminava em
-- "Sem descrição no plano". Quem coordena pensa — e presta contas — por
-- item (a tabela mandada ao professor em 2026-09-30 já era por item).
--
-- (A) `balancete_lancamentos.item_descricao`: o item resolvido de cada
--     lançamento (a descrição como está no plano ativo).
--
-- (B) `conta_item_map` — regra conta → item, POR PROJETO. Não cabe no
--     conta_rubrica_map: aquele é global e casa por prefixo, e item é de
--     cada projeto e de cada versão do plano. A regra guarda (rubrica,
--     descrição) e casa com o plano ativo pela descrição NORMALIZADA
--     (`norm_item`: sem acento, caixa, pontuação nem aspas), não pelo id
--     de plano_rubricas — o id troca a cada plano ativado, a descrição
--     sobrevive a um remanejamento. Item que sumir do plano novo não é
--     chutado: o lançamento fica sem item e aparece como "Sem item
--     atribuído".
--     A regra é DECISÃO HUMANA DO PROJETO e por isso vence a letra do
--     mapa global: no 30.068 o Victor decidiu que frete de importação
--     (conta de `b` no plano de contas da FUNAPE) é Investimento ›
--     transporte e taxas, e serviço gráfico (`b`) é Material de Consumo
--     › impressão. Sem isso a tabela do professor não fecha. O que NÃO
--     vence: rubrica escolhida explicitamente na revisão (resposta a uma
--     pergunta) que contradiga a regra — aí o lançamento fica sem item.
--
-- (C) Letra com um único item descrito (e nenhuma linha sem descrição)
--     escolhe o item sozinha: bolsas, passagens, diárias, DAO.
--
-- (D) O gatilho `auto_resolve_rubrica_lancamento` (026) passa a
--     resolver letra E item, na inserção. Continua `security invoker`
--     com search_path fixo (036/037): roda dentro do upsert_balancete
--     (definer), que é quem insere.
--
-- (E) `upsert_balancete` aceita `item_descricao` por lançamento (a
--     resposta da revisão) e `new_item_mappings` ([{ conta_prefix,
--     rubrica_code, item_descricao }]) para gravar a regra do projeto.
--     Corpo da 051 + os dois blocos.
--
-- (F) `get_previsto_vs_realizado`: cada item de `detalhes` ganha
--     `realizado` e `saldo`; a rubrica ganha `realizado_sem_item` (o que
--     ainda não tem item) e `previsto_sem_descricao`. `contas` ganha o
--     item de cada conta. Chaves antigas mantidas (o MCP e a tela as
--     leem). Corpo da 049 + o detalhamento.
--
-- (G) Semente do 30.068 (decisões do Victor de 2026-10-01, caderno do
--     Buriti) e backfill dos balancetes já gravados de todos os
--     projetos (regras + item único). O que ficar sem item sai num
--     NOTICE — é a lista de perguntas a fazer, não um chute.
--
-- A tabela nova recebe a barreira do agente (mig. 051): tabela criada
-- depois da 051 não a ganha sozinha.
--
-- Conferência: tests/sql/test_053_item_do_plano.sql
-- ============================================================

begin;

-- ------------------------------------------------------------
-- (A) item no lançamento
-- ------------------------------------------------------------
alter table public.balancete_lancamentos add column if not exists item_descricao text;
alter table public.balancete_lancamentos add column if not exists classificado_na_revisao boolean not null default false;

comment on column public.balancete_lancamentos.classificado_na_revisao is
  'true quando a rubrica ou o item veio de resposta humana na revisão (mig. 053). Backfill e regras nunca sobrescrevem essas linhas — nem quando a resposta coincide com a letra do mapa.';
comment on column public.balancete_lancamentos.item_descricao is
  'Item do plano ativo a que o lançamento pertence (descrição como está no plano). NULL = sem item atribuído (mig. 053).';

-- ------------------------------------------------------------
-- Normalização e consulta ao plano ativo
-- ------------------------------------------------------------
create or replace function public.norm_item(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(btrim(regexp_replace(
           lower(translate(coalesce(p, ''),
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')),
           '[^a-z0-9]+', ' ', 'g')), '');
$$;

-- Descrição do item no plano ativo do projeto, se existir com essa letra.
create or replace function public.item_do_plano(p_project_id uuid, p_rubrica text, p_item text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select btrim(pr.descricao_livre, '" ')
    from public.plano_rubricas pr
    join public.planos_trabalho pt on pt.id = pr.plano_id
   where pt.project_id = p_project_id and pt.ativo
     and pr.rubrica_code = p_rubrica
     and public.norm_item(pr.descricao_livre) = public.norm_item(p_item)
     and public.norm_item(p_item) is not null
   limit 1;
$$;

-- O item, quando a letra tem um só (descrito) e nenhuma linha sem descrição.
create or replace function public.item_unico(p_project_id uuid, p_rubrica text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select min(btrim(pr.descricao_livre, '" '))
    from public.plano_rubricas pr
    join public.planos_trabalho pt on pt.id = pr.plano_id
   where pt.project_id = p_project_id and pt.ativo
     and pr.rubrica_code = p_rubrica
  having count(distinct public.norm_item(pr.descricao_livre)) = 1
     and count(*) filter (where public.norm_item(pr.descricao_livre) is null) = 0;
$$;

-- ------------------------------------------------------------
-- (B) regra conta → item, por projeto
-- ------------------------------------------------------------
create table if not exists public.conta_item_map (
  project_id     uuid not null references public.projects(id) on delete cascade,
  conta_prefix   text not null,
  rubrica_code   text not null references public.rubricas(code),
  item_descricao text not null,
  criado_por     uuid default auth.uid(),
  criado_em      timestamptz not null default now(),
  primary key (project_id, conta_prefix)
);

comment on table public.conta_item_map is
  'Regra conta → item do plano, por projeto (mig. 053). Decisão humana: vence a letra do conta_rubrica_map global. Casa com o plano ativo pela descrição normalizada.';

alter table public.conta_item_map enable row level security;
drop policy if exists "Escopo lê regras de item" on public.conta_item_map;
create policy "Escopo lê regras de item" on public.conta_item_map
  for select to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()));
revoke insert, update, delete, truncate on public.conta_item_map from anon, authenticated;
grant select on public.conta_item_map to authenticated;

-- barreira do agente (mig. 051): tabela nova não a ganha sozinha
drop trigger if exists trg_bloqueia_agente on public.conta_item_map;
create trigger trg_bloqueia_agente before insert or update or delete on public.conta_item_map
  for each statement execute function public.bloqueia_escrita_do_agente();

-- Regra mais específica do projeto para a conta (longest-prefix).
create or replace function public.regra_item(p_project_id uuid, p_conta text)
returns public.conta_item_map
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select *
    from public.conta_item_map m
   where m.project_id = p_project_id
     and p_conta like m.conta_prefix || '%'
   order by length(m.conta_prefix) desc
   limit 1;
$$;

-- ------------------------------------------------------------
-- (D) o gatilho resolve letra e item
-- ------------------------------------------------------------
create or replace function public.auto_resolve_rubrica_lancamento()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_proj      uuid;
  v_explicita boolean := new.rubrica_code is not null;
  v_regra     public.conta_item_map;
  v_item      text;
begin
  -- resposta humana marcada: o backfill da 053 nunca a sobrescreve
  new.classificado_na_revisao := new.classificado_na_revisao
                                 or new.rubrica_code is not null
                                 or new.item_descricao is not null;
  if not v_explicita then
    new.rubrica_code := public.resolve_rubrica_for_conta(new.conta_codigo);
  end if;

  select project_id into v_proj from public.balancetes where id = new.balancete_id;
  if v_proj is null then
    return new;
  end if;

  if new.item_descricao is not null then
    -- item respondido na revisão: vale se existir no plano com essa letra
    new.item_descricao := public.item_do_plano(v_proj, new.rubrica_code, new.item_descricao);
    return new;
  end if;

  v_regra := public.regra_item(v_proj, new.conta_codigo);
  if v_regra.conta_prefix is not null then
    v_item := public.item_do_plano(v_proj, v_regra.rubrica_code, v_regra.item_descricao);
    -- regra do projeto vence a letra do mapa; não vence a resposta explícita
    if v_item is not null and (not v_explicita or v_regra.rubrica_code = new.rubrica_code) then
      new.rubrica_code   := v_regra.rubrica_code;
      new.item_descricao := v_item;
      return new;
    end if;
  end if;

  if new.rubrica_code is not null then
    new.item_descricao := public.item_unico(v_proj, new.rubrica_code);
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- (E) upsert_balancete: corpo da 051 + item por lançamento e regra
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

  -- Regras de ITEM do projeto (mig. 053), também antes dos lançamentos.
  if jsonb_typeof(p_payload->'new_item_mappings') = 'array' then
    for r_map in select * from jsonb_array_elements(p_payload->'new_item_mappings')
    loop
      if nullif(r_map->>'conta_prefix', '') is not null
         and nullif(r_map->>'rubrica_code', '') is not null
         and nullif(r_map->>'item_descricao', '') is not null then
        insert into public.conta_item_map (project_id, conta_prefix, rubrica_code, item_descricao)
        values (v_project_id, r_map->>'conta_prefix', r_map->>'rubrica_code', r_map->>'item_descricao')
        on conflict (project_id, conta_prefix) do update set
          rubrica_code   = excluded.rubrica_code,
          item_descricao = excluded.item_descricao,
          criado_por     = auth.uid(),
          criado_em      = now();
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
        (balancete_id, conta_codigo, conta_descricao, valor_debito, valor_credito, saldo_atual,
         rubrica_code, item_descricao)
      values (
        v_id,
        r_lanc->>'conta_codigo',
        r_lanc->>'conta_descricao',
        coalesce((r_lanc->>'valor_debito')::numeric, 0),
        coalesce((r_lanc->>'valor_credito')::numeric, 0),
        coalesce((r_lanc->>'saldo_atual')::numeric, 0),
        -- Rubrica respondida na revisão (mig. 050). Nula, o gatilho
        -- trg_auto_resolve_rubrica resolve pelo mapa, como antes.
        nullif(r_lanc->>'rubrica_code', ''),
        -- Item respondido na revisão (mig. 053). Nulo, o gatilho resolve
        -- pela regra do projeto ou pelo item único da letra.
        nullif(r_lanc->>'item_descricao', '')
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
  'Cria ou atualiza um balancete a partir do JSON revisado. Guard: assert_project_allowed. Aceita new_mappings (catálogo global), rubrica_code e item_descricao por lançamento (mig. 050/053), new_item_mappings (regra de item do projeto, mig. 053) e proposta_id (mig. 051).';

-- ------------------------------------------------------------
-- (F) Previsto × Realizado por item
-- ------------------------------------------------------------
create or replace function public.get_previsto_vs_realizado(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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
  perform public.assert_project_allowed(p_project_id);

  select id into v_plano_id
    from public.planos_trabalho
   where project_id = p_project_id and ativo = true
   limit 1;

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
  -- Itens do PLANO (linhas com descrição), com o realizado de cada um
  -- (mig. 053). Casam pela descrição normalizada: é assim que o
  -- lançamento guarda o item.
  itens_plano as (
    select rubrica_code,
           public.norm_item(descricao_livre) as chave,
           min(nullif(btrim(coalesce(descricao_livre, ''), '" '), '')) as descricao,
           sum(valor_previsto) as previsto
      from public.plano_rubricas
     where plano_id = v_plano_id
       and public.norm_item(descricao_livre) is not null
     group by 1, 2
  ),
  real_item as (
    select rubrica_code, public.norm_item(item_descricao) as chave, sum(saldo_atual) as realizado
      from public.balancete_lancamentos
     where balancete_id = v_balancete_id and rubrica_code is not null and item_descricao is not null
     group by 1, 2
  ),
  previsto_det as (
    select ip.rubrica_code,
           jsonb_agg(
             jsonb_build_object(
               'descricao', ip.descricao,
               'previsto',  ip.previsto,
               'realizado', coalesce(ri.realizado, 0),
               'saldo',     ip.previsto - coalesce(ri.realizado, 0)
             ) order by ip.previsto desc
           ) as itens
      from itens_plano ip
      left join real_item ri on ri.rubrica_code = ip.rubrica_code and ri.chave = ip.chave
     group by ip.rubrica_code
  ),
  -- O que não tem item: lançamento sem item, ou com item que não está no
  -- plano ativo (o plano mudou depois da gravação).
  sem_item as (
    select bl.rubrica_code, sum(bl.saldo_atual) as realizado
      from public.balancete_lancamentos bl
     where bl.balancete_id = v_balancete_id and bl.rubrica_code is not null
       and (bl.item_descricao is null
            or not exists (select 1 from itens_plano ip
                            where ip.rubrica_code = bl.rubrica_code
                              and ip.chave = public.norm_item(bl.item_descricao)))
     group by bl.rubrica_code
  ),
  sem_descricao as (
    select rubrica_code, sum(valor_previsto) as previsto
      from public.plano_rubricas
     where plano_id = v_plano_id and public.norm_item(descricao_livre) is null
     group by rubrica_code
  ),
  -- As contas do BALANCETE que alimentam cada rubrica, com o item de cada
  -- uma. É o que deixa auditável de onde veio o número. Estornos (mig.
  -- 049) aparecem aqui com valor negativo, no fim da lista.
  realizado_det as (
    select rubrica_code,
           jsonb_agg(
             jsonb_build_object(
               'conta_codigo',    conta_codigo,
               'conta_descricao', conta_descricao,
               'realizado',       saldo_atual,
               'item',            item_descricao
             ) order by saldo_atual desc
           ) as contas
      from public.balancete_lancamentos
     where balancete_id = v_balancete_id
       and rubrica_code is not null
     group by rubrica_code
  ),
  todas as (
    select r.code as rubrica_code, r.name, r.parent_code, r.ordem,
           coalesce(p.total_previsto, 0)    as previsto,
           coalesce(rr.total_realizado, 0)  as realizado,
           coalesce(pd.itens,  '[]'::jsonb) as detalhes,
           coalesce(rd.contas, '[]'::jsonb) as contas,
           coalesce(si.realizado, 0)        as realizado_sem_item,
           coalesce(sd.previsto, 0)         as previsto_sem_descricao
      from public.rubricas r
      left join previsto      p  on p.rubrica_code  = r.code
      left join realizado     rr on rr.rubrica_code = r.code
      left join previsto_det  pd on pd.rubrica_code = r.code
      left join realizado_det rd on rd.rubrica_code = r.code
      left join sem_item      si on si.rubrica_code = r.code
      left join sem_descricao sd on sd.rubrica_code = r.code
     where coalesce(p.total_previsto, 0) > 0
        or coalesce(rr.total_realizado, 0) <> 0
     order by r.ordem
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'rubrica_code',           rubrica_code,
      'rubrica_name',           name,
      'parent_code',            parent_code,
      'previsto',               previsto,
      'realizado',              realizado,
      'saldo',                  (previsto - realizado),
      'perc_executado',         case when previsto > 0 then round((realizado / previsto) * 100, 2) else null end,
      'detalhes',               detalhes,
      'contas',                 contas,
      'realizado_sem_item',     realizado_sem_item,
      'previsto_sem_descricao', previsto_sem_descricao
    )
  ), '[]'::jsonb)
    into v_rubricas
    from todas;

  -- 7.1.1.01 é RECEITA (apropriação de recurso e de rendimento), não
  -- despesa sem rubrica. Mostrá-la aqui somava milhões num cartão
  -- rotulado "despesas" (mig. 049).
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'conta_codigo',    conta_codigo,
      'conta_descricao', conta_descricao,
      'saldo_atual',     saldo_atual
    )
  ), '[]'::jsonb)
    into v_nao_mapeados
    from public.balancete_lancamentos
   where balancete_id = v_balancete_id
     and rubrica_code is null
     and conta_codigo not like '7.1.1.01.%';

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
  'Cruza o plano ativo com o balancete mais recente. Cada rubrica traz `detalhes` (itens do plano com previsto, realizado e saldo — mig. 053), `contas` (contas do balancete, com o item de cada uma), `realizado_sem_item` e `previsto_sem_descricao`. `nao_mapeados` exclui receitas. Guard: assert_project_allowed.';

-- ------------------------------------------------------------
-- (G) Semente do 30.068 e backfill
-- ------------------------------------------------------------
insert into public.conta_item_map (project_id, conta_prefix, rubrica_code, item_descricao, criado_por)
select p.id, s.conta, s.rubrica, s.item, null
  from public.projects p
  cross join (values
    -- Investimento › transporte e taxas de importação (inclusive as redutoras)
    ('7.1.3.05.01.00043', 'f', 'Serviços de transporte de equipamentos e taxas de importação'),
    ('7.1.3.05.01.00069', 'f', 'Serviços de transporte de equipamentos e taxas de importação'),
    ('7.1.3.05.01.00129', 'f', 'Serviços de transporte de equipamentos e taxas de importação'),
    ('7.1.3.05.01.00130', 'f', 'Serviços de transporte de equipamentos e taxas de importação'),
    -- Investimento › bens permanentes (capital, doação de bens e os estornos)
    ('7.1.3.20',          'f', 'Bens permanentes (clusters e equipamentos)'),
    ('7.1.3.50.06',       'f', 'Bens permanentes (clusters e equipamentos)'),
    ('7.1.3.50.02.94664', 'f', 'Bens permanentes (clusters e equipamentos)'),
    ('7.1.1.08.22',       'f', 'Bens permanentes (clusters e equipamentos)'),
    ('7.1.1.08.50',       'f', 'Bens permanentes (clusters e equipamentos)'),
    -- Serviços PJ › serviço técnico especializado
    ('7.1.3.05.01.00004', 'b', 'Serviços técnicos especializaos'),
    ('7.1.3.05.01.00027', 'b', 'Serviços técnicos especializaos'),
    ('7.1.3.05.01.00039', 'b', 'Serviços técnicos especializaos'),
    ('7.1.3.05.01.00099', 'b', 'Serviços técnicos especializaos'),
    -- Serviços PJ › congressos
    ('7.1.3.05.01.00014', 'b', 'Pagamento inscrição para participação de congressos, eventos, simpósios entre outros'),
    ('7.1.3.05.01.93482', 'b', 'Pagamento inscrição para participação de congressos, eventos, simpósios entre outros'),
    -- Material de Consumo
    ('7.1.3.05.01.00035', 'e', 'Impressão de material gráfico para divulgação do CEMPA-Cerrado'),
    ('7.1.3.03.01.00009', 'e', 'Componentes eletronicos Peças de informática'),
    ('7.1.3.03.01.91999', 'e', 'Componentes eletronicos Manutenção de máquinas e equipamentos')
  ) as s(conta, rubrica, item)
 where p.code = '30.068'
on conflict (project_id, conta_prefix) do nothing;

create temp table _053_antes on commit drop as
select b.project_id, bl.rubrica_code, sum(bl.saldo_atual) as realizado
  from public.balancete_lancamentos bl
  join public.balancetes b on b.id = bl.balancete_id
 where bl.rubrica_code is not null
 group by 1, 2;

-- Regra do projeto: define letra e item, quando o item existe no plano.
-- Só em linha SEM item e que não foi classificada na revisão: o backfill
-- não desfaz decisão humana — nem numa reaplicação desta migração. (Linha
-- anterior à 053 nasce com a marca falsa; as respostas da 050 são de
-- código cortado, que nenhuma regra alcança.)
update public.balancete_lancamentos bl
   set rubrica_code   = x.rubrica_code,
       item_descricao = x.item
  from (
    select l.id, r.rubrica_code,
           public.item_do_plano(b.project_id, r.rubrica_code, r.item_descricao) as item
      from public.balancete_lancamentos l
      join public.balancetes b on b.id = l.balancete_id
      cross join lateral public.regra_item(b.project_id, l.conta_codigo) r
     where r.conta_prefix is not null
       and l.item_descricao is null
       and not l.classificado_na_revisao
  ) x
 where x.id = bl.id
   and x.item is not null;

-- Letra de item único: o item vem sozinho.
update public.balancete_lancamentos bl
   set item_descricao = public.item_unico(b.project_id, bl.rubrica_code)
  from public.balancetes b
 where b.id = bl.balancete_id
   and bl.item_descricao is null
   and bl.rubrica_code is not null
   and public.item_unico(b.project_id, bl.rubrica_code) is not null;

do $$
declare
  r record;
begin
  -- O que mudou de letra (regra de item do projeto vencendo o mapa global)
  for r in
    with depois as (
      select b.project_id, bl.rubrica_code, sum(bl.saldo_atual) as realizado
        from public.balancete_lancamentos bl
        join public.balancetes b on b.id = bl.balancete_id
       where bl.rubrica_code is not null
       group by 1, 2
    )
    select p.code, coalesce(d.rubrica_code, a.rubrica_code) as rubrica,
           coalesce(a.realizado, 0) as antes, coalesce(d.realizado, 0) as depois
      from depois d
      full join _053_antes a using (project_id, rubrica_code)
      join public.projects p on p.id = coalesce(d.project_id, a.project_id)
     where coalesce(a.realizado, 0) <> coalesce(d.realizado, 0)
     order by 1, 2
  loop
    raise notice '053: % rubrica % — realizado (todos os balancetes) % -> %', r.code, r.rubrica, r.antes, r.depois;
  end loop;

  -- O que ficou sem item no balancete mais recente de cada projeto com
  -- plano: é a lista de perguntas a fazer, não um chute.
  for r in
    select p.code, bl.rubrica_code, bl.conta_codigo, bl.conta_descricao, bl.saldo_atual
      from public.balancete_lancamentos bl
      join public.balancetes b on b.id = bl.balancete_id
      join public.projects p on p.id = b.project_id
     where bl.rubrica_code is not null and bl.item_descricao is null and bl.saldo_atual <> 0
       and b.data_referencia = (select max(b2.data_referencia) from public.balancetes b2 where b2.project_id = b.project_id)
       and exists (select 1 from public.planos_trabalho pt where pt.project_id = b.project_id and pt.ativo)
     order by 1, 2, 3
  loop
    raise notice '053 sem item: % % % (%) %', r.code, r.rubrica_code, r.conta_codigo, r.conta_descricao, r.saldo_atual;
  end loop;
end $$;

-- ------------------------------------------------------------
-- ACL (funções novas nascem fechadas pela 035)
-- ------------------------------------------------------------
revoke all on function public.norm_item(text)                    from public, anon;
revoke all on function public.item_do_plano(uuid, text, text)    from public, anon, authenticated;
revoke all on function public.item_unico(uuid, text)             from public, anon, authenticated;
revoke all on function public.regra_item(uuid, text)             from public, anon, authenticated;
grant execute on function public.norm_item(text) to authenticated;

-- ------------------------------------------------------------
-- Asserções
-- ------------------------------------------------------------
do $$
begin
  if public.norm_item('"Serviços técnicos especializaos "') is distinct from public.norm_item('servicos tecnicos especializaos') then
    raise exception '053: norm_item não iguala acento, caixa e aspas.';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.conta_item_map'::regclass and tgname = 'trg_bloqueia_agente') then
    raise exception '053: conta_item_map sem a barreira do agente.';
  end if;
  if not exists (select 1 from pg_proc where proname = 'upsert_balancete' and pronamespace = 'public'::regnamespace
                    and prosecdef
                    and pg_get_functiondef(oid) like '%new_item_mappings%'
                    and pg_get_functiondef(oid) like '%_aplicar_proposta%'
                    and pg_get_functiondef(oid) like '%nullif(r_lanc->>''rubrica_code''%') then
    raise exception '053: upsert_balancete perdeu a 050/051 ou não grava item.';
  end if;
end $$;

commit;

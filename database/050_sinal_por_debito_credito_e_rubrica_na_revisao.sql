-- ============================================================
-- 050_sinal_por_debito_credito_e_rubrica_na_revisao.sql
--
-- (A) CONSERTA O SINAL QUE A 049 ERROU.
--     A 049 tratava como redutora toda conta de 7.1.3 cujo nome começa
--     com "( - )" e gravava o valor negativo. O nome não diz isso: nos
--     encargos de pessoal CLT (7.1.3.01), "( - ) 13º SALARIO",
--     "( - ) FÉRIAS", "( - ) PIS S/ FOLHA", "( - ) FGTS S/FÉRIAS PRJ" etc.
--     são DÉBITOS — gasto normal, que a conta-mãe soma positivo (30.076
--     e 30.111 de 2026-09: 7.1.3.01 só fecha com eles positivos). Nesses
--     projetos a 049 tirou o encargo do realizado e ainda o descontou de
--     novo (efeito de 2× o valor em `a.colab`/`a.enc`).
--
--     O critério certo está nas colunas do próprio balancete: despesa é
--     Débitos − Créditos. A redutora de verdade ("( - ) FRETES S/
--     IMPORTAÇÕES", débito 0, crédito 19.531,30) dá negativo; o encargo
--     "( - ) FÉRIAS" (débito 15.258,33) dá positivo. `valor_debito` e
--     `valor_credito` são gravados (em módulo) desde a mig. 026, então o
--     valor certo se recalcula sem reimportar PDF. O parser passa a usar
--     a mesma regra no mesmo commit.
--
--     Só toca as linhas que a 049 pode ter mexido — 7.1.3 com "( - )" no
--     nome — e só quando há débito/crédito gravado. No 30.068 nada muda:
--     lá todas as "( - )" são créditos.
--
-- (B) A RUBRICA ESCOLHIDA NA REVISÃO PASSA A VALER.
--     O layout de 2026-09 da FUNAPE corta a coluna Conta em 14
--     caracteres; o parser reconstrói o código pelo "Reduzido"
--     (funape-contas.js), mas conta nova vem cortada e a revisão PERGUNTA
--     a rubrica — uma regra no mapa feita com o código cortado capturaria
--     as vizinhas (7.1.3.05.01.00 pegaria passagens e DAO). Até aqui o
--     `upsert_balancete` ignorava a rubrica da tela e deixava o gatilho
--     resolver pelo prefixo: a resposta seria descartada e a conta cairia
--     em `b` sem aviso. Agora o lançamento pode trazer `rubrica_code`; o
--     gatilho `auto_resolve_rubrica_lancamento` só preenche quando ele é
--     nulo (mig. 026), então nada mais precisa mudar.
--
--     Rubrica inexistente é recusada pela FK de `balancete_lancamentos`.
--     `create or replace` (não drop) preserva a ACL da 035; security
--     definer + search_path + guard repetidos (lição da 036).
--
-- ORDEM: aplicar ANTES de publicar o frontend do mesmo commit. Com o
-- frontend novo e o banco velho, a rubrica respondida na revisão seria
-- ignorada (o gatilho resolveria pelo código cortado).
--
-- Conferência: tests/sql/test_050_sinal_e_rubrica_revisao.sql
-- ============================================================

begin;

-- ------------------------------------------------------------
-- (A) Sinal por débito − crédito
-- ------------------------------------------------------------
create temp table _050_antes on commit drop as
select b.project_id, bl.rubrica_code, sum(bl.saldo_atual) as realizado
  from public.balancete_lancamentos bl
  join public.balancetes b on b.id = bl.balancete_id
 where bl.rubrica_code is not null
 group by 1, 2;

update public.balancete_lancamentos
   set saldo_atual = valor_debito - valor_credito
 where conta_codigo like '7.1.3.%'
   and conta_descricao ~ '^\(\s*-\s*\)'
   and (valor_debito <> 0 or valor_credito <> 0)
   and saldo_atual is distinct from (valor_debito - valor_credito);

do $$
declare
  r record;
begin
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
      full join _050_antes a using (project_id, rubrica_code)
      join public.projects p on p.id = coalesce(d.project_id, a.project_id)
     where coalesce(a.realizado, 0) <> coalesce(d.realizado, 0)
     order by 1, 2
  loop
    raise notice '050: % rubrica % — realizado (todos os balancetes) % -> %',
      r.code, r.rubrica, r.antes, r.depois;
  end loop;
end $$;

-- ------------------------------------------------------------
-- (B) upsert_balancete: rubrica_code opcional por lançamento
-- Corpo idêntico ao da 033, exceto o INSERT dos lançamentos.
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

  return v_id;
end;
$$;

comment on function public.upsert_balancete is
  'Cria ou atualiza um balancete a partir do JSON revisado. Guard: assert_project_allowed. Aceita new_mappings opcional (catálogo permissivo) e rubrica_code por lançamento (resposta da revisão; nulo = gatilho resolve pelo mapa).';

-- ------------------------------------------------------------
-- Asserções — abortam a transação se o efeito não for o pretendido
-- ------------------------------------------------------------
do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from public.balancete_lancamentos
   where conta_codigo like '7.1.3.%'
     and conta_descricao ~ '^\(\s*-\s*\)'
     and (valor_debito <> 0 or valor_credito <> 0)
     and saldo_atual is distinct from (valor_debito - valor_credito);
  if v_n > 0 then
    raise exception '050: % lancamento(s) "( - )" de 7.1.3 ainda fora de debito - credito.', v_n;
  end if;

  -- O consertado pela 049 continua consertado: redutora de verdade
  -- (só crédito) segue negativa.
  select count(*) into v_n
    from public.balancete_lancamentos
   where conta_codigo like '7.1.3.%'
     and conta_descricao ~ '^\(\s*-\s*\)'
     and valor_debito = 0 and valor_credito > 0
     and saldo_atual >= 0;
  if v_n > 0 then
    raise exception '050: % redutora(s) so-credito ficaram positivas.', v_n;
  end if;

  if not exists (
    select 1 from pg_proc
     where proname = 'upsert_balancete'
       and pronamespace = 'public'::regnamespace
       and prosecdef
       and pg_get_functiondef(oid) like '%nullif(r_lanc->>''rubrica_code''%'
  ) then
    raise exception '050: upsert_balancete nao ficou com rubrica_code por lancamento (ou perdeu o security definer).';
  end if;
end $$;

commit;

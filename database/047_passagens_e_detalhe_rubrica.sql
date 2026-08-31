-- ============================================================
-- 047_passagens_e_detalhe_rubrica.sql
--
-- Duas coisas, com a mesma origem: a tela mostrava número errado e
-- não dava a quem olhasse como perceber isso.
--
-- (A) PASSAGENS CAÍA EM `b`.
--     No plano de contas da FUNAPE, "PASSAGENS E DESPESAS COM
--     LOCOMOÇÃO" é a conta 7.1.3.05.01.00042 — pendurada DEBAIXO de
--     7.1.3.05 (Serviços Terceiros PJ), não numa árvore própria. O
--     `conta_rubrica_map` tinha `7.1.3.05 -> b` e `7.1.3.07 -> c`;
--     como o casamento é longest-prefix-match e não havia regra para
--     a conta específica, todo gasto de passagem era somado em `b`.
--
--     Efeito medido em 2026-08-31: no 30.068, `c` aparecia com
--     realizado ZERO e saldo integral de R$ 135.000, enquanto `b`
--     carregava R$ 116.287,41 que não eram dele. O 78.215 tem o mesmo
--     defeito, com R$ 54.181,06. Não é caso isolado de um projeto: é
--     o plano de contas da FUNAPE, então a regra é global — que é
--     onde o `conta_rubrica_map` vive (catálogo sem project_id,
--     mig. 037).
--
--     A regra nova é MAIS ESPECÍFICA que `7.1.3.05`, então ela ganha
--     o longest-prefix sem que mais nada mude de rubrica. `7.1.3.07`
--     continua mapeada: projeto cujo plano de contas use aquela conta
--     segue funcionando.
--
--     O trigger `auto_resolve_rubrica_lancamento` só resolve na
--     INSERÇÃO e só quando `rubrica_code is null`, então lançamento
--     já gravado não se corrige sozinho — daí o UPDATE explícito,
--     restrito a essa conta.
--
-- (B) O DETALHE DO PLANO NÃO CHEGAVA À TELA.
--     `get_previsto_vs_realizado` fazia `group by rubrica_code`, e o
--     `descricao_livre` de `plano_rubricas` morria ali. Um plano com
--     três linhas de Material de Consumo (manutenção, peças de
--     informática, impressão gráfica) virava uma linha só. O dado
--     estava no banco desde a mig. 025; o que faltava era o caminho
--     até a tela.
--
--     Passa a devolver, em cada rubrica, dois detalhamentos:
--       • `detalhes` — as linhas do PLANO (previsto), com a descrição
--                      escrita no documento;
--       • `contas`   — as contas do BALANCETE (realizado) que
--                      alimentam aquela rubrica.
--
--     `contas` não é enfeite: é o que torna (A) visível. Se a tela
--     mostrasse desde o início quais contas compõem cada rubrica,
--     "PASSAGENS" listada embaixo de Serviços de Terceiros teria
--     saltado aos olhos. Número agregado não se audita; número com a
--     origem ao lado, sim.
--
-- O QUE NÃO MUDA: a assinatura, as chaves que já existiam, o guard e
-- os totais por rubrica. Consumidor que ignore as duas chaves novas
-- continua correto — o frontend é publicado ANTES desta migração
-- rodar e não pode quebrar no intervalo.
--
-- Atributos repetidos de propósito (lição da 036: `create or replace`
-- reescreve os atributos junto com o corpo). Usa REPLACE e não DROP
-- para não levar junto a ACL da mig. 035.
--
-- Conferência: tests/sql/test_047_passagens_detalhe.sql
-- ============================================================

begin;

-- ------------------------------------------------------------
-- (A) A conta de passagens, e os lançamentos já gravados
-- ------------------------------------------------------------

insert into public.conta_rubrica_map (conta_prefix, rubrica_code, descricao) values
  ('7.1.3.05.01.00042', 'c',
   'PASSAGENS E DESPESAS COM LOCOMOCAO (fica sob 7.1.3.05 no plano de contas da FUNAPE)')
on conflict (conta_prefix) do update set
  rubrica_code = excluded.rubrica_code,
  ativo        = true;

update public.balancete_lancamentos
   set rubrica_code = 'c'
 where conta_codigo like '7.1.3.05.01.00042%'
   and rubrica_code is distinct from 'c';

-- ------------------------------------------------------------
-- (B) get_previsto_vs_realizado com o detalhamento
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
  -- As linhas do PLANO, com a descrição escrita no documento. O
  -- btrim tira as aspas que sobram da extração do DOCX/planilha.
  -- Linha sem descrição continua somando no total da rubrica, mas
  -- não vira detalhe: um item rotulado "—" não informa nada.
  previsto_det as (
    select rubrica_code,
           jsonb_agg(
             jsonb_build_object('descricao', descricao, 'previsto', valor)
             order by valor desc
           ) as itens
      from (
        select rubrica_code,
               nullif(btrim(coalesce(descricao_livre, ''), '" '), '') as descricao,
               sum(valor_previsto) as valor
          from public.plano_rubricas
         where plano_id = v_plano_id
         group by 1, 2
      ) d
     where descricao is not null
     group by rubrica_code
  ),
  -- As contas do BALANCETE que alimentam cada rubrica. É o que deixa
  -- auditável de onde veio o número.
  realizado_det as (
    select rubrica_code,
           jsonb_agg(
             jsonb_build_object(
               'conta_codigo',    conta_codigo,
               'conta_descricao', conta_descricao,
               'realizado',       saldo_atual
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
           coalesce(rd.contas, '[]'::jsonb) as contas
      from public.rubricas r
      left join previsto      p  on p.rubrica_code  = r.code
      left join realizado     rr on rr.rubrica_code = r.code
      left join previsto_det  pd on pd.rubrica_code = r.code
      left join realizado_det rd on rd.rubrica_code = r.code
     where coalesce(p.total_previsto, 0) > 0
        or coalesce(rr.total_realizado, 0) > 0
     order by r.ordem
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'rubrica_code',   rubrica_code,
      'rubrica_name',   name,
      'parent_code',    parent_code,
      'previsto',       previsto,
      'realizado',      realizado,
      'saldo',          (previsto - realizado),
      'perc_executado', case when previsto > 0 then round((realizado / previsto) * 100, 2) else null end,
      'detalhes',       detalhes,
      'contas',         contas
    )
  ), '[]'::jsonb)
    into v_rubricas
    from todas;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'conta_codigo',    conta_codigo,
      'conta_descricao', conta_descricao,
      'saldo_atual',     saldo_atual
    )
  ), '[]'::jsonb)
    into v_nao_mapeados
    from public.balancete_lancamentos
   where balancete_id = v_balancete_id and rubrica_code is null;

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
  'Cruza o plano ativo do projeto com o balancete mais recente. Cada rubrica traz `detalhes` (linhas do plano) e `contas` (contas do balancete que a alimentam). Guard: assert_project_allowed.';

-- ------------------------------------------------------------
-- Asserções — abortam a transação se o efeito não for o pretendido
-- ------------------------------------------------------------

do $$
declare
  v_map    int;
  v_sobrou int;
  v_cat    int;
begin
  select count(*) into v_map
    from public.conta_rubrica_map
   where conta_prefix = '7.1.3.05.01.00042' and rubrica_code = 'c' and ativo;
  if v_map <> 1 then
    raise exception 'A regra de passagens nao ficou cadastrada (achei % linha[s]).', v_map;
  end if;

  if public.resolve_rubrica_for_conta('7.1.3.05.01.00042') is distinct from 'c' then
    raise exception 'longest-prefix-match nao devolveu c para a conta de passagens.';
  end if;

  -- A regra nova nao pode ter arrastado o resto de 7.1.3.05 junto.
  if public.resolve_rubrica_for_conta('7.1.3.05.01.00004') is distinct from 'b' then
    raise exception 'A regra nova mudou a rubrica de outra conta de 7.1.3.05.';
  end if;

  select count(*) into v_sobrou
    from public.balancete_lancamentos
   where conta_codigo like '7.1.3.05.01.00042%'
     and rubrica_code is distinct from 'c';
  if v_sobrou > 0 then
    raise exception 'Ainda ha % lancamento(s) de passagem fora da rubrica c.', v_sobrou;
  end if;

  select count(*) into v_cat from public.rubricas where code = 'c';
  if v_cat <> 1 then
    raise exception 'Rubrica c sumiu do catalogo.';
  end if;
end $$;

commit;

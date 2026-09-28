-- ============================================================
-- 049_sinal_e_reclassificacao_de_bens.sql
--
-- O realizado de `b` e de `f` estava inflado — no 30.068, `f`
-- (Investimento) aparecia ESTOURADO em R$ 152.226,59 quando tinha
-- R$ 236.279,01 sobrando, e o saldo livre total do projeto saía
-- R$ 267 mil em vez de R$ 737 mil. Todas as RPCs (026/038/047/048)
-- somam `balancete_lancamentos.saldo_atual` por rubrica; o defeito
-- era o que entrava nessa soma. Duas causas, conferidas contra o
-- balancete de 03/08/2026, em que as contas-mãe impressas no próprio
-- PDF fecham centavo a centavo com a leitura corrigida:
--
-- (A) REDUTORAS "( - )" SOMADAS.
--     Na linha-folha, o PDF imprime a conta redutora SEM parênteses
--     ("( - ) FRETES E TRANSP S/ IMPORTA ... 19.531,30"), mas a
--     conta-mãe a desconta: 7.1.3.05 fecha em 314.560,17, e a soma
--     das folhas com as redutoras positivas dá 395.297,77 —
--     exatamente 2 × (19.531,30 + 20.837,50). Idem
--     "( - ) VARIAÇÃO CAMBIAL NEGATIVA" em 7.1.3.20.51, que a mãe
--     imprime como (22.362,35).
--
-- (B) O CICLO DE RECLASSIFICAÇÃO DO EQUIPAMENTO.
--     A FUNAPE lança o bem como despesa de capital (7.1.3.20), depois
--     ESTORNA como "recuperação de despesa" (7.1.1.08.22 — equipamento;
--     7.1.1.08.50 — adiantamento de importação) e relança como doação
--     de bens à UFG (7.1.3.50). O mapa só conhecia a primeira perna:
--     o estorno e a doação caíam em "não mapeados". Contando as três:
--        7.1.3.20 (1.864.143,49) + 7.1.3.50 (1.542.724,94)
--        − 7.1.1.08.22 (1.394.727,26) − 7.1.1.08.50 (491.778,58)
--        = 1.520.362,59   ← gasto real com equipamento
--     Conferência independente: com isso, o gasto total (mais IR e
--     perda cambial) fecha com a saída de caixa do balancete
--     (entradas 4.491.499,02 − aplicação 1.182.140,96), com resíduo
--     de ~R$ 6 mil em contas a pagar.
--     Idem 7.1.1.08.20 (recuperação de despesa de serviço — tarifa
--     bancária), que estorna 7.1.3.05.01.00054 em `b`.
--
-- CONVENÇÃO: `saldo_atual` passa a significar CONTRIBUIÇÃO AO GASTO.
-- Redutora e recuperação ficam negativas. O parser
-- (frontend/js/parsers/balancete-parser.js) grava assim a partir do
-- mesmo commit, e confere cada conta-mãe de 4 níveis contra a soma das
-- folhas — um sinal lido errado vira aviso na importação.
--
-- PERDA CAMBIAL fica fora de `f`: a redutora (A) a tira de 7.1.3.20 e
-- a FUNAPE a relança em 7.1.3.62, que o parser ignora como despesa
-- financeira (mesmo tratamento do IR). Se o financiador a considerar
-- custo de importação, é uma regra `7.1.3.62.01.94123 -> f` — mas o
-- parser teria de parar de ignorá-la.
--
-- RECEITAS (7.1.1.01) deixam de aparecer em `nao_mapeados` de
-- `get_previsto_vs_realizado`. A tela as rotulava "despesas que não
-- correspondem a nenhuma rubrica" e somava R$ 2,9 mi de apropriação de
-- receita no 30.068. Estorno não mapeado (7.1.1.08 de outro prefixo)
-- CONTINUA aparecendo — negativo, que é o sinal de que falta regra.
--
-- IDEMPOTENTE: o sinal é gravado com -abs(), então rodar de novo não
-- desfaz. Não mexe em ACL: `get_previsto_vs_realizado` é REPLACE (não
-- DROP) e repete security definer + search_path + guard (lição 036).
--
-- Conferência: tests/sql/test_049_sinal_reclassificacao.sql
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Impacto por projeto, ANTES — sai como NOTICE no SQL Editor
-- ------------------------------------------------------------
create temp table _049_antes on commit drop as
select b.project_id, bl.rubrica_code, sum(bl.saldo_atual) as realizado
  from public.balancete_lancamentos bl
  join public.balancetes b on b.id = bl.balancete_id
 where bl.rubrica_code is not null
 group by 1, 2;

-- ------------------------------------------------------------
-- (B) Mapa: as outras duas pernas do ciclo
-- ------------------------------------------------------------
insert into public.conta_rubrica_map (conta_prefix, rubrica_code, descricao) values
  ('7.1.3.50.06',       'f', 'BAIXA/DOACOES DE BENS (equipamento relancado como doacao a UFG)'),
  ('7.1.3.50.02.94664', 'f', 'DOACOES DE BENS ENTRE C.C'),
  ('7.1.1.08.22',       'f', 'RECUPERACAO DESP EQUIPAMENTOS (estorno — entra negativo)'),
  ('7.1.1.08.50',       'f', 'TRANSF ADTO IMPORT DE DESP (estorno — entra negativo)'),
  ('7.1.1.08.20',       'b', 'RECUPERACAO DESPESAS SERVICOS TERCEIROS (estorno — entra negativo)')
on conflict (conta_prefix) do update set
  rubrica_code = excluded.rubrica_code,
  descricao    = excluded.descricao,
  ativo        = true;

-- ------------------------------------------------------------
-- (A)+(B) Sinal dos lançamentos já gravados
-- ------------------------------------------------------------
update public.balancete_lancamentos
   set saldo_atual = -abs(saldo_atual)
 where conta_codigo like '7.1.3.%'
   and conta_descricao ~ '^\(\s*-\s*\)'
   and saldo_atual > 0;

update public.balancete_lancamentos
   set saldo_atual = -abs(saldo_atual)
 where conta_codigo like '7.1.1.08.%'
   and saldo_atual > 0;

-- O gatilho auto_resolve_rubrica_lancamento só age no INSERT, então as
-- linhas já gravadas das contas novas não se resolvem sozinhas.
update public.balancete_lancamentos
   set rubrica_code = public.resolve_rubrica_for_conta(conta_codigo)
 where (conta_codigo like '7.1.3.50.%' or conta_codigo like '7.1.1.08.%')
   and rubrica_code is distinct from public.resolve_rubrica_for_conta(conta_codigo);

-- ------------------------------------------------------------
-- get_previsto_vs_realizado: receita não é "não mapeado"
-- Corpo idêntico ao da 047, exceto o filtro de v_nao_mapeados.
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
  -- auditável de onde veio o número. Estornos (mig. 049) aparecem
  -- aqui com valor negativo, no fim da lista.
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
  'Cruza o plano ativo do projeto com o balancete mais recente. Cada rubrica traz `detalhes` (linhas do plano) e `contas` (contas do balancete que a alimentam; estornos negativos). `nao_mapeados` exclui receitas (7.1.1.01). Guard: assert_project_allowed.';

-- ------------------------------------------------------------
-- Impacto por projeto — NOTICE, para conferir antes do commit
-- ------------------------------------------------------------
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
      full join _049_antes a using (project_id, rubrica_code)
      join public.projects p on p.id = coalesce(d.project_id, a.project_id)
     where coalesce(a.realizado, 0) <> coalesce(d.realizado, 0)
     order by 1, 2
  loop
    raise notice '049: % rubrica % — realizado (todos os balancetes) % -> %',
      r.code, r.rubrica, r.antes, r.depois;
  end loop;
end $$;

-- ------------------------------------------------------------
-- Asserções — abortam a transação se o efeito não for o pretendido
-- ------------------------------------------------------------
do $$
declare
  v_n int;
begin
  -- As regras novas ganham o longest-prefix...
  if public.resolve_rubrica_for_conta('7.1.3.50.06.08942') is distinct from 'f'
  or public.resolve_rubrica_for_conta('7.1.3.50.02.94664') is distinct from 'f'
  or public.resolve_rubrica_for_conta('7.1.1.08.22.98672') is distinct from 'f'
  or public.resolve_rubrica_for_conta('7.1.1.08.50.97012') is distinct from 'f'
  or public.resolve_rubrica_for_conta('7.1.1.08.20.99553') is distinct from 'b' then
    raise exception '049: alguma regra nova nao resolve para a rubrica esperada.';
  end if;

  -- ...sem arrastar as vizinhas nem as receitas.
  if public.resolve_rubrica_for_conta('7.1.3.05.01.00004') is distinct from 'b'
  or public.resolve_rubrica_for_conta('7.1.3.05.01.00042') is distinct from 'c'
  or public.resolve_rubrica_for_conta('7.1.3.20.50.00003') is distinct from 'f'
  or public.resolve_rubrica_for_conta('7.1.1.01.02.96789') is not null then
    raise exception '049: uma regra nova mudou a rubrica de conta que nao devia.';
  end if;

  select count(*) into v_n
    from public.balancete_lancamentos
   where saldo_atual > 0
     and (conta_codigo like '7.1.1.08.%'
          or (conta_codigo like '7.1.3.%' and conta_descricao ~ '^\(\s*-\s*\)'));
  if v_n > 0 then
    raise exception '049: % lancamento(s) redutor/estorno ainda positivo(s).', v_n;
  end if;

  select count(*) into v_n
    from public.balancete_lancamentos
   where (conta_codigo like '7.1.3.50.06.%' or conta_codigo like '7.1.3.50.02.94664%'
          or conta_codigo like '7.1.1.08.20.%' or conta_codigo like '7.1.1.08.22.%'
          or conta_codigo like '7.1.1.08.50.%')
     and rubrica_code is null;
  if v_n > 0 then
    raise exception '049: % lancamento(s) das contas novas ficaram sem rubrica.', v_n;
  end if;
end $$;

commit;

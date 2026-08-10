-- ============================================================
-- 038_saldo_livre.sql
-- ============================================================
-- RPC `get_saldo_livre(p_project_id)` — primeira peça da camada de
-- DECISÃO (as demais RPCs são de leitura/cadastro).
--
-- POR QUE EXISTE
-- O sistema já responde "quanto sobrou?" olhando para trás
-- (`get_previsto_vs_realizado`: plano ativo × balancete mais recente)
-- e "quanto sai por mês?" olhando para frente
-- (`calc_project_monthly`: bolsas ativas mês a mês). Nenhuma das duas
-- cruza as informações, e é justamente o cruzamento que decide se
-- cabe uma bolsa nova ou a compra de um equipamento:
--
--   saldo_livre(rubrica) = previsto − realizado − compromissos assumidos
--                          até o fim da vigência
--
-- Sem subtrair os compromissos, o "saldo" do balancete parece maior do
-- que é: as bolsas ativas continuam sendo pagas todo mês até o fim da
-- vigência, e esse dinheiro já tem dono.
--
-- SEMÂNTICA E LIMITES (ler antes de confiar no número)
--
-- 1. `realizado` é `sum(balancete_lancamentos.saldo_atual)` — mesma
--    definição usada por `get_previsto_vs_realizado`, para os dois
--    números nunca divergirem.
--
-- 2. Compromissos são contados a partir do mês SEGUINTE ao
--    `data_referencia` do balancete: o que é anterior já está dentro
--    do `realizado`, e contar de novo seria dupla contagem. Sem
--    balancete, contam a partir do mês corrente.
--
-- 3. Balancete atrasado torna o resultado CONSERVADOR, de propósito.
--    Se o balancete é de janeiro e hoje é agosto, as bolsas de
--    fevereiro a julho provavelmente já foram pagas, mas não há
--    balancete provando — então seguem contadas como compromisso. O
--    erro empurra para "cabe menos", que é o lado seguro numa decisão
--    de gasto. O campo `balancete_defasagem_meses` expõe o atraso.
--
-- 4. O sistema só rastreia compromissos futuros de BOLSAS (tabela
--    `scholarships`). Não há previsão de contratos, diárias ou
--    equipamentos em nenhuma tabela. Por isso cada grupo devolve
--    `compromissos_cobertura`: 'bolsas' quando há rastreio, 'nenhuma'
--    quando `saldo_livre` é apenas `previsto − realizado` e NÃO
--    significa "verificadamente livre". Distinguir "zero compromissos"
--    de "compromissos não rastreados" é requisito, não detalhe: quem
--    lê o retorno (pessoa ou IA) precisa saber a diferença.
--
-- 5. `grupos` é a superfície de decisão; `rubricas` é o detalhe.
--    O plano PROAD ora orça na letra-mãe ('a — Pessoal'), ora nas
--    sub-rubricas ('a.bolsas', 'a.colab'…), enquanto o balancete
--    sempre resolve na sub-rubrica. Comparar código a código produz
--    saldo negativo quando o plano orçou só na mãe. O rollup por
--    `coalesce(parent_code, code)` é o único nível correto nos dois
--    casos — e é conservador na direção certa: não inventa espaço em
--    bolsas que na verdade pertence a salários CLT, mas usa o
--    orçamento da letra-mãe quando foi assim que o plano foi escrito.
--
-- 6. NÃO decide sobre remanejamento entre letras. Dinheiro não
--    atravessa a rubrica sem aprovação do financiador; a função
--    reporta o saldo de cada grupo separadamente e quem decide
--    considera o remanejamento fora daqui.
--
-- SEGURANÇA
-- `security definer` + guard `assert_project_allowed` — mesmo padrão
-- de `get_previsto_vs_realizado` (mig. 033), e necessário porque
-- `plano_rubricas` e `balancete_lancamentos` são admin-only no RLS
-- (mig. 033); o professor chega aos dados dele só por RPC guardada.
-- Não retorna CPF: nenhuma decisão de alocação precisa dele.
-- ============================================================


create or replace function public.get_saldo_livre(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project       record;
  v_plano_id      uuid;
  v_balancete_id  uuid;
  v_data_ref      date;
  v_saldo_disp    numeric;
  v_rend          numeric;
  v_inicio_comp   date;
  v_fim_comp      date;
  v_meses_rest    integer;
  v_defasagem     integer;
  v_compromissos  numeric := 0;
  v_bolsas_det    jsonb   := '[]'::jsonb;
  v_rubricas      jsonb;
  v_grupos        jsonb;
  v_avisos        text[]  := '{}';
begin
  perform public.assert_project_allowed(p_project_id);

  select * into v_project
    from public.projects
   where id = p_project_id;

  if not found then
    raise exception 'Projeto não encontrado: %', p_project_id;
  end if;

  -- Plano ativo (o previsto vem daqui)
  select id into v_plano_id
    from public.planos_trabalho
   where project_id = p_project_id and ativo = true
   limit 1;

  -- Balancete mais recente (o realizado vem daqui)
  select id, data_referencia, saldo_disponivel, rendimento_liquido
    into v_balancete_id, v_data_ref, v_saldo_disp, v_rend
    from public.balancetes
   where project_id = p_project_id
   order by data_referencia desc
   limit 1;

  if v_plano_id is null then
    return jsonb_build_object(
      'has_plano',     false,
      'has_balancete', v_balancete_id is not null,
      'project_id',    p_project_id,
      'project_name',  v_project.name,
      'message',       'Sem plano de trabalho ativo: não há previsto por rubrica para descontar. Cadastre/ative um plano antes de decidir alocação.'
    );
  end if;

  -- NB: usar array_append, não `||`. Com um literal sem tipo à direita,
  -- o Postgres resolve `anyarray || anyarray` e tenta ler a string como
  -- array literal ("malformed array literal").
  if v_balancete_id is null then
    v_avisos := array_append(v_avisos,
      'Sem balancete importado: realizado = 0. O saldo mostrado é o previsto do plano, não a execução real.');
  end if;

  -- ---------- Janela de compromissos ----------
  -- Começa no mês seguinte ao balancete (o anterior já está no
  -- realizado). Sem balancete, no mês corrente.
  v_inicio_comp := case
    when v_data_ref is not null
      then (date_trunc('month', v_data_ref) + interval '1 month')::date
    else date_trunc('month', current_date)::date
  end;

  -- Termina no fim da vigência: depois disso o recurso não é mais
  -- deste projeto (e o não gasto volta ao financiador).
  v_fim_comp := v_project.end_date;

  if v_fim_comp is null then
    select max(s.end_date) into v_fim_comp
      from public.scholarships s
     where s.project_id = p_project_id and s.status = 'active';
    v_avisos := array_append(v_avisos,
      'Projeto sem data de término cadastrada: vigência desconhecida. Compromissos contados até o fim da última bolsa ativa, e não há como estimar risco de devolução.');
  end if;

  -- Meses restantes de vigência (inclusivo, a partir do mês corrente)
  if v_project.end_date is not null then
    v_meses_rest := greatest(0, (
        (date_part('year',  v_project.end_date) - date_part('year',  current_date)) * 12
      + (date_part('month', v_project.end_date) - date_part('month', current_date))
    )::integer + 1);

    if v_meses_rest = 0 then
      v_avisos := array_append(v_avisos,
        'Vigência encerrada: o saldo não gasto já é objeto de devolução ao financiador.');
    end if;
  end if;

  -- Defasagem do balancete, em meses
  if v_data_ref is not null then
    v_defasagem := greatest(0, (
        (date_part('year',  current_date) - date_part('year',  v_data_ref)) * 12
      + (date_part('month', current_date) - date_part('month', v_data_ref))
    )::integer);

    if v_defasagem >= 3 then
      v_avisos := array_append(v_avisos,
        format('Balancete com %s meses de defasagem: os compromissos incluem bolsas provavelmente já pagas. O saldo livre está subestimado.', v_defasagem));
    end if;
  end if;

  -- ---------- Compromissos de bolsas ----------
  if v_fim_comp is not null and v_fim_comp >= v_inicio_comp then
    with bolsas as (
      select s.id,
             h.full_name,
             s.amount,
             s.start_date,
             s.end_date,
             count(*)::integer as meses
        from public.scholarships s
        join public.scholarship_holders h on h.id = s.holder_id
        join public.generate_month_series(v_inicio_comp, v_fim_comp) m
          on s.start_date <= m.month_end
         and s.end_date   >= m.month_start
       where s.project_id = p_project_id
         and s.status = 'active'
       group by s.id, h.full_name, s.amount, s.start_date, s.end_date
    )
    select coalesce(sum(b.amount * b.meses), 0),
           coalesce(jsonb_agg(
             jsonb_build_object(
               'scholarship_id', b.id,
               'bolsista',       b.full_name,
               'valor_mensal',   b.amount,
               'end_date',       b.end_date,
               'meses',          b.meses,
               'compromisso',    b.amount * b.meses
             ) order by (b.amount * b.meses) desc
           ), '[]'::jsonb)
      into v_compromissos, v_bolsas_det
      from bolsas b;
  end if;

  -- ---------- Por rubrica e por grupo ----------
  with previsto as (
    select pr.rubrica_code, sum(pr.valor_previsto) as v
      from public.plano_rubricas pr
     where pr.plano_id = v_plano_id
     group by pr.rubrica_code
  ),
  realizado as (
    select bl.rubrica_code, sum(bl.saldo_atual) as v
      from public.balancete_lancamentos bl
     where bl.balancete_id = v_balancete_id
       and bl.rubrica_code is not null
     group by bl.rubrica_code
  ),
  base as (
    select r.code,
           r.name,
           r.parent_code,
           r.ordem,
           coalesce(r.parent_code, r.code)      as grupo_code,
           coalesce(p.v,  0)                    as previsto,
           coalesce(rr.v, 0)                    as realizado,
           case when r.code = 'a.bolsas' then v_compromissos else 0 end as compromissos,
           (r.code = 'a.bolsas')                as rastreia_compromissos
      from public.rubricas r
      left join previsto  p  on p.rubrica_code  = r.code
      left join realizado rr on rr.rubrica_code = r.code
     where coalesce(p.v, 0) > 0
        or coalesce(rr.v, 0) > 0
        or (r.code = 'a.bolsas' and v_compromissos > 0)
  )
  select
    -- detalhe por rubrica
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'rubrica_code',  b.code,
          'rubrica_name',  b.name,
          'grupo_code',    b.grupo_code,
          'previsto',      b.previsto,
          'realizado',     b.realizado,
          'saldo',         b.previsto - b.realizado,
          'compromissos',  b.compromissos,
          'saldo_livre',   b.previsto - b.realizado - b.compromissos
        ) order by b.ordem
      ) from base b
    ), '[]'::jsonb),
    -- rollup por grupo (superfície de decisão)
    coalesce((
      select jsonb_agg(g.obj order by g.ordem)
        from (
          select min(b.ordem) as ordem,
                 jsonb_build_object(
                   'grupo_code',   b.grupo_code,
                   'grupo_name',   coalesce(gr.name, b.grupo_code),
                   'previsto',     sum(b.previsto),
                   'realizado',    sum(b.realizado),
                   'saldo',        sum(b.previsto) - sum(b.realizado),
                   'compromissos', sum(b.compromissos),
                   'saldo_livre',  sum(b.previsto) - sum(b.realizado) - sum(b.compromissos),
                   'compromissos_cobertura',
                     case when bool_or(b.rastreia_compromissos)
                          then 'bolsas' else 'nenhuma' end
                 ) as obj
            from base b
            left join public.rubricas gr on gr.code = b.grupo_code
           group by b.grupo_code, gr.name
        ) g
    ), '[]'::jsonb)
    into v_rubricas, v_grupos;

  return jsonb_build_object(
    'has_plano',        true,
    'has_balancete',    v_balancete_id is not null,
    'project_id',       p_project_id,
    'project_name',     v_project.name,
    'end_date',         v_project.end_date,
    'meses_restantes',  v_meses_rest,
    'balancete_id',           v_balancete_id,
    'data_referencia',        v_data_ref,
    'balancete_defasagem_meses', v_defasagem,
    'saldo_disponivel_caixa', v_saldo_disp,
    'rendimento_liquido',     v_rend,
    'compromissos_inicio',    v_inicio_comp,
    'compromissos_fim',       v_fim_comp,
    'compromissos_bolsas',    v_compromissos,
    'bolsas_ativas',          v_bolsas_det,
    'grupos',                 v_grupos,
    'rubricas',               v_rubricas,
    'avisos',                 to_jsonb(v_avisos),
    'nota',
      'saldo_livre = previsto − realizado − compromissos. Só compromissos de BOLSAS são rastreados: onde compromissos_cobertura = ''nenhuma'', saldo_livre é apenas previsto − realizado e não foi verificado contra compromissos assumidos. Remanejamento entre letras exige aprovação do financiador e não está considerado.'
  );
end;
$$;

comment on function public.get_saldo_livre is
  'Saldo realmente livre por grupo de rubrica até o fim da vigência: cruza o previsto do plano ativo, o realizado do balancete mais recente e os compromissos futuros de bolsas ativas. Superfície de decisão para alocação (bolsa nova, compra de equipamento). Ver cabeçalho da migração 038 para semântica e limites.';


-- ------------------------------------------------------------
-- Grants — a mig. 035 fez funções novas nascerem sem EXECUTE para
-- public/anon (alter default privileges). Devolve só a authenticated;
-- o guard interno faz o escopo por centro de custo.
-- ------------------------------------------------------------

revoke execute on function public.get_saldo_livre(uuid) from public;
revoke execute on function public.get_saldo_livre(uuid) from anon;
grant  execute on function public.get_saldo_livre(uuid) to   authenticated;


-- ------------------------------------------------------------
-- Asserção (reexecutável como reauditoria)
-- ------------------------------------------------------------

do $$
declare
  bad text;
begin
  if has_function_privilege('anon', 'public.get_saldo_livre(uuid)', 'execute') then
    bad := coalesce(bad || E'\n', '') || '  get_saldo_livre executável por anon';
  end if;

  if not has_function_privilege('authenticated', 'public.get_saldo_livre(uuid)', 'execute') then
    bad := coalesce(bad || E'\n', '') || '  get_saldo_livre NÃO executável por authenticated';
  end if;

  -- search_path fixo (regra da mig. 036 — mesmo idioma da asserção de lá,
  -- que casa por prefixo em vez de formatação exata do proconfig)
  if not exists (
    select 1 from pg_proc p
     where p.oid = 'public.get_saldo_livre(uuid)'::regprocedure
       and p.proconfig is not null
       and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
  ) then
    bad := coalesce(bad || E'\n', '') || '  get_saldo_livre sem search_path fixo';
  end if;

  -- definer (precisa ler plano_rubricas/balancete_lancamentos, admin-only no RLS)
  if not exists (
    select 1 from pg_proc p
     where p.oid = 'public.get_saldo_livre(uuid)'::regprocedure
       and p.prosecdef
  ) then
    bad := coalesce(bad || E'\n', '') || '  get_saldo_livre não é security definer';
  end if;

  if bad is not null then
    raise exception 'Asserção da 038 falhou:%', E'\n' || bad;
  end if;
end $$;

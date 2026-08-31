-- ============================================================
-- 048_janela_compromissos_dia_pagamento.sql
--
-- O SALDO LIVRE ESTAVA SISTEMATICAMENTE INFLADO, TODO MÊS.
--
-- `get_saldo_livre` cruza duas fontes com cortes de data diferentes:
-- o `realizado` vem do BALANCETE, fechado em `data_referencia`; os
-- `compromissos` eram contados a partir do mês SEGUINTE a essa data.
--
-- A 038 supôs que o balancete do mês M já contém a folha de M. Não
-- contém: **as bolsas da FUNAPE são pagas no dia 07**, e o balancete
-- chega em dia imprevisível — às vezes antes do 07, às vezes atrasado
-- meses, e vem um por mês. Quando `data_referencia` cai antes do dia
-- do pagamento, a folha daquele mês não está no balancete E também
-- não era contada como compromisso: sumia no vão entre as duas fontes.
--
-- Medido no 30.068 em 2026-08-31, balancete de 2026-08-03:
--   compromissos     91.400  (setembro a novembro)
--   folha de agosto  34.600  (6.200 x 3 + 4.000 x 4) -> invisível
--   saldo livre      92.600, quando o correto era 58.000
--
-- Os 34.600 são exatamente uma folha das 7 bolsas ativas. E 58.000 é
-- o número que fecha contra a FAPEG: 57.000 de cota reservada e não
-- usada, mais 1.000 de "Cota Resto" disponível.
--
-- TRÊS CORREÇÕES, porque o defeito tem três faces:
--
-- (A) JANELA. O balancete de data D cobre a folha do mês de D apenas
--     se D passou do dia do pagamento; senão cobre até o mês anterior
--     e os compromissos começam no PRÓPRIO mês de D. No limite exato
--     (D no dia 07) assume-se NÃO coberta: erra para "cabe menos",
--     que é o lado seguro numa decisão de gasto — a mesma escolha que
--     a 038 já fazia para balancete atrasado.
--
-- (B) QUEM CONTA. A janela agora pode começar no passado, então uma
--     bolsa ENCERRADA dentro dela teve pagamento que o balancete não
--     viu. O filtro `status = 'active'` a excluía e o dinheiro sumia
--     de novo. Passa a `status <> 'cancelled'` — cancelada é a única
--     que de fato não gera pagamento. A sobreposição de datas segue
--     excluindo o que terminou antes da janela.
--
-- (C) DEFASAGEM. `balancete_defasagem_meses` comparava
--     `data_referencia` com hoje e devolvia 0 para um balancete de
--     03/08 em agosto — escondendo justamente o mês que faltava.
--     Passa a medir do ÚLTIMO MÊS COBERTO. Nova chave no retorno:
--     `balancete_cobre_ate`, para a defasagem parar de ser adivinhada
--     a partir da data do documento.
--
-- O QUE NÃO MUDA: assinatura, o resto das chaves, o guard, a definição
-- de `realizado` e o rollup por grupo. Sem balancete, nada muda (a
-- janela segue no mês corrente). Chave nova é aditiva: consumidor que
-- a ignore continua correto.
--
-- Gerada como diff mínimo do corpo da 038 — não reescrita — para não
-- mexer sem querer no `rastreia_compromissos` nem no rollup. Atributos
-- repetidos de propósito (lição da 036); REPLACE e não DROP, para
-- preservar a ACL da 035.
--
-- Conferência: tests/sql/test_048_janela_compromissos.sql
-- ============================================================

begin;

create or replace function public.get_saldo_livre(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Dia em que a FUNAPE paga as bolsas. Fato de negocio, nao convencao:
  -- se mudar, esta constante e o unico lugar a mexer.
  c_dia_pagamento constant integer := 7;

  v_project       record;
  v_plano_id      uuid;
  v_balancete_id  uuid;
  v_data_ref      date;
  v_saldo_disp    numeric;
  v_rend          numeric;
  v_inicio_comp   date;
  v_ultimo_cober  date;
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
  -- (A) O balancete de data D so contem a folha do mes de D se D
  -- passou do dia do pagamento; senao cobre ate o mes ANTERIOR. A 038
  -- supunha sempre coberto, e a folha do mes caia no vao entre o
  -- realizado (que nao a tinha) e os compromissos (que comecavam no
  -- mes seguinte). No limite exato do dia 07 assume-se NAO coberta:
  -- erra para "cabe menos", o lado seguro numa decisao de gasto.
  if v_data_ref is not null then
    v_ultimo_cober := case
      when extract(day from v_data_ref) > c_dia_pagamento
        then date_trunc('month', v_data_ref)::date
      else (date_trunc('month', v_data_ref) - interval '1 month')::date
    end;
    v_inicio_comp := (v_ultimo_cober + interval '1 month')::date;
  else
    v_ultimo_cober := null;
    v_inicio_comp := date_trunc('month', current_date)::date;
  end if;

  -- Termina no fim da vigência: depois disso o recurso não é mais
  -- deste projeto (e o não gasto volta ao financiador).
  v_fim_comp := v_project.end_date;

  if v_fim_comp is null then
    select max(s.end_date) into v_fim_comp
      from public.scholarships s
     where s.project_id = p_project_id and s.status <> 'cancelled';
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

  -- (C) Defasagem medida do ultimo mes COBERTO, nao da data do
  -- documento: um balancete de 03/08 nao cobre agosto, e a 038
  -- devolvia 0 justamente escondendo o mes que faltava.
  if v_ultimo_cober is not null then
    v_defasagem := greatest(0, (
        (date_part('year',  current_date) - date_part('year',  v_ultimo_cober)) * 12
      + (date_part('month', current_date) - date_part('month', v_ultimo_cober))
    )::integer);

    if v_defasagem >= 3 then
      v_avisos := array_append(v_avisos,
        format('Balancete cobre ate %s (%s meses atras): os compromissos incluem bolsas provavelmente já pagas. O saldo livre está subestimado.', to_char(v_ultimo_cober, 'MM/YYYY'), v_defasagem));
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
       -- (B) A janela pode comecar no passado; bolsa ENCERRADA dentro
       -- dela teve pagamento que o balancete nao viu. Cancelada e a
       -- unica que de fato nao gera pagamento. A sobreposicao de datas
       -- continua excluindo o que terminou antes da janela.
       where s.project_id = p_project_id
         and s.status <> 'cancelled'
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
    'balancete_cobre_ate',    v_ultimo_cober,
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
      'saldo_livre = previsto − realizado − compromissos. Só compromissos de BOLSAS são rastreados: onde compromissos_cobertura = ''nenhuma'', saldo_livre é apenas previsto − realizado e não foi verificado contra compromissos assumidos. A janela de compromissos comeca no mes seguinte ao ultimo que o balancete cobre (`balancete_cobre_ate`), porque as bolsas sao pagas no dia 07 e um balancete emitido antes disso nao contem a folha do proprio mes. Remanejamento entre letras exige aprovação do financiador e não está considerado.'
  );
end;
$$;

comment on function public.get_saldo_livre is
  'Saldo realmente livre por grupo de rubrica até o fim da vigência. A janela de compromissos começa no mês seguinte ao último que o balancete cobre — as bolsas são pagas no dia 07 e um balancete emitido antes disso não contém a folha do próprio mês (ver 048). Guard: assert_project_allowed.';


-- ------------------------------------------------------------
-- Asserções — abortam a transação se o efeito não for o pretendido
-- ------------------------------------------------------------
do $asserts$
declare
  v_cobre date;
begin
  -- A regra da janela, isolada, para o efeito ficar explícito.
  v_cobre := (case when extract(day from date '2026-08-03') > 7
                   then date_trunc('month', date '2026-08-03')
                   else date_trunc('month', date '2026-08-03') - interval '1 month' end)::date;
  if v_cobre is distinct from date '2026-07-01' then
    raise exception 'Balancete de 03/08 deveria cobrir ate 07/2026, deu %.', v_cobre;
  end if;

  v_cobre := (case when extract(day from date '2026-08-20') > 7
                   then date_trunc('month', date '2026-08-20')
                   else date_trunc('month', date '2026-08-20') - interval '1 month' end)::date;
  if v_cobre is distinct from date '2026-08-01' then
    raise exception 'Balancete de 20/08 deveria cobrir ate 08/2026, deu %.', v_cobre;
  end if;

  -- O EXECUTE de authenticated tem de sobreviver ao replace (mig. 035).
  if not has_function_privilege('authenticated', 'public.get_saldo_livre(uuid)', 'EXECUTE') then
    raise exception 'authenticated perdeu EXECUTE em get_saldo_livre.';
  end if;
end
$asserts$;

commit;

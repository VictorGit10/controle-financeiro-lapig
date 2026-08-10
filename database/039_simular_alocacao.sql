-- ============================================================
-- 039_simular_alocacao.sql
-- ============================================================
-- RPC `simular_alocacao(...)` — segunda peça da camada de DECISÃO.
--
-- POR QUE EXISTE
-- A 038 responde "quanto está livre NESTE centro de custo?". A
-- pergunta que motivou a camada inteira é outra, e é comparativa:
--
--   "onde é melhor colocar uma bolsa de R$ 2.000/mês por 24 meses?"
--   "em qual projeto cabe um computador de R$ 8.000?"
--
-- Esta função roda `get_saldo_livre` em todos os centros de custo que
-- o chamador enxerga, aplica as restrições que a 038 deliberadamente
-- não aplicava (prazo, caixa, rubrica alvo) e devolve uma lista
-- RANQUEADA, com veredito e justificativa por projeto.
--
-- Ela não redefine nada: herda a semântica de saldo livre da 038
-- (previsto − realizado − compromissos, por grupo de rubrica), que já
-- foi conferida contra o papel. Toda a discussão de definição ficou na
-- fase anterior, de propósito.
--
--
-- ============================================================
-- AS TRÊS RESTRIÇÕES (e por que são três, não uma)
-- ============================================================
--
-- Um mesmo pedido pode caber no orçamento e não caber no caixa, ou
-- caber nos dois e não caber no prazo. Tratar as três como um número
-- só esconde exatamente o motivo pelo qual a resposta é "não".
--
-- 1. ORÇAMENTO — o plano autoriza?
--    `saldo_livre` do grupo alvo, vindo da 038. É o teto
--    ORÇAMENTÁRIO: o que o financiador aprovou gastar naquela letra.
--
-- 2. CAIXA — o dinheiro está na conta na hora de pagar?
--    Regra de negócio informada pelo coordenador: uma bolsa só pode
--    ser prevista se houver saldo EM CONTA para pagá-la. Orçamento
--    autorizado que ainda não virou depósito não paga bolsista.
--
--    Por isso o caixa não é conferido como um número único: uma bolsa
--    de 24 meses é uma saída mensal, e o saldo em conta sobe (parcelas
--    do cronograma de desembolso) e desce (bolsas já ativas) ao longo
--    da vigência. A função projeta MÊS A MÊS, do balancete até o fim
--    da vigência, e reporta o primeiro mês em que o saldo projetado
--    ficaria negativo (`caixa.aperta_em`).
--
--    ATENÇÃO À DIREÇÃO DO ERRO — é o oposto da 038:
--      · O orçamento é CONSERVADOR (compromissos futuros descontados,
--        balancete atrasado empurra para "cabe menos").
--      · O caixa é OTIMISTA: a única saída que o banco sabe PREVER é
--        bolsa. Diária, equipamento e contrato não têm previsão em
--        tabela nenhuma.
--
--    Mas "otimista" aqui não é buraco permanente, e a distinção
--    importa para saber quanto confiar no número. São DUAS lacunas
--    diferentes, com remédios diferentes:
--
--    (a) RETROSPECTIVA — o que já saiu da conta e ainda não foi visto.
--        O ponto de partida da projeção é `saldo_disponivel`, que é o
--        saldo REAL da conta na FUNAPE: ele já embute diária,
--        equipamento e contrato pagos até `data_referencia`. Então a
--        cegueira vale só para o intervalo entre o balancete e hoje —
--        exatamente `balancete_defasagem_meses`. Com o balancete
--        importado todo mês (rotina do Fechamento Mensal), essa janela
--        fica em no máximo um mês. Com balancete atrasado, ela cresce
--        na mesma medida. É por isso que a função devolve
--        `caixa.janela_cega_meses` em vez de um disclaimer fixo: a
--        confiabilidade do caixa é MENSURÁVEL, e é a rotina mensal que
--        a mantém alta.
--
--    (b) PROSPECTIVA — o que ainda vai sair e ninguém previu. Essa é
--        estrutural: nenhuma tabela orça diária ou equipamento futuro,
--        e balancete é retrospectivo, então importá-lo não fecha esta
--        lacuna. O que a rotina mensal dá aqui é DETECÇÃO: o saldo do
--        mês seguinte revela o quanto de fato saiu, e a simulação pode
--        ser refeita antes que a divergência vire problema.
--
--    `caixa.cobertura` resume o estado em uma palavra ('atualizada',
--    'defasada', 'nenhuma'). Um caixa que "cobre" significa "cobre as
--    bolsas conhecidas mais o que já estava debitado no balancete".
--
--    Entradas previstas vêm de `plano_desembolsos` com
--    `data_prevista` POSTERIOR ao balancete — as anteriores já estão
--    dentro do `saldo_disponivel` da conta, e contá-las de novo seria
--    dupla contagem (mesma regra que a 038 usa para compromissos).
--    Parcelas sem valor normalizado (o plano diz "mediante cálculo de
--    gastos") não entram e são contadas em
--    `caixa.desembolsos_sem_valor` — dinheiro que provavelmente vai
--    entrar, mas que a função não pode somar sem inventar.
--
-- 3. PRAZO — dá tempo de executar dentro da vigência?
--    Uma bolsa de 24 meses num projeto que acaba em 5 não cabe, e o
--    motivo não é saldo: é prazo. Sem essa restrição a resposta
--    engana. Daí o veredito `cabe_parcial`, que é informação útil e
--    não meia-recusa: "cabe, mas só 5 dos 24 meses; os outros 19
--    precisam de outra fonte".
--
--
-- ============================================================
-- REMANEJAMENTO: É PROCESSO, NÃO É VEREDITO
-- ============================================================
--
-- Esta é a regra institucional que mais mudou o desenho, e ela não
-- estava no banco — veio do coordenador:
--
--   TODA implementação de bolsa exige remanejamento, HAJA OU NÃO
--   saldo na rubrica de pessoal. O remanejamento é o ato
--   administrativo que NOMEIA o bolsista. Não é um plano B para
--   quando falta verba na letra certa.
--
-- Consequência de desenho: `cabe_com_remanejamento` NÃO é um veredito
-- rebaixado. Se remanejar é obrigatório em 100% dos casos de bolsa,
-- usar isso como critério de ranking seria ruído puro — ordenaria os
-- projetos por uma característica que todos compartilham.
--
-- Então o remanejamento saiu do campo `veredito` e virou o objeto
-- `remanejamento`, que descreve o ATRITO do processo, com três graus:
--
--   'nomeacao'     — há saldo na letra de pessoal. O remanejamento é
--                    só o ato de nomear. Atrito baixo, mas existe.
--   'entre_letras' — falta saldo em pessoal e a verba precisa vir de
--                    outra letra. Remanejar é quase sempre possível,
--                    mas custa tempo e desgaste com o financiador.
--                    Aparece como possibilidade, não como impedimento.
--   'nenhum'       — compra com espaço na rubrica alvo.
--
-- O ÚNICO caso em que remanejar não resolve, e que portanto é um
-- portão de verdade: o plano não tem NENHUMA rubrica do grupo 'a'
-- (Pessoal). Sem letra de pessoal orçada não há de onde nem para onde
-- remanejar uma bolsa. Isso é `nao_cabe`, motivo
-- `sem_rubrica_pessoal`, e nenhuma negociação contorna.
--
-- Pool remanejável: soma dos saldos livres POSITIVOS, excluindo
-- 'cip_ufg', 'cip_ua' e 'dao'. Custo indireto e despesa administrativa
-- são fatia institucional, não verba de execução do projeto — tratá-los
-- como remanejáveis inflaria o espaço disponível. Grupo com saldo
-- negativo também não entra (não se remaneja de quem já estourou). As
-- duas exclusões erram para o lado de "cabe menos", coerente com a 038.
--
--
-- ============================================================
-- O RANQUEAMENTO CARREGA A REGRA INSTITUCIONAL
-- ============================================================
--
-- Ordenar por saldo faria uma ferramenta que só sabe somar. A regra
-- que interessa é outra: DINHEIRO QUE VAI VOLTAR AO FINANCIADOR DEVE
-- SER GASTO PRIMEIRO. Saldo não executado até o fim da vigência é
-- devolvido — o projeto perde o recurso.
--
-- Logo o critério primário é RISCO DE DEVOLUÇÃO, não volume:
--
--   prioridade = saldo_livre_realocavel / meses_restantes
--
-- Isto é a taxa de queima mensal necessária para não devolver nada.
-- Exemplo real do critério: R$ 30 mil vencendo em 4 meses dá
-- R$ 7.500/mês; R$ 200 mil com 3 anos pela frente dá R$ 5.556/mês. O
-- projeto menor ranqueia acima do maior — e deve mesmo, porque é ele
-- que está prestes a perder o recurso.
--
-- Projeto sem data de término cadastrada não tem prazo de devolução
-- estimável: `prioridade` fica nula e ele cai para o fim da lista, com
-- aviso. É ausência de dado, não prioridade zero.
--
-- `cabe` e `cabe_parcial` COMPARTILHAM o mesmo balde, e isso é
-- deliberado. A tentação é ranquear "cabe integralmente" acima de
-- "cabe parcial", mas isso inverte a regra acima justamente no caso
-- que ela existe para resolver: um projeto que devolve R$ 68 mil em 4
-- meses e comporta 4 dos 24 meses da bolsa é um lugar MELHOR para os
-- primeiros 4 meses do que um projeto de R$ 250 mil com 3 anos pela
-- frente — e ranquear o segundo primeiro faria perder o recurso do
-- primeiro. Quem lê vê `veredito` e `meses_cabiveis` na posição 1;
-- nada fica escondido. Só `nao_cabe` e `sem_plano` caem para baixo.
--
--
-- ============================================================
-- SEGURANÇA
-- ============================================================
-- `security invoker`, ao contrário da 038. Aqui não é preciso furar o
-- RLS: tudo que a função lê direto (`projects`, `planos_trabalho`,
-- `plano_desembolsos`, `scholarships`) já é escopado por centro de
-- custo desde a mig. 033, e o único dado admin-only (plano_rubricas,
-- balancete_lancamentos) chega pela `get_saldo_livre`, que é definer
-- E guardada por `assert_project_allowed`. Invoker é a escolha mais
-- segura sempre que ela é possível — mesmo critério das 4 RPCs de
-- cálculo que a 033 converteu.
--
-- O filtro explícito por `is_admin() or allowed_project_ids()` é
-- redundante sob RLS, e fica de propósito: declara a intenção e
-- garante que `get_saldo_livre` nunca receba um projeto que levantaria
-- exceção no guard.
--
-- Não retorna CPF nem nome de bolsista: uma decisão de alocação não
-- precisa deles (a 038 devolve `bolsas_ativas` detalhado; aqui só o
-- agregado atravessa).
-- ============================================================


create or replace function public.simular_alocacao(
  p_tipo        text,                     -- 'bolsa' (recorrente) | 'compra' (pontual)
  p_valor       numeric,                  -- mensal se bolsa, total se compra
  p_rubrica     text    default null,     -- alvo; null => 'a' para bolsa
  p_inicio      date    default current_date,
  p_meses       integer default null,     -- só para bolsa (default 12)
  p_project_ids uuid[]  default null      -- restringe a simulação a estes centros de custo
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  -- parâmetros normalizados
  v_tipo         text;
  v_meses        integer;
  v_rubrica      text;
  v_grupo_param  text;

  -- laço
  r_proj         record;
  v_sl           jsonb;

  -- por projeto
  v_grupo_alvo   text;
  v_plano_id     uuid;
  v_data_ref     date;
  v_caixa_ini    numeric;
  v_ini_comp     date;
  v_fim_vig      date;
  v_meses_rest   integer;
  v_alloc_ini    date;
  v_alloc_fim    date;
  v_fim_proj     date;

  v_prev_pessoal numeric;   -- previsto do grupo 'a', para o portão da bolsa
  v_saldo_grupo  numeric;
  v_saldo_realoc numeric;
  v_cobertura    text;
  v_espaco       numeric;
  v_fonte_espaco text;

  v_meses_prazo  integer;
  v_meses_orc    integer;
  v_meses_caixa  integer;
  v_meses_cabe   integer;

  v_aperta_em    date;
  v_menor_saldo  numeric;
  v_aperta_sem   date;
  v_ult_neg      date;
  v_ult_mes      date;
  v_normaliza    date;
  v_entradas     numeric;
  v_sem_valor    integer;
  v_defasagem    integer;

  v_veredito     text;
  v_motivo_cod   text;
  v_bucket       integer;
  v_motivos      text[];
  v_avisos       text[];
  v_prioridade   numeric;
  v_rem_tipo     text;
  v_rem_nota     text;

  v_itens        jsonb := '[]'::jsonb;
  v_projetos     jsonb;
  v_resumo       jsonb;
  v_obs          text;
  v_n            integer := 0;
begin
  -- ---------- validação dos parâmetros ----------
  v_tipo := lower(nullif(trim(coalesce(p_tipo, '')), ''));

  if v_tipo is null or v_tipo not in ('bolsa', 'compra') then
    raise exception 'p_tipo deve ser ''bolsa'' ou ''compra'' (recebido: %)', p_tipo;
  end if;

  if p_valor is null or p_valor <= 0 then
    raise exception 'p_valor deve ser maior que zero (recebido: %)', p_valor;
  end if;

  if v_tipo = 'bolsa' then
    v_meses := coalesce(nullif(p_meses, 0), 12);
    if v_meses < 0 then
      raise exception 'p_meses deve ser positivo (recebido: %)', p_meses;
    end if;
  else
    v_meses := 1;
  end if;

  -- Rubrica alvo -> grupo (mesma superfície de decisão da 038:
  -- coalesce(parent_code, code)). Rubrica desconhecida é erro, não
  -- silêncio: simular contra uma letra que não existe daria uma lista
  -- inteira de "não cabe" sem motivo aparente.
  v_rubrica := nullif(trim(coalesce(p_rubrica, '')), '');

  if v_rubrica is not null then
    select coalesce(r.parent_code, r.code) into v_grupo_param
      from public.rubricas r
     where r.code = v_rubrica;

    if v_grupo_param is null then
      raise exception 'Rubrica desconhecida: % (ver tabela public.rubricas)', v_rubrica;
    end if;
  end if;

  v_alloc_ini := date_trunc('month', coalesce(p_inicio, current_date))::date;

  -- ---------- laço sobre os centros de custo visíveis ----------
  for r_proj in
    select p.id, p.name, p.code, p.end_date
      from public.projects p
     where p.active
       and (public.is_admin() or p.id = any(public.allowed_project_ids()))
       and (p_project_ids is null or p.id = any(p_project_ids))
     order by p.name
  loop
    v_n := v_n + 1;

    v_sl := public.get_saldo_livre(r_proj.id);

    -- Sem plano ativo não há previsto por rubrica: nada a simular.
    if not (v_sl->>'has_plano')::boolean then
      v_itens := v_itens || jsonb_build_array(jsonb_build_object(
        '_bucket',      2,
        '_meses_rest',  null,
        'project_id',   r_proj.id,
        'project_name', r_proj.name,
        'project_code', r_proj.code,
        'veredito',     'sem_plano',
        'motivo_codigo','sem_plano_ativo',
        'motivos',      to_jsonb(array[
                          'Sem plano de trabalho ativo: não há previsto por rubrica para avaliar. Cadastre/ative um plano antes de simular.'
                        ]),
        'prioridade',   null,
        -- Chaves nulas de propósito: os itens de curto-circuito mantêm
        -- o MESMO conjunto de chaves dos demais, para que quem consome
        -- (tela, MCP) possa iterar sem checar a forma caso a caso.
        'meses_solicitados', v_meses,
        'meses_cabiveis',    0,
        'valor_cabivel',     0,
        'risco_devolucao',   null,
        'orcamento',         null,
        'caixa',             null,
        'prazo',             null,
        'remanejamento',     null,
        'avisos',            '[]'::jsonb
      ));
      continue;
    end if;

    -- ---------- contexto vindo da 038 ----------
    v_data_ref   := nullif(v_sl->>'data_referencia', '')::date;
    v_caixa_ini  := nullif(v_sl->>'saldo_disponivel_caixa', '')::numeric;
    v_defasagem  := nullif(v_sl->>'balancete_defasagem_meses', '')::integer;
    v_ini_comp   := (v_sl->>'compromissos_inicio')::date;
    v_meses_rest := nullif(v_sl->>'meses_restantes', '')::integer;
    v_motivos    := '{}';
    v_avisos     := '{}';

    -- Avisos da 038 atravessam: são sobre a qualidade do número, e a
    -- decisão herda todos eles.
    select coalesce(array_agg(a #>> '{}'), '{}') into v_avisos
      from jsonb_array_elements(coalesce(v_sl->'avisos', '[]'::jsonb)) a;

    -- Fim da vigência. Sem end_date, a 038 já caiu no fim da última
    -- bolsa ativa; se nem isso, o prazo deixa de ser restrição.
    v_fim_vig := coalesce(
      r_proj.end_date,
      nullif(v_sl->>'compromissos_fim', '')::date,
      (v_alloc_ini + make_interval(months => greatest(v_meses - 1, 0)))::date
    );

    select id into v_plano_id
      from public.planos_trabalho
     where project_id = r_proj.id and ativo = true
     limit 1;

    -- ---------- grupo alvo ----------
    v_grupo_alvo := coalesce(v_grupo_param, case when v_tipo = 'bolsa' then 'a' end);

    select coalesce((g->>'saldo_livre')::numeric, 0),
           g->>'compromissos_cobertura'
      into v_saldo_grupo, v_cobertura
      from jsonb_array_elements(v_sl->'grupos') g
     where g->>'grupo_code' = v_grupo_alvo;

    v_saldo_grupo := coalesce(v_saldo_grupo, 0);

    -- O portão da bolsa olha SEMPRE o grupo 'a', mesmo que o chamador
    -- tenha informado outra rubrica: bolsa se paga com verba de
    -- pessoal, e é a existência dessa letra que decide se remanejar
    -- resolve ou não.
    select coalesce((g->>'previsto')::numeric, 0)
      into v_prev_pessoal
      from jsonb_array_elements(v_sl->'grupos') g
     where g->>'grupo_code' = 'a';

    v_prev_pessoal := coalesce(v_prev_pessoal, 0);

    -- Pool remanejável: só saldos positivos, sem custo indireto/DAO.
    select coalesce(sum(greatest(coalesce((g->>'saldo_livre')::numeric, 0), 0)), 0)
      into v_saldo_realoc
      from jsonb_array_elements(v_sl->'grupos') g
     where g->>'grupo_code' not in ('cip_ufg', 'cip_ua', 'dao');

    -- ---------- prioridade (risco de devolução) ----------
    -- Taxa de queima mensal necessária para não devolver recurso.
    v_prioridade := case
      when v_meses_rest is null then null
      else round(v_saldo_realoc / greatest(v_meses_rest, 1), 2)
    end;

    if v_meses_rest is null then
      v_avisos := array_append(v_avisos,
        'Sem data de término: não há como estimar risco de devolução, e o projeto cai para o fim do ranking.');
    end if;

    -- ---------- PORTÃO: bolsa exige rubrica de pessoal ----------
    -- Único caso que remanejamento não resolve.
    if v_tipo = 'bolsa' and v_prev_pessoal <= 0 then
      v_itens := v_itens || jsonb_build_array(jsonb_build_object(
        '_bucket',      1,
        '_meses_rest',  v_meses_rest,
        'project_id',   r_proj.id,
        'project_name', r_proj.name,
        'project_code', r_proj.code,
        'veredito',     'nao_cabe',
        'motivo_codigo','sem_rubrica_pessoal',
        'motivos',      to_jsonb(array[
                          'O plano ativo não orça nenhuma rubrica do grupo "a" (Pessoal). Sem letra de pessoal não há de onde nem para onde remanejar uma bolsa — nem com negociação.'
                        ]),
        'prioridade',   v_prioridade,
        'remanejamento', jsonb_build_object(
          'necessario', true,
          'tipo',       'impossivel',
          'nota',       'Único caso em que remanejar não resolve: não existe letra de pessoal no plano ativo.'
        ),
        -- Mesma razão do item 'sem_plano': conjunto de chaves uniforme.
        'meses_solicitados', v_meses,
        'meses_cabiveis',    0,
        'valor_cabivel',     0,
        'risco_devolucao', jsonb_build_object(
          'saldo_em_risco',         v_saldo_realoc,
          'meses_restantes',        v_meses_rest,
          'fim_vigencia',           r_proj.end_date,
          'burn_mensal_necessario', v_prioridade
        ),
        'orcamento',    null,
        'caixa',        null,
        'prazo',        null,
        'avisos',       to_jsonb(v_avisos)
      ));
      continue;
    end if;

    -- ---------- espaço orçamentário ----------
    if v_grupo_alvo is null then
      -- compra sem rubrica alvo informada: avalia contra o pool
      v_espaco       := v_saldo_realoc;
      v_fonte_espaco := 'pool_remanejavel';
      v_avisos := array_append(v_avisos,
        'Nenhuma rubrica alvo informada: a avaliação usou o saldo livre remanejável do projeto inteiro, não uma letra específica.');
    elsif v_saldo_grupo >= p_valor * v_meses then
      v_espaco       := v_saldo_grupo;
      v_fonte_espaco := 'grupo_alvo';
    else
      v_espaco       := v_saldo_realoc;
      v_fonte_espaco := 'pool_remanejavel';
    end if;

    v_meses_orc := case
      when p_valor <= 0 then 0
      else floor(greatest(v_espaco, 0) / p_valor)::integer
    end;

    if v_tipo = 'compra' then
      v_meses_orc := case when v_espaco >= p_valor then 1 else 0 end;
    end if;

    -- ---------- prazo ----------
    if v_alloc_ini > v_fim_vig then
      v_meses_prazo := 0;
    else
      v_meses_prazo := least(
        v_meses,
        (
            (date_part('year',  v_fim_vig) - date_part('year',  v_alloc_ini)) * 12
          + (date_part('month', v_fim_vig) - date_part('month', v_alloc_ini))
        )::integer + 1
      );
    end if;

    v_alloc_fim := (v_alloc_ini + make_interval(months => greatest(v_meses_prazo - 1, 0)))::date;
    v_fim_proj  := greatest(v_fim_vig, v_alloc_fim);

    if v_alloc_ini < v_ini_comp then
      v_avisos := array_append(v_avisos,
        format('Início solicitado (%s) é anterior à janela do balancete (%s): a projeção de caixa começa em %s.',
               to_char(v_alloc_ini, 'MM/YYYY'), to_char(v_ini_comp, 'MM/YYYY'), to_char(v_ini_comp, 'MM/YYYY')));
    end if;

    -- ---------- projeção de caixa, mês a mês ----------
    v_aperta_em   := null;
    v_menor_saldo := null;
    v_aperta_sem  := null;
    v_ult_neg     := null;
    v_ult_mes     := null;
    v_normaliza   := null;
    v_entradas    := 0;
    v_sem_valor   := 0;
    v_meses_caixa := v_meses_prazo;

    if v_caixa_ini is null then
      v_avisos := array_append(v_avisos,
        'Sem balancete importado: não há saldo em conta conhecido. O caixa NÃO foi verificado — a avaliação abaixo é só orçamentária.');
    elsif v_fim_proj >= v_ini_comp then
      select count(*)::integer into v_sem_valor
        from public.plano_desembolsos pd
       where pd.plano_id = v_plano_id
         and pd.valor is null
         and (v_data_ref is null or pd.data_prevista is null or pd.data_prevista > v_data_ref);

      with meses as (
        select m.month_start, m.month_end
          from public.generate_month_series(v_ini_comp, v_fim_proj) m
      ),
      fluxo as (
        select
          ms.month_start,
          coalesce((
            select sum(pd.valor)
              from public.plano_desembolsos pd
             where pd.plano_id = v_plano_id
               and pd.valor is not null
               and pd.data_prevista between ms.month_start and ms.month_end
               and (v_data_ref is null or pd.data_prevista > v_data_ref)
          ), 0) as entrada,
          coalesce((
            select sum(s.amount)
              from public.scholarships s
             where s.project_id = r_proj.id
               and s.status = 'active'
               and s.start_date <= ms.month_end
               and s.end_date   >= ms.month_start
          ), 0) as saida_bolsas,
          case
            when v_meses_prazo = 0 then 0
            when v_tipo = 'bolsa'
             and ms.month_start >= greatest(v_alloc_ini, v_ini_comp)
             and ms.month_start <= v_alloc_fim then p_valor
            when v_tipo = 'compra'
             and ms.month_start = greatest(v_alloc_ini, v_ini_comp) then p_valor
            else 0
          end as saida_nova
          from meses ms
      ),
      acum as (
        select f.month_start,
               f.entrada,
               v_caixa_ini + sum(f.entrada - f.saida_bolsas - f.saida_nova)
                 over (order by f.month_start) as saldo_com,
               v_caixa_ini + sum(f.entrada - f.saida_bolsas)
                 over (order by f.month_start) as saldo_sem
          from fluxo f
      )
      select min(a.month_start) filter (where a.saldo_com < 0),
             min(a.saldo_com),
             min(a.month_start) filter (where a.saldo_sem < 0),
             coalesce(sum(a.entrada), 0),
             max(a.month_start) filter (where a.saldo_com < 0),
             max(a.month_start)
        into v_aperta_em, v_menor_saldo, v_aperta_sem, v_entradas,
             v_ult_neg, v_ult_mes
        from acum a;

      -- Um vale de caixa não é o mesmo que falta de dinheiro: a
      -- parcela seguinte do cronograma pode recompor a conta. Se o
      -- último mês negativo não é o último da projeção, o caixa se
      -- normaliza — e adiar o início resolve sem trocar de projeto.
      if v_ult_neg is not null and v_ult_mes is not null and v_ult_neg < v_ult_mes then
        v_normaliza := (v_ult_neg + interval '1 month')::date;
      end if;

      -- Meses cobertos pelo caixa: até o mês anterior ao primeiro
      -- estouro. Se estoura já no primeiro mês da alocação, zero.
      if v_aperta_em is not null then
        v_meses_caixa := greatest(0, (
            (date_part('year',  v_aperta_em) - date_part('year',  greatest(v_alloc_ini, v_ini_comp))) * 12
          + (date_part('month', v_aperta_em) - date_part('month', greatest(v_alloc_ini, v_ini_comp)))
        )::integer);
        v_meses_caixa := least(v_meses_caixa, v_meses_prazo);
      end if;

      if v_aperta_sem is not null then
        v_avisos := array_append(v_avisos,
          format('O caixa projetado já ficaria negativo em %s SEM esta alocação: o aperto não é causado pelo que se está simulando.',
                 to_char(v_aperta_sem, 'MM/YYYY')));
      end if;

      if v_sem_valor > 0 then
        v_avisos := array_append(v_avisos,
          format('%s parcela(s) do cronograma de desembolso sem valor normalizado ficaram de fora das entradas: o caixa projetado está subestimado.', v_sem_valor));
      end if;

      -- Janela cega do caixa (lacuna retrospectiva). Complementa — não
      -- duplica — o aviso de defasagem da 038: lá o efeito é no
      -- orçamento (subestima o saldo livre), aqui é no caixa
      -- (superestima o dinheiro em conta). Direções opostas.
      -- Limiar 3 para alarmar, o mesmo que a 038 usa: a FUNAPE emite o
      -- balancete com atraso próprio, então 1–2 meses é o regime normal
      -- da rotina mensal e avisar ali seria alarme falso constante. O
      -- número exato fica sempre em `caixa.janela_cega_meses`.
      if coalesce(v_defasagem, 0) >= 3 then
        v_avisos := array_append(v_avisos,
          format('Caixa com janela cega de %s meses: o que saiu da conta desde %s e não é bolsa (diária, equipamento, contrato) ainda não foi visto. Importar o balancete do mês fecha a janela.',
                 v_defasagem, to_char(v_data_ref, 'MM/YYYY')));
      end if;
    end if;

    -- ---------- veredito ----------
    v_meses_cabe := least(v_meses_prazo, v_meses_orc, v_meses_caixa);

    if v_meses_prazo = 0 then
      v_motivos := array_append(v_motivos,
        format('Prazo: a vigência termina em %s, antes do início solicitado (%s).',
               to_char(v_fim_vig, 'MM/YYYY'), to_char(v_alloc_ini, 'MM/YYYY')));
    elsif v_meses_prazo < v_meses then
      v_motivos := array_append(v_motivos,
        format('Prazo: a vigência termina em %s e cobre %s de %s meses.',
               to_char(v_fim_vig, 'MM/YYYY'), v_meses_prazo, v_meses));
    end if;

    if v_meses_orc < v_meses then
      v_motivos := array_append(v_motivos,
        format('Orçamento: R$ %s livre em %s, o que cobre %s de %s %s.',
               translate(to_char(v_espaco, 'FM999,999,999,990.00'), '.,', ',.'),
               case when v_fonte_espaco = 'grupo_alvo'
                    then format('"%s"', v_grupo_alvo)
                    else 'saldo remanejável do projeto' end,
               v_meses_orc, v_meses,
               case when v_tipo = 'bolsa' then 'meses' else 'unidade(s)' end));
    end if;

    -- Caixa não verificado não pode ficar só nos avisos: `motivos` é o
    -- que explica o veredito, e um "cabe" que nunca olhou a conta
    -- precisa dizer isso na própria justificativa.
    if v_caixa_ini is null then
      v_motivos := array_append(v_motivos,
        'Caixa NÃO verificado: sem balancete importado não há saldo em conta conhecido. O veredito considera apenas orçamento e prazo — e bolsa só se paga com dinheiro em conta.');
    end if;

    if v_caixa_ini is not null and v_aperta_em is not null then
      v_motivos := array_append(v_motivos,
        format('Caixa: o saldo em conta projetado fica negativo em %s (menor saldo: R$ %s). Cobre %s de %s meses.',
               to_char(v_aperta_em, 'MM/YYYY'),
               translate(to_char(coalesce(v_menor_saldo, 0), 'FM999,999,999,990.00'), '.,', ',.'),
               v_meses_caixa, v_meses));

      if v_normaliza is not null then
        v_motivos := array_append(v_motivos,
          format('Caixa: é um vale, não falta de recurso — a conta volta ao positivo em %s. Adiar o início para essa competência resolve sem trocar de centro de custo.',
                 to_char(v_normaliza, 'MM/YYYY')));
      end if;
    end if;

    -- Balde 0 cobre 'cabe' E 'cabe_parcial': ver cabeçalho — separar os
    -- dois inverteria o critério de risco de devolução.
    if v_meses_cabe <= 0 then
      v_veredito := 'nao_cabe';
      v_bucket   := 1;
    elsif v_meses_cabe < v_meses then
      v_veredito := 'cabe_parcial';
      v_bucket   := 0;
    else
      v_veredito := 'cabe';
      v_bucket   := 0;
      -- A frase de "cabe" só pode afirmar o que foi de fato conferido.
      -- Caixa sem balancete e prazo sem data de término são LACUNAS, e
      -- cada uma sai do cabeçalho da frase e vira ressalva explícita —
      -- senão o veredito afirma cobertura que ninguém verificou (o
      -- fallback de vigência da 038 chega a produzir uma data que não
      -- existe em lugar nenhum do cadastro).
      v_motivos  := array_append(v_motivos,
        format('%s: R$ %s de espaço em %s, %s e %s.',
               case
                 when v_caixa_ini is null and r_proj.end_date is null then 'Cabe no orçamento'
                 when v_caixa_ini is null                             then 'Cabe no orçamento e no prazo'
                 when r_proj.end_date is null                         then 'Cabe no orçamento e no caixa'
                 else 'Cabe integralmente'
               end,
               translate(to_char(v_espaco, 'FM999,999,999,990.00'), '.,', ',.'),
               case when v_fonte_espaco = 'grupo_alvo'
                    then format('"%s"', v_grupo_alvo)
                    else 'saldo remanejável' end,
               case
                 when v_caixa_ini is null then 'o caixa não foi verificado (sem balancete importado)'
                 when v_tipo = 'bolsa'    then format('o caixa projetado cobre os %s meses', v_meses)
                 else 'o caixa projetado cobre a competência'
               end,
               case
                 when r_proj.end_date is null
                   then 'o prazo não foi avaliado (projeto sem data de término cadastrada)'
                 else format('o prazo cabe na vigência (até %s)', to_char(v_fim_vig, 'MM/YYYY'))
               end));
    end if;

    -- Qual das três restrições está amarrando. É o campo que a tela e o
    -- MCP leem para saber O QUE resolver — texto de motivo é para
    -- pessoa, código é para máquina. Empate resolve pela restrição mais
    -- rígida: prazo não se negocia, caixa depende de calendário,
    -- orçamento é o único que remanejamento alcança.
    v_motivo_cod := case
      when v_meses_cabe >= v_meses           then null
      when v_meses_prazo = v_meses_cabe      then 'prazo'
      when v_meses_caixa = v_meses_cabe      then 'caixa'
      else                                        'orcamento'
    end;

    -- ---------- remanejamento (processo, não veredito) ----------
    if v_tipo = 'bolsa' then
      if v_saldo_grupo >= p_valor * greatest(v_meses_cabe, 1) then
        v_rem_tipo := 'nomeacao';
        v_rem_nota := 'Há saldo livre na letra de pessoal. Ainda assim é preciso remanejamento: é o ato que nomeia o bolsista.';
      else
        v_rem_tipo := 'entre_letras';
        v_rem_nota := 'Falta saldo na letra de pessoal — a verba precisa vir de outra letra. Remanejar é quase sempre possível, mas leva tempo e desgaste junto ao financiador. Some-se a isso o remanejamento de nomeação, que toda bolsa exige.';
      end if;
    else
      if v_fonte_espaco = 'grupo_alvo' then
        v_rem_tipo := 'nenhum';
        v_rem_nota := 'Há saldo livre na rubrica alvo: a compra não depende de remanejamento.';
      else
        v_rem_tipo := 'entre_letras';
        v_rem_nota := 'A rubrica alvo não comporta o valor — dependeria de remanejamento de outra letra, processo possível mas demorado.';
      end if;
    end if;

    -- ---------- item ----------
    v_itens := v_itens || jsonb_build_array(jsonb_build_object(
      '_bucket',      v_bucket,
      '_meses_rest',  v_meses_rest,
      'project_id',   r_proj.id,
      'project_name', r_proj.name,
      'project_code', r_proj.code,
      'veredito',     v_veredito,
      'motivo_codigo',v_motivo_cod,
      'motivos',      to_jsonb(v_motivos),
      'meses_solicitados', v_meses,
      'meses_cabiveis',    greatest(v_meses_cabe, 0),
      'valor_cabivel', case when v_tipo = 'bolsa'
                            then p_valor * greatest(v_meses_cabe, 0)
                            else case when v_meses_cabe > 0 then p_valor else 0 end
                       end,
      'prioridade',   v_prioridade,
      'risco_devolucao', jsonb_build_object(
        'saldo_em_risco',           v_saldo_realoc,
        'meses_restantes',          v_meses_rest,
        'fim_vigencia',             r_proj.end_date,
        'burn_mensal_necessario',   v_prioridade
      ),
      'orcamento', jsonb_build_object(
        'grupo_alvo',              v_grupo_alvo,
        'saldo_livre_grupo',       v_saldo_grupo,
        'saldo_livre_realocavel',  v_saldo_realoc,
        'espaco_considerado',      v_espaco,
        'fonte_espaco',            v_fonte_espaco,
        'compromissos_cobertura',  coalesce(v_cobertura, 'nenhuma'),
        'meses_cobertos',          v_meses_orc
      ),
      'caixa', jsonb_build_object(
        -- 'atualizada' = rotina mensal em dia (até 2 meses, que é o
        -- regime normal dado o atraso de emissão da FUNAPE);
        -- 'defasada' = a janela cega passou disso; 'nenhuma' = sem
        -- balancete, caixa não verificado. Ver bloco (a)/(b) no
        -- cabeçalho. Quem precisa de precisão lê janela_cega_meses.
        'cobertura',              case
                                    when v_caixa_ini is null           then 'nenhuma'
                                    when coalesce(v_defasagem, 0) <= 2 then 'atualizada'
                                    else 'defasada'
                                  end,
        'saldo_inicial',          v_caixa_ini,
        'data_referencia',        v_data_ref,
        'defasagem_meses',        v_defasagem,
        'janela_cega_meses',      case when v_caixa_ini is null
                                       then null else coalesce(v_defasagem, 0) end,
        'entradas_previstas',     v_entradas,
        'desembolsos_sem_valor',  v_sem_valor,
        'menor_saldo_projetado',  v_menor_saldo,
        'aperta_em',              v_aperta_em,
        'normaliza_em',           v_normaliza,
        'ja_negativo_sem_alocacao', v_aperta_sem is not null,
        'meses_cobertos',         v_meses_caixa
      ),
      'prazo', jsonb_build_object(
        'inicio',          greatest(v_alloc_ini, v_ini_comp),
        'fim_possivel',    case when v_meses_prazo > 0 then v_alloc_fim end,
        'fim_vigencia',    v_fim_vig,
        'meses_cobertos',  v_meses_prazo
      ),
      'remanejamento', jsonb_build_object(
        'necessario', v_rem_tipo <> 'nenhum',
        'tipo',       v_rem_tipo,
        'nota',       v_rem_nota
      ),
      'avisos', to_jsonb(v_avisos)
    ));
  end loop;

  -- ---------- ranqueamento ----------
  -- Balde primeiro (onde não cabe nunca supera onde cabe), depois
  -- risco de devolução, depois quem vence antes.
  with ordenado as (
    select e.obj,
           row_number() over (
             order by (e.obj->>'_bucket')::integer,
                      (e.obj->>'prioridade')::numeric desc nulls last,
                      (e.obj->>'_meses_rest')::integer asc nulls last,
                      e.obj->>'project_name'
           ) as pos
      from jsonb_array_elements(v_itens) e(obj)
  )
  select coalesce(jsonb_agg(
           (o.obj - '_bucket' - '_meses_rest')
             || jsonb_build_object('posicao', o.pos)
           order by o.pos
         ), '[]'::jsonb)
    into v_projetos
    from ordenado o;

  -- Com 'cabe' e 'cabe_parcial' no mesmo balde, o topo da lista pode
  -- ser parcial. Dizer isso em voz alta evita que quem lê só a
  -- posição 1 conclua que a alocação inteira está resolvida.
  if (v_projetos->0->>'veredito') = 'cabe_parcial' then
    v_obs := format(
      'O primeiro colocado (%s) é o de maior risco de devolução, mas comporta %s de %s %s: o restante precisa de outra fonte — veja as posições seguintes para dividir a alocação.',
      v_projetos->0->>'project_name',
      v_projetos->0->>'meses_cabiveis',
      v_meses,
      case when v_tipo = 'bolsa' then 'meses' else 'unidade(s)' end);
  end if;

  select jsonb_build_object(
           'cabe',         count(*) filter (where e.obj->>'veredito' = 'cabe'),
           'cabe_parcial', count(*) filter (where e.obj->>'veredito' = 'cabe_parcial'),
           'nao_cabe',     count(*) filter (where e.obj->>'veredito' = 'nao_cabe'),
           'sem_plano',    count(*) filter (where e.obj->>'veredito' = 'sem_plano'),
           'melhor',       (v_projetos->0->>'project_name'),
           'melhor_veredito', (v_projetos->0->>'veredito'),
           'observacao',   v_obs
         )
    into v_resumo
    from jsonb_array_elements(v_itens) e(obj);

  return jsonb_build_object(
    'parametros', jsonb_build_object(
      'tipo',         v_tipo,
      'valor',        p_valor,
      'valor_total',  case when v_tipo = 'bolsa' then p_valor * v_meses else p_valor end,
      'rubrica',      v_rubrica,
      'grupo_alvo',   coalesce(v_grupo_param, case when v_tipo = 'bolsa' then 'a' end),
      'inicio',       v_alloc_ini,
      'meses',        v_meses
    ),
    'gerado_em',           current_date,
    'projetos_avaliados',  v_n,
    'resumo',              v_resumo,
    'projetos',            v_projetos,
    'nota',
      'Ranqueado por risco de devolução (saldo livre remanejável ÷ meses restantes de vigência): recurso prestes a voltar ao financiador vale mais ser gasto que recurso com anos pela frente. Três restrições independentes formam o veredito — orçamento (previsto − realizado − compromissos, ver mig. 038), caixa (saldo em conta projetado mês a mês) e prazo (vigência). ATENÇÃO ÀS DIREÇÕES DE ERRO OPOSTAS: o orçamento é conservador (compromissos de bolsa descontados até o fim da vigência), enquanto o caixa é otimista — a única saída que o banco sabe PREVER é bolsa; diária, equipamento e contrato não têm previsão em tabela. Isso não é buraco permanente: o ponto de partida da projeção é o saldo real da conta no balancete, que já embute esses gastos até a data de referência, então a cegueira do caixa vale só de lá até hoje e está quantificada em caixa.janela_cega_meses (caixa.cobertura = ''atualizada'' quando é no máximo 1 mês, ''defasada'' acima disso, ''nenhuma'' sem balancete). Importar o balancete todo mês mantém a janela em um mês; o que a rotina mensal NÃO fecha é a previsão de gastos não-bolsa futuros — para esses ela dá detecção, não previsão: refaça a simulação quando o balancete novo chegar. Toda implementação de bolsa exige remanejamento, com ou sem saldo na letra de pessoal, porque é o ato que nomeia o bolsista: por isso remanejamento é reportado como atrito de processo, não como veredito. O único impedimento que remanejar não contorna é o plano não ter nenhuma rubrica do grupo "a" (Pessoal). Pool remanejável exclui cip_ufg, cip_ua e dao (fatia institucional) e grupos com saldo negativo.'
  );
end;
$$;

comment on function public.simular_alocacao is
  'Simula onde alocar uma bolsa (recorrente) ou uma compra (pontual) entre todos os centros de custo visíveis ao chamador. Cruza orçamento (get_saldo_livre), caixa projetado mês a mês e prazo de vigência; devolve lista ranqueada por risco de devolução, com veredito, justificativa e atrito de remanejamento por projeto. Ver cabeçalho da migração 039 para a semântica.';


-- ------------------------------------------------------------
-- Grants — a mig. 035 fez funções novas nascerem sem EXECUTE para
-- public/anon (alter default privileges). Devolve só a authenticated.
-- ------------------------------------------------------------

revoke execute on function public.simular_alocacao(text, numeric, text, date, integer, uuid[]) from public;
revoke execute on function public.simular_alocacao(text, numeric, text, date, integer, uuid[]) from anon;
grant  execute on function public.simular_alocacao(text, numeric, text, date, integer, uuid[]) to   authenticated;


-- ------------------------------------------------------------
-- Asserção (reexecutável como reauditoria)
-- ------------------------------------------------------------

do $$
declare
  bad text;
  fn  text := 'public.simular_alocacao(text,numeric,text,date,integer,uuid[])';
begin
  if has_function_privilege('anon', fn, 'execute') then
    bad := coalesce(bad || E'\n', '') || '  simular_alocacao executável por anon';
  end if;

  if not has_function_privilege('authenticated', fn, 'execute') then
    bad := coalesce(bad || E'\n', '') || '  simular_alocacao NÃO executável por authenticated';
  end if;

  -- search_path fixo (regra da mig. 036)
  if not exists (
    select 1 from pg_proc p
     where p.oid = fn::regprocedure
       and p.proconfig is not null
       and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
  ) then
    bad := coalesce(bad || E'\n', '') || '  simular_alocacao sem search_path fixo';
  end if;

  -- invoker de propósito: tudo que lê direto já é escopado por RLS, e o
  -- dado admin-only chega pela get_saldo_livre (definer + guard).
  if exists (
    select 1 from pg_proc p
     where p.oid = fn::regprocedure
       and p.prosecdef
  ) then
    bad := coalesce(bad || E'\n', '') || '  simular_alocacao é security definer (deveria ser invoker)';
  end if;

  -- dependência declarada: a 039 não faz sentido sem a 038
  if to_regprocedure('public.get_saldo_livre(uuid)') is null then
    bad := coalesce(bad || E'\n', '') || '  get_saldo_livre ausente — aplique a migração 038 antes da 039';
  end if;

  if bad is not null then
    raise exception 'Asserção da 039 falhou:%', E'\n' || bad;
  end if;
end $$;

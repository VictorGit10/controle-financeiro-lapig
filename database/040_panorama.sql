-- ============================================================
-- 040_panorama.sql
-- ============================================================
-- RPC `get_panorama(p_project_ids, p_incluir_inativos)` — terceira
-- peça da camada de DECISÃO, depois de `get_saldo_livre` (038) e
-- `simular_alocacao` (039).
--
-- POR QUE EXISTE
-- A 038 responde "quanto está livre NESTE centro de custo?" e a 039
-- "onde é melhor colocar ESTE gasto?". Nenhuma das duas responde a
-- pergunta que vem antes de ambas e que é a primeira de quem coordena
-- vários centros: "como estão os projetos?".
--
-- Hoje essa resposta exige N chamadas e uma consolidação na cabeça de
-- quem pergunta. Pior: exige saber de antemão o que perguntar. Quem
-- não sabe que um balancete está seis meses atrasado não pensa em ir
-- conferir justamente o centro de custo cujo número menos merece
-- confiança.
--
-- DECISÕES DE SEMÂNTICA
--
-- 1. PANORAMA DESCREVE, NÃO RANQUEIA. A ordem é alfabética e não
--    carrega significado. Ranquear é trabalho da 039, que ordena por
--    risco de devolução a partir de uma hipótese de gasto concreta
--    (tipo, valor, prazo, rubrica). Um segundo ranking aqui, com
--    critério necessariamente diferente por não haver hipótese,
--    produziria duas listas "de prioridade" que discordam — e quem
--    lesse as duas não teria como saber qual vale. A `nota` diz isso
--    explicitamente para quem consome (tela ou IA) não inventar uma
--    ordem de urgência a partir do que aqui é só descrição.
--
-- 2. NÃO RECALCULA NADA. Todo número vem de `get_saldo_livre` (038),
--    de `get_project_alerts` (032) ou da view `v_project_summary`. O
--    único cálculo local é a soma dos `saldo_livre` dos grupos que a
--    038 já devolveu, e a contagem dos itens do resumo. A regra é a
--    mesma que rege o MCP: se um número está errado, o conserto é na
--    função de origem, não aqui — caso contrário passam a existir
--    duas contas para a mesma pergunta.
--
-- 3. A QUALIDADE DO DADO É PARTE DA RESPOSTA, não uma nota de rodapé.
--    Cada centro traz `situacao_dado` ('completo' | 'sem_balancete' |
--    'sem_plano') e `caixa.cobertura`, e o resumo conta quantos estão
--    em cada estado. Um saldo alto sem balancete não é dinheiro
--    sobrando: é o previsto integral do plano com realizado zero por
--    AUSÊNCIA DE DADO — a mesma armadilha que a 039 documenta em
--    `risco_devolucao.base`, e que ali distorcia o topo do ranking.
--    Aqui ela distorceria a leitura de "quem está bem". Balancete
--    AUSENTE superestima o saldo livre; balancete DEFASADO o
--    subestima (bolsas já pagas seguem contadas como compromisso, ver
--    038). As direções são opostas e não se cancelam.
--
-- 4. `sem_plano` devolve `saldo_livre` NULL, não zero. Confundir os
--    dois faria "sem dado" parecer "sem dinheiro" em qualquer soma.
--
-- 5. O LIMIAR DE `cobertura` É O MESMO DA 039: até 2 meses de
--    defasagem é 'atualizada' (regime normal dado o atraso de emissão
--    da FUNAPE), acima disso 'defasada', sem balancete 'nenhuma'.
--    Repetir o limiar em vez de inventar outro é o que permite ler o
--    panorama e a simulação lado a lado sem traduzir.
--
-- 6. `vigencia_encerrando` usa 6 meses. É convenção, não regra do
--    financiador: seis meses é o horizonte em que ainda dá para
--    implementar uma bolsa e executá-la por um tempo útil. O campo
--    `meses_restantes` vai junto, cru, para quem quiser outro corte.
--
-- 7. O panorama É a leitura de saúde do Fechamento Mensal. A rotina
--    mensal é o que mantém pequena a janela cega do caixa (ver 039), e
--    até aqui não havia como ver, numa consulta, quais centros estavam
--    com balancete atrasado. `resumo.balancete_defasado` e
--    `resumo.sem_balancete` são esse indicador.
--
-- SEGURANÇA
-- `security invoker`, pelo mesmo critério da 039: tudo que a função lê
-- direto (`projects`, a view `v_project_summary`, os alertas) já é
-- escopado por RLS desde a 033, e o único dado admin-only
-- (`plano_rubricas`, `balancete_lancamentos`) chega pela
-- `get_saldo_livre`, que é definer E guardada por
-- `assert_project_allowed`. O filtro explícito por `is_admin() or
-- allowed_project_ids()` é redundante sob RLS e fica de propósito:
-- declara a intenção e garante que `get_saldo_livre` nunca receba um
-- projeto que levantaria exceção no guard.
--
-- DEPENDÊNCIA DE ESCOPO (a asserção do fim confere)
-- O escopo do panorama depende de `get_project_alerts` e
-- `get_alerts_for_projects` continuarem `security invoker` — atributo
-- que a migração 019 lhes deu. Invoker chamada de DENTRO de uma
-- definer executa como o dono da definer, então se qualquer uma delas
-- regredisse para definer, o panorama passaria a mostrar alerta de
-- centro de custo alheio (a mensagem do alerta 1 traz o nome completo
-- do bolsista). Não é hipótese remota: é exatamente o que a 021 fez
-- com `sync_project_balance` ao recriá-la com `create or replace`,
-- desfazendo em silêncio a correção da 019 — a regressão que a 036
-- documenta. Por isso a asserção verifica as duas, e não só as
-- funções que esta migração cria.
--
-- Retorna nome de bolsista dentro das mensagens de alerta (é o
-- conteúdo do alerta: "a bolsa de Fulano passa da vigência"). Não
-- retorna CPF nem e-mail.
-- ============================================================


-- ============================================================
-- (0) REPARO — get_project_alerts quebrada desde a 032
-- ============================================================
-- Descoberto ao rodar o `get_panorama` pela primeira vez contra a
-- réplica do banco real: a função explode com
--
--   ERROR: relation "public.expenses" does not exist
--
-- O corpo vivo no banco é o da migração 003, que tem um quarto alerta
-- ('expense_no_description') lendo `public.expenses`. A migração 032
-- dropou essa tabela E recriou esta função sem o alerta 4 — a seção
-- 4.5, cujo comentário diz exatamente "sem recriar a função, ela — e
-- get_alerts_for_projects (013), que a chama — quebraria em runtime
-- após o drop da tabela". O drop aconteceu; a recriação, não.
--
-- Evidência de que é o corpo da 003 e não outra coisa: `monitoramento`
-- existe e `expenses` não (logo a 032 rodou), o corpo menciona
-- `expense_no_description`, e os atributos são `security invoker` +
-- `search_path` — que a 003 não tinha (ela era definer) e a 019
-- aplicou por ALTER. Ou seja: 003 + 019, sem a 032.
--
-- Plpgsql não valida referência a tabela em tempo de criação, só de
-- execução — por isso a função foi recriada sem erro em 2023 e só
-- falha quando alguém pede alerta. Consequência em produção: os
-- alertas da página Projetos (projetos.js:138) e o sino do Dashboard
-- (dashboard.js:213, via get_alerts_for_projects) estão quebrados
-- desde que a 032 foi aplicada.
--
-- Isto NÃO é feature nova: é reaplicar textualmente o que a 032 já
-- pretendia. Vai aqui, e não numa migração própria, porque o
-- `get_panorama` abaixo chama esta função e não roda sem ela.
--
-- Para conferir em qualquer banco antes de aplicar:
--   select prosrc ~ 'expense_no_description' as quebrada
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'get_project_alerts';
-- ============================================================

create or replace function public.get_project_alerts(p_project_id uuid)
returns table (
  alert_type  text,
  severity    text,
  message     text,
  details     text
) as $$
declare
  v_project record;
begin
  select * into v_project from public.projects where id = p_project_id;

  if not found then
    return;
  end if;

  -- Alerta 1: Bolsa excedendo vigência do projeto
  return query
  select
    'scholarship_exceeds_project'::text,
    'warning'::text,
    format('Bolsa de %s vai até %s, mas o projeto termina em %s',
      sh.full_name, to_char(s.end_date, 'DD/MM/YYYY'), to_char(v_project.end_date, 'DD/MM/YYYY')),
    s.id::text
  from public.scholarships s
  join public.scholarship_holders sh on sh.id = s.holder_id
  where s.project_id = p_project_id
    and s.status = 'active'
    and v_project.end_date is not null
    and s.end_date > v_project.end_date;

  -- Alerta 2: Saldo negativo em algum mês
  return query
  select
    'negative_balance'::text,
    'danger'::text,
    format('Saldo fica negativo em %s: R$ %s', cm.month_label, to_char(cm.net_balance, 'FM999G999G999D00')),
    cm.month_start::text
  from public.calc_project_monthly(p_project_id) cm
  where cm.net_balance < 0
  limit 3;

  -- Alerta 3: Projeto sem vigência definida
  if v_project.end_date is null then
    return query
    select
      'no_end_date'::text,
      'info'::text,
      'Projeto sem data de vigência definida'::text,
      v_project.id::text;
  end if;
end;
$$ language plpgsql stable security invoker set search_path = public, pg_temp;

comment on function public.get_project_alerts is
  'Retorna alertas de inconsistência para um projeto (bolsa excedendo vigência, saldo negativo, sem vigência). O alerta de gasto sem descrição caiu junto com a tabela expenses (032); a 040 reaplicou esta versão porque a recriação da 032 não chegou ao banco.';


-- ============================================================
-- (1) get_panorama
-- ============================================================

create or replace function public.get_panorama(
  p_project_ids      uuid[]  default null,   -- restringe a estes centros de custo
  p_incluir_inativos boolean default false   -- por padrão, só os ativos
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  r_proj          record;
  v_sl            jsonb;

  -- por centro de custo
  v_saldo_livre   numeric;
  v_grupos        jsonb;
  v_defasagem     integer;
  v_data_ref      date;
  v_caixa         numeric;
  v_meses_rest    integer;
  v_has_plano     boolean;
  v_has_balancete boolean;
  v_cobertura     text;
  v_situacao      text;
  v_n_bolsas      integer;
  v_custo_mensal  numeric;
  v_total_funding numeric;
  v_alertas       jsonb;
  v_n_alertas     integer;
  v_n_graves      integer;

  -- acumuladores
  v_itens         jsonb   := '[]'::jsonb;
  v_resumo        jsonb;
  v_obs           text[]  := '{}';
  v_n             integer := 0;
begin
  for r_proj in
    select p.id, p.name, p.code, p.start_date, p.end_date, p.active
      from public.projects p
     where (p_incluir_inativos or p.active)
       and (public.is_admin() or p.id = any(public.allowed_project_ids()))
       and (p_project_ids is null or p.id = any(p_project_ids))
     order by p.name
  loop
    v_n := v_n + 1;

    v_sl := public.get_saldo_livre(r_proj.id);

    v_has_plano     := coalesce((v_sl->>'has_plano')::boolean, false);
    v_has_balancete := coalesce((v_sl->>'has_balancete')::boolean, false);
    v_data_ref      := nullif(v_sl->>'data_referencia', '')::date;
    v_defasagem     := nullif(v_sl->>'balancete_defasagem_meses', '')::integer;
    v_caixa         := nullif(v_sl->>'saldo_disponivel_caixa', '')::numeric;
    v_meses_rest    := nullif(v_sl->>'meses_restantes', '')::integer;

    -- Sem plano ativo a 038 devolve o objeto curto: não há previsto por
    -- rubrica, logo não há saldo livre. O centro continua na lista (a
    -- ausência de plano é justamente o que precisa aparecer), com os
    -- campos financeiros nulos.
    if v_has_plano then
      v_grupos := coalesce(v_sl->'grupos', '[]'::jsonb);

      select coalesce(sum((g->>'saldo_livre')::numeric), 0)
        into v_saldo_livre
        from jsonb_array_elements(v_grupos) g;
    else
      v_grupos      := '[]'::jsonb;
      v_saldo_livre := null;
    end if;

    -- Mesmo limiar da 039 (caixa.cobertura), para os dois resultados
    -- poderem ser lidos lado a lado sem tradução.
    --
    -- 'desconhecida' é o caso que não existe na 039 e existe aqui: sem
    -- plano ativo, a 038 devolve o objeto CURTO, que traz `has_balancete`
    -- mas não `data_referencia` nem `balancete_defasagem_meses` — ela já
    -- consultou os dois, só não os inclui nesse caminho. Sem o primeiro
    -- ramo deste case, `coalesce(v_defasagem, 0) <= 2` leria o NULL como
    -- zero e declararia 'atualizada' um balancete cuja idade não
    -- conhecemos: transformar "não sei" em "está em dia" é exatamente o
    -- erro que o resto desta migração existe para evitar. O conserto de
    -- raiz é a 038 carregar o contexto no caminho curto; enquanto isso,
    -- este ramo diz a verdade.
    v_cobertura := case
      when not v_has_plano               then 'desconhecida'
      when not v_has_balancete           then 'nenhuma'
      when coalesce(v_defasagem, 0) <= 2 then 'atualizada'
      else 'defasada'
    end;

    v_situacao := case
      when not v_has_plano     then 'sem_plano'
      when not v_has_balancete then 'sem_balancete'
      else 'completo'
    end;

    -- Bolsas e desembolsos: da view, não recontados aqui, para não
    -- criar uma segunda definição de "bolsa ativa hoje".
    select vs.active_scholarships,
           vs.current_monthly_scholarships,
           vs.total_funding
      into v_n_bolsas, v_custo_mensal, v_total_funding
      from public.v_project_summary vs
     where vs.id = r_proj.id;

    -- Alertas. get_project_alerts é invoker (mig. 019) e get_panorama
    -- também, então o RLS continua valendo aqui dentro — ver a nota
    -- sobre DEPENDÊNCIA DE ESCOPO no cabeçalho.
    select count(*)::integer,
           count(*) filter (where a.severity = 'danger')::integer,
           coalesce(jsonb_agg(
             jsonb_build_object(
               'tipo',       a.alert_type,
               'severidade', a.severity,
               'mensagem',   a.message
             )
           ), '[]'::jsonb)
      into v_n_alertas, v_n_graves, v_alertas
      from public.get_project_alerts(r_proj.id) a;

    v_itens := v_itens || jsonb_build_array(jsonb_build_object(
      'project_id',      r_proj.id,
      'project_name',    r_proj.name,
      'project_code',    r_proj.code,
      'ativo',           r_proj.active,
      'end_date',        r_proj.end_date,
      'meses_restantes', v_meses_rest,
      'vigencia_encerrando',
        case when v_meses_rest is null then null else v_meses_rest <= 6 end,

      'situacao_dado',   v_situacao,
      'saldo_livre',     v_saldo_livre,
      'grupos',          v_grupos,

      'caixa', jsonb_build_object(
        'saldo_disponivel', v_caixa,
        'data_referencia',  v_data_ref,
        'defasagem_meses',  v_defasagem,
        'cobertura',        v_cobertura
      ),

      'bolsas', jsonb_build_object(
        'ativas',       coalesce(v_n_bolsas, 0),
        'custo_mensal', coalesce(v_custo_mensal, 0),
        'compromissos_ate_fim_vigencia',
          nullif(v_sl->>'compromissos_bolsas', '')::numeric
      ),

      'total_desembolsado', coalesce(v_total_funding, 0),

      'alertas', jsonb_build_object(
        'total',  coalesce(v_n_alertas, 0),
        'graves', coalesce(v_n_graves, 0),
        'itens',  coalesce(v_alertas, '[]'::jsonb)
      ),

      'avisos', coalesce(v_sl->'avisos', '[]'::jsonb)
    ));
  end loop;

  -- ---------- resumo ----------
  select jsonb_build_object(
           'centros',             count(*),
           'com_plano',           count(*) filter (where e.obj->>'situacao_dado' <> 'sem_plano'),
           'sem_plano',           count(*) filter (where e.obj->>'situacao_dado' = 'sem_plano'),
           'sem_balancete',       count(*) filter (where e.obj->'caixa'->>'cobertura' = 'nenhuma'),
           'balancete_defasado',  count(*) filter (where e.obj->'caixa'->>'cobertura' = 'defasada'),
           'balancete_em_dia',    count(*) filter (where e.obj->'caixa'->>'cobertura' = 'atualizada'),
           -- Não somam com os três acima: são os sem plano, cuja idade de
           -- balancete a 038 não devolve no caminho curto.
           'balancete_desconhecido',
                                  count(*) filter (where e.obj->'caixa'->>'cobertura' = 'desconhecida'),
           'vigencia_encerrando', count(*) filter (where (e.obj->>'vigencia_encerrando')::boolean),
           'com_alertas',         count(*) filter (where (e.obj->'alertas'->>'total')::integer > 0),
           'alertas_graves',      coalesce(sum((e.obj->'alertas'->>'graves')::integer), 0),
           'saldo_livre_total',   coalesce(sum((e.obj->>'saldo_livre')::numeric), 0),
           'custo_mensal_total',  coalesce(sum((e.obj->'bolsas'->>'custo_mensal')::numeric), 0),
           'bolsas_ativas_total', coalesce(sum((e.obj->'bolsas'->>'ativas')::integer), 0)
         )
    into v_resumo
    from jsonb_array_elements(v_itens) e(obj);

  -- Observações de QUALIDADE DO DADO, não de dinheiro. Existem porque
  -- um saldo alto num centro sem balancete é o previsto do plano com
  -- realizado zero por ausência de dado — e quem lê o total precisa
  -- saber disso antes de somar mentalmente.
  -- NB: array_append, não `||`. Com literal sem tipo à direita o
  -- Postgres resolve `anyarray || anyarray` e falha ("malformed array
  -- literal") — mesma armadilha registrada na 038.
  if coalesce((v_resumo->>'sem_balancete')::integer, 0) > 0 then
    v_obs := array_append(v_obs, format(
      '%s dos %s centros de custo não têm balancete importado: para eles o realizado é zero por AUSÊNCIA DE DADO, não por execução, e o saldo livre mostrado é o previsto integral do plano. O total consolidado está superestimado nessa medida.',
      v_resumo->>'sem_balancete', v_resumo->>'centros'));
  end if;

  if coalesce((v_resumo->>'balancete_defasado')::integer, 0) > 0 then
    v_obs := array_append(v_obs, format(
      '%s centro(s) com balancete defasado (mais de 2 meses): o saldo livre deles está SUBESTIMADO, porque bolsas provavelmente já pagas seguem contadas como compromisso. Rodar o Fechamento Mensal desses centros corrige.',
      v_resumo->>'balancete_defasado'));
  end if;

  if coalesce((v_resumo->>'sem_plano')::integer, 0) > 0 then
    v_obs := array_append(v_obs, format(
      '%s centro(s) sem plano de trabalho ativo: sem previsto por rubrica não há saldo livre a calcular, e eles ficam de fora de qualquer simulação de alocação.',
      v_resumo->>'sem_plano'));
  end if;

  return jsonb_build_object(
    'gerado_em', current_date,
    'filtro', jsonb_build_object(
      'project_ids',      p_project_ids,
      'incluir_inativos', p_incluir_inativos
    ),
    'resumo',  v_resumo || jsonb_build_object(
                 'observacao', nullif(array_to_string(v_obs, ' '), '')),
    'centros', v_itens,
    'nota',
      'PANORAMA DESCREVE, NÃO RANQUEIA. A ordem é ALFABÉTICA e não significa prioridade, urgência ou mérito — não a apresente como se significasse. Para ordenar por urgência de gasto use simular_alocacao, que ranqueia por risco de devolução a partir de uma hipótese concreta (tipo, valor, prazo, rubrica); um ranking daqui usaria outro critério e as duas listas discordariam. Antes de comparar centros de custo entre si, leia situacao_dado: "sem_balancete" significa realizado = 0 por AUSÊNCIA DE DADO, então o saldo_livre é o previsto integral do plano e não é comparável com o de um centro que tem balancete; "sem_plano" não tem saldo_livre nenhum (null, não zero). caixa.cobertura resume a confiabilidade do saldo em conta: "atualizada" (defasagem de até 2 meses, regime normal dado o atraso de emissão da FUNAPE), "defasada" acima disso, "nenhuma" sem balancete, "desconhecida" quando o centro não tem plano ativo e portanto a idade do balancete não foi apurada — NÃO leia "desconhecida" como "em dia". O limiar é o mesmo da simular_alocacao. Balancete defasado torna o saldo livre SUBESTIMADO (bolsas já pagas ainda contam como compromisso, ver mig. 038); balancete ausente o torna SUPERESTIMADO. As duas direções de erro são opostas e não se cancelam. saldo_livre soma os grupos de rubrica e não considera remanejamento entre letras, que exige aprovação do financiador. Repasse resumo.observacao quando existir: ela diz o que o total consolidado está escondendo.'
  );
end;
$$;

comment on function public.get_panorama is
  'Visão consolidada de todos os centros de custo visíveis ao chamador: saldo livre por grupo, caixa e defasagem do balancete, bolsas ativas e custo mensal, vigência restante e alertas. Descreve — não ranqueia (isso é a simular_alocacao). Também é a leitura de saúde do Fechamento Mensal: resumo.sem_balancete e resumo.balancete_defasado dizem quais centros estão com o dado atrasado. Ver cabeçalho da migração 040.';


-- ------------------------------------------------------------
-- Grants — a mig. 035 fez funções novas nascerem sem EXECUTE para
-- public/anon (alter default privileges). Devolve só a authenticated.
-- ------------------------------------------------------------

revoke execute on function public.get_panorama(uuid[], boolean) from public;
revoke execute on function public.get_panorama(uuid[], boolean) from anon;
grant  execute on function public.get_panorama(uuid[], boolean) to   authenticated;


-- ------------------------------------------------------------
-- Asserção (reexecutável como reauditoria)
-- ------------------------------------------------------------

do $$
declare
  bad text;
  fn  text := 'public.get_panorama(uuid[],boolean)';
begin
  -- ---------- get_panorama ----------
  if has_function_privilege('anon', fn, 'execute') then
    bad := coalesce(bad || E'\n', '') || '  get_panorama executável por anon';
  end if;

  if not has_function_privilege('authenticated', fn, 'execute') then
    bad := coalesce(bad || E'\n', '') || '  get_panorama NÃO executável por authenticated';
  end if;

  if exists (select 1 from pg_proc p where p.oid = fn::regprocedure and p.prosecdef) then
    bad := coalesce(bad || E'\n', '') || '  get_panorama é security definer (deveria ser invoker)';
  end if;

  -- ---------- dependências de escopo (invoker desde a 019) ----------
  -- Se qualquer uma regredir para definer, o panorama passa a mostrar
  -- alerta de centro de custo alheio — com nome de bolsista dentro.
  if exists (
    select 1 from pg_proc p
     where p.oid in (
             'public.get_project_alerts(uuid)'::regprocedure,
             'public.get_alerts_for_projects(uuid[])'::regprocedure
           )
       and p.prosecdef
  ) then
    bad := coalesce(bad || E'\n', '')
        || '  get_project_alerts / get_alerts_for_projects voltou a ser definer (regressão da 019)';
  end if;

  -- ---------- search_path fixo (regra da mig. 036) ----------
  if not exists (
    select 1 from pg_proc p
     where p.oid = fn::regprocedure
       and p.proconfig is not null
       and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
  ) then
    bad := coalesce(bad || E'\n', '') || '  get_panorama sem search_path fixo';
  end if;

  -- ---------- o reparo da seção (0) pegou? ----------
  if exists (
    select 1 from pg_proc p
     where p.oid = 'public.get_project_alerts(uuid)'::regprocedure
       and p.prosrc ~ 'expense_no_description'
  ) then
    bad := coalesce(bad || E'\n', '')
        || '  get_project_alerts ainda referencia a tabela expenses (dropada pela 032)';
  end if;

  if bad is not null then
    raise exception 'Asserção da 040 falhou:%', E'\n' || bad;
  end if;
end $$;

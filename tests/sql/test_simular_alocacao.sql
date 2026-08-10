-- ============================================================
-- TESTE / CONFERÊNCIA — simular_alocacao (migração 039)
-- ============================================================
-- Rode no SQL Editor do Supabase, DEPOIS de aplicar a 038 e a 039.
--
-- A 038 já foi conferida contra o papel: o saldo livre por grupo bate.
-- Esta fase confere o que a 039 ACRESCENTA, que é onde ela pode errar:
--
--   · o CAIXA projetado mês a mês (entradas do cronograma, saídas de
--     bolsa) — a restrição que o coordenador definiu como a que
--     realmente morde numa bolsa;
--   · o PRAZO, que transforma "cabe" em "cabe 5 dos 24 meses";
--   · o RANQUEAMENTO por risco de devolução, que é regra
--     institucional e não tem como ser verificada pelo código.
--
-- A pergunta a responder aqui NÃO é "a função roda?" — a 039 já foi
-- executada contra um cenário sintético antes de ser commitada. É:
-- **o ranking coloca em primeiro o centro de custo onde você e o
-- Laerte de fato colocariam a bolsa?** Se não coloca, é a semântica
-- que está errada, e é agora que isso precisa aparecer — antes de
-- virar MCP ou aba no site.
--
-- ------------------------------------------------------------
-- COMO USAR (importante — leia antes)
-- ------------------------------------------------------------
-- O SQL Editor do Supabase NÃO preserva `set_config` entre execuções:
-- cada "Run" pode cair numa conexão diferente do pool e a impersonação
-- evapora. Por isso cada bloco é AUTOSSUFICIENTE — abre transação,
-- impersona e chama a RPC num Run só. Rode `begin; … commit;` inteiro.
--
-- Antes de começar, cole no SQL Editor do Supabase e faça lá a
-- substituição:
--   SEU-USER-ID -> o uuid do passo 0.a de tests/sql/test_saldo_livre.sql
--
-- ATENÇÃO: substitua no editor do Supabase, NÃO neste arquivo. O repo
-- é público; uuid de usuário e de centro de custo não entram em
-- arquivo versionado. Se editar aqui por engano, desfaça antes de
-- commitar (`git diff` mostra).
--
-- Diferente da 038, esta RPC NÃO recebe project_id: ela varre todos os
-- centros de custo que o chamador enxerga. Logo a impersonação não é
-- detalhe de teste — ela É o escopo do resultado. Rodar como admin dá
-- o ranking global; rodar como professor dá o ranking dele.
-- ============================================================


-- ============================================================
-- PARTE 1 — o cenário real
-- ============================================================

-- 1.a — a pergunta que motivou a camada inteira:
--       onde colocar uma bolsa de R$ 2.000/mês por 24 meses?
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','SEU-USER-ID','role','authenticated')::text, true);

select jsonb_pretty(public.simular_alocacao('bolsa', 2000, null, current_date, 24));
commit;


-- 1.b — o mesmo, em tabela legível (é esta que você lê primeiro)
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','SEU-USER-ID','role','authenticated')::text, true);

with r as (select public.simular_alocacao('bolsa', 2000, null, current_date, 24) as j)
select (p->>'posicao')::int                      as pos,
       p->>'project_name'                        as centro_de_custo,
       p->>'veredito'                            as veredito,
       (p->>'meses_cabiveis')::int               as meses_ok,
       (p->>'meses_solicitados')::int            as meses_pedidos,
       (p->>'prioridade')::numeric               as burn_mensal,
       (p->'risco_devolucao'->>'meses_restantes')::int as meses_vigencia,
       (p->'risco_devolucao'->>'saldo_em_risco')::numeric as saldo_em_risco,
       p->>'motivo_codigo'                       as restricao_que_limita,
       p->'remanejamento'->>'tipo'               as remanejamento,
       p->'caixa'->>'cobertura'                  as caixa_cobertura,
       (p->'caixa'->>'janela_cega_meses')::int   as janela_cega,
       p->'caixa'->>'aperta_em'                  as caixa_aperta,
       p->'caixa'->>'normaliza_em'               as caixa_normaliza
  from r, jsonb_array_elements(r.j->'projetos') p
 order by pos;
commit;
-- CONFIRA, nesta ordem:
--   1. A posição 1 é onde você colocaria a bolsa? Se não, POR QUÊ não?
--      A resposta é a regra que falta no modelo.
--   2. `burn_mensal` = saldo_em_risco / meses_vigencia. É o critério de
--      ranking: quanto o projeto precisa gastar por mês para não
--      devolver recurso. Faz sentido para os centros de custo do topo?
--   3. `veredito = cabe_parcial` na posição 1 é ESPERADO e não é
--      defeito: um projeto que vence em 4 meses lidera por risco de
--      devolução mesmo cobrindo só 4 dos 24. Ver `resumo.observacao`.
--   4. `restricao_que_limita` diz o que resolver: 'prazo' (não se
--      negocia), 'caixa' (é calendário — veja `caixa_normaliza`, adiar
--      o início pode bastar) ou 'orcamento' (remanejamento alcança).
--   5. **`janela_cega` é o termômetro da rotina mensal.** Ela mede
--      quantos meses de gasto NÃO-bolsa (diária, equipamento,
--      contrato) ainda não foram vistos, porque o balancete não
--      chegou. Com o Fechamento Mensal em dia isso fica em 1–2. Se
--      aparecer 4, 5, 6 aqui, o problema não é a RPC: é balancete
--      atrasado, e o caixa projetado está mais otimista que a
--      realidade na exata medida desse número.


-- 1.c — as justificativas, uma por centro de custo
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','SEU-USER-ID','role','authenticated')::text, true);

with r as (select public.simular_alocacao('bolsa', 2000, null, current_date, 24) as j)
select (p->>'posicao')::int   as pos,
       p->>'project_name'     as centro_de_custo,
       m                      as motivo
  from r,
       jsonb_array_elements(r.j->'projetos') p,
       jsonb_array_elements_text(p->'motivos') m
 order by pos;
commit;
-- Cada motivo deve poder ser conferido no papel. Se um deles afirma
-- algo que você sabe ser falso, o bug está na restrição correspondente
-- (prazo, orçamento ou caixa), não no ranking.


-- 1.d — os avisos (qualidade do número, herdados da 038 + os da 039)
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','SEU-USER-ID','role','authenticated')::text, true);

with r as (select public.simular_alocacao('bolsa', 2000, null, current_date, 24) as j)
select p->>'project_name' as centro_de_custo,
       a                  as aviso
  from r,
       jsonb_array_elements(r.j->'projetos') p,
       jsonb_array_elements_text(p->'avisos') a
 order by 1;
commit;


-- ============================================================
-- PARTE 2 — conferir o CAIXA na mão
-- ============================================================
-- É a parte nova e a mais fácil de errar. Escolha um centro de custo
-- do resultado acima (de preferência um com `caixa_aperta` preenchido)
-- e cole o uuid dele no lugar de O-PROJECT-ID.
--
-- Rode como postgres (sem impersonação): são leituras diretas, e no
-- SQL Editor você é superusuário.

-- 2.a — de onde sai o saldo inicial da projeção
select b.data_referencia,
       b.saldo_disponivel  as caixa_inicial,
       (date_trunc('month', b.data_referencia) + interval '1 month')::date
         as projecao_comeca_em
  from public.balancetes b
 where b.project_id = 'O-PROJECT-ID'::uuid
 order by b.data_referencia desc
 limit 1;
-- O `saldo_disponivel` deve bater com o extrato/balancete em papel.
-- A projeção começa no mês SEGUINTE de propósito: o que veio antes já
-- está dentro desse saldo (mesma regra de dupla contagem da 038).


-- 2.b — a projeção mês a mês, refeita em SQL cru
-- Confira contra `caixa.aperta_em` e `caixa.menor_saldo_projetado`.
-- NB: a saída da bolsa NOVA não entra aqui — este bloco mostra o caixa
-- como ele está HOJE, sem a alocação simulada. Some R$ 2.000/mês
-- mentalmente a partir do mês de início para reproduzir a projeção da
-- RPC.
with ctx as (
  select b.data_referencia,
         b.saldo_disponivel,
         (select id from public.planos_trabalho
           where project_id = 'O-PROJECT-ID'::uuid and ativo limit 1) as plano_id,
         (select end_date from public.projects where id = 'O-PROJECT-ID'::uuid) as fim
    from public.balancetes b
   where b.project_id = 'O-PROJECT-ID'::uuid
   order by b.data_referencia desc
   limit 1
),
fluxo as (
  select m.month_start,
         coalesce((select sum(pd.valor) from public.plano_desembolsos pd, ctx
                    where pd.plano_id = ctx.plano_id
                      and pd.valor is not null
                      and pd.data_prevista between m.month_start and m.month_end
                      and pd.data_prevista > ctx.data_referencia), 0) as entrada,
         coalesce((select sum(s.amount) from public.scholarships s
                    where s.project_id = 'O-PROJECT-ID'::uuid
                      and s.status = 'active'
                      and s.start_date <= m.month_end
                      and s.end_date   >= m.month_start), 0) as saida_bolsas
    from ctx,
         public.generate_month_series(
           (date_trunc('month', ctx.data_referencia) + interval '1 month')::date,
           ctx.fim) m
)
select f.month_start                as mes,
       f.entrada,
       f.saida_bolsas,
       (select saldo_disponivel from ctx)
         + sum(f.entrada - f.saida_bolsas) over (order by f.month_start)
                                    as saldo_projetado
  from fluxo f
 order by f.month_start;


-- 2.c — parcelas do cronograma que NÃO entraram na projeção
-- (o plano diz "mediante cálculo de gastos" e não há valor
-- normalizado). O caixa projetado está subestimado por elas.
select pd.parcela, pd.data_prevista, pd.valor
  from public.plano_desembolsos pd
 where pd.plano_id = (select id from public.planos_trabalho
                       where project_id = 'O-PROJECT-ID'::uuid and ativo limit 1)
   and pd.valor is null
 order by pd.parcela;


-- ============================================================
-- PARTE 3 — os casos que precisam dar NÃO
-- ============================================================

-- 3.a — compra pontual (não tem recorrência, não tem p_meses)
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','SEU-USER-ID','role','authenticated')::text, true);

with r as (select public.simular_alocacao('compra', 8000, 'f', current_date) as j)
select (p->>'posicao')::int   as pos,
       p->>'project_name'     as centro_de_custo,
       p->>'veredito'         as veredito,
       p->'orcamento'->>'fonte_espaco'   as espaco_veio_de,
       p->'remanejamento'->>'tipo'       as remanejamento,
       (p->'motivos'->>0)                as motivo_principal
  from r, jsonb_array_elements(r.j->'projetos') p
 order by pos;
commit;
-- Em `compra`, `remanejamento = 'nenhum'` quando há saldo na letra
-- alvo — diferente de bolsa, que NUNCA é 'nenhum' (o remanejamento é o
-- ato que nomeia o bolsista).


-- 3.b — o portão duro: projeto sem letra de pessoal no plano
-- Nenhuma bolsa cabe ali, com ou sem negociação. Deve aparecer com
-- veredito 'nao_cabe' e remanejamento.tipo = 'impossivel'.
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','SEU-USER-ID','role','authenticated')::text, true);

with r as (select public.simular_alocacao('bolsa', 2000, null, current_date, 12) as j)
select p->>'project_name'          as centro_de_custo,
       p->>'motivo_codigo'         as codigo,
       p->'remanejamento'->>'tipo' as remanejamento
  from r, jsonb_array_elements(r.j->'projetos') p
 where p->>'motivo_codigo' = 'sem_rubrica_pessoal';
commit;
-- Para cada um que aparecer: confirme no plano em papel que realmente
-- não há letra "a". Um falso positivo aqui significa que o plano foi
-- importado sem a seção de pessoal — é erro de importação, não da RPC.


-- 3.c — valor absurdo: tem que dar 'nao_cabe' em toda a lista
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','SEU-USER-ID','role','authenticated')::text, true);

with r as (select public.simular_alocacao('bolsa', 500000, null, current_date, 24) as j)
select r.j->'resumo' as resumo from r;
commit;
-- Esperado: cabe = 0. Se algum centro de custo aceitar meio milhão por
-- mês, o previsto do plano dele foi importado com escala errada.


-- 3.d — parâmetros inválidos devem levantar exceção, não devolver lista
-- Rode um de cada vez; os três têm que falhar.
-- select public.simular_alocacao('doacao', 100);        -- p_tipo inválido
-- select public.simular_alocacao('bolsa', 0);           -- p_valor <= 0
-- select public.simular_alocacao('bolsa', 100, 'zzz');  -- rubrica inexistente


-- ============================================================
-- PARTE 4 — escopo por centro de custo (multi-tenancy)
-- ============================================================
-- A RPC é `security invoker`: o RLS decide o que ela enxerga. Rodando
-- como um professor, o ranking tem que conter SÓ os centros de custo
-- dele. Substitua por um user_id de professor (passo 0.a da 038).
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','ID-DE-UM-PROFESSOR','role','authenticated')::text, true);

with r as (select public.simular_alocacao('bolsa', 2000, null, current_date, 12) as j)
select (r.j->>'projetos_avaliados')::int as projetos_avaliados,
       (select array_agg(p->>'project_name')
          from jsonb_array_elements(r.j->'projetos') p) as centros_de_custo
  from r;
commit;
-- Compare com `select project_id from public.user_projects where
-- user_id = 'ID-DE-UM-PROFESSOR'`. Qualquer centro de custo a mais na
-- lista é vazamento de escopo e é bug de segurança, não de cálculo.

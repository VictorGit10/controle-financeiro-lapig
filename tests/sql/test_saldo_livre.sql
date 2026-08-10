-- ============================================================
-- TESTE / CONFERÊNCIA — get_saldo_livre (migração 038)
-- ============================================================
-- Rode no SQL Editor do Supabase, DEPOIS de aplicar a 038.
--
-- O objetivo desta fase NÃO é testar encanamento — é responder uma
-- pergunta: o número que a função dá bate com o que você e o Laerte
-- concluiriam na mão? Por isso o script tem duas partes:
--
--   PARTE 1 — chama a RPC
--   PARTE 2 — recalcula as três parcelas em SQL cru, separadas,
--             para você conferir cada uma contra a realidade
--
-- Se a PARTE 1 e a PARTE 2 divergirem, é bug na função.
-- Se as duas concordarem mas o número não bater com a realidade,
-- é a SEMÂNTICA que está errada — e é isso que precisa ser
-- descoberto agora, antes de construir MCP ou aba no site.
--
-- ------------------------------------------------------------
-- COMO USAR (importante — leia antes)
-- ------------------------------------------------------------
-- O SQL Editor do Supabase NÃO preserva `set_config` entre execuções:
-- cada "Run" pode cair numa conexão diferente do pool, e a
-- impersonação evapora. Por isso cada bloco da PARTE 1 é
-- AUTOSSUFICIENTE: abre transação, impersona e chama a RPC, tudo num
-- Run só. Rode cada bloco `begin; … commit;` inteiro, de uma vez.
--
-- Antes de começar, cole o conteúdo no SQL Editor do Supabase e faça
-- lá as duas substituições:
--   SEU-USER-ID    -> o uuid do passo 0.a
--   O-PROJECT-ID   -> o uuid do projeto escolhido no passo 0.c
--
-- ATENÇÃO: substitua no editor do Supabase, NÃO neste arquivo. O repo
-- é público; uuid de usuário e de centro de custo não entram em
-- arquivo versionado. Se editar aqui por engano, desfaça antes de
-- commitar (`git diff` mostra).
--
-- A PARTE 2 não precisa de impersonação: são leituras diretas nas
-- tabelas, e no SQL Editor você roda como `postgres` (superusuário
-- ignora RLS).
-- ============================================================


-- ============================================================
-- 0. PREPARO
-- ============================================================

-- 0.a — descubra seu user_id e confirme seu papel:
select u.id, u.email, coalesce(a.role, '(sem linha em app_users)') as papel
  from auth.users u
  left join public.app_users a on a.user_id = u.id
 order by u.email;

-- 0.b — confirme que a impersonação funciona (bloco inteiro, um Run):
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','SEU-USER-ID','role','authenticated')::text, true);

select auth.uid()                                            as uid,
       public.is_admin()                                     as sou_admin,
       coalesce(array_length(public.allowed_project_ids(),1),0) as n_projetos;
commit;
-- Esperado: uid preenchido.
--   • uid nulo            -> o bloco não rodou junto; rode begin..commit de uma vez
--   • sou_admin = false   -> você não é admin. Ou promova (0.d), ou escolha
--                            no passo 0.c um projeto que esteja em user_projects
--   • sou_admin = true    -> pode seguir, você enxerga todos os projetos

-- 0.c — escolha um projeto com plano ativo E balancete importado.
--       A coluna `no_meu_escopo` diz se você consegue chamar a RPC
--       para ele sem ser admin.
select p.id,
       p.name,
       p.end_date,
       (select count(*) from public.planos_trabalho pt
         where pt.project_id = p.id and pt.ativo)             as tem_plano_ativo,
       (select count(*) from public.balancetes b
         where b.project_id = p.id)                           as qtd_balancetes,
       (select count(*) from public.scholarships s
         where s.project_id = p.id and s.status = 'active')   as bolsas_ativas,
       exists (select 1 from public.user_projects up
                where up.project_id = p.id
                  and up.user_id = 'SEU-USER-ID'::uuid)       as no_meu_escopo
  from public.projects p
 where p.active = true
 order by tem_plano_ativo desc, qtd_balancetes desc, bolsas_ativas desc;

-- 0.d — SOMENTE se 0.b mostrou sou_admin = false e você deveria ser
--       admin (é o `update` manual que a mig. 033 deixou pendente).
--       Use o uuid do passo 0.a; e-mail não entra em arquivo versionado
--       (o repo é público — mesma razão pela qual a 033 não os hardcoda).
-- update public.app_users
--    set role = 'admin'
--  where user_id = 'SEU-USER-ID'::uuid;


-- ============================================================
-- PARTE 1 — a RPC (cada bloco = um Run)
-- ============================================================

-- 1.a — payload inteiro
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','SEU-USER-ID','role','authenticated')::text, true);

select jsonb_pretty(public.get_saldo_livre('O-PROJECT-ID'::uuid));
commit;


-- 1.b — a superfície de decisão, em tabela legível
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','SEU-USER-ID','role','authenticated')::text, true);

with r as (select public.get_saldo_livre('O-PROJECT-ID'::uuid) as j)
select g->>'grupo_name'              as grupo,
       (g->>'previsto')::numeric     as previsto,
       (g->>'realizado')::numeric    as realizado,
       (g->>'saldo')::numeric        as saldo_plano,
       (g->>'compromissos')::numeric as compromissos,
       (g->>'saldo_livre')::numeric  as saldo_livre,
       g->>'compromissos_cobertura'  as cobertura
  from r, jsonb_array_elements(r.j->'grupos') g;
commit;
-- LEITURA: onde cobertura = 'nenhuma', saldo_livre é só
-- previsto − realizado. NÃO foi verificado contra compromissos —
-- o sistema não rastreia contrato/diária/equipamento futuro.


-- 1.c — cabeçalho: vigência, defasagem do balancete, avisos
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','SEU-USER-ID','role','authenticated')::text, true);

with r as (select public.get_saldo_livre('O-PROJECT-ID'::uuid) as j)
select r.j->>'meses_restantes'             as meses_restantes,
       r.j->>'data_referencia'             as balancete_de,
       r.j->>'balancete_defasagem_meses'   as defasagem_meses,
       r.j->>'compromissos_inicio'         as compromissos_de,
       r.j->>'compromissos_fim'            as compromissos_ate,
       jsonb_pretty(r.j->'avisos')         as avisos
  from r;
commit;


-- 1.d — bolsas que formam o compromisso, pessoa a pessoa
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','SEU-USER-ID','role','authenticated')::text, true);

with r as (select public.get_saldo_livre('O-PROJECT-ID'::uuid) as j)
select b->>'bolsista'                as bolsista,
       (b->>'valor_mensal')::numeric as valor_mensal,
       b->>'end_date'                as bolsa_ate,
       (b->>'meses')::int            as meses,
       (b->>'compromisso')::numeric  as compromisso
  from r, jsonb_array_elements(r.j->'bolsas_ativas') b;
commit;


-- ============================================================
-- PARTE 2 — conferência manual (sem a função, sem impersonação)
-- ============================================================
-- Rode cada parcela e confira contra o que você sabe do projeto.

-- 2.a — PREVISTO por grupo (plano ativo)
select coalesce(r.parent_code, r.code) as grupo,
       sum(pr.valor_previsto)          as previsto
  from public.plano_rubricas pr
  join public.rubricas r on r.code = pr.rubrica_code
 where pr.plano_id = (
         select id from public.planos_trabalho
          where project_id = 'O-PROJECT-ID'::uuid and ativo
          limit 1)
 group by 1
 order by 1;
-- CONFERIR: os totais batem com o PROAD/plano em papel?

-- 2.b — REALIZADO por grupo (balancete mais recente)
select coalesce(r.parent_code, r.code) as grupo,
       sum(bl.saldo_atual)             as realizado
  from public.balancete_lancamentos bl
  join public.rubricas r on r.code = bl.rubrica_code
 where bl.balancete_id = (
         select id from public.balancetes
          where project_id = 'O-PROJECT-ID'::uuid
          order by data_referencia desc
          limit 1)
   and bl.rubrica_code is not null
 group by 1
 order by 1;
-- CONFERIR: bate com o PDF do balancete?

-- 2.c — COMPROMISSOS de bolsas, pessoa a pessoa
-- Mesma janela da função: do mês seguinte ao balancete até o fim
-- da vigência.
with proj as (
  select id, end_date from public.projects
   where id = 'O-PROJECT-ID'::uuid
),
janela as (
  select
    coalesce(
      (select (date_trunc('month', b.data_referencia) + interval '1 month')::date
         from public.balancetes b
        where b.project_id = (select id from proj)
        order by b.data_referencia desc limit 1),
      date_trunc('month', current_date)::date
    ) as inicio,
    (select end_date from proj) as fim
)
select h.full_name          as bolsista,
       s.amount             as valor_mensal,
       s.end_date           as bolsa_ate,
       count(*)             as meses,
       s.amount * count(*)  as compromisso
  from public.scholarships s
  join public.scholarship_holders h on h.id = s.holder_id
  join janela j on true
  join public.generate_month_series(j.inicio, j.fim) m
    on s.start_date <= m.month_end and s.end_date >= m.month_start
 where s.project_id = (select id from proj)
   and s.status = 'active'
 group by h.full_name, s.amount, s.end_date
 order by compromisso desc;
-- CONFERIR (as perguntas que importam):
--   • Falta alguém que você sabe que recebe bolsa neste projeto?
--   • Sobra alguém que já saiu mas ficou como 'active'?
--   • As datas de término estão certas? Uma end_date errada
--     distorce o compromisso proporcionalmente ao nº de meses.
--   • O total daqui bate com 1.d / `compromissos_bolsas`?


-- ============================================================
-- 3. CASOS DE BORDA (opcional — já validados em container)
-- ============================================================

-- 3.a — projeto sem plano ativo: has_plano=false com mensagem,
--       sem exceção
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','SEU-USER-ID','role','authenticated')::text, true);

select p.name,
       public.get_saldo_livre(p.id)->>'message' as msg
  from public.projects p
 where p.active = true
   and not exists (select 1 from public.planos_trabalho pt
                    where pt.project_id = p.id and pt.ativo)
 limit 1;
commit;

-- 3.b — escopo: impersone um PROFESSOR que não tenha este centro de
--       custo e rode 1.a de novo. Deve levantar
--       'Acesso negado ao projeto'. É o teste que o container não
--       pôde fazer (lá o guard era um stub).

-- ============================================================
-- TESTE / CONFERÊNCIA — migração 040
--   (0) reparo de get_project_alerts (quebrada desde a 032)
--   (1) get_panorama
-- ============================================================
-- Rode no SQL Editor do Supabase, DEPOIS de aplicar a 040 — exceto o
-- bloco 1.a, que vale mais rodado ANTES, porque é o que mostra a
-- função quebrada antes do conserto.
--
-- ------------------------------------------------------------
-- COMO USAR (leia antes)
-- ------------------------------------------------------------
-- O SQL Editor do Supabase NÃO preserva `set_config` entre execuções:
-- cada "Run" pode cair numa conexão diferente do pool e a
-- impersonação evapora. Por isso cada bloco é AUTOSSUFICIENTE —
-- abre transação, impersona e consulta num Run só. Rode cada
-- `begin; … commit;` inteiro, de uma vez.
--
-- Substituições a fazer NO EDITOR do Supabase, não neste arquivo:
--   SEU-USER-ID        -> uuid do passo 0.a
--   UM-PROFESSOR-ID    -> uuid de um usuário com papel 'professor'
--   O-PROJECT-ID       -> uuid de um centro de custo com plano ativo
--
-- ------------------------------------------------------------
-- ARMADILHA: `get_panorama()` sem impersonação devolve ZERO
-- ------------------------------------------------------------
-- No SQL Editor você roda como `postgres`, que não tem JWT. Então
-- `auth.uid()` é nulo, `is_admin()` é false e `allowed_project_ids()`
-- volta vazio — o filtro do laço exclui todos os centros e o resumo
-- sai com `centros: 0` e todos os contadores zerados. Isso NÃO é
-- "banco vazio" nem função quebrada: é a ausência de usuário.
--
-- Vale para qualquer função `security invoker` desta camada
-- (get_panorama, simular_alocacao). As `security definer` com guard
-- se comportam diferente e mais barulhento: `get_saldo_livre` levanta
-- exceção em `assert_project_allowed` em vez de devolver vazio.
--
-- Se só quiser um resultado rápido sem escolher usuário, este bloco
-- descobre o admin sozinho e dispensa qualquer substituição:
--
--   begin;
--   select set_config('request.jwt.claims',
--     json_build_object(
--       'sub',  (select user_id::text from public.app_users where role='admin' limit 1),
--       'role', 'authenticated')::text, true);
--   select jsonb_pretty(public.get_panorama()->'resumo');
--   commit;
--
-- ATENÇÃO: o repo é público. Nenhum uuid, e-mail ou nome real entra
-- em arquivo versionado. Se editar aqui por engano, desfaça antes de
-- commitar (`git diff` mostra).
-- ============================================================


-- ============================================================
-- 0. PREPARO
-- ============================================================

-- 0.a — seu user_id e seu papel:
select u.id, u.email, coalesce(a.role, '(sem linha em app_users)') as papel
  from auth.users u
  left join public.app_users a on a.user_id = u.id
 order by u.email;

-- 0.b — um centro de custo com plano ativo (para a PARTE 2):
select p.id,
       p.name,
       p.end_date,
       (select count(*) from public.planos_trabalho pt
         where pt.project_id = p.id and pt.ativo)           as tem_plano_ativo,
       (select count(*) from public.balancetes b
         where b.project_id = p.id)                         as qtd_balancetes
  from public.projects p
 where p.active
 order by tem_plano_ativo desc, qtd_balancetes desc;

-- 0.c — um professor, para a conferência de escopo:
select a.user_id, count(up.project_id) as centros_do_professor
  from public.app_users a
  left join public.user_projects up on up.user_id = a.user_id
 where a.role = 'professor'
 group by a.user_id
 order by centros_do_professor desc;


-- ============================================================
-- PARTE 1 — o reparo de get_project_alerts
-- ============================================================
-- A 032 dropou a tabela `expenses` E recriou esta função sem o alerta
-- que a lia. O drop chegou ao banco; a recriação, não. Como plpgsql só
-- resolve nome de tabela em tempo de EXECUÇÃO, a função continuou
-- existindo e só falha quando alguém pede alerta — o que quebra a
-- página Projetos e o sino do Dashboard.

-- 1.a — DIAGNÓSTICO. Roda sozinho, sem impersonação, e diz o estado
--       do banco em uma linha. Rode ANTES de aplicar a 040.
select p.prosrc ~ 'expense_no_description' as quebrada,
       p.prosecdef                          as definer,
       p.proconfig                          as config
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'get_project_alerts';
-- quebrada = true  -> corpo da 003, a 032 não chegou aqui. A 040 conserta.
-- quebrada = false -> já está na versão da 032/040.
-- definer  = false -> correto (a 019 converteu para invoker).

-- 1.b — A FALHA, ao vivo. ANTES da 040 devolve
--       `ERROR: relation "public.expenses" does not exist`.
--       DEPOIS devolve as linhas de alerta (ou zero, se o projeto não
--       tiver nenhuma inconsistência).
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','SEU-USER-ID','role','authenticated')::text, true);

select alert_type, severity, message
  from public.get_project_alerts('O-PROJECT-ID'::uuid);
commit;

-- 1.c — o sino do Dashboard usa a versão em lote, que chama a de cima.
--       Mesmo comportamento: quebrava junto, conserta junto.
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','SEU-USER-ID','role','authenticated')::text, true);

select project_name, alert_type, severity, message
  from public.get_alerts_for_projects(array['O-PROJECT-ID'::uuid]);
commit;


-- ============================================================
-- PARTE 2 — get_panorama
-- ============================================================

-- 2.a — payload inteiro
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','SEU-USER-ID','role','authenticated')::text, true);

select jsonb_pretty(public.get_panorama());
commit;


-- 2.b — a tabela que interessa: um centro de custo por linha
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','SEU-USER-ID','role','authenticated')::text, true);

with r as (select public.get_panorama() as j)
select c->>'project_name'                          as centro,
       c->>'situacao_dado'                         as dado,
       (c->>'saldo_livre')::numeric                as saldo_livre,
       c->'caixa'->>'cobertura'                    as balancete,
       (c->'caixa'->>'defasagem_meses')::int       as defasagem,
       (c->>'meses_restantes')::int                as meses_rest,
       (c->'bolsas'->>'ativas')::int               as bolsas,
       (c->'bolsas'->>'custo_mensal')::numeric     as custo_mes,
       (c->'alertas'->>'total')::int               as alertas
  from r, jsonb_array_elements(r.j->'centros') c;
commit;
-- LEITURA: a ordem é ALFABÉTICA e não significa prioridade.
-- Compare saldo_livre APENAS entre linhas com dado = 'completo':
--   'sem_balancete' -> realizado = 0 por ausência de dado, saldo
--                      SUPERESTIMADO (é o previsto integral do plano)
--   'sem_plano'     -> saldo_livre NULO, não zero
--   balancete 'defasada'     -> saldo SUBESTIMADO (bolsas já pagas
--                      ainda contam como compromisso; ver mig. 038)
--   balancete 'desconhecida' -> o centro não tem plano, então a idade
--                      do balancete não foi apurada. NÃO leia como
--                      "em dia".


-- 2.c — o resumo e a observação de qualidade do dado
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','SEU-USER-ID','role','authenticated')::text, true);

with r as (select public.get_panorama() as j)
select r.j->'resumo'->>'centros'                as centros,
       r.j->'resumo'->>'sem_plano'              as sem_plano,
       r.j->'resumo'->>'sem_balancete'          as sem_balancete,
       r.j->'resumo'->>'balancete_defasado'     as defasado,
       r.j->'resumo'->>'balancete_em_dia'       as em_dia,
       r.j->'resumo'->>'balancete_desconhecido' as desconhecido,
       r.j->'resumo'->>'vigencia_encerrando'    as encerrando,
       r.j->'resumo'->>'alertas_graves'         as graves,
       r.j->'resumo'->>'saldo_livre_total'      as saldo_total,
       r.j->'resumo'->>'observacao'             as observacao
  from r;
commit;
-- CONFIRA A ARITMÉTICA: sem_balancete + defasado + em_dia +
-- desconhecido tem que somar exatamente `centros`. Os quatro estados
-- são mutuamente exclusivos; se não fecharem, há caso não previsto.
--
-- `sem_balancete` + `defasado` é a leitura de saúde do Fechamento
-- Mensal: são os centros cujo número menos merece confiança hoje.


-- 2.d — ESCOPO: o mesmo panorama pelos olhos de um professor.
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','UM-PROFESSOR-ID','role','authenticated')::text, true);

with r as (select public.get_panorama() as j)
select r.j->'resumo'->>'centros' as centros_que_ele_ve,
       (select string_agg(c->>'project_name', ', ')
          from jsonb_array_elements(r.j->'centros') c) as quais
  from r;
commit;
-- Compare com 0.c: deve bater com `centros_do_professor`, contando só
-- os ativos.


-- 2.e — filtro explícito por centro de custo
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','SEU-USER-ID','role','authenticated')::text, true);

select jsonb_pretty(public.get_panorama(array['O-PROJECT-ID'::uuid]));
commit;


-- ============================================================
-- PARTE 3 — o panorama concorda com as funções de origem?
-- ============================================================
-- A 040 promete NÃO recalcular nada. Estes blocos conferem a
-- promessa: se divergirem, existe uma segunda conta para a mesma
-- pergunta — exatamente o que a arquitetura tenta impedir.

-- 3.a — saldo_livre do panorama × soma dos grupos da get_saldo_livre
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','SEU-USER-ID','role','authenticated')::text, true);

with pan as (
  select c
    from jsonb_array_elements(public.get_panorama()->'centros') c
   where c->>'project_id' = 'O-PROJECT-ID'
),
direto as (
  select public.get_saldo_livre('O-PROJECT-ID'::uuid) as j
)
select (select (c->>'saldo_livre')::numeric from pan)              as pelo_panorama,
       (select coalesce(sum((g->>'saldo_livre')::numeric), 0)
          from direto, jsonb_array_elements(direto.j->'grupos') g) as pela_038,
       (select (c->'caixa'->>'defasagem_meses')::int from pan)     as defasagem_panorama,
       (select (j->>'balancete_defasagem_meses')::int from direto) as defasagem_038;
commit;
-- Esperado: as duas colunas de cada par IDÊNTICAS.


-- 3.b — contagem de bolsas do panorama × SQL cru
--       (o panorama lê de v_project_summary; isto confere a view)
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','SEU-USER-ID','role','authenticated')::text, true);

with pan as (
  select c
    from jsonb_array_elements(public.get_panorama()->'centros') c
   where c->>'project_id' = 'O-PROJECT-ID'
)
select (select (c->'bolsas'->>'ativas')::int from pan)           as bolsas_panorama,
       (select count(*) from public.scholarships s
         where s.project_id = 'O-PROJECT-ID'::uuid
           and s.status = 'active')                              as bolsas_cru,
       (select (c->'bolsas'->>'custo_mensal')::numeric from pan)  as custo_panorama,
       (select coalesce(sum(s.amount), 0) from public.scholarships s
         where s.project_id = 'O-PROJECT-ID'::uuid
           and s.status = 'active'
           and s.start_date <= current_date
           and s.end_date   >= current_date)                      as custo_cru;
commit;
-- ATENÇÃO à diferença legítima: `bolsas_panorama` conta TODAS as
-- ativas (definição da view), enquanto `custo_mensal` soma só as
-- vigentes HOJE. Uma bolsa ativa que começa mês que vem entra na
-- contagem e não no custo — não é bug.


-- ============================================================
-- 4. REAUDITORIA (roda sozinha, sem substituições)
-- ============================================================
-- Mesmo bloco de asserção do fim da 040. Reexecutável a qualquer
-- momento: se alguma migração futura recriar uma destas funções com
-- `create or replace` e perder o atributo, isto acusa — que é
-- exatamente como a correção da 019 se perdeu uma vez (ver mig. 036) e
-- como a recriação da 032 nunca chegou ao banco.

do $$
declare
  bad text;
begin
  if exists (select 1 from pg_proc p
              where p.oid = 'public.get_panorama(uuid[],boolean)'::regprocedure
                and p.prosecdef) then
    bad := coalesce(bad || E'\n', '') || '  get_panorama é definer (deveria ser invoker)';
  end if;

  if has_function_privilege('anon', 'public.get_panorama(uuid[],boolean)', 'execute') then
    bad := coalesce(bad || E'\n', '') || '  get_panorama executável por anon';
  end if;

  if exists (select 1 from pg_proc p
              where p.oid in (
                      'public.get_project_alerts(uuid)'::regprocedure,
                      'public.get_alerts_for_projects(uuid[])'::regprocedure)
                and p.prosecdef) then
    bad := coalesce(bad || E'\n', '')
        || '  get_project_alerts / get_alerts_for_projects voltou a ser definer (regressão da 019)';
  end if;

  if exists (select 1 from pg_proc p
              where p.oid = 'public.get_project_alerts(uuid)'::regprocedure
                and p.prosrc ~ 'expense_no_description') then
    bad := coalesce(bad || E'\n', '')
        || '  get_project_alerts voltou a referenciar a tabela expenses (dropada pela 032)';
  end if;

  if bad is not null then
    raise exception 'Reauditoria da 040 falhou:%', E'\n' || bad;
  end if;

  raise notice 'Reauditoria da 040: OK';
end $$;

-- ============================================================
-- Migração 035 — Lockdown do role `anon` (pré-publicação)
-- ============================================================
-- Contexto: o site vai para GitHub Pages e o repositório fica
-- público. A publishable key (`sb_publishable_...`) vai no bundle
-- e é pública POR DESIGN — qualquer pessoa pode falar com a API
-- do Supabase como role `anon`, sem senha. A garantia de que
-- ninguém sem senha lê dado de projeto/bolsa depende de três
-- barreiras, e esta migração fecha a que estava aberta.
--
-- ------------------------------------------------------------
-- A BRECHA (real, encontrada na auditoria pré-publicação)
-- ------------------------------------------------------------
-- No Postgres, `create function` concede EXECUTE a PUBLIC por
-- padrão, e o PostgREST expõe todo o schema `public` como RPC ao
-- role `anon`. O projeto tem ~25 funções `security definer` —
-- e `security definer` **burla o RLS** (roda como o dono da
-- função, não como quem chamou).
--
-- Até aqui só 4 funções tinham `revoke execute ... from anon`
-- (migração 033, linhas 118-120 e 1433). Todas as outras estavam
-- chamáveis sem login. Na prática, quase todas se salvam pelo
-- guard interno `assert_project_allowed()` — para o `anon`,
-- `is_admin()` é false e `allowed_project_ids()` é vazio, então
-- a função levanta exceção. Mas isso é sorte estrutural, não
-- garantia: bastava UMA função definer sem guard para vazar
-- tudo, sem senha. E havia uma:
--
--   public.resolve_rubrica_for_conta(text)  — 026, definer, sem
--   guard, lê conta_rubrica_map. Chamável por anon.
--
-- Em vez de auditar função por função (que precisa ser refeito a
-- cada migração nova), esta migração remove a permissão na raiz:
-- `anon` deixa de poder executar QUALQUER função do schema
-- public, agora e no futuro.
--
-- ------------------------------------------------------------
-- O QUE ESTA MIGRAÇÃO **NÃO** MUDA
-- ------------------------------------------------------------
-- • Nada do app quebra: o frontend só chama RPC depois do login,
--   sempre como `authenticated`, que mantém o EXECUTE.
-- • Os grants de SELECT do `anon` nas TABELAS ficam como estão.
--   Ali a barreira já é o RLS, e ele foi verificado: 20/20
--   tabelas com RLS habilitado e ZERO policies `to anon`/`to
--   public` (a parte 3 abaixo re-verifica isso a cada execução).
--   Manter o SELECT permite que o keep-alive do n8n continue
--   recebendo 200 + `[]` em vez de 401 — a query segue contando
--   como atividade e o projeto free não entra em pausa.
-- ============================================================


-- ============================================================
-- 1. anon perde EXECUTE em todo o schema public
-- ============================================================
-- Revoga de PUBLIC (o grant implícito do `create function`) e de
-- `anon` (o grant explícito que o Supabase concede por default
-- privileges). Em seguida devolve a `authenticated` — que é quem
-- o app usa — para não quebrar nada.

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;

grant execute on all functions in schema public to authenticated;

-- resolve_rubrica_for_conta: era a única definer SEM guard, ou
-- seja, a brecha concreta. Fechada para anon.
-- Mantida para `authenticated` de propósito: ela é chamada dentro
-- de auto_resolve_rubrica_lancamento() (026:138), que é INVOKER —
-- revogar de authenticated quebraria o trigger se algum insert em
-- balancete_lancamentos passasse fora da RPC upsert_balancete.
-- E não protegeria nada: um usuário logado já lê conta_rubrica_map
-- direto pela tabela (plano-trabalho.js:74).
revoke execute on function public.resolve_rubrica_for_conta(text) from public, anon;

-- Utilitário de setup (já revogado na 019 — reafirmado aqui
-- porque o grant acima devolveria EXECUTE a authenticated).
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;


-- ============================================================
-- 2. Funções FUTURAS já nascem fechadas para anon
-- ============================================================
-- Sem isto, a próxima migração que criar uma função definer
-- reabre exatamente a mesma brecha. `alter default privileges`
-- sem `for role` vale para o role que executa este script — no
-- SQL Editor do Supabase, `postgres`, que é quem cria as funções
-- das migrações.

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public grant  execute on functions to authenticated;


-- ============================================================
-- 3. Verificação — falha alto se alguma barreira estiver aberta
-- ============================================================
-- Roda como asserção: se qualquer item abaixo estiver errado, a
-- migração aborta com mensagem em vez de dar "sucesso" silencioso.
-- Re-execute esta migração a qualquer momento para reauditar.

do $$
declare
  v_sem_rls      text;
  v_pol_anon     text;
  v_fn_anon      text;
  v_bucket_pub   text;
begin
  -- 3a. Toda tabela do schema public precisa ter RLS habilitado.
  select string_agg(tablename, ', ' order by tablename)
    into v_sem_rls
    from pg_tables
   where schemaname = 'public'
     and rowsecurity = false;

  if v_sem_rls is not null then
    raise exception 'FALHA DE SEGURANÇA: tabelas sem RLS: %', v_sem_rls;
  end if;

  -- 3b. Nenhuma policy pode alcançar anon (nem via PUBLIC).
  select string_agg(tablename || '.' || policyname, ', ')
    into v_pol_anon
    from pg_policies
   where schemaname = 'public'
     and (roles::text[] && array['anon', 'public']);

  if v_pol_anon is not null then
    raise exception 'FALHA DE SEGURANÇA: policies acessíveis por anon: %', v_pol_anon;
  end if;

  -- 3c. Nenhuma função do schema public pode ser executável por anon.
  select string_agg(p.proname, ', ' order by p.proname)
    into v_fn_anon
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'EXECUTE');

  if v_fn_anon is not null then
    raise exception 'FALHA DE SEGURANÇA: funções executáveis por anon: %', v_fn_anon;
  end if;

  -- 3d. Nenhum bucket de Storage pode ser público.
  select string_agg(id, ', ' order by id)
    into v_bucket_pub
    from storage.buckets
   where public = true;

  if v_bucket_pub is not null then
    raise exception 'FALHA DE SEGURANÇA: buckets públicos: %', v_bucket_pub;
  end if;

  raise notice 'OK — RLS em todas as tabelas, nenhuma policy anon, nenhuma função executável por anon, nenhum bucket público.';
end$$;


-- ============================================================
-- LEMBRETE MANUAL (não dá para fazer por SQL)
-- ============================================================
-- Esta migração fecha o lado do banco. Falta o lado do Auth, que
-- só existe no Dashboard e é o item MAIS crítico dos dois:
--
--   Authentication → Sign In / Providers → Email:
--     DESMARCAR "Allow new users to sign up"
--   Authentication → Providers:
--     confirmar "Anonymous sign-ins" desativado
--
-- Com signup aberto, qualquer pessoa com a publishable key chama
-- auth.signUp() pela API, vira `authenticated` e as policies
-- passam a valer para ela. Aí o RLS deixa de ser barreira de
-- acesso e vira só escopo por centro de custo.
-- Checklist completo: docs/seguranca-publicacao.md
-- ============================================================

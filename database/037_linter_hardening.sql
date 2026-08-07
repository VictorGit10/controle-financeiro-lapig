-- ============================================================
-- Migração 037 — Hardening dos warnings do Database Linter
-- ============================================================
-- Resolve os warnings remanescentes do Supabase Database Linter
-- após a publicação (035/036 já fecharam o role `anon` e o
-- `search_path` das funções vivas). Sobram duas famílias:
--
--   A) rls_policy_always_true em `rubricas` (INSERT/UPDATE/DELETE)
--      e `conta_rubrica_map` (INSERT/UPDATE): policies `(true)`
--      para `authenticated`.
--      Ambas são catálogos GLOBAIS (sem `project_id`) — não dá
--      pra escopar com `allowed_project_ids()`. Mas o frontend
--      NUNCA escreve direto nessas tabelas:
--        • o dropdown de rubricas é a constante JS `RUBRICAS`
--          (plano-trabalho.js:39), não um select da tabela;
--        • novos mapeamentos conta→rubrica são gravados pela RPC
--          `upsert_balancete` (security definer → bypassa RLS),
--          não por INSERT direto do cliente.
--      Logo as policies de escrita `(true)` não têm consumidor
--      legítimo pelo PostgREST. Endurecidas para admin-only
--      (`is_admin()`). SELECT fica `(true)` (dado de referência,
--      sem PII, sem sensibilidade por projeto — o linter não
--      flaga SELECT `using (true)`). O fluxo do professor (salvar
--      mapeamento na revisão do balancete) é preservado: roda
--      via `upsert_balancete` (definer), que bypassa RLS.
--
--   B) authenticated_security_definer_function_executable em 6
--      funções que NÃO são RPC expostos ao frontend. Revoga
--      EXECUTE de `authenticated` (`anon` já foi revogado na 035):
--        • 5 triggers (`audit_trigger_function`,
--          `enforce_single_plano_ativo`, `handle_new_user`,
--          `set_holder_created_by`, `sync_project_balance`) —
--          triggers disparam pelo mecanismo de trigger, que NÃO
--          checa EXECUTE do chamador; continuam funcionando, só
--          deixam de ser chamáveis como `/rpc/...`;
--        • `assert_project_allowed` — helper chamado só dentro de
--          outras RPCs definer (que rodam como o dono, dono esse
--          com EXECUTE); nunca chamado pelo frontend direto.
--      Mantêm EXECUTE em `authenticated` (intencional):
--        • `is_admin()` / `allowed_project_ids()` — referenciados
--          pelas policies de RLS (as policies os chamam);
--        • `resolve_rubrica_for_conta(text)` — chamada pelo
--          trigger `security invoker` `auto_resolve_rubrica_lancamento`;
--        • as 12 RPCs `security definer` que o frontend chama
--          (`save_project`, `upsert_plano_trabalho`, `upsert_balancete`,
--          `get_plano_ativo`, `get_planos_historico`, `get_balancetes_by_project`,
--          `get_balancete_detalhado`, `get_previsto_vs_realizado`,
--          `ativar_plano_trabalho`, `apply_reconciliation`, `merge_holders`,
--          `save_user_assignments`) — cada uma com guard interno
--          (`assert_project_allowed` ou `is_admin`), então o warning
--          é benigno: o linter não enxerga o guard.
--
-- Não toca na anon key (pública), nem no RLS de tabelas com
-- `project_id`, nem nas RPCs definer expostas (guards intactos).
-- Termina com asserção reauditoria (reexecutável a qualquer
-- momento).
-- ============================================================


-- A) Policies de escrita dos catálogos globais → admin-only -----

-- rubricas (catálogo fixo de rubricas do Plano de Trabalho)
-- Idempotente: remove as policies antigas (Autenticado) E as novas
-- (Admin) de uma execução parcial anterior, antes de (re)criar.
drop policy if exists "Autenticado insere rubricas" on public.rubricas;
drop policy if exists "Autenticado edita rubricas"  on public.rubricas;
drop policy if exists "Autenticado exclui rubricas" on public.rubricas;
drop policy if exists "Admin insere rubricas" on public.rubricas;
drop policy if exists "Admin edita rubricas"  on public.rubricas;
drop policy if exists "Admin exclui rubricas" on public.rubricas;

create policy "Admin insere rubricas" on public.rubricas
  for insert to authenticated with check (public.is_admin());
create policy "Admin edita rubricas" on public.rubricas
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admin exclui rubricas" on public.rubricas
  for delete to authenticated using (public.is_admin());

-- conta_rubrica_map (catálogo de mapeamento conta → rubrica)
drop policy if exists "Autenticado insere mapeamento" on public.conta_rubrica_map;
drop policy if exists "Autenticado edita mapeamento"  on public.conta_rubrica_map;
drop policy if exists "Autenticado exclui mapeamento" on public.conta_rubrica_map;
drop policy if exists "Admin insere mapeamento" on public.conta_rubrica_map;
drop policy if exists "Admin edita mapeamento"  on public.conta_rubrica_map;
drop policy if exists "Admin exclui mapeamento" on public.conta_rubrica_map;

create policy "Admin insere mapeamento" on public.conta_rubrica_map
  for insert to authenticated with check (public.is_admin());
create policy "Admin edita mapeamento" on public.conta_rubrica_map
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admin exclui mapeamento" on public.conta_rubrica_map
  for delete to authenticated using (public.is_admin());

-- SELECT permanece `using (true)` (dado de referência, leitura
-- liberada a todo autenticado) — não flagado pelo linter.


-- B) Revoga EXECUTE de authenticated em triggers/helper ---------

revoke execute on function public.audit_trigger_function()     from authenticated;
revoke execute on function public.enforce_single_plano_ativo() from authenticated;
revoke execute on function public.handle_new_user()            from authenticated;
revoke execute on function public.set_holder_created_by()      from authenticated;
revoke execute on function public.sync_project_balance()      from authenticated;
revoke execute on function public.assert_project_allowed(uuid) from authenticated;


-- C) Asserção reauditoria --------------------------------------
-- Aborta a migração (e pode ser reexecutada como reauditoria) se
-- (1) alguma das 6 funções acima ainda for executável por
-- `authenticated`, ou (2) sobrar policy permissiva (`using (true)`
-- ou `with check (true)`) de escrita nas tabelas-catálogo.

do $$
declare
  fn  text;
  bad text;
begin
  -- (1) funções não devem ser executáveis por authenticated
  foreach fn in array array[
    'public.audit_trigger_function()',
    'public.enforce_single_plano_ativo()',
    'public.handle_new_user()',
    'public.set_holder_created_by()',
    'public.sync_project_balance()',
    'public.assert_project_allowed(uuid)'
  ] loop
    if has_function_privilege('authenticated', fn, 'execute') then
      bad := coalesce(bad || E'\n', '') || '  EXECUTE ainda concedido a authenticated: ' || fn;
    end if;
  end loop;

  -- (2) nenhuma policy de escrita permissiva nos catálogos
  if exists (
    select 1 from pg_policies
      where schemaname = 'public'
        and tablename in ('rubricas','conta_rubrica_map')
        and cmd in ('INSERT','UPDATE','DELETE')
        and (qual = 'true' or with_check = 'true')
  ) then
    bad := coalesce(bad || E'\n', '') || '  policy permissiva remanescente em rubricas/conta_rubrica_map';
  end if;

  if bad is not null then
    raise exception 'Reauditoria falhou:%', E'\n' || bad;
  end if;
end $$;
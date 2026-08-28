-- Liga RLS de verdade no stub sintético, que até aqui rodava com as tabelas
-- abertas. Sem isso o roteiro da 044 não testaria nada: a migração inteira é
-- sobre policy e GRANT, e num banco sem RLS todo bloco passaria por acidente.
--
-- Reproduz as policies da mig. 033 (as três de escrita são o que a 044 remove) e
-- deixa `projects` com policy de SELECT **e de propósito nenhuma de UPDATE** — é
-- o que transforma o bloco 5 em prova: se `sync_project_balance` não escrevesse
-- acima do RLS, a cadeia até `projects.initial_balance` morreria ali.
--
-- `is_admin()` do stub devolve `true`. Isso deixa o teste MAIS forte, não mais
-- fraco: se nem um admin consegue inserir depois da 044, é porque a policy
-- realmente não existe, e não porque o escopo barrou.
--
--   ... stub.sql, stub-042.sql, stub-043.sql, 042, 043 ...
--   docker exec -i cf-044 psql -U postgres -d cf < tools/replica-local/sintetico/stub-044.sql
--   docker exec -i cf-044 psql -U postgres -d cf < database/044_saldo_somente_do_balancete.sql
--   docker exec -i cf-044 psql -U postgres -d cf < tests/sql/test_044_saldo_somente_do_balancete.sql

grant usage on schema public to authenticated, anon;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.project_balances to authenticated;
grant insert, update on public.balancetes to authenticated;
grant execute on function public.upsert_project_balance(
  uuid, integer, integer, numeric, numeric, date, text) to authenticated;
grant execute on function public.get_balances_for_month(integer, integer) to authenticated;

alter table public.project_balances enable row level security;
alter table public.balancetes       enable row level security;
alter table public.projects         enable row level security;

-- ── project_balances: as 4 policies da mig. 033 ───────────────────────────
drop policy if exists "Escopo lê saldos"     on public.project_balances;
drop policy if exists "Escopo insere saldos" on public.project_balances;
drop policy if exists "Escopo edita saldos"  on public.project_balances;
drop policy if exists "Escopo exclui saldos" on public.project_balances;

create policy "Escopo lê saldos" on public.project_balances for select to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Escopo insere saldos" on public.project_balances for insert to authenticated
  with check (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Escopo edita saldos" on public.project_balances for update to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()))
  with check (public.is_admin() or project_id = any(public.allowed_project_ids()));
create policy "Escopo exclui saldos" on public.project_balances for delete to authenticated
  using (public.is_admin() or project_id = any(public.allowed_project_ids()));

-- ── balancetes: o professor sobe o PDF, então escreve aqui ────────────────
drop policy if exists "Escopo lê balancetes"     on public.balancetes;
drop policy if exists "Escopo insere balancetes" on public.balancetes;
create policy "Escopo lê balancetes" on public.balancetes for select to authenticated
  using (true);
create policy "Escopo insere balancetes" on public.balancetes for insert to authenticated
  with check (true);

-- ── projects: SELECT e mais nada ──────────────────────────────────────────
-- A ausência da policy de UPDATE é intencional. Ver o cabeçalho.
drop policy if exists "Escopo lê projetos" on public.projects;
create policy "Escopo lê projetos" on public.projects for select to authenticated
  using (true);

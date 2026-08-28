-- ============================================================================
-- 044_saldo_somente_do_balancete.sql
--
-- Fecha o caminho de escrita manual em `project_balances`. Depois da 043 o saldo
-- do projeto vem do `SALDO DISPONÍVEL` do balancete; a aba Saldos virou registro
-- somente leitura e não chama mais `upsert_project_balance`. Esta migração faz o
-- BANCO dizer a mesma coisa que a tela.
--
-- POR QUE NÃO BASTA TIRAR OS CAMPOS DA TELA. A anon key é pública e o PostgREST
-- expõe tabela e RPC direto: enquanto `authenticated` puder dar INSERT em
-- `project_balances` ou EXECUTE em `upsert_project_balance`, existe um segundo
-- caminho para o mesmo número — que é exatamente o que a 043 removeu. É o mesmo
-- raciocínio das migrações 035 e 037: quem impõe o limite é o RLS e o GRANT, a
-- interface é só onde ele aparece.
--
-- O QUE CONTINUA ESCREVENDO. Só o gatilho `sync_balance_from_balancete` (mig.
-- 043) e, em cascata, `sync_project_balance` (mig. 017/021). Os dois são
-- `security definer` e pertencem ao dono das tabelas, então rodam acima do RLS —
-- tirar as policies de escrita de `authenticated` não os afeta. **Isso é
-- afirmação testável, não raciocínio:** o roteiro sobe RLS de verdade, faz
-- `set role authenticated` e confere que o upload de balancete ainda grava e que
-- os dois caminhos manuais falham. Ver blocos 2, 3 e 4 de
-- `tests/sql/test_044_saldo_somente_do_balancete.sql`.
--
-- COMO DESFAZER, se voltar a fazer falta digitar saldo. Três comandos, e é de
-- propósito que sejam poucos — a decisão é de processo, não de arquitetura:
--
--   grant execute on function public.upsert_project_balance(
--     uuid,integer,integer,numeric,numeric,date,text) to authenticated;
--   grant insert, update on public.project_balances to authenticated;
--   create policy "Escopo insere saldos" on public.project_balances
--     for insert to authenticated
--     with check (public.is_admin() or project_id = any(public.allowed_project_ids()));
--
-- A função `upsert_project_balance` NÃO é dropada: ela continua sendo o caminho
-- para uma correção pontual feita por quem tem acesso ao SQL Editor, e dropá-la
-- transformaria "não é a rotina" em "não é possível". A 043 continua chamando a
-- lógica dela? Não — a 043 usa o gatilho. São independentes.
--
-- DELETE fica de fora do revoke: apagar saldo já era impossível pela interface,
-- e a policy de DELETE some junto com as outras. Ver o bug latente registrado no
-- roteiro da 043 (apagar a última linha estoura em `sync_project_balance`).
-- ============================================================================

begin;

-- ── A. A RPC de digitação deixa de ser executável pela web ─────────────────
revoke execute on function public.upsert_project_balance(
  uuid, integer, integer, numeric, numeric, date, text
) from public, anon, authenticated;


-- ── B. Policies de escrita de project_balances ────────────────────────────
-- Nomes da migração 033. A de SELECT ("Escopo lê saldos") FICA: a aba Saldos
-- continua lendo, escopada por centro de custo.
drop policy if exists "Escopo insere saldos" on public.project_balances;
drop policy if exists "Escopo edita saldos"  on public.project_balances;
drop policy if exists "Escopo exclui saldos" on public.project_balances;


-- ── C. E o GRANT de tabela, por baixo da policy ───────────────────────────
-- Sem policy o INSERT já seria negado; revogar o privilégio também é a mesma
-- redundância que a 035 aplicou às funções. Dá erro de permissão claro em vez
-- de "0 linhas afetadas por RLS", que é mais difícil de diagnosticar.
revoke insert, update, delete on public.project_balances from anon, authenticated;


-- ── D. Asserção ───────────────────────────────────────────────────────────
do $$
declare
  v_policies integer;
  v_exec     boolean;
  v_ins      boolean;
  v_sel      boolean;
begin
  select count(*) into v_policies
    from pg_policies
   where schemaname = 'public' and tablename = 'project_balances'
     and cmd in ('INSERT', 'UPDATE', 'DELETE');

  if v_policies > 0 then
    raise exception 'Ainda há % policy(ies) de escrita em project_balances.', v_policies;
  end if;

  select has_function_privilege('authenticated',
    'public.upsert_project_balance(uuid,integer,integer,numeric,numeric,date,text)', 'execute')
    into v_exec;
  select has_table_privilege('authenticated', 'public.project_balances', 'insert') into v_ins;
  select has_table_privilege('authenticated', 'public.project_balances', 'select') into v_sel;

  if v_exec then raise exception 'authenticated ainda executa upsert_project_balance.'; end if;
  if v_ins  then raise exception 'authenticated ainda tem INSERT em project_balances.';  end if;
  if not v_sel then raise exception 'authenticated PERDEU o SELECT em project_balances — a aba Saldos para de ler.'; end if;

  raise notice 'OK: saldo só entra pelo balancete; leitura preservada.';
end $$;

commit;

-- ============================================================================
-- Roteiro de conferência da migração 042.
--
-- ⚠️  ESCREVE E APAGA DADOS. Roda só no container descartável do nível
--     sintético (`tools/replica-local/README.md`), NUNCA contra produção.
--
--   docker run -d --name cf-042 -e POSTGRES_PASSWORD=postgres postgres:17-alpine
--   docker exec cf-042 psql -U postgres -c 'create database cf'
--   docker exec -i cf-042 psql -U postgres -d cf < tools/replica-local/sintetico/stub.sql
--   docker exec -i cf-042 psql -U postgres -d cf < database/042_fix_saldos_project_id.sql
--   docker exec -i cf-042 psql -U postgres -d cf < tests/sql/test_042_saldos_project_id.sql
--
-- Os 5 blocos devem imprimir PASSA. É reexecutável: limpa o próprio rastro
-- antes de começar.
--
-- O QUE ESTE ROTEIRO PROTEGE. A regressão que a 042 conserta é silenciosa: a
-- função não erra, não devolve linha a menos e não estoura — devolve a linha
-- certa com a identidade nula, e o estrago aparece três telas adiante (saldo
-- projetado negativo em projeto com dinheiro em conta). Por isso o bloco 2 é o
-- que importa: ele testa justamente o caso SEM par no LEFT JOIN, que é o único
-- em que o bug se manifestava e o único que ninguém testa por reflexo.
-- ============================================================================

\pset pager off

-- Porteiro. Sem ele os blocos passariam a vazio contra um banco sem a 042.
do $$ begin
  if to_regprocedure('public.get_balances_for_month(integer,integer)') is null then
    raise exception 'get_balances_for_month não existe. Rode as migrações 017 e 042 antes deste roteiro.';
  end if;
end $$;

create or replace function pg_temp.chk(nome text, cond boolean) returns void
language plpgsql as $$ begin
  raise notice '%  %', case when cond then 'PASSA' else '>>> FALHA' end, nome;
end $$;

-- ── Cenário ────────────────────────────────────────────────────────────────
-- Dois projetos ativos: um COM saldo no mês de referência, outro SEM. O
-- segundo é o caso do bug.
delete from public.project_balances
 where project_id in (select id from public.projects where code in ('99.001','99.002'));
delete from public.projects where code in ('99.001','99.002');

insert into public.projects (name, code, active)
values ('ZZ Teste Com Saldo', '99.001', true),
       ('ZZ Teste Sem Saldo', '99.002', true);

insert into public.project_balances
  (project_id, reference_month, reference_year, initial_balance, yield_amount, balance_date)
select id, 8, 2026, 1000.00, 50.00, '2026-08-03'
  from public.projects where code = '99.001';


-- ── 1. Projeto COM saldo: identidade e valores preservados ────────────────
do $$
declare r record;
begin
  select * into r from public.get_balances_for_month(8, 2026)
   where project_name = 'ZZ Teste Com Saldo';

  perform pg_temp.chk('1a. linha com saldo traz project_id',
    r.project_id = (select id from public.projects where code = '99.001'));
  perform pg_temp.chk('1b. linha com saldo traz o id do balanço (hasBalance)',
    r.id is not null);
  perform pg_temp.chk('1c. valores do balanço vêm intactos',
    r.initial_balance = 1000.00 and r.yield_amount = 50.00 and r.balance_date = date '2026-08-03');
end $$;


-- ── 2. Projeto SEM saldo: A REGRESSÃO ─────────────────────────────────────
-- Antes da 042 este bloco falhava em 2a e passava em 2b: o project_id vinha
-- nulo porque era lido do lado sem par do LEFT JOIN.
do $$
declare r record;
begin
  select * into r from public.get_balances_for_month(8, 2026)
   where project_name = 'ZZ Teste Sem Saldo';

  perform pg_temp.chk('2a. linha SEM saldo AINDA ASSIM traz project_id  <<< a correção',
    r.project_id = (select id from public.projects where code = '99.002'));
  perform pg_temp.chk('2b. linha SEM saldo tem id do balanço nulo (hasBalance = false)',
    r.id is null);
  perform pg_temp.chk('2c. linha SEM saldo tem os campos do balanço nulos',
    r.initial_balance is null and r.balance_date is null and r.reference_month is null);
end $$;


-- ── 3. Nenhuma linha, em nenhum mês, sem project_id ───────────────────────
-- Inclui um mês em que ninguém tem saldo — o caso 100% sem par.
do $$
declare v_nulos integer;
begin
  select count(*) into v_nulos from (
    select project_id from public.get_balances_for_month(8, 2026)
    union all
    select project_id from public.get_balances_for_month(1, 1999)
  ) t where project_id is null;

  perform pg_temp.chk('3. project_id nunca é nulo, nem no mês totalmente vazio',
    v_nulos = 0);
end $$;


-- ── 4. Todo projeto aparece exatamente uma vez ────────────────────────────
-- O LEFT JOIN não pode duplicar: `uq` em (project_id, mês, ano) garante, mas o
-- filtro de mês/ano tem que estar no ON e não no WHERE — no WHERE ele viraria
-- INNER JOIN e sumiria com os projetos sem saldo, que é o oposto do conserto.
do $$
declare v_linhas integer; v_projetos integer;
begin
  select count(*) into v_linhas   from public.get_balances_for_month(8, 2026);
  select count(*) into v_projetos from public.projects;

  perform pg_temp.chk('4. uma linha por projeto, sem duplicar nem sumir',
    v_linhas = v_projetos);
end $$;


-- ── 5. Atributos da função sobreviveram ao create or replace ──────────────
-- Lição da 036: `security` e `search_path` são reescritos junto com o corpo.
do $$
declare r record;
begin
  select p.prosecdef, p.proconfig into r
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_balances_for_month';

  perform pg_temp.chk('5a. continua security invoker (RLS das mig. 033/034 aplica)',
    r.prosecdef = false);
  perform pg_temp.chk('5b. search_path continua fixo',
    r.proconfig @> array['search_path=public, pg_temp']);
end $$;


-- ── Limpeza ───────────────────────────────────────────────────────────────
delete from public.project_balances
 where project_id in (select id from public.projects where code in ('99.001','99.002'));
delete from public.projects where code in ('99.001','99.002');

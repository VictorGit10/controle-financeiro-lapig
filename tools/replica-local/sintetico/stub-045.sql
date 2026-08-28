-- Completa o stub sintético com o que a migração 045 toca e a cadeia 042/043
-- não tem: as duas tabelas de que `v_project_summary` depende
-- (`dashboard_settings` e `funding_releases`, das mig. 003/001) e a versão
-- ANTERIOR da view — a da 032, sem `rendimento_informativo`.
--
-- A view antiga entra de propósito. A seção E da 045 usa `create or replace
-- view` justamente para NÃO perder os GRANTs, e um `replace` só prova alguma
-- coisa se houver o que substituir. Contra um banco sem a view, a seção passaria
-- criando-a do zero e o roteiro não teria testado a parte arriscada.
--
-- Insere também um balancete PRÉ-EXISTENTE com rendimento (projeto 99.015),
-- para que o backfill da seção F tenha o que encontrar — mesma razão do 99.014
-- no stub-043: criado depois da migração, quem agiria é o gatilho, e o backfill
-- passaria a vazio sem ninguém notar.
--
--   docker exec -i cf-045 psql -U postgres -d cf < tools/replica-local/sintetico/stub.sql
--   docker exec -i cf-045 psql -U postgres -d cf < tools/replica-local/sintetico/stub-042.sql
--   docker exec -i cf-045 psql -U postgres -d cf < tools/replica-local/sintetico/stub-043.sql
--   docker exec -i cf-045 psql -U postgres -d cf < database/042_fix_saldos_project_id.sql
--   docker exec -i cf-045 psql -U postgres -d cf < database/043_saldo_do_balancete.sql
--   docker exec -i cf-045 psql -U postgres -d cf < tools/replica-local/sintetico/stub-045.sql
--   docker exec -i cf-045 psql -U postgres -d cf < database/045_rendimento_informativo.sql
--   docker exec -i cf-045 psql -U postgres -d cf < tests/sql/test_045_rendimento_informativo.sql

-- A restrição que o stub base não tem e que a 045 DEPENDE. Na mig. 026 a tabela
-- nasce com `unique (project_id, data_referencia)`: um reupload do mesmo PDF é
-- UPDATE, nunca uma segunda linha. Sem ela, o `distinct on (projeto, ano, mês)
-- order by data_referencia desc` do backfill fica com empate para desempatar e
-- escolhe qualquer um dos dois rendimentos — e um roteiro que depende de sorte
-- reprova de vez em quando, que é pior do que reprovar sempre.
do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'uq_balancete_proj_data'
       and conrelid = 'public.balancetes'::regclass
  ) then
    delete from public.balancetes b
     using public.balancetes b2
     where b.project_id = b2.project_id
       and b.data_referencia = b2.data_referencia
       and b.ctid > b2.ctid;
    alter table public.balancetes
      add constraint uq_balancete_proj_data unique (project_id, data_referencia);
  end if;
end $$;

create table if not exists public.dashboard_settings (
  project_id         uuid primary key references public.projects(id),
  include_in_general boolean not null default true
);

create table if not exists public.funding_releases (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id),
  amount       numeric(14,2) not null default 0,
  release_date date
);

-- Versão da mig. 032 — sem a coluna que a 045 acrescenta no fim.
create or replace view public.v_project_summary
  with (security_invoker = true)
as
select
  p.id,
  p.name,
  p.start_date,
  p.end_date,
  p.initial_balance,
  p.yield_amount,
  p.balance_date,
  p.active,
  coalesce(ds.include_in_general, false) as in_general_dashboard,

  (select count(*) from public.scholarships s
   where s.project_id = p.id and s.status = 'active') as active_scholarships,

  coalesce((
    select sum(s.amount) from public.scholarships s
    where s.project_id = p.id
      and s.status = 'active'
      and s.start_date <= current_date
      and s.end_date >= current_date
  ), 0) as current_monthly_scholarships,

  coalesce((
    select sum(fr.amount) from public.funding_releases fr
    where fr.project_id = p.id
  ), 0) as total_funding

from public.projects p
left join public.dashboard_settings ds on ds.project_id = p.id
order by p.active desc, p.name;


-- ── Dado anterior à 045, para o backfill da seção F ────────────────────────
-- O saldo já existe (o gatilho da 043 o criou ao inserir o balancete), mas sem
-- a composição — que é exatamente o estado do banco de produção hoje.
alter table public.project_balances disable trigger trg_sync_project_balance;
delete from public.balancetes b
 using public.projects p
 where b.project_id = p.id and p.code = '99.015';
delete from public.project_balances pb
 using public.projects p
 where pb.project_id = p.id and p.code = '99.015';
delete from public.dashboard_settings ds
 using public.projects p
 where ds.project_id = p.id and p.code = '99.015';
delete from public.projects where code = '99.015';
alter table public.project_balances enable trigger trg_sync_project_balance;

insert into public.projects (name, code, active)
values ('ZZ Rendimento Pre Existente', '99.015', true);

insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido)
select id, date '2026-06-10', 500000.00, 8500.00
  from public.projects where code = '99.015';

-- Completa o stub sintético com o que a migração 042 toca e ele não tem:
-- `project_balances` (mig. 017/024) e a versão ORIGINAL, com bug, de
-- `get_balances_for_month` (mig. 017 + o ALTER da 019).
--
-- A versão com bug entra de propósito. Sem ela o roteiro só provaria que a 042
-- funciona; com ela, prova também que o roteiro DETECTA o bug — rodar o teste
-- antes da migração tem que reprovar o bloco 2a. Um teste que passa nos dois
-- estados não estava testando nada.
--
--   docker exec -i cf-042 psql -U postgres -d cf < tools/replica-local/sintetico/stub.sql
--   docker exec -i cf-042 psql -U postgres -d cf < tools/replica-local/sintetico/stub-042.sql
--   docker exec -i cf-042 psql -U postgres -d cf < tests/sql/test_042_saldos_project_id.sql   # 2a FALHA
--   docker exec -i cf-042 psql -U postgres -d cf < database/042_fix_saldos_project_id.sql
--   docker exec -i cf-042 psql -U postgres -d cf < tests/sql/test_042_saldos_project_id.sql   # tudo PASSA

create table if not exists public.project_balances (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete restrict,
  reference_month integer not null check (reference_month between 1 and 12),
  reference_year  integer not null,
  initial_balance numeric(14,2) not null default 0,
  yield_amount    numeric(14,2) not null default 0,
  balance_date    date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint uq_balance_proj_month unique (project_id, reference_month, reference_year)
);

-- Versão da mig. 017 (com o `pb.project_id` que a 042 corrige), já com os
-- atributos que a 019 aplicou por ALTER.
create or replace function public.get_balances_for_month(
  p_month integer,
  p_year  integer
)
returns table (
  id              uuid,
  project_id      uuid,
  project_name    text,
  project_active  boolean,
  reference_month integer,
  reference_year  integer,
  initial_balance numeric,
  yield_amount    numeric,
  balance_date    date,
  notes           text,
  created_at      timestamptz,
  updated_at      timestamptz
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  return query
  select
    pb.id,
    pb.project_id,          -- <<< o bug: nulo quando o LEFT JOIN não acha par
    p.name   as project_name,
    p.active as project_active,
    pb.reference_month,
    pb.reference_year,
    pb.initial_balance,
    pb.yield_amount,
    pb.balance_date,
    pb.notes,
    pb.created_at,
    pb.updated_at
  from public.projects p
  left join public.project_balances pb
    on pb.project_id      = p.id
   and pb.reference_month = p_month
   and pb.reference_year  = p_year
  order by p.active desc, p.name;
end;
$$;

-- Preparo da réplica local antes de restaurar o schema real.
-- Cria o que existe no Supabase mas não vem no dump do schema public:
-- roles do PostgREST, schema extensions e um stub de auth.users.

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon')            then create role anon            nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated')   then create role authenticated   nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role')    then create role service_role    nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_admin')  then create role supabase_admin  nologin noinherit; end if;
end $$;

create schema if not exists extensions;
create schema if not exists auth;

-- O dump cria estas no schema "extensions". pg_stat_statements e
-- supabase_vault não existem no Postgres oficial e não são usadas por
-- nada no schema public — ficam de fora (as linhas correspondentes são
-- removidas do schema.sql antes de restaurar).
create extension if not exists pg_trgm  with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Stub de auth.users: só o que as FKs do schema public precisam.
create table if not exists auth.users (
  id    uuid primary key,
  email text
);

-- auth.uid() lê o JWT do request, igual ao Supabase — é assim que a
-- impersonação por set_config('request.jwt.claims', ...) funciona nos
-- testes, e é o que as policies de RLS e os guards das RPCs consultam.
create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), '')::uuid
$$;

create or replace function auth.role()
returns text
language sql stable
as $$
  select coalesce(
    current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )
$$;

grant usage on schema public     to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema auth       to anon, authenticated, service_role;

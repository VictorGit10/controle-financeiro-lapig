-- Stub para validar a migração 051 num Postgres descartável.
-- Ordem: stub.sql -> stub-047.sql -> 047 -> stub-049.sql -> stub-050.sql
--        -> 049 -> 050 -> stub-051.sql -> 051 -> test_051
-- NÃO faz parte do projeto.
--
-- Traz o que o Postgres puro não tem e a 051 depende:
--   • auth.uid() lendo o JWT como no Supabase (request.jwt.claim.sub), para
--     o roteiro trocar de usuário com set_config;
--   • app_users/user_projects e os helpers REAIS da 033 — o stub.sql tem
--     is_admin() = true, que faria todo teste de escopo passar a vazio;
--   • storage mínimo (buckets, objects com RLS, foldername) e a policy
--     permissiva do bucket de balancetes (026), que a restritiva da 051
--     tem de vencer.

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table if not exists public.app_users (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  role         text not null default 'professor' check (role in ('admin','professor')),
  display_name text,
  email        text,
  created_at   timestamptz not null default now()
);
create table if not exists public.user_projects (
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  primary key (user_id, project_id)
);

create or replace function public.is_admin() returns boolean
language sql security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.app_users where user_id = auth.uid() and role = 'admin');
$$;
create or replace function public.allowed_project_ids() returns uuid[]
language sql security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(project_id), '{}'::uuid[]) from public.user_projects where user_id = auth.uid();
$$;
create or replace function public.assert_project_allowed(p_project_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.is_admin() then return; end if;
  if not exists (select 1 from unnest(public.allowed_project_ids()) as id where id = p_project_id) then
    raise exception 'Acesso negado ao projeto %', p_project_id;
  end if;
end; $$;

-- storage mínimo
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null
);
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant usage on schema public, auth to authenticated;
grant select on public.projects to authenticated;   -- como no Supabase
insert into storage.buckets values ('balancete-pdfs', 'balancete-pdfs', false) on conflict do nothing;
create policy bal_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'balancete-pdfs');
create policy bal_select on storage.objects for select to authenticated
  using (bucket_id = 'balancete-pdfs');

-- Pessoas e escopo
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1'),   -- admin
  ('00000000-0000-0000-0000-0000000000b1'),   -- professor, escopo X
  ('00000000-0000-0000-0000-0000000000c1')    -- agente,    escopo X
on conflict do nothing;

insert into public.projects (name, code, start_date, end_date) values
  ('Stub 051 X', '51.X', '2025-01-01', '2027-12-31'),
  ('Stub 051 Y', '51.Y', '2025-01-01', '2027-12-31');

insert into public.app_users (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000b1', 'professor');
-- o agente entra DEPOIS da 051 (o check de role ainda não o aceita aqui)

insert into public.user_projects (user_id, project_id)
select u, p.id
  from (values ('00000000-0000-0000-0000-0000000000b1'::uuid),
               ('00000000-0000-0000-0000-0000000000c1'::uuid)) as v(u)
 cross join public.projects p
 where p.code = '51.X';

-- Stub para validar a migração 052 num Postgres descartável.
-- Ordem: stub.sql -> stub-047.sql -> 047 -> stub-049.sql -> stub-050.sql
--        -> 049 -> 050 -> stub-051.sql -> 051 -> stub-052.sql -> 052
--        -> test_052
-- NÃO faz parte do projeto.
--
-- Traz o estado de produção que a 052 corrige: scholarship_holders com
-- cpf/email e a policy de leitura da 033 (que entrega a linha inteira a
-- quem tem o centro no escopo — inclusive o agente), e o bucket de
-- planilhas de bolsas legível por qualquer autenticado (031).

alter table public.scholarship_holders
  add column if not exists cpf        text,
  add column if not exists email      text,
  add column if not exists created_by uuid;

alter table public.scholarship_holders enable row level security;
create policy "Escopo lê bolsistas" on public.scholarship_holders for select to authenticated
  using (
    public.is_admin()
    or created_by = auth.uid()
    or exists (
      select 1 from public.scholarships s
       where s.holder_id = scholarship_holders.id
         and s.project_id = any(public.allowed_project_ids())
    )
  );
grant select on public.scholarship_holders, public.scholarships to authenticated;

-- o agente (o check de role aceita desde a 051)
insert into public.app_users (user_id, role)
values ('00000000-0000-0000-0000-0000000000c1', 'agente')
on conflict (user_id) do update set role = 'agente';

-- bolsistas: um no centro X (escopo do professor e do agente), um no Y.
-- CPFs válidos de teste (passam no dígito verificador), nenhum real.
do $$
declare
  x  uuid := (select id from public.projects where code = '51.X');
  y  uuid := (select id from public.projects where code = '51.Y');
  hx uuid;
  hy uuid;
begin
  insert into public.scholarship_holders (full_name, cpf, email)
  values ('Bolsista X Teste', '52998224725', 'x@teste.local') returning id into hx;
  insert into public.scholarship_holders (full_name, cpf, email)
  values ('Bolsista Y Teste', '11144477735', 'y@teste.local') returning id into hy;
  insert into public.scholarships (holder_id, project_id, amount, start_date, end_date)
  values (hx, x, 4000, '2026-01-01', '2026-12-31'),
         (hy, y, 4000, '2026-01-01', '2026-12-31');
end $$;

-- storage: planilha de bolsas (tem CPF) legível por autenticado, como na 031
insert into storage.buckets values ('bolsa-planilhas', 'bolsa-planilhas', false) on conflict do nothing;
create policy bolsa_auth_select on storage.objects for select to authenticated
  using (bucket_id = 'bolsa-planilhas');
insert into storage.objects (bucket_id, name)
select 'bolsa-planilhas', id::text || '/planilha.xlsx' from public.projects where code = '51.X';
insert into storage.objects (bucket_id, name)
select 'balancete-pdfs', id::text || '/bal.pdf' from public.projects where code = '51.X';

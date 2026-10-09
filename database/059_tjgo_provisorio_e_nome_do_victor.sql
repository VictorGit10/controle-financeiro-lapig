-- 059 — cadastros que o Victor pediu ao Claude em 09/10/2026 (ele não quer fazê-los pela tela).
--
-- 1. Centro de custo 30.121 (TJGO, contrato 23/2026 TJGO × UFG × FUNAPE) PROVISÓRIO: só nome, código e
--    uma nota do que falta, para as tarefas do TJGO existirem já. Vigência, saldo, plano e pasta do Drive
--    entram depois. Se o 30.121 já existir, só é reaproveitado; se houver outro "TJGO" com outro código,
--    a migração para (não adivinha qual é o certo).
-- 2. O 30.121 entra no escopo do Buriti (login de papel 'agente', que só lê e propõe).
-- 3. O login do Victor ganha nome no sistema ("Victor Amaral"): estava vazio, a tela mostrava um nome
--    montado do e-mail e o Buriti não o achava como responsável de tarefa. Identificado como o único admin
--    sem nome cujo e-mail começa por "victor"; se houver zero ou mais de um, a migração para.
begin;

do $$
declare v uuid; n integer;
begin
  select id into v from public.projects where code = '30.121';
  if v is null then
    if exists (select 1 from public.projects where lower(btrim(name)) = 'tjgo') then
      raise exception '059: já existe projeto TJGO com outro código; conferir antes de cadastrar o 30.121';
    end if;
    insert into public.projects (name, code, active, notes)
    values ('TJGO', '30.121', true,
      'Cadastro provisório feito pelo Claude em 09/10/2026 a pedido do Victor (contrato 23/2026 TJGO × UFG × FUNAPE; '
      || '1º Termo Aditivo assinado em 07/10/2026). Falta: vigência, saldo, plano de trabalho e pasta do Drive.')
    returning id into v;
  end if;

  -- Exatamente um agente (revisão do Kimi K3): com zero, o escopo sairia no vazio e a migração passaria.
  if (select count(*) from public.app_users where role = 'agente') <> 1 then
    raise exception '059: esperava exatamente 1 login agente'; end if;
  insert into public.user_projects (user_id, project_id)
  select user_id, v from public.app_users where role = 'agente'
  on conflict (user_id, project_id) do nothing;

  update public.app_users set display_name = 'Victor Amaral'
   where role = 'admin' and coalesce(btrim(display_name), '') = '' and lower(email) like 'victor%';
  get diagnostics n = row_count;
  if n <> 1 then raise exception '059: esperava 1 admin sem nome, achou %', n; end if;
end $$;

-- Asserções
do $$
begin
  if (select count(*) from public.projects where code = '30.121') <> 1 then
    raise exception '059: 30.121 não ficou único'; end if;
  if exists (select 1 from public.app_users a where a.role = 'agente' and not exists (
      select 1 from public.user_projects u join public.projects p on p.id = u.project_id
       where u.user_id = a.user_id and p.code = '30.121')) then
    raise exception '059: agente sem o 30.121'; end if;
  if exists (select 1 from public.app_users where role = 'admin' and coalesce(btrim(display_name), '') = '') then
    raise exception '059: ainda há admin sem nome'; end if;
end $$;
commit;

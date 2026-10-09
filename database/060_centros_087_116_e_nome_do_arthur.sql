-- 060 — cadastros que faltavam (pendência 9 do Buriti, 03/10/2026; o Victor pediu ao Claude que cadastre).
--
-- 1. Centros de custo PROVISÓRIOS, só nome, código e nota do que falta, para o Buriti propor os balancetes:
--    - 30.087 "Estoque de Carbono" (nome da pasta do Drive "11.Estoque de carbono - 30.087"; no balancete da
--      FUNAPE a conta é "BB/FU MAPEAMENTO ESPA..."); tem balancete de setembro esperando;
--    - 30.116 "Rede ILPF" (pasta "6. Rede ILPF - 30.116"; projeto "Mapeamento Nacional de Pastagens 2024/2025
--      com Camada de Integração", Prof. Laerte); ainda sem balancete.
--    Se o código já existir, só é reaproveitado; se houver outro projeto com o mesmo nome, a migração para.
-- 2. Os dois entram no escopo do Buriti (login de papel 'agente', que só lê e propõe).
-- 3. O login do Arthur passa a se chamar "Arthur Pietro" no sistema (estava "arthurpietro.lapig", e a tela de
--    Atividades mostrava "Arthurpietro"). Identificado pelo nome atual exato; zero ou mais de um: para.
-- Valores fixos (id e datas): o cofre só aplica se o efeito na produção for idêntico ao do ensaio.
begin;

do $$
declare v uuid; c record; n integer;
begin
  if (select count(*) from public.app_users where role = 'agente') <> 1 then
    raise exception '060: esperava exatamente 1 login agente'; end if;

  for c in select * from (values
      ('30.087', 'Estoque de Carbono', md5('lapig:projeto:30.087')::uuid,
       'Cadastro provisório feito pelo Claude em 09/10/2026 a pedido do Victor (nome da pasta do Drive; no balancete '
       || 'da FUNAPE: "MAPEAMENTO ESPA..."). Falta: confirmar o nome, vigência, saldo e plano de trabalho.'),
      ('30.116', 'Rede ILPF', md5('lapig:projeto:30.116')::uuid,
       'Cadastro provisório feito pelo Claude em 09/10/2026 a pedido do Victor (projeto "Mapeamento Nacional de '
       || 'Pastagens 2024/2025 com Camada de Integração", Prof. Laerte). Falta: vigência, saldo, plano e balancete.')
    ) x(code, name, id, notes) loop
    select id into v from public.projects where code = c.code;
    if v is null then
      if exists (select 1 from public.projects where lower(btrim(name)) = lower(c.name)) then
        raise exception '060: já existe projeto "%" com outro código; conferir antes de cadastrar o %', c.name, c.code;
      end if;
      insert into public.projects (id, name, code, active, created_at, updated_at, notes)
      values (c.id, c.name, c.code, true, '2026-10-09 12:00:00-03', '2026-10-09 12:00:00-03', c.notes)
      returning id into v;
    end if;
    insert into public.user_projects (user_id, project_id)
    select user_id, v from public.app_users where role = 'agente'
    on conflict (user_id, project_id) do nothing;
  end loop;

  update public.app_users set display_name = 'Arthur Pietro'
   where role = 'professor' and display_name = 'arthurpietro.lapig';
  get diagnostics n = row_count;
  if n <> 1 then raise exception '060: esperava 1 login "arthurpietro.lapig", achou %', n; end if;
end $$;

-- Asserções
do $$
begin
  if (select count(*) from public.projects where code in ('30.087', '30.116')) <> 2 then
    raise exception '060: os dois centros não ficaram cadastrados'; end if;
  if exists (select 1 from public.app_users a where a.role = 'agente' and (
      select count(*) from public.user_projects u join public.projects p on p.id = u.project_id
       where u.user_id = a.user_id and p.code in ('30.087', '30.116')) <> 2) then
    raise exception '060: agente sem os dois centros'; end if;
  if exists (select 1 from public.app_users where display_name = 'arthurpietro.lapig') then
    raise exception '060: o login do Arthur continua sem nome'; end if;
end $$;
commit;

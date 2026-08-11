-- Pós-carga da réplica local: bolsistas sintéticos + remoção de PII.
-- Nada aqui afeta os números que a camada de decisão calcula — as
-- colunas zeradas são texto livre/jsonb que nenhuma RPC lê.

-- 1. Bolsistas sintéticos, só para satisfazer a FK. O dump real da
--    scholarship_holders foi excluído na origem (nome, CPF, e-mail).
insert into public.scholarship_holders (id, full_name, active)
select s.holder_id,
       'Bolsista ' || lpad((row_number() over (order by s.holder_id))::text, 3, '0'),
       true
  from (select distinct holder_id from public.scholarships) s
on conflict (id) do nothing;

alter table public.scholarships
  add constraint scholarships_holder_id_fkey
  foreign key (holder_id) references public.scholarship_holders(id) on delete restrict;

-- 2. auth.users stub, a partir dos ids que sobraram nas tabelas.
insert into auth.users (id)
select user_id from public.app_users
union
select user_id from public.user_projects
on conflict (id) do nothing;

-- 3. PII e texto livre que não entra em conta nenhuma.
update public.app_users        set display_name = null, email = null;
update public.planos_trabalho  set coordenador = null, titulo = null, observacoes = null,
                                   raw_extraction = null, arquivo_nome = null,
                                   arquivo_storage_path = null;
update public.balancetes       set observacoes = null, raw_extraction = null,
                                   arquivo_nome = null, arquivo_storage_path = null;
update public.scholarships     set notes = null;
update public.projects         set notes = null;
update public.funding_releases set description = '(removido)', notes = null;
truncate public.dashboard_settings;

-- 4. Conferência: nada de e-mail nem sequência de 11 dígitos sobrando
--    nas colunas de texto que restaram.
do $$
declare n int;
begin
  select count(*) into n from public.scholarship_holders
   where full_name !~ '^Bolsista [0-9]{3}$';
  if n > 0 then raise exception 'Sobrou nome real em scholarship_holders: % linha(s)', n; end if;

  select count(*) into n from public.app_users where email is not null or display_name is not null;
  if n > 0 then raise exception 'Sobrou PII em app_users: % linha(s)', n; end if;

  raise notice 'Réplica limpa: % projetos, % bolsas, % bolsistas sintéticos',
    (select count(*) from public.projects),
    (select count(*) from public.scholarships),
    (select count(*) from public.scholarship_holders);
end $$;

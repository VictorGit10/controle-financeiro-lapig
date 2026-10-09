-- Produção antes da 058: save_user_assignments da 033 (a 051 aplicada em 02/10 foi a 73010bd, sem a correção).
-- Carregado pelo rodar-058-pglite.mjs depois da 051 final, para provar o defeito antes da 058.
create or replace function public.save_user_assignments(
  p_user_id     uuid,
  p_role        text,
  p_project_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem gerenciar atribuições de usuários.';
  end if;

  if p_role not in ('admin','professor') then
    raise exception 'Papel inválido: %', p_role;
  end if;

  update public.app_users
     set role = p_role
   where user_id = p_user_id;

  delete from public.user_projects where user_id = p_user_id;

  if p_project_ids is not null then
    insert into public.user_projects (user_id, project_id)
    select p_user_id, id from unnest(p_project_ids) as id
    on conflict (user_id, project_id) do nothing;
  end if;
end;
$$;

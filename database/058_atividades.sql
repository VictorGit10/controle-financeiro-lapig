-- 058 — tela de Atividades (pedido do Victor em 09/10/2026).
--
-- 1. O ADMIN ANOTA uma atividade direto na tela, como no caderno: centro de custo, o que fazer, prazo e
--    responsável (ele mesmo ou alguém da equipe). Vira uma tarefa comum, com um passo de pessoa, que o
--    vigia e o Buriti acompanham como as outras. Coluna nova tarefas.criada_na_tela: até aqui toda tarefa
--    vinha de proposta aplicada ou do Buriti operador (check da 055).
-- 2. save_user_assignments volta a aceitar o papel 'agente'. A 051 que foi para produção em 02/10 era a
--    primeira versão do arquivo (73010bd); a correção desta função entrou no arquivo dez minutos depois
--    (0edb4b7) e nunca foi aplicada. Resultado: em 09/10, ao atribuir centros ao Buriti em Usuários &
--    Centros de Custo, a tela mandou 'agente' e o banco respondeu "Papel inválido: agente". Corpo igual ao
--    da 051 final: aceita 'agente' e recusa tirar alguém desse papel.
begin;

-- ---------- 1. Atividade anotada na tela ----------
alter table public.tarefas add column criada_na_tela boolean not null default false;
alter table public.tarefas drop constraint tarefas_origem_check;
alter table public.tarefas add constraint tarefas_origem_check
  check (proposta_id is not null or criada_pelo_buriti or criada_na_tela);

-- p: {project_id, titulo, descricao?, prazo?, prazo_motivo?, passos:[{descricao}]}. Responsável por id
-- (a tela escolhe da lista de pessoas); nulo = sem responsável. Passos sempre de pessoa.
create function public.criar_tarefa_na_tela(p jsonb,p_responsavel uuid default null) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v uuid; s jsonb; passo uuid; i integer:=0; nome text;
begin
  if auth.uid() is null or public.is_agente() or public.is_automacao(null) or not public.is_admin() then
    raise exception 'Só admin anota atividade.' using errcode='42501'; end if;
  perform public._travar_modulo_tarefas();
  perform public._validar_tarefa(p);
  if p ? 'chaves' or p ? 'responsavel' then
    raise exception 'Chaves e responsável por nome não se usam aqui.' using errcode='22023'; end if;
  if not exists(select 1 from public.projects where id=(p->>'project_id')::uuid) then
    raise exception 'Projeto inexistente.' using errcode='22023'; end if;
  for s in select value from jsonb_array_elements(p->'passos') loop
    if s ? 'evidencia' or coalesce(s->>'executor','pessoa')<>'pessoa' then
      raise exception 'Passo anotado na tela é de pessoa e sem regra.' using errcode='22023'; end if;
  end loop;
  if p_responsavel is not null then nome:=public._nome_responsavel(p_responsavel); end if;
  -- trg_responsavel_humano recusa responsável que não seja admin/professor.
  insert into public.tarefas(project_id,titulo,descricao,responsavel,responsavel_id,prazo,prazo_motivo,criada_na_tela)
  values((p->>'project_id')::uuid,btrim(p->>'titulo'),nullif(btrim(p->>'descricao'),''),nome,p_responsavel,
    nullif(p->>'prazo','')::date,nullif(btrim(p->>'prazo_motivo'),''),true) returning id into v;
  for s in select value from jsonb_array_elements(p->'passos') loop
    i:=i+1;
    insert into public.tarefa_passos(tarefa_id,ordem,descricao,quem,evidencia,executor)
      values(v,i,btrim(s->>'descricao'),coalesce(nullif(btrim(s->>'quem'),''),nome),'{}','pessoa') returning id into passo;
    insert into public.tarefa_passos_regras(passo_id,evidencia) values(passo,'{}');
  end loop;
  insert into public.tarefa_chaves select v,'centro_custo',code from public.projects
    where id=(p->>'project_id')::uuid and code is not null on conflict do nothing;
  perform public._evento_tarefa(v,'criada:'||v,'criada','humano','Anotada na tela de Atividades.');
  if p_responsavel is not null then
    perform public._evento_tarefa(v,'responsavel:'||gen_random_uuid(),'status','humano','Responsável: '||nome);
  end if;
  return v;
end $$;

-- ---------- 2. save_user_assignments da 051 final ----------
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
declare
  v_atual text;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem gerenciar atribuições de usuários.';
  end if;

  if p_role not in ('admin', 'professor', 'agente') then
    raise exception 'Papel inválido: %', p_role;
  end if;

  select role into v_atual from public.app_users where user_id = p_user_id;
  if v_atual = 'agente' and p_role <> 'agente' then
    raise exception 'Este usuário é o agente (Buriti). Mudar o papel dele dá a uma IA poder de gravar: faça isso no SQL Editor, de propósito.'
      using errcode = '42501';
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

comment on function public.save_user_assignments is
  'Define o papel (admin/professor/agente) e os centros de custo permitidos de um usuário. Admin-only. Recusa tirar alguém do papel agente (mig. 051, reaplicada na 058). Usada pela página Usuários & Centros de Custo.';

revoke all on function public.criar_tarefa_na_tela(jsonb,uuid) from public, anon;
grant execute on function public.criar_tarefa_na_tela(jsonb,uuid) to authenticated;
revoke all on function public.save_user_assignments(uuid,text,uuid[]) from public, anon;
grant execute on function public.save_user_assignments(uuid,text,uuid[]) to authenticated;

-- Asserções: atributos de segurança, ACL e a regra de origem.
do $$
declare r record;
begin
  for r in select p.oid,p.proname,p.prosecdef,p.proconfig from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname in ('criar_tarefa_na_tela','save_user_assignments') loop
    if not r.prosecdef or not ('search_path=public, pg_temp'=any(r.proconfig)) or has_function_privilege('anon',r.oid,'EXECUTE')
      or not has_function_privilege('authenticated',r.oid,'EXECUTE') then
      raise exception '058: atributos/ACL incorretos em %',r.proname; end if;
  end loop;
  if position('''agente''' in (select prosrc from pg_proc where proname='save_user_assignments'
      and pronamespace='public'::regnamespace)) = 0 then
    raise exception '058: save_user_assignments ainda recusa o agente'; end if;
  if not exists(select 1 from pg_constraint where conname='tarefas_origem_check'
      and pg_get_constraintdef(oid) like '%criada_na_tela%') then
    raise exception '058: regra de origem sem criada_na_tela'; end if;
end $$;
commit;

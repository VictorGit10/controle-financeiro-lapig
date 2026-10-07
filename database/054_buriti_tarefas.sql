-- 054: tarefas do Buriti. Protótipo; nenhuma tarefa sem projeto.
-- Decisões da revisão Astra em docs/buriti-tarefas.md prevalecem.
-- Não altera os seis helpers protegidos. Automação permanece sem escopo,
-- inclusive desativada, e uma barreira adicional fecha escritas financeiras.
-- Eventos são imutáveis; textos descritivos devem vir mascarados.
-- CPF e endereço eletrônico são recusados nesses textos (máscara completa é
-- responsabilidade do executor). Endereços em regras de direção da evidência
-- ficam só em tarefa_passos_regras (admin) e vigia_contexto (vigia ativo).
-- A proposta bruta de tarefa é admin-only; listar_propostas_tarefa_seguras
-- projeta as propostas do escopo sem regras/endereço para professor e agente.
-- Locks: trava transacional do módulo, tarefas em UUID crescente, mensagens
-- em ID crescente, passos em UUID crescente. A serialização do protótipo
-- também ordena execução/outbox/eventos; nenhuma RPC ganha lock de mensagem
-- antes das tarefas do lote. Primeira captura exige primeira_carga=true;
-- as seguintes sobrepõem um dia ao cursor, travado antes da validação.
-- Remetente só existe na triagem admin e no lote de captura pendente do vigia.
-- Contrato externo: tools/vigia/CONTRATO.md (v1). Surgiu durante o trabalho;
-- os helpers _vigia_* fazem apenas a persistência interna, sem EXECUTE público.
-- vigia_contexto devolve versao_esquema/cursor_em/pendentes/alertas_emitidos,
-- tarefas abertas com centro_custo, contagens e saude.
-- vigia_capturar recebe {execucao_id?,janela:{inicio,fim,completa,primeira_carga?},mensagens}
-- e devolve {processar_ids,mensagens_novas,cursor_em}.
-- vigia_registrar recebe execucao (início/fim), resultados (registro_mensagem,
-- vinculos,eventos,passos_sugeridos), eventos de prazo, resumo_diario ou
-- avisos_resultados (ack enviado/falhou). Devolve execucao_id e outbox avisos.
-- Eventos/outbox são construídos pelo banco; resumos livres do modelo não
-- são persistidos. Ack repetido de enviado não incrementa tentativas; falhou
-- sem id de execução representa uma nova tentativa de entrega.
-- vigia_expurgar devolve {mensagens_expurgadas}.
-- Abaixo, formato interno usado pelos helpers privados e pelo teste:
-- Todas as RPCs recebem os nomes de parâmetros abaixo; retornos JSON:
-- propor_tarefa(p): {project_id,titulo,descricao?,responsavel?,prazo?,
--   prazo_motivo?,proxima_checagem?,chave?,passos:[{descricao,quem?,evidencia?}],
--   chaves?:[{tipo,valor}]} -> UUID da proposta. Até 64 KiB / 50 passos.
-- vigia_contexto(): {versao:1,cursor,ultima_recebida_em,tarefas:[{id,titulo,
--   project_id,centro,prazo,criada_em,chaves,passos}],mensagens:[capturadas/erro],
--   vinculos:[pares conhecidos],avisos:[pendentes/falhou],ultima_execucao}.
-- vigia_capturar(p): {mensagens:[{gmail_message_id,gmail_thread_id,recebida_em,
--   remetente?,remetente_dominio?,assunto?,trecho?,encaminhada?,anexos?}],
--   janela_completa?:bool,cursor?:timestamp,execucao?:{id,iniciada_em,versao?}}
--   -> {capturadas,cursor}. Só janela_completa=true avança cursor, monotônico.
--   Texto cuja máscara falhou é apagado na captura, com motivo mascara_falhou:
--   o metadado da mensagem é preservado para revisão, nunca descartado.
-- vigia_registrar(p): {mensagens:[{gmail_message_id,fila,motivo,estado?:
--   processada|erro,classificacao?,confianca?:alta|media|baixa,modelo?,
--   vinculos?:[{tarefa_id}],sugestoes?:[{tarefa_id,passo_id,resumo?}]}],
--   alertas?:[{tarefa_id,prazo,nivel:D-5|D-2|D-0|vencido,resumo?}],
--   avisos?:[{chave,texto,estado?:pendente|enviado|falhou}],
--   execucao?:{id,iniciada_em?,terminada_em?,mensagens_novas?,chamadas_modelo?,
--     alertas?,erros?:[],versao?}} -> {processadas,eventos}.
-- Evento de sugestão: msg:<id>:passo:<uuid>; mensagem: msg:<id>:tarefa:<uuid>;
-- alerta: prazo:<uuid>:<data>:<nivel>. Repetição não incrementa tentativas de
-- mensagem processada nem regride passos/revisões/vínculos rejeitados.
-- Aviso: inserir pendente; resultado de envio incrementa tentativa uma vez
-- por execução (execucao.id obrigatório ao comunicar enviado/falhou).
-- vigia_expurgar(): limpa assunto/trecho de mensagens com mais de 90 dias.
-- Teste: bash tools/replica-local/rodar-054.sh (Postgres descartável).
begin;

alter table public.app_users drop constraint app_users_role_check;
alter table public.app_users add constraint app_users_role_check
  check (role in ('admin','professor','agente','automacao'));
alter table public.propostas_agente drop constraint propostas_agente_tipo_check;
alter table public.propostas_agente add constraint propostas_agente_tipo_check
  check (tipo in ('balancete','bolsas','pergunta','aviso','tarefa'));
create policy tarefa_payload_restrito on public.propostas_agente
  as restrictive for select to authenticated using(tipo<>'tarefa' or public.is_admin());

-- decidir_proposta (051) com a única mudança: tipo 'tarefa' só admin. O resto do corpo é o da 051.
create or replace function public.decidir_proposta(p_id uuid, p_decisao text, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.propostas_agente;
begin
  if public.is_agente() then
    raise exception 'O agente não decide proposta: só humano.' using errcode = '42501';
  end if;
  if p_decisao not in ('rejeitada', 'respondida') then
    raise exception 'Decisão inválida: %. Use rejeitada ou respondida (aplicar é marcar_proposta_aplicada).', p_decisao;
  end if;
  select * into r from public.propostas_agente where id = p_id for update;
  if not found then
    raise exception 'Proposta % não existe.', p_id;
  end if;
  if r.status <> 'pendente' then
    raise exception 'Proposta % está %, não pendente.', p_id, r.status;
  end if;
  -- 054: proposta de tarefa só o admin decide (o professor do centro nem a lê; ver tarefa_payload_restrito).
  if r.tipo = 'tarefa' and not public.is_admin() then
    raise exception 'Proposta de tarefa: só admin decide.' using errcode = '42501';
  end if;
  if r.project_id is not null then
    perform public.assert_project_allowed(r.project_id);
  elsif not public.is_admin() then
    raise exception 'Proposta sem centro de custo: só admin decide.' using errcode = '42501';
  end if;
  if p_decisao = 'rejeitada' and coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Rejeitar exige o motivo: é o que o agente lê para não repetir o erro.';
  end if;
  if p_decisao = 'respondida' and r.tipo = 'pergunta' and coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Responder uma pergunta exige o texto da resposta.';
  end if;

  update public.propostas_agente
     set status = p_decisao, decidida_por = auth.uid(), decidida_em = now(), motivo = p_motivo
   where id = p_id;
end;
$$;
revoke all on function public.decidir_proposta(uuid, text, text) from public, anon;
grant execute on function public.decidir_proposta(uuid, text, text) to authenticated;

-- Trava única da escrita do módulo no protótipo. Também protege inserções
-- concorrentes de chaves idempotentes, sem exigir locks de linhas inexistentes.
create function public._travar_modulo_tarefas() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin perform pg_advisory_xact_lock(540054); end $$;

create table public.automacoes (
  user_id uuid primary key references auth.users(id),
  nome text not null check (nome in ('vigia')),
  ativo boolean not null default true,
  criada_em timestamptz not null default now()
);

create function public.is_automacao(p_nome text default null) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.app_users u where u.user_id = auth.uid()
    and u.role = 'automacao' and (p_nome is null or exists (
      select 1 from public.automacoes a where a.user_id = u.user_id
        and a.nome = p_nome and a.ativo
        and not exists (select 1 from public.user_projects s where s.user_id = u.user_id))));
$$;

-- Escopo vazio não cobre as exceções por criador da 033 nem os buckets
-- legíveis por qualquer autenticado. A automação não ganha dados pessoais
-- de um eventual histórico desse login. Os seis helpers protegidos ficam iguais.
create policy "Automação não lê bolsistas" on public.scholarship_holders
  as restrictive for select to authenticated using(not public.is_automacao(null));
create policy automacao_sem_storage on storage.objects
  as restrictive for all to authenticated using(not public.is_automacao(null))
  with check(not public.is_automacao(null));
create or replace function public.bolsistas_nomes(p_ids uuid[] default null,p_busca text default null)
returns table(id uuid,full_name text)
language sql stable security definer set search_path=public,pg_temp as $$
  select h.id,h.full_name from public.scholarship_holders h
    where not public.is_automacao(null)
      and (p_ids is null or h.id=any(p_ids))
      and (p_busca is null or h.full_name ilike '%'||p_busca||'%')
      and (public.is_admin() or h.created_by=auth.uid() or exists(
        select 1 from public.scholarships s where s.holder_id=h.id and s.project_id=any(public.allowed_project_ids())))
    order by h.full_name limit 1000;
$$;
revoke all on function public.bolsistas_nomes(uuid[],text) from public,anon;
grant execute on function public.bolsistas_nomes(uuid[],text) to authenticated;

-- Mantém a identidade mesmo quando o cadastro está desativado. Serializa
-- atribuição e conversão pelo mesmo perfil, impedindo escopo em corrida.
create function public._proteger_identidade_automacao() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role text;
begin
  if TG_TABLE_NAME = 'app_users' then
    if TG_OP = 'DELETE' then
      if old.role = 'automacao' then raise exception 'Não remova perfil de automação.' using errcode='42501'; end if;
      return old;
    end if;
    if TG_OP = 'UPDATE' and old.role = 'automacao' and new.role <> 'automacao' then
      raise exception 'Automação não pode virar humano.' using errcode='42501';
    end if;
    if TG_OP='UPDATE' and new.role not in ('admin','professor') and exists(
      select 1 from public.tarefas where responsavel_id=new.user_id) then
      raise exception 'Desatribua as tarefas antes de mudar o papel do responsável.' using errcode='42501'; end if;
    if new.role = 'automacao' and exists (select 1 from public.user_projects where user_id = new.user_id) then
      raise exception 'Automação deve ter escopo vazio.' using errcode='42501';
    end if;
  else
    select role into v_role from public.app_users where user_id = new.user_id for update;
    if v_role = 'automacao' then raise exception 'Automação não recebe projetos.' using errcode='42501'; end if;
  end if;
  return new;
end $$;
create trigger trg_identidade_automacao before insert or update or delete on public.app_users
for each row execute function public._proteger_identidade_automacao();
create trigger trg_escopo_automacao before insert or update on public.user_projects
for each row execute function public._proteger_identidade_automacao();

create function public.set_automacao(p_user uuid, p_nome text, p_ativo boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role text;
begin
  if not public.is_admin() then raise exception 'Só admin cadastra automações.' using errcode='42501'; end if;
  perform public._travar_modulo_tarefas();
  if p_nome is distinct from 'vigia' or p_ativo is null then raise exception 'Cadastro inválido.' using errcode='22023'; end if;
  select role into v_role from public.app_users where user_id=p_user for update;
  if not found or v_role not in ('professor','automacao') then
    raise exception 'Use um login dedicado de professor ou automação.' using errcode='22023';
  end if;
  delete from public.user_projects where user_id=p_user;
  update public.app_users set "role"='automacao' where user_id=p_user;
  insert into public.automacoes(user_id,nome,ativo) values(p_user,p_nome,p_ativo)
    on conflict(user_id) do update set nome=excluded.nome, ativo=excluded.ativo;
end $$;

create table public.tarefas (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  titulo text not null check (length(btrim(titulo)) between 1 and 300),
  descricao text check(length(descricao)<=10000), responsavel text check(length(responsavel)<=300),
  responsavel_id uuid references public.app_users(user_id),
  status text not null default 'em_andamento' check(status in ('em_andamento','aguardando_terceiro','concluida','cancelada')),
  precisa_atencao boolean not null default false, motivo_atencao text,
  prazo date, prazo_motivo text check(length(prazo_motivo)<=1000), proxima_checagem date,
  proposta_id uuid not null unique references public.propostas_agente(id),
  criada_por uuid not null default auth.uid(), criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now(), concluida_por uuid, concluida_em timestamptz,
  check (not precisa_atencao or coalesce(length(btrim(motivo_atencao)),0) > 0),
  check ((status='concluida') = (concluida_em is not null)),
  check ((concluida_por is null) = (concluida_em is null))
);
create index tarefas_projeto on public.tarefas(project_id,status);
create index tarefas_responsavel on public.tarefas(responsavel_id,prazo);
create table public.tarefa_eventos (
  id uuid primary key default gen_random_uuid(), tarefa_id uuid not null references public.tarefas(id),
  chave text not null unique check(length(chave) between 1 and 500),
  tipo text not null check(tipo in ('criada','mensagem','sugestao','confirmacao','nota','alerta_prazo','status','vinculo')),
  origem text not null check(origem in ('vigia','buriti','humano','sistema')),
  resumo text not null check(length(resumo) between 1 and 2400), detalhe jsonb not null default '{}',
  gmail_message_id text, gmail_thread_id text,
  ocorrido_em timestamptz not null default now(), criado_em timestamptz not null default now(),
  criado_por uuid not null default auth.uid()
);
create index tarefa_eventos_tarefa on public.tarefa_eventos(tarefa_id,criado_em);
create table public.tarefa_passos (
  id uuid primary key default gen_random_uuid(), tarefa_id uuid not null references public.tarefas(id),
  ordem integer not null check(ordem > 0), descricao text not null check(length(btrim(descricao)) between 1 and 1000),
  quem text check(length(quem)<=300), evidencia jsonb not null default '{}' check(evidencia='{}'::jsonb),
  estado text not null default 'pendente' check(estado in ('pendente','sugerido','confirmado','dispensado')),
  evento_id uuid references public.tarefa_eventos(id), confirmado_por uuid, confirmado_em timestamptz,
  ultimo_feito_id uuid references public.tarefa_eventos(id),
  unique(tarefa_id,ordem), check ((estado in ('confirmado','dispensado')) = (confirmado_em is not null)),
  check ((confirmado_por is null) = (confirmado_em is null))
);
create table public.tarefa_passos_regras (
  passo_id uuid primary key references public.tarefa_passos(id),
  evidencia jsonb not null check(jsonb_typeof(evidencia)='object')
);
create table public.tarefa_chaves (
  tarefa_id uuid not null references public.tarefas(id),
  tipo text not null check(tipo in ('thread','centro_custo','pessoa','termo','numero')),
  valor text not null check(length(btrim(valor)) between 1 and 300), primary key(tarefa_id,tipo,valor)
);
create table public.vigia_mensagens (
  gmail_message_id text primary key check(length(gmail_message_id) between 1 and 200),
  gmail_thread_id text not null check(length(gmail_thread_id) between 1 and 200),
  recebida_em timestamptz not null, remetente text check(length(remetente)<=300),
  remetente_dominio text check(length(remetente_dominio)<=300),
  assunto text check(length(assunto)<=1000), trecho text check(length(trecho)<=300),
  fila text check(fila in ('tarefa','esclarecer','rotina')),
  motivo text not null default 'aguarda_processamento' check(length(motivo)<=500),
  mascara_falhou boolean not null default false,
  estado text not null default 'capturada' check(estado in ('capturada','processada','erro')),
  tentativas integer not null default 0 check(tentativas>=0),
  classificacao text check(classificacao in ('concluido','exigencia','duvida','informativo','sem_acao')),
  confianca text check(confianca in ('alta','media','baixa')), modelo text check(length(modelo)<=100),
  encaminhada boolean not null default false, ocorrido_em timestamptz not null,
  anexos integer not null default 0 check(anexos>=0),
  revisada_por uuid, revisada_em timestamptz, criada_em timestamptz not null default now(), expurgada_em timestamptz
);
create index vigia_mensagens_estado on public.vigia_mensagens(estado,recebida_em);
create table public.vigia_vinculos (
  gmail_message_id text not null references public.vigia_mensagens(gmail_message_id),
  tarefa_id uuid not null references public.tarefas(id),
  estado text not null check(estado in ('sugerido','confirmado','rejeitado')),
  origem text not null check(origem in ('vigia','humano')),
  criado_em timestamptz not null default now(), revisado_por uuid, revisado_em timestamptz,
  primary key(gmail_message_id,tarefa_id)
);
create table public.vigia_cursor (
  id integer primary key check(id=1), ultima_recebida_em timestamptz,
  atualizada_em timestamptz not null default now()
);
insert into public.vigia_cursor(id) values(1);
create table public.vigia_execucoes (
  id uuid primary key, iniciada_em timestamptz not null, terminada_em timestamptz,
  tipo text not null default 'checagem' check(tipo in ('checagem','resumo_diario')),
  mensagens_novas integer not null default 0 check(mensagens_novas>=0),
  chamadas_modelo integer not null default 0 check(chamadas_modelo>=0),
  alertas integer not null default 0 check(alertas>=0), erros jsonb not null default '[]', versao text,
  check(terminada_em is null or terminada_em>=iniciada_em), check(jsonb_typeof(erros)='array')
);
create table public.vigia_avisos (
  chave text primary key check(length(chave) between 1 and 500), texto text not null check(length(texto) between 1 and 2000),
  tipo text not null default 'saude' check(tipo in ('mensagem','sugestao','alerta_prazo','esclarecer','saude','resumo_diario')),
  tarefa_id uuid references public.tarefas(id), dia date,
  estado text not null default 'pendente' check(estado in ('pendente','enviado','falhou')),
  canal text check(canal in ('ntfy','email')), motivo text check(motivo in ('sem_canal','envio_falhou')),
  tentativas integer not null default 0 check(tentativas>=0), ultima_execucao uuid references public.vigia_execucoes(id),
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);

-- ACL de tabela nunca depende dos privilégios padrão do ambiente.
do $$
declare t text;
begin
  foreach t in array array['automacoes','tarefas','tarefa_passos','tarefa_passos_regras','tarefa_chaves','tarefa_eventos',
    'vigia_mensagens','vigia_vinculos','vigia_cursor','vigia_execucoes','vigia_avisos'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create trigger trg_bloqueia_agente before insert or update or delete on public.%I for each statement execute function public.bloqueia_escrita_do_agente()',t);
    if t='tarefas' then
      execute format('create policy leitura on public.%I for select to authenticated using (public.is_admin() or project_id=any(public.allowed_project_ids()) or (responsavel_id=auth.uid() and not public.is_agente() and not public.is_automacao(null)))',t);
    elsif t in ('tarefa_passos','tarefa_chaves','tarefa_eventos') then
      execute format('create policy leitura on public.%I for select to authenticated using (exists(select 1 from public.tarefas t where t.id=tarefa_id))',t);
    else
      execute format('create policy leitura on public.%I for select to authenticated using (public.is_admin())',t);
    end if;
  end loop;
end $$;

-- A ordem é independente da ordem dos itens recebidos. Todas as tarefas do
-- lote são adquiridas antes de qualquer mensagem, inclusive antes do replay.
create function public._travar_lote_tarefas(p jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare ts uuid[]; ms text[];
begin
  perform public._travar_modulo_tarefas();
  select array_agg(distinct id order by id) into ts from (
    select (v->>'tarefa_id')::uuid id from jsonb_array_elements(coalesce(p->'mensagens','[]')) m,
      lateral jsonb_array_elements(coalesce(m->'vinculos','[]')||coalesce(m->'sugestoes','[]')) v
    union select (a->>'tarefa_id')::uuid from jsonb_array_elements(coalesce(p->'alertas','[]')) a
  ) ids;
  perform 1 from public.tarefas where id=any(coalesce(ts,'{}')) order by id for update;
  select array_agg(distinct m->>'gmail_message_id' order by m->>'gmail_message_id') into ms
    from jsonb_array_elements(coalesce(p->'mensagens','[]')) m;
  perform 1 from public.vigia_mensagens where gmail_message_id=any(coalesce(ms,'{}')) order by gmail_message_id for update;
  perform 1 from public.tarefa_passos where tarefa_id=any(coalesce(ts,'{}')) order by id for update;
end $$;

create function public._bloquear_financeiro_automacao() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.is_automacao(null) then raise exception 'Automação só escreve pelas RPCs do vigia.' using errcode='42501'; end if;
  return null;
end $$;
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and c.relname not in
    ('tarefas','tarefa_passos','tarefa_chaves','tarefa_eventos','vigia_mensagens','vigia_vinculos','vigia_cursor','vigia_execucoes','vigia_avisos') loop
    execute format('create trigger trg_bloqueia_automacao before insert or update or delete on public.%I for each statement execute function public._bloquear_financeiro_automacao()',t.relname);
  end loop;
end $$;

create function public._eventos_imutaveis() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin raise exception 'Eventos são imutáveis.' using errcode='42501'; end $$;
create trigger trg_eventos_imutaveis before update or delete or truncate on public.tarefa_eventos
for each statement execute function public._eventos_imutaveis();

create function public._texto_tarefa_seguro(p text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.contem_cpf(p) or p ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' then
    raise exception 'Texto deve estar mascarado (CPF/endereço eletrônico).' using errcode='22023';
  end if;
end $$;
-- A projeção recursiva remove todas as regras, inclusive em payloads antigos
-- malformados, e retém qualquer string que contenha endereço ou CPF.
create function public._payload_tarefa_publico(p jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; v jsonb; texto text;
begin
  if jsonb_typeof(p)='object' then
    v:='{}';
    for r in select key,value from jsonb_each(p) loop
      if public.contem_cpf(r.key) or r.key ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' then continue; end if;
      v:=v||jsonb_build_object(r.key,case when r.key='evidencia' then '{}'::jsonb else public._payload_tarefa_publico(r.value) end);
    end loop; return v;
  elsif jsonb_typeof(p)='array' then
    select coalesce(jsonb_agg(public._payload_tarefa_publico(value) order by ord),'[]') into v
      from jsonb_array_elements(p) with ordinality a(value,ord); return v;
  elsif jsonb_typeof(p)='string' then
    texto:=p#>>'{}';
    if public.contem_cpf(texto) or texto ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' then return to_jsonb('[Retido]'::text); end if;
  end if;
  return p;
end $$;
create function public.listar_propostas_tarefa_seguras() returns setof public.propostas_agente
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.propostas_agente;
begin
  if auth.uid() is null or public.is_automacao(null) then raise exception 'Só usuário humano ou agente no escopo.' using errcode='42501'; end if;
  for r in select * from public.propostas_agente where tipo='tarefa'
    and (public.is_admin() or project_id=any(public.allowed_project_ids())) order by criada_em,id loop
    r.payload:=public._payload_tarefa_publico(r.payload);
    r.resumo:=public._payload_tarefa_publico(to_jsonb(r.resumo))#>>'{}';
    r.chave:=public._payload_tarefa_publico(to_jsonb(r.chave))#>>'{}';
    r.motivo:=public._payload_tarefa_publico(to_jsonb(r.motivo))#>>'{}';
    r.arquivo_path:=public._payload_tarefa_publico(to_jsonb(r.arquivo_path))#>>'{}';
    return next r;
  end loop;
end $$;

-- Reposição da interna da 051: nenhum caminho legado pode aplicar tarefa.
-- RPCs financeiras que a chamam falham na mesma transação, desfazendo tudo.
create or replace function public._aplicar_proposta(p_id uuid,p_project_id uuid,p_objeto_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.propostas_agente;
begin
  if auth.uid() is null or public.is_agente() or public.is_automacao(null) then raise exception 'Só humano aplica proposta.' using errcode='42501'; end if;
  perform public._travar_modulo_tarefas();
  select * into r from public.propostas_agente where id=p_id for update;
  if not found then raise exception 'Proposta % não existe.',p_id; end if;
  if r.tipo='tarefa' then raise exception 'Tarefa exige aplicar_proposta_tarefa.' using errcode='22023'; end if;
  if r.status<>'pendente' then raise exception 'Proposta % está %, não pendente.',p_id,r.status; end if;
  if r.tipo in ('pergunta','aviso') then raise exception 'Proposta do tipo % não se aplica: responda-a.',r.tipo; end if;
  if r.project_id is distinct from p_project_id then raise exception 'A proposta % é de outro centro de custo.',p_id; end if;
  perform public.assert_project_allowed(r.project_id);
  update public.propostas_agente set status='aplicada',decidida_por=auth.uid(),decidida_em=now(),objeto_id=p_objeto_id where id=p_id;
end $$;
create or replace function public.marcar_proposta_aplicada(p_id uuid,p_objeto_id uuid default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_proj uuid;
begin
  if auth.uid() is null or public.is_agente() or public.is_automacao(null) then raise exception 'Só humano aplica proposta.' using errcode='42501'; end if;
  perform public._travar_modulo_tarefas();
  select project_id into v_proj from public.propostas_agente where id=p_id;
  perform public._aplicar_proposta(p_id,v_proj,p_objeto_id);
end $$;
revoke all on function public._aplicar_proposta(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.marcar_proposta_aplicada(uuid,uuid) from public,anon;
grant execute on function public.marcar_proposta_aplicada(uuid,uuid) to authenticated;

create function public._validar_tarefa(p jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; k text;
begin
  if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>65536 then
    raise exception 'Tarefa deve ser objeto de até 64 KiB.' using errcode='22023'; end if;
  if public.contem_cpf(p::text) then raise exception 'CPF não entra em tarefa.' using errcode='22023'; end if;
  if p ? 'responsavel_id' then raise exception 'O responsável é escolhido pelo admin na revisão.' using errcode='22023'; end if;
  foreach k in array array['titulo','descricao','responsavel','prazo_motivo','chave'] loop
    if p ? k and jsonb_typeof(p->k) not in ('string','null') then
      raise exception 'Campo textual inválido: %',k using errcode='22023'; end if;
    perform public._texto_tarefa_seguro(p->>k);
  end loop;
  if length(p->>'descricao')>10000 or length(p->>'responsavel')>300 or length(p->>'prazo_motivo')>1000
    or length(p->>'chave')>300 then raise exception 'Campo textual excede o limite.' using errcode='22023'; end if;
  if jsonb_typeof(p->'titulo') is distinct from 'string' or length(btrim(p->>'titulo')) not between 1 and 300
    or nullif(p->>'project_id','') is null then raise exception 'Título e projeto obrigatórios.' using errcode='22023'; end if;
  if jsonb_typeof(p->'passos') is distinct from 'array' then raise exception 'Passos devem ser lista.' using errcode='22023'; end if;
  if jsonb_array_length(p->'passos') not between 1 and 50 then raise exception 'Use de 1 a 50 passos.' using errcode='22023'; end if;
  for r in select value from jsonb_array_elements(p->'passos') loop
    if jsonb_typeof(r)<>'object' or jsonb_typeof(r->'descricao') is distinct from 'string'
      or length(btrim(r->>'descricao')) not between 1 and 1000
      or (r ? 'evidencia' and jsonb_typeof(r->'evidencia')<>'object') then
      raise exception 'Passo inválido.' using errcode='22023'; end if;
    if r ? 'quem' and jsonb_typeof(r->'quem') not in ('string','null') then
      raise exception 'Responsável do passo inválido.' using errcode='22023'; end if;
    if length(r->>'quem')>300 then raise exception 'Responsável do passo excede o limite.' using errcode='22023'; end if;
    perform public._texto_tarefa_seguro(coalesce(r->>'descricao','')||coalesce(r->>'quem',''));
  end loop;
  if p ? 'chaves' then
    if jsonb_typeof(p->'chaves')<>'array' then raise exception 'Chaves devem ser lista.' using errcode='22023'; end if;
    if jsonb_array_length(p->'chaves')>100 then raise exception 'Máximo de 100 chaves.' using errcode='22023'; end if;
    for r in select value from jsonb_array_elements(p->'chaves') loop
      if jsonb_typeof(r)<>'object' or coalesce(r->>'tipo','') not in ('thread','centro_custo','pessoa','termo','numero')
        or jsonb_typeof(r->'valor') is distinct from 'string' or length(btrim(r->>'valor')) not between 1 and 300 then
        raise exception 'Chave inválida.' using errcode='22023'; end if;
      perform public._texto_tarefa_seguro(r->>'valor');
    end loop;
  end if;
  perform (p->>'project_id')::uuid;
  perform nullif(p->>'prazo','')::date;
  perform nullif(p->>'proxima_checagem','')::date;
end $$;
create function public._humano_tarefa(p_tarefa uuid,p_decisao boolean default true) returns public.tarefas
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.tarefas;
begin
  if auth.uid() is null or public.is_agente() or public.is_automacao(null) then
    raise exception 'Só humano opera tarefas.' using errcode='42501'; end if;
  perform public._travar_modulo_tarefas();
  select * into t from public.tarefas where id=p_tarefa for update;
  if not found then raise exception 'Tarefa inexistente.' using errcode='22023'; end if;
  if p_decisao and not public.is_admin() then
    raise exception 'Só admin decide tarefas.' using errcode='42501'; end if;
  if not public.is_admin() and t.responsavel_id is distinct from auth.uid() then
    perform public.assert_project_allowed(t.project_id);
  end if;
  return t;
end $$;
create function public._evento_tarefa(p_tarefa uuid,p_chave text,p_tipo text,p_origem text,p_resumo text,
  p_detalhe jsonb default '{}',p_msg text default null,p_thread text default null,p_ocorrido timestamptz default now()) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v uuid;
begin
  perform public._texto_tarefa_seguro(coalesce(p_resumo,'')||coalesce(p_detalhe::text,'')||
    coalesce(p_chave,'')||coalesce(p_msg,'')||coalesce(p_thread,''));
  insert into public.tarefa_eventos(tarefa_id,chave,tipo,origem,resumo,detalhe,gmail_message_id,gmail_thread_id,ocorrido_em)
    values(p_tarefa,p_chave,p_tipo,p_origem,p_resumo,p_detalhe,p_msg,p_thread,p_ocorrido)
    on conflict(chave) do nothing returning id into v;
  if v is not null and p_origem='vigia' and (p_tipo in ('sugestao','alerta_prazo') or
    (p_tipo='mensagem' and (p_detalhe->>'classificacao' in ('exigencia','duvida') or coalesce((p_detalhe->>'precisa_victor')::boolean,false)))) then
    insert into public.vigia_avisos(chave,texto,tipo,tarefa_id)
      values('aviso:'||p_chave,'Há uma tarefa para revisar.',p_tipo,p_tarefa) on conflict do nothing;
  end if;
  return v;
end $$;

-- Atribuição não altera user_projects. O rótulo é um nome, nunca o e-mail.
create function public._nome_responsavel(p_user uuid) returns text
language sql stable security definer set search_path=public,pg_temp as $$
  select left(public._payload_tarefa_publico(to_jsonb(coalesce(nullif(btrim(display_name),''),'Usuário')))#>>'{}',300)
  from public.app_users where user_id=p_user;
$$;
create function public._responsavel_humano() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare papel text;
begin
  if new.responsavel_id is not null then
    select role into papel from public.app_users where user_id=new.responsavel_id for share;
    if papel is null or papel not in ('admin','professor') then
      raise exception 'Responsável deve ser um usuário humano.' using errcode='22023'; end if;
  end if;
  return new;
end $$;
create trigger trg_responsavel_humano before insert or update of responsavel_id on public.tarefas
for each row execute function public._responsavel_humano();

create function public.atribuir_tarefa(p_tarefa uuid,p_user uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.tarefas; nome text;
begin
  t:=public._humano_tarefa(p_tarefa);
  if p_user is not null then
    perform 1 from public.app_users where user_id=p_user and role in ('admin','professor') for share;
    if not found then raise exception 'Responsável deve ser um usuário humano.' using errcode='22023'; end if;
    nome:=public._nome_responsavel(p_user);
  end if;
  update public.tarefas set responsavel_id=p_user,responsavel=nome,atualizada_em=now() where id=t.id;
  perform public._evento_tarefa(t.id,'responsavel:'||gen_random_uuid(),'status','humano',
    'Responsável: '||coalesce(nome,'Sem responsável'));
end $$;

create function public.registrar_feito(p_passo uuid,p_nota text,p_link text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.tarefa_passos; t public.tarefas; nome text; evento uuid;
begin
  select * into s from public.tarefa_passos where id=p_passo;
  t:=public._humano_tarefa(s.tarefa_id,false);
  if not public.is_admin() and t.responsavel_id is distinct from auth.uid() then
    raise exception 'Só o responsável ou admin registra que fez.' using errcode='42501'; end if;
  select * into s from public.tarefa_passos where id=p_passo for update;
  if t.status in ('concluida','cancelada') or s.estado not in ('pendente','sugerido') then
    raise exception 'Passo ou tarefa encerrados.' using errcode='22023'; end if;
  if coalesce(length(btrim(p_nota)),0)=0 or length(p_nota)>2000 then
    raise exception 'Nota obrigatória, até 2000 caracteres.' using errcode='22023'; end if;
  if p_link is not null and (length(p_link)>500 or p_link !~ '^https://[^/[:space:]?#]+[^[:space:]]*$') then
    raise exception 'Link deve começar com https:// e ter até 500 caracteres.' using errcode='22023'; end if;
  nome:=public._nome_responsavel(auth.uid());
  evento:=public._evento_tarefa(t.id,'feito:'||gen_random_uuid(),'sugestao','humano',
    'Feito por '||nome||': '||btrim(p_nota),
    jsonb_build_object('passo_id',s.id,'nota',btrim(p_nota),'link',p_link,'por',nome));
  update public.tarefa_passos set estado='sugerido',evento_id=evento,ultimo_feito_id=evento where id=s.id;
  update public.tarefas set precisa_atencao=true,motivo_atencao=split_part(nome,' ',1)||' registrou um passo; confirmar',
    atualizada_em=now() where id=t.id;
end $$;

-- Só o código necessário ao cartão. Não abre projects nem qualquer dado financeiro.
create function public.centros_das_tarefas(p_ids uuid[]) returns table(tarefa_id uuid,centro_custo text)
language sql stable security definer set search_path=public,pg_temp as $$
  select t.id,p.code from public.tarefas t join public.projects p on p.id=t.project_id
  where auth.uid() is not null and t.id=any(p_ids) and (
    public.is_admin() or t.project_id=any(public.allowed_project_ids()) or
    (t.responsavel_id=auth.uid() and not public.is_agente() and not public.is_automacao(null)));
$$;

create function public.propor_tarefa(p jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.is_agente() then raise exception 'Só agente propõe tarefa.' using errcode='42501'; end if;
  perform public._travar_modulo_tarefas();
  perform public._validar_tarefa(p);
  perform public.assert_project_allowed((p->>'project_id')::uuid);
  return public.criar_proposta('tarefa',(p->>'project_id')::uuid,p->>'titulo',p,null,p->>'chave');
end $$;
create function public.aplicar_proposta_tarefa(p_id uuid,p_responsavel uuid default null) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.propostas_agente; v uuid; s jsonb; passo uuid; i integer:=0;
begin
  if auth.uid() is null or public.is_agente() or public.is_automacao(null) then
    raise exception 'Só admin aplica tarefa.' using errcode='42501'; end if;
  if not public.is_admin() then raise exception 'Só admin aplica tarefa.' using errcode='42501'; end if;
  perform public._travar_modulo_tarefas();
  select * into r from public.propostas_agente where id=p_id for update;
  if not found or r.tipo<>'tarefa' or r.status<>'pendente' then
    raise exception 'Proposta inexistente, de outro tipo ou não pendente.' using errcode='22023'; end if;
  perform public._validar_tarefa(r.payload);
  if r.project_id is distinct from (r.payload->>'project_id')::uuid then raise exception 'Projeto divergente.' using errcode='22023'; end if;
  perform public.assert_project_allowed(r.project_id);
  insert into public.tarefas(project_id,titulo,descricao,responsavel,prazo,prazo_motivo,proxima_checagem,proposta_id)
  values(r.project_id,r.payload->>'titulo',r.payload->>'descricao',r.payload->>'responsavel',
    nullif(r.payload->>'prazo','')::date,r.payload->>'prazo_motivo',nullif(r.payload->>'proxima_checagem','')::date,r.id) returning id into v;
  for s in select value from jsonb_array_elements(r.payload->'passos') loop
    i:=i+1;
    insert into public.tarefa_passos(tarefa_id,ordem,descricao,quem,evidencia)
      values(v,i,s->>'descricao',s->>'quem','{}') returning id into passo;
    insert into public.tarefa_passos_regras(passo_id,evidencia) values(passo,coalesce(s->'evidencia','{}'));
  end loop;
  for s in select value from jsonb_array_elements(coalesce(r.payload->'chaves','[]')) loop
    insert into public.tarefa_chaves values(v,s->>'tipo',s->>'valor') on conflict do nothing;
  end loop;
  perform public._evento_tarefa(v,'criada:'||v,'criada','buriti','Tarefa criada pela revisão humana.');
  if p_responsavel is not null then perform public.atribuir_tarefa(v,p_responsavel); end if;
  update public.propostas_agente set status='aplicada',decidida_por=auth.uid(),decidida_em=now(),objeto_id=v where id=r.id;
  return v;
end $$;

create function public._decidir_passo(p_passo uuid,p_nota text,p_estado text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.tarefa_passos; t public.tarefas; v uuid;
begin
  select * into s from public.tarefa_passos where id=p_passo;
  t:=public._humano_tarefa(s.tarefa_id);
  select * into s from public.tarefa_passos where id=p_passo for update;
  if t.status in ('concluida','cancelada') or s.estado in ('confirmado','dispensado') then
    raise exception 'Passo ou tarefa encerrados.' using errcode='22023'; end if;
  v:=public._evento_tarefa(t.id,'humano:'||gen_random_uuid(),'confirmacao','humano',
    coalesce(nullif(btrim(p_nota),''),'Passo '||p_estado||'.'),jsonb_build_object('passo_id',s.id,'estado',p_estado));
  update public.tarefa_passos set estado=p_estado,evento_id=v,confirmado_por=auth.uid(),confirmado_em=now() where id=s.id;
  update public.tarefas set atualizada_em=now() where id=t.id;
end $$;
create function public.confirmar_passo(p_passo uuid,p_nota text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public._decidir_passo(p_passo,p_nota,'confirmado'); end $$;
create function public.dispensar_passo(p_passo uuid,p_nota text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public._decidir_passo(p_passo,p_nota,'dispensado'); end $$;
create function public.registrar_nota(p_tarefa uuid,p_texto text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public._humano_tarefa(p_tarefa,false);
  if coalesce(length(btrim(p_texto)),0)=0 or length(p_texto)>2000 then raise exception 'Nota obrigatória, até 2000 caracteres.' using errcode='22023'; end if;
  perform public._evento_tarefa(p_tarefa,'nota:'||gen_random_uuid(),'nota','humano',p_texto);
end $$;
create function public._status_tarefa(p_tarefa uuid,p_status text,p_nota text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.tarefas;
begin
  t:=public._humano_tarefa(p_tarefa);
  if (p_status='em_andamento' and t.status not in ('concluida','cancelada'))
    or (p_status<>'em_andamento' and t.status in ('concluida','cancelada')) then
    raise exception 'Transição de tarefa inválida.' using errcode='22023'; end if;
  if p_status='concluida' and exists(select 1 from public.tarefa_passos where tarefa_id=t.id and estado not in ('confirmado','dispensado')) then
    raise exception 'Confirme ou dispense os passos antes de concluir.' using errcode='22023'; end if;
  perform public._evento_tarefa(t.id,'status:'||gen_random_uuid(),'status','humano',
    coalesce(nullif(btrim(p_nota),''),'Tarefa: '||p_status),jsonb_build_object('antes',t.status,'depois',p_status));
  update public.tarefas set status=p_status,concluida_por=case when p_status='concluida' then auth.uid() end,
    concluida_em=case when p_status='concluida' then now() end,precisa_atencao=false,motivo_atencao=null,atualizada_em=now() where id=t.id;
end $$;
create function public.concluir_tarefa(p_tarefa uuid,p_nota text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public._status_tarefa(p_tarefa,'concluida',p_nota); end $$;
create function public.reabrir_tarefa(p_tarefa uuid,p_nota text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public._status_tarefa(p_tarefa,'em_andamento',p_nota); end $$;
create function public.cancelar_tarefa(p_tarefa uuid,p_nota text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public._status_tarefa(p_tarefa,'cancelada',p_nota); end $$;
create function public.atualizar_prazo(p_tarefa uuid,p_prazo date,p_motivo text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.tarefas;
begin
  t:=public._humano_tarefa(p_tarefa);
  if t.status in ('concluida','cancelada') then raise exception 'Tarefa encerrada.' using errcode='22023'; end if;
  perform public._evento_tarefa(t.id,'prazo:'||gen_random_uuid(),'nota','humano',
    coalesce(nullif(btrim(p_motivo),''),'Prazo atualizado.'),jsonb_build_object('antes',t.prazo,'depois',p_prazo));
  update public.tarefas set prazo=p_prazo,prazo_motivo=p_motivo,atualizada_em=now() where id=t.id;
end $$;
create function public.vincular_mensagem(p_msg text,p_tarefa uuid,p_aceitar boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.tarefas; m public.vigia_mensagens;
begin
  t:=public._humano_tarefa(p_tarefa);
  if not public.is_admin() then raise exception 'Só admin revisa mensagens.' using errcode='42501'; end if;
  if p_aceitar is null then raise exception 'Informe a decisão.' using errcode='22023'; end if;
  select * into m from public.vigia_mensagens where gmail_message_id=p_msg for update;
  if not found then raise exception 'Mensagem inexistente.' using errcode='22023'; end if;
  perform public._texto_tarefa_seguro(m.gmail_thread_id);
  insert into public.vigia_vinculos(gmail_message_id,tarefa_id,estado,origem,revisado_por,revisado_em)
    values(p_msg,t.id,case when p_aceitar then 'confirmado' else 'rejeitado' end,'humano',auth.uid(),now())
    on conflict(gmail_message_id,tarefa_id) do update set estado=excluded.estado,origem='humano',revisado_por=auth.uid(),revisado_em=now();
  if p_aceitar then
    insert into public.tarefa_chaves values(t.id,'thread',m.gmail_thread_id) on conflict do nothing;
  end if;
  perform public._evento_tarefa(t.id,'vinculo:'||gen_random_uuid(),'vinculo','humano',
    case when p_aceitar then 'Vínculo confirmado.' else 'Vínculo rejeitado.' end,'{}',p_msg,m.gmail_thread_id);
end $$;
create function public.revisar_mensagem(p_msg text,p_fila text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.is_admin() or public.is_agente() or public.is_automacao(null) then
    raise exception 'Só admin revisa mensagens.' using errcode='42501'; end if;
  perform public._travar_modulo_tarefas();
  if p_fila is null or p_fila not in ('tarefa','esclarecer','rotina') then raise exception 'Fila inválida.' using errcode='22023'; end if;
  update public.vigia_mensagens set fila=p_fila,estado='processada',revisada_por=auth.uid(),revisada_em=now() where gmail_message_id=p_msg;
  if not found then raise exception 'Mensagem inexistente.' using errcode='22023'; end if;
end $$;

create function public._exigir_vigia() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.is_automacao('vigia') then raise exception 'Só vigia ativo.' using errcode='42501'; end if;
end $$;
create function public._validar_lote_vigia(p jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare k text;
begin
  perform public._exigir_vigia();
  if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>1048576 then
    raise exception 'Lote deve ser objeto de até 1 MiB.' using errcode='22023'; end if;
  foreach k in array array['mensagens','alertas','avisos'] loop
    if p ? k then
      if jsonb_typeof(p->k)<>'array' then raise exception '% deve ser lista.',k using errcode='22023'; end if;
      if jsonb_array_length(p->k)>1000 then raise exception 'Lote excede 1000 itens.' using errcode='22023'; end if;
    end if;
  end loop;
end $$;
create function public._vigia_contexto_base() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v jsonb;
begin
  perform public._exigir_vigia();
  select jsonb_build_object('versao',1,
    'cursor',(select ultima_recebida_em from public.vigia_cursor where id=1),
    'ultima_recebida_em',(select ultima_recebida_em from public.vigia_cursor where id=1),
    'tarefas',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'project_id',t.project_id,
      'titulo',t.titulo,'centro',pr.code,'centro_custo',pr.code,'responsavel',t.responsavel,
      'status',t.status,'precisa_atencao',t.precisa_atencao,'prazo',t.prazo,'criada_em',t.criada_em,
      'chaves',coalesce((select jsonb_agg(jsonb_build_object('tipo',c.tipo,'valor',c.valor))
        from public.tarefa_chaves c where c.tarefa_id=t.id),'[]'),
      'passos',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'ordem',s.ordem,
        'descricao',s.descricao,'estado',s.estado,'evidencia',coalesce((select r.evidencia
          from public.tarefa_passos_regras r where r.passo_id=s.id),'{}'::jsonb)) order by s.ordem)
        from public.tarefa_passos s where s.tarefa_id=t.id and s.estado in ('pendente','sugerido')),'[]')) order by t.criada_em)
      from public.tarefas t join public.projects pr on pr.id=t.project_id
      where t.status in ('em_andamento','aguardando_terceiro') and t.project_id is not null),'[]'),
    'mensagens',coalesce((select jsonb_agg(to_jsonb(m) order by m.recebida_em)
      from (select * from public.vigia_mensagens where estado in ('capturada','erro')
        order by recebida_em) m),'[]'),
    'vinculos',coalesce((select jsonb_agg(jsonb_build_object('gmail_message_id',v.gmail_message_id,
      'tarefa_id',v.tarefa_id,'estado',v.estado)) from public.vigia_vinculos v),'[]'),
    'avisos',coalesce((select jsonb_agg(to_jsonb(a)) from public.vigia_avisos a where estado in ('pendente','falhou')),'[]'),
    'ultima_execucao',(select to_jsonb(e) from public.vigia_execucoes e order by iniciada_em desc limit 1)) into v;
  return v;
end $$;
create function public._vigia_capturar_base(p jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare m jsonb; e jsonb; n integer:=0; c timestamptz; v integer; falha boolean;
begin
  perform public._validar_lote_vigia(p);
  perform public._travar_modulo_tarefas();
  e:=p->'execucao';
  if e is not null then
    insert into public.vigia_execucoes(id,iniciada_em,versao)
      values((e->>'id')::uuid,(e->>'iniciada_em')::timestamptz,e->>'versao') on conflict(id) do nothing;
  end if;
  for m in select value from jsonb_array_elements(coalesce(p->'mensagens','[]')) order by value->>'gmail_message_id' loop
    falha:=coalesce((m->>'mascara_falhou')::boolean,false)
      or coalesce(m->>'assunto','')='[Conteúdo retido: máscara falhou]' or coalesce(m->>'motivo','')='mascara_falhou';
    begin
      perform public._texto_tarefa_seguro(coalesce(m->>'assunto','')||coalesce(m->>'trecho',''));
    exception when invalid_parameter_value then falha:=true;
    end;
    insert into public.vigia_mensagens(gmail_message_id,gmail_thread_id,recebida_em,remetente,
      remetente_dominio,assunto,trecho,encaminhada,ocorrido_em,anexos,motivo,mascara_falhou)
      values(m->>'gmail_message_id',m->>'gmail_thread_id',(m->>'recebida_em')::timestamptz,
        case when falha then '[Retido]' else m->>'remetente' end,m->>'remetente_dominio',
        case when falha then '[Conteúdo retido: máscara falhou]' else left(m->>'assunto',1000) end,
        case when falha then '' else left(m->>'trecho',300) end,
        coalesce((m->>'encaminhada')::boolean,false),coalesce((m->>'ocorrido_em')::timestamptz,(m->>'recebida_em')::timestamptz),
        coalesce((m->>'anexos')::integer,0),
        case when falha then 'mascara_falhou' else 'aguarda_processamento' end,falha)
      on conflict(gmail_message_id) do nothing;
    get diagnostics v=row_count; n:=n+v;
    -- Uma recaptura pode reforçar a retenção; nunca pode apagar a falha.
    if falha then
      update public.vigia_mensagens set mascara_falhou=true,remetente='[Retido]',
        assunto='[Conteúdo retido: máscara falhou]',trecho='',motivo='mascara_falhou'
        where gmail_message_id=m->>'gmail_message_id' and not mascara_falhou;
    end if;
  end loop;
  if coalesce((p->>'janela_completa')::boolean,false) then
    c:=(p->>'cursor')::timestamptz;
    if c is null or c>now()+interval '5 minutes' then raise exception 'Cursor inválido.' using errcode='22023'; end if;
    update public.vigia_cursor set ultima_recebida_em=c,atualizada_em=now()
      where id=1 and (ultima_recebida_em is null or ultima_recebida_em<c);
  end if;
  return jsonb_build_object('capturadas',n,'cursor',(select ultima_recebida_em from public.vigia_cursor where id=1));
end $$;

create function public._vigia_registrar_base(p jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare m jsonb; s jsonb; a jsonb; e jsonb; msg public.vigia_mensagens;
  t public.tarefas; passo public.tarefa_passos; v uuid; n integer:=0; ne integer:=0;
  nivel text; eid uuid; aceito boolean; v_estado text;
begin
  perform public._validar_lote_vigia(p);
  perform public._travar_lote_tarefas(p);
  e:=p->'execucao';
  if e is not null then
    eid:=(e->>'id')::uuid;
    perform public._texto_tarefa_seguro(coalesce(e->'erros','[]')::text);
    insert into public.vigia_execucoes(id,iniciada_em,versao)
      values(eid,coalesce((e->>'iniciada_em')::timestamptz,now()),e->>'versao') on conflict(id) do nothing;
  end if;
  for m in select value from jsonb_array_elements(coalesce(p->'mensagens','[]')) loop
    select * into msg from public.vigia_mensagens where gmail_message_id=m->>'gmail_message_id' for update;
    if not found then raise exception 'Capture a mensagem primeiro.' using errcode='22023'; end if;
    if msg.estado='processada' then continue; end if;
    v_estado:=coalesce(m->>'estado','processada');
    if v_estado not in ('capturada','processada','erro') then raise exception 'Estado inválido.' using errcode='22023'; end if;
    if nullif(btrim(m->>'motivo'),'') is null then raise exception 'Motivo obrigatório.' using errcode='22023'; end if;
    perform public._texto_tarefa_seguro(m->>'motivo');
    -- A falha é independente do motivo da tentativa e bloqueia todos os efeitos.
    if msg.mascara_falhou then
      update public.vigia_mensagens set estado=v_estado,tentativas=tentativas+1,
        motivo='mascara_falhou',fila='esclarecer',classificacao=null,confianca=null,modelo=m->>'modelo'
        where gmail_message_id=msg.gmail_message_id;
      if v_estado='processada' then
        insert into public.vigia_avisos(chave,texto,tipo)
          values('aviso:msg:'||msg.gmail_message_id||':esclarecer','Há uma mensagem para revisar.','esclarecer') on conflict do nothing;
      end if;
      n:=n+1; continue;
    end if;
    -- Erro não produz nenhum efeito em tarefa. Continua na próxima execução.
    if v_estado='processada' then
      if m ? 'vinculos' and jsonb_typeof(m->'vinculos')<>'array' then raise exception 'Vínculos inválidos.' using errcode='22023'; end if;
      if m ? 'sugestoes' and jsonb_typeof(m->'sugestoes')<>'array' then raise exception 'Sugestões inválidas.' using errcode='22023'; end if;
      for s in select value from jsonb_array_elements(coalesce(m->'vinculos','[]')) loop
        select * into t from public.tarefas where id=(s->>'tarefa_id')::uuid and project_id is not null for update;
        if not found then raise exception 'Tarefa inexistente.' using errcode='22023'; end if;
        if t.status in ('concluida','cancelada') then continue; end if;
        if msg.recebida_em<t.criada_em then continue; end if;
        insert into public.vigia_vinculos(gmail_message_id,tarefa_id,estado,origem)
          values(msg.gmail_message_id,t.id,'sugerido','vigia') on conflict do nothing;
        select estado<>'rejeitado' into aceito from public.vigia_vinculos
          where gmail_message_id=msg.gmail_message_id and tarefa_id=t.id;
        if not aceito then continue; end if;
        v:=public._evento_tarefa(t.id,'msg:'||msg.gmail_message_id||':tarefa:'||t.id,
          'mensagem','vigia','Mensagem recebida; vínculo a revisar.',
          jsonb_build_object('classificacao',m->>'classificacao','precisa_victor',coalesce((m->>'precisa_victor')::boolean,false)),
          msg.gmail_message_id,msg.gmail_thread_id,msg.ocorrido_em);
        if v is not null then
          ne:=ne+1;
          if m->>'classificacao' in ('exigencia','duvida') or coalesce((m->>'precisa_victor')::boolean,false) then
            update public.tarefas set precisa_atencao=true,motivo_atencao='Mensagem exige revisão humana.',atualizada_em=now() where id=t.id;
          end if;
        end if;
      end loop;
      if m ? 'sugestoes' and jsonb_typeof(m->'sugestoes')<>'array' then raise exception 'Sugestões inválidas.' using errcode='22023'; end if;
      for s in select value from jsonb_array_elements(coalesce(m->'sugestoes','[]')) loop
        select * into t from public.tarefas where id=(s->>'tarefa_id')::uuid and project_id is not null for update;
        if not found then raise exception 'Tarefa inexistente.' using errcode='22023'; end if;
        if t.status in ('concluida','cancelada') or msg.ocorrido_em<t.criada_em or msg.encaminhada or m->>'motivo'='ausencia' then continue; end if;
        if not exists(select 1 from public.vigia_vinculos where gmail_message_id=msg.gmail_message_id
          and tarefa_id=t.id and estado<>'rejeitado') then continue; end if;
        select * into passo from public.tarefa_passos where id=(s->>'passo_id')::uuid and tarefa_id=t.id for update;
        if not found then raise exception 'Passo de outra tarefa ou inexistente.' using errcode='22023'; end if;
        if passo.estado<>'pendente' then continue; end if;
        v:=public._evento_tarefa(t.id,'msg:'||msg.gmail_message_id||':passo:'||passo.id,
          'sugestao','vigia',coalesce(s->>'resumo','Evidência sugerida; aguarda confirmação.'),
          jsonb_build_object('passo_id',passo.id)||coalesce(s->'detalhe','{}'),msg.gmail_message_id,msg.gmail_thread_id,msg.ocorrido_em);
        if v is not null then
          update public.tarefa_passos set estado='sugerido',evento_id=v where id=passo.id and estado='pendente';
          update public.tarefas set precisa_atencao=true,motivo_atencao='Passo sugerido; confirme a evidência.',atualizada_em=now() where id=t.id;
          ne:=ne+1;
        end if;
      end loop;
    end if;
    if v_estado='processada' and m->>'fila'='tarefa' and not exists(
      select 1 from public.vigia_vinculos where gmail_message_id=msg.gmail_message_id and estado<>'rejeitado') then
      m:=m||jsonb_build_object('fila','esclarecer');
    end if;
    update public.vigia_mensagens set estado=v_estado,tentativas=tentativas+1,
      fila=case when revisada_em is null then case when v_estado='processada' then coalesce(m->>'fila','esclarecer') end else fila end,
      motivo=m->>'motivo',classificacao=case when v_estado='processada' then m->>'classificacao' end,
      confianca=case when v_estado='processada' then m->>'confianca' end,modelo=m->>'modelo'
      where gmail_message_id=msg.gmail_message_id;
    if v_estado='processada' and coalesce(m->>'fila','esclarecer')='esclarecer' and msg.revisada_em is null then
      insert into public.vigia_avisos(chave,texto,tipo)
        values('aviso:msg:'||msg.gmail_message_id||':esclarecer','Há uma mensagem para revisar.','esclarecer') on conflict do nothing;
    end if;
    n:=n+1;
  end loop;
  for a in select value from jsonb_array_elements(coalesce(p->'alertas','[]')) loop
    select * into t from public.tarefas where id=(a->>'tarefa_id')::uuid and project_id is not null for update;
    if not found then raise exception 'Tarefa inexistente.' using errcode='22023'; end if;
    if t.status in ('concluida','cancelada') or t.prazo is null or t.prazo is distinct from (a->>'prazo')::date then continue; end if;
    nivel:=case when t.prazo<current_date then 'vencido' when t.prazo=current_date then 'D-0'
      when t.prazo<=current_date+2 then 'D-2' when t.prazo<=current_date+5 then 'D-5' end;
    if nivel is null or nivel is distinct from a->>'nivel' then continue; end if;
    v:=public._evento_tarefa(t.id,'prazo:'||t.id||':'||t.prazo||':'||nivel,'alerta_prazo','vigia',
      coalesce(a->>'resumo','Prazo requer atenção: '||nivel),jsonb_build_object('prazo',t.prazo,'nivel',nivel));
    if v is not null then
      update public.tarefas set precisa_atencao=true,motivo_atencao='Prazo requer atenção: '||nivel,atualizada_em=now() where id=t.id;
      ne:=ne+1;
    end if;
  end loop;
  for a in select value from jsonb_array_elements(coalesce(p->'avisos','[]')) loop
    perform public._texto_tarefa_seguro(coalesce(a->>'texto','')||coalesce(a->>'chave',''));
    v_estado:=coalesce(a->>'estado','pendente');
    if v_estado not in ('pendente','enviado','falhou') then raise exception 'Estado de aviso inválido.' using errcode='22023'; end if;
    insert into public.vigia_avisos(chave,texto) values(a->>'chave',a->>'texto') on conflict do nothing;
    if v_estado<>'pendente' then
      if eid is null then raise exception 'Resultado de aviso exige execução.' using errcode='22023'; end if;
      update public.vigia_avisos set estado=v_estado,tentativas=tentativas+1,ultima_execucao=eid,atualizado_em=now()
        where chave=a->>'chave' and estado<>'enviado' and ultima_execucao is distinct from eid;
    end if;
  end loop;
  if e is not null and e->>'terminada_em' is not null then
    update public.vigia_execucoes set terminada_em=(e->>'terminada_em')::timestamptz,
      mensagens_novas=coalesce((e->>'mensagens_novas')::integer,mensagens_novas),chamadas_modelo=coalesce((e->>'chamadas_modelo')::integer,chamadas_modelo),
      alertas=coalesce((e->>'alertas')::integer,alertas),erros=coalesce(e->'erros','[]'),versao=coalesce(e->>'versao',versao)
      where id=eid and terminada_em is null;
  end if;
  return jsonb_build_object('processadas',n,'eventos',ne);
end $$;
create function public._vigia_expurgar_base() returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
  perform public._exigir_vigia();
  perform public._travar_modulo_tarefas();
  perform 1 from public.vigia_mensagens where recebida_em<now()-interval '90 days'
    and expurgada_em is null order by gmail_message_id for update;
  update public.vigia_mensagens set assunto=null,trecho=null,expurgada_em=now()
    where recebida_em<now()-interval '90 days' and expurgada_em is null;
  get diagnostics n=row_count; return n;
end $$;

-- Fronteira JSON v1. Só estruturas explicitamente projetadas entram no núcleo.
create function public._vigia_timestamp(p text) returns timestamptz
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p is null or p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception 'Use timestamp ISO com offset ou Z.' using errcode='22023'; end if;
  return p::timestamptz;
end $$;
create function public.vigia_contexto() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c jsonb; ultima timestamptz;
begin
  perform public._exigir_vigia();
  c:=public._vigia_contexto_base();
  -- Saúde só pela última checagem concluída: execução só iniciada não conta como ok.
  select max(terminada_em) into ultima from public.vigia_execucoes;
  return c||jsonb_build_object('versao_esquema',1,'cursor_em',c->'cursor','pendentes',c->'mensagens',
    'alertas_emitidos',coalesce((select jsonb_agg(chave) from public.tarefa_eventos where tipo='alerta_prazo'),'[]'),
    'esclarecer',(select count(*) from public.vigia_mensagens where fila='esclarecer'),
    'rotina',(select count(*) from public.vigia_mensagens where fila='rotina'),
    'saude',case when ultima is null then 'indisponivel' when ultima<now()-interval '2 hours' then 'atrasado' else 'ok' end);
end $$;
create function public.vigia_capturar(p jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; j jsonb; inicio timestamptz; fim timestamptz; m jsonb; ids jsonb;
  cursor_atual timestamptz; primeira timestamptz;
begin
  perform public._validar_lote_vigia(p);
  perform public._travar_modulo_tarefas();
  select ultima_recebida_em into cursor_atual from public.vigia_cursor where id=1 for update;
  j:=p->'janela';
  if jsonb_typeof(j) is distinct from 'object' or jsonb_typeof(j->'completa') is distinct from 'boolean' then
    raise exception 'Informe janela e completude.' using errcode='22023'; end if;
  inicio:=public._vigia_timestamp(j->>'inicio'); fim:=public._vigia_timestamp(j->>'fim');
  if inicio is null or fim is null or fim<inicio or fim>now()+interval '5 minutes' then
    raise exception 'Janela inválida.' using errcode='22023'; end if;
  if p->>'execucao_id' is not null and not exists(select 1 from public.vigia_execucoes where id=(p->>'execucao_id')::uuid) then
    raise exception 'Execução inexistente.' using errcode='22023'; end if;
  if cursor_atual is null then
    if jsonb_typeof(j->'primeira_carga') is distinct from 'boolean' or j->>'primeira_carga'<>'true'
      or p->>'execucao_id' is null then
      raise exception 'Primeira carga exige janela.primeira_carga=true e execução registrada.' using errcode='22023'; end if;
    select iniciada_em into primeira from public.vigia_execucoes where id=(p->>'execucao_id')::uuid;
    if inicio>primeira-interval '1 day' or fim<primeira then
      raise exception 'Primeira carga deve cobrir pelo menos o dia anterior ao início da execução.' using errcode='22023'; end if;
  elsif inicio>cursor_atual-interval '1 day' then
    raise exception 'Janela exige sobreposição de um dia com o cursor atual.' using errcode='22023';
  end if;
  for m in select value from jsonb_array_elements(coalesce(p->'mensagens','[]')) loop
    if jsonb_typeof(m)<>'object' or jsonb_typeof(m->'gmail_message_id') is distinct from 'string'
      or jsonb_typeof(m->'gmail_thread_id') is distinct from 'string' then raise exception 'IDs inválidos.' using errcode='22023'; end if;
    if public._vigia_timestamp(m->>'recebida_em')>now()+interval '5 minutes' then raise exception 'Data futura inválida.' using errcode='22023'; end if;
    if m->>'ocorrido_em' is not null then perform public._vigia_timestamp(m->>'ocorrido_em'); end if;
  end loop;
  r:=public._vigia_capturar_base(jsonb_build_object('mensagens',coalesce(p->'mensagens','[]'),
    'cursor',fim,'janela_completa',j->'completa'));
  select coalesce(jsonb_agg(m.gmail_message_id order by m.recebida_em),'[]') into ids
    from public.vigia_mensagens m where m.estado in ('capturada','erro')
      and exists(select 1 from jsonb_array_elements(coalesce(p->'mensagens','[]')) x where x->>'gmail_message_id'=m.gmail_message_id);
  return jsonb_build_object('processar_ids',ids,'mensagens_novas',r->'capturadas','cursor_em',r->'cursor');
end $$;

create function public.vigia_registrar(p jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare e jsonb; r jsonb; m jsonb; x jsonb; y jsonb; a jsonb; v jsonb; b jsonb;
  mensagens jsonb:='[]'; alertas jsonb:='[]'; links jsonb; sugestoes jsonb;
  eid uuid; chave text; tarefa uuid; passo uuid; aviso public.vigia_avisos; dia date; k text;
begin
  perform public._validar_lote_vigia(p);
  perform public._travar_modulo_tarefas();
  foreach k in array array['resultados','eventos','avisos_resultados'] loop
    if p ? k then
      if jsonb_typeof(p->k)<>'array' then raise exception '% deve ser lista.',k using errcode='22023'; end if;
      if jsonb_array_length(p->k)>1000 then raise exception 'Máximo de 1000 itens por lista.' using errcode='22023'; end if;
    end if;
  end loop;
  if p ? 'mensagens' or p ? 'alertas' or p ? 'avisos' then raise exception 'Use o contrato v1: resultados/eventos/avisos_resultados.' using errcode='22023'; end if;
  e:=p->'execucao';
  if e is not null and e<>'null'::jsonb then
    if jsonb_typeof(e)<>'object' then raise exception 'Execução inválida.' using errcode='22023'; end if;
    eid:=coalesce((e->>'id')::uuid,gen_random_uuid());
    if e->>'iniciada_em' is not null and public._vigia_timestamp(e->>'iniciada_em')>now()+interval '5 minutes' then
      raise exception 'Início futuro inválido.' using errcode='22023'; end if;
    if e->>'terminada_em' is not null and public._vigia_timestamp(e->>'terminada_em')>now()+interval '5 minutes' then
      raise exception 'Fim futuro inválido.' using errcode='22023'; end if;
    if not exists(select 1 from public.vigia_execucoes where id=eid) then
      if e->>'iniciada_em' is null then raise exception 'Registre o início da execução.' using errcode='22023'; end if;
      insert into public.vigia_execucoes(id,iniciada_em,tipo,versao)
        values(eid,(e->>'iniciada_em')::timestamptz,coalesce(e->>'tipo','checagem'),p->>'versao');
    end if;
    if e ? 'erros' then
      if jsonb_typeof(e->'erros')<>'array' then raise exception 'Erros devem ser lista de códigos.' using errcode='22023'; end if;
      for x in select value from jsonb_array_elements(e->'erros') loop
        if jsonb_typeof(x)<>'object' or coalesce(x->>'codigo','') !~ '^[a-z0-9_]{1,100}$'
          or exists(select 1 from jsonb_object_keys(x) keys(error_key) where keys.error_key not in ('codigo','gmail_message_id')) then
          raise exception 'Erro técnico deve conter somente código e ID.' using errcode='22023'; end if;
        perform public._texto_tarefa_seguro(x::text);
      end loop;
    end if;
    e:=e||jsonb_build_object('id',eid,'versao',p->>'versao');
  else e:=null;
  end if;
  for r in select value from jsonb_array_elements(coalesce(p->'resultados','[]')) loop
    m:=r->'registro_mensagem'; links:='[]'; sugestoes:='[]';
    if jsonb_typeof(m) is distinct from 'object' then raise exception 'Registro de mensagem obrigatório.' using errcode='22023'; end if;
    foreach k in array array['vinculos','eventos','passos_sugeridos'] loop
      if r ? k then
        if jsonb_typeof(r->k)<>'array' then raise exception 'Lista inválida: %',k using errcode='22023'; end if;
        if jsonb_array_length(r->k)>100 then raise exception 'Máximo de 100 efeitos por mensagem.' using errcode='22023'; end if;
      end if;
    end loop;
    for x in select value from jsonb_array_elements(coalesce(r->'vinculos','[]')) loop
      if x->>'gmail_message_id' is distinct from m->>'gmail_message_id'
        or coalesce(x->>'estado','sugerido') not in ('sugerido','confirmado') then
        raise exception 'Vínculo inválido.' using errcode='22023'; end if;
      tarefa:=(x->>'tarefa_id')::uuid;
      if tarefa is null then raise exception 'Projeto/tarefa obrigatórios.' using errcode='22023'; end if;
      if x->>'estado'='confirmado' and not exists(select 1 from public.vigia_vinculos
        where gmail_message_id=m->>'gmail_message_id' and tarefa_id=tarefa and estado='confirmado') then continue; end if;
      links:=links||jsonb_build_array(jsonb_build_object('tarefa_id',tarefa));
    end loop;
    -- Conferir as chaves declaradas; não aceitar eventos de status/confirmação.
    for x in select value from jsonb_array_elements(coalesce(r->'eventos','[]')) loop
      tarefa:=(x->>'tarefa_id')::uuid;
      if x->>'tipo'='sugestao' then
        passo:=(x->'detalhe'->>'passo_id')::uuid;
        chave:='msg:'||(m->>'gmail_message_id')||':passo:'||passo;
      elsif x->>'tipo'='mensagem' then
        chave:='msg:'||(m->>'gmail_message_id')||':tarefa:'||tarefa;
      else raise exception 'Vigia só registra mensagem/sugestão nesta lista.' using errcode='22023'; end if;
      if tarefa is null or chave is null or x->>'chave' is distinct from chave
        or x->>'gmail_message_id' is distinct from m->>'gmail_message_id' then
        raise exception 'Chave de evento inválida.' using errcode='22023'; end if;
      perform public._texto_tarefa_seguro(coalesce(x->'detalhe'->>'trecho',''));
    end loop;
    for x in select value from jsonb_array_elements(coalesce(r->'passos_sugeridos','[]')) loop
      tarefa:=(x->>'tarefa_id')::uuid; passo:=(x->>'passo_id')::uuid;
      chave:='msg:'||(m->>'gmail_message_id')||':passo:'||passo;
      if tarefa is null or passo is null or x->>'estado' is distinct from 'sugerido' or x->>'evento_chave' is distinct from chave then
        raise exception 'Vigia só sugere passo com chave canônica.' using errcode='22023'; end if;
      select value into y from jsonb_array_elements(coalesce(r->'eventos','[]'))
        where value->>'chave'=chave and value->>'tipo'='sugestao' and (value->>'tarefa_id')::uuid=tarefa;
      if y is null then raise exception 'Sugestão exige seu evento.' using errcode='22023'; end if;
      sugestoes:=sugestoes||jsonb_build_array(jsonb_build_object('tarefa_id',tarefa,'passo_id',passo,
        'resumo','Evidência sugerida; aguarda confirmação humana.',
        'detalhe',jsonb_build_object('trecho',y->'detalhe'->>'trecho')));
    end loop;
    if m->>'motivo'='ausencia' then m:=m||jsonb_build_object('classificacao','informativo'); end if;
    mensagens:=mensagens||jsonb_build_array(m||jsonb_build_object('vinculos',links,'sugestoes',sugestoes,'precisa_victor',coalesce((r->>'precisa_victor')::boolean,false)));
  end loop;
  for x in select value from jsonb_array_elements(coalesce(p->'eventos','[]')) loop
    tarefa:=(x->>'tarefa_id')::uuid;
    chave:='prazo:'||tarefa||':'||(x->'detalhe'->>'prazo')||':'||(x->'detalhe'->>'nivel');
    if tarefa is null or chave is null or x->>'tipo' is distinct from 'alerta_prazo' or x->>'chave' is distinct from chave then
      raise exception 'Alerta de prazo inválido.' using errcode='22023'; end if;
    alertas:=alertas||jsonb_build_array(jsonb_build_object('tarefa_id',tarefa,'prazo',x->'detalhe'->>'prazo','nivel',x->'detalhe'->>'nivel'));
  end loop;
  b:=jsonb_build_object('mensagens',mensagens,'alertas',alertas);
  if e is not null then b:=b||jsonb_build_object('execucao',e); end if;
  v:=public._vigia_registrar_base(b);
  if p->'resumo_diario' is not null and p->'resumo_diario'<>'null'::jsonb then
    a:=p->'resumo_diario'; dia:=(a->>'dia')::date;
    if dia is null or a->>'chave' is distinct from 'resumo:'||dia then raise exception 'Resumo diário inválido.' using errcode='22023'; end if;
    insert into public.vigia_avisos(chave,texto,tipo,dia)
      values(a->>'chave','Resumo diário disponível.','resumo_diario',dia) on conflict do nothing;
  end if;
  if e is not null and jsonb_array_length(coalesce(e->'erros','[]'))>0 then
    insert into public.vigia_avisos(chave,texto,tipo)
      values('saude:'||eid,'A checagem requer revisão.','saude') on conflict do nothing;
  end if;
  for a in select value from jsonb_array_elements(coalesce(p->'avisos_resultados','[]')) order by value->>'chave' loop
    if coalesce(a->>'estado','') not in ('enviado','falhou') or (a ? 'canal' and coalesce(a->>'canal','') not in ('ntfy','email'))
      or (a ? 'motivo' and coalesce(a->>'motivo','') not in ('sem_canal','envio_falhou')) then
      raise exception 'Resultado de envio inválido.' using errcode='22023'; end if;
    select * into aviso from public.vigia_avisos va where va.chave=a->>'chave' for update;
    if not found then raise exception 'Aviso inexistente.' using errcode='22023'; end if;
    if aviso.estado='enviado' or (eid is not null and aviso.ultima_execucao=eid) then continue; end if;
    update public.vigia_avisos va set estado=a->>'estado',tentativas=va.tentativas+1,ultima_execucao=eid,
      canal=a->>'canal',motivo=a->>'motivo',atualizado_em=now()
      where va.chave=aviso.chave;
  end loop;
  return v||jsonb_build_object('execucao_id',eid,'avisos',coalesce((select jsonb_agg(jsonb_build_object(
    'chave',a.chave,'tipo',a.tipo,'tarefa_id',a.tarefa_id,'dia',a.dia) order by a.criado_em)
    from public.vigia_avisos a where estado in ('pendente','falhou')),'[]'));
end $$;
create function public.vigia_expurgar() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public._exigir_vigia();
  return jsonb_build_object('mensagens_expurgadas',public._vigia_expurgar_base());
end $$;

-- ACL de funções: internas fechadas até para authenticated.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as assinatura,p.proname from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname = any(array[
    'is_automacao','set_automacao','_proteger_identidade_automacao','_bloquear_financeiro_automacao',
    '_travar_modulo_tarefas','_travar_lote_tarefas','_payload_tarefa_publico','listar_propostas_tarefa_seguras',
    '_nome_responsavel','_responsavel_humano','atribuir_tarefa','registrar_feito','centros_das_tarefas',
    '_eventos_imutaveis','_texto_tarefa_seguro','_validar_tarefa','_humano_tarefa','_evento_tarefa',
    '_decidir_passo','_status_tarefa','_exigir_vigia','_validar_lote_vigia','propor_tarefa',
    '_vigia_contexto_base','_vigia_capturar_base','_vigia_registrar_base','_vigia_expurgar_base','_vigia_timestamp',
    'aplicar_proposta_tarefa','confirmar_passo','dispensar_passo','registrar_nota','concluir_tarefa',
    'reabrir_tarefa','cancelar_tarefa','atualizar_prazo','vincular_mensagem','revisar_mensagem',
    'vigia_contexto','vigia_capturar','vigia_registrar','vigia_expurgar']) loop
    execute format('revoke all on function %s from public, anon, authenticated',f.assinatura);
    if left(f.proname,1)<>'_' then execute format('grant execute on function %s to authenticated',f.assinatura); end if;
  end loop;
end $$;

do $$
declare t text; f record; faltam text;
begin
  -- BLOCO 1 da 051, acrescido de conferência da forma exata do gatilho.
  select string_agg(c.relname,', ') into faltam from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and c.relname<>'propostas_agente'
    and not exists(select 1 from pg_trigger g where g.tgrelid=c.oid and g.tgname='trg_bloqueia_agente'
      and g.tgtype=30 and g.tgenabled='O' and g.tgqual is null and g.tgfoid='public.bloqueia_escrita_do_agente()'::regprocedure);
  if faltam is not null then raise exception '054: tabelas sem barreira: %',faltam; end if;
  foreach t in array array['automacoes','tarefas','tarefa_passos','tarefa_passos_regras','tarefa_chaves','tarefa_eventos',
    'vigia_mensagens','vigia_vinculos','vigia_cursor','vigia_execucoes','vigia_avisos'] loop
    if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass)
      or has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      or has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE')
      or not has_table_privilege('authenticated','public.'||t,'SELECT') then
      raise exception '054: RLS/ACL incorretas: %',t; end if;
  end loop;
  for f in select p.oid,p.proname,p.prosecdef,p.proconfig from pg_proc p where p.pronamespace='public'::regnamespace
    and p.proname in ('atribuir_tarefa','registrar_feito','centros_das_tarefas','is_automacao','set_automacao','listar_propostas_tarefa_seguras','propor_tarefa','aplicar_proposta_tarefa','confirmar_passo',
    'dispensar_passo','registrar_nota','concluir_tarefa','reabrir_tarefa','cancelar_tarefa','atualizar_prazo',
    'vincular_mensagem','revisar_mensagem','vigia_contexto','vigia_capturar','vigia_registrar','vigia_expurgar') loop
    if not f.prosecdef or not ('search_path=public, pg_temp'=any(f.proconfig)) or has_function_privilege('anon',f.oid,'EXECUTE') then
      raise exception '054: atributos/ACL incorretos: %',f.proname; end if;
  end loop;
  if exists(select 1 from public.app_users u join public.user_projects s using(user_id) where u.role='automacao') then
    raise exception '054: automação possui escopo.'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='propostas_agente'
    and policyname='tarefa_payload_restrito' and permissive='RESTRICTIVE')
    or has_function_privilege('authenticated','public._aplicar_proposta(uuid,uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public._payload_tarefa_publico(jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public._travar_modulo_tarefas()','EXECUTE')
    or has_function_privilege('authenticated','public._travar_lote_tarefas(jsonb)','EXECUTE') then
    raise exception '054: payload bruto ou helpers internos expostos.'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='scholarship_holders'
    and policyname='Automação não lê bolsistas' and permissive='RESTRICTIVE')
    or not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
      and policyname='automacao_sem_storage' and permissive='RESTRICTIVE')
    or pg_get_functiondef('public.bolsistas_nomes(uuid[],text)'::regprocedure) not like '%not public.is_automacao(null)%' then
    raise exception '054: barreira de privacidade da automação ausente.'; end if;
end $$;
commit;

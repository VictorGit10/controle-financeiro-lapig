-- ============================================================================
-- 041_drive_folder_e_auditoria.sql
--
-- Três coisas, todas ADITIVAS: nenhuma função existente é redefinida, nenhuma
-- coluna é removida, nenhuma policy é trocada. É de propósito — ver a nota
-- sobre `save_project` na seção B.
--
--   (A) Coluna `projects.drive_folder_url` + índice único em `projects.code`.
--   (B) Duas RPCs estreitas: `set_project_drive_folder` e `set_project_code`.
--   (C) Triggers de auditoria nas 6 tabelas que ainda não tinham.
--
-- MOTIVAÇÃO (B) — a peça que muda a natureza da garantia. Até aqui, a única
-- coisa entre um script de automação e um estrago era a disciplina de quem
-- escreveu o script: `projects` UPDATE é admin-only no RLS (mig. 033), e o
-- login de admin não é contido por policy nenhuma (`is_admin()` libera tudo,
-- e os guards `assert_project_allowed` das RPCs definer passam direto). Uma
-- rotina que precisasse gravar `code`/`drive_folder_url` teria duas saídas
-- ruins: rodar como admin (alcance = banco inteiro) ou passar pelo
-- `save_project`, que sobrescreve TODAS as colunas que nomeia e portanto zera
-- vigência, notas e `active` de quem chamá-la só para mudar um campo.
--
-- Estas duas RPCs dão a terceira saída: `security definer` + guard
-- `assert_project_allowed`, tocando UMA coluna. Com elas, um login `professor`
-- escopado em `user_projects` consegue rodar a varredura do Drive, e o limite
-- do que ele pode escrever passa a ser imposto pelo BANCO — não importa o que
-- o script diga ou o que uma IA erre. É o mesmo padrão de `save_project` e
-- `apply_reconciliation`, aplicado agora à automação. Ver `docs/acesso-ao-banco.md`.
--
-- ATENÇÃO AO APLICAR: o índice único da seção A **falha** se dois projetos
-- tiverem o mesmo `code`. Isso é o comportamento desejado — o conflito aparece
-- antes de virar dado errado, e o erro nomeia o código repetido. Conferido em
-- 2026-08-26: os 16 códigos cadastrados são distintos.
--
-- POR QUE ESTA MIGRAÇÃO ABRE TRANSAÇÃO e as anteriores não: 035–040 são quase
-- todas `create or replace function`, que não têm como falhar por causa dos
-- dados — reaplicar é inócuo e uma parada no meio não deixa estado inconsistente.
-- Esta tem um passo que PODE falhar contra dado real (o índice único). Sem
-- `begin/commit`, o psql roda em autocommit e uma falha ali deixaria a coluna e
-- as RPCs criadas e o índice não — meio aplicada, sem sinal disso no arquivo.
-- Verificado em container: sem a transação, `drive_folder_url` sobrevive à falha.
-- ============================================================================

begin;


-- ============================================================================
-- (A) Coluna do Drive e unicidade do código
-- ============================================================================

-- URL, não ID. Parece pior, mas pastas de formato antigo (id começando em
-- `0B_…`) exigem `?resourcekey=…` para abrir, e o ID sozinho não basta.
-- Guardar a URL que a API do Drive devolve resolve esse caso e ainda aceita
-- alguém colando um link à mão.
alter table public.projects
  add column if not exists drive_folder_url text;

alter table public.projects
  drop constraint if exists projects_drive_folder_url_check;

alter table public.projects
  add constraint projects_drive_folder_url_check
  check (drive_folder_url is null or drive_folder_url ~ '^https://drive\.google\.com/');

comment on column public.projects.drive_folder_url is
  'URL da pasta do projeto no Google Drive. Preenchida pela varredura ou à mão; '
  'gravada pela RPC set_project_drive_folder. NULL = pasta não vinculada.';

-- Um centro de custo é um só. Sem isso, dois projetos podem reivindicar o
-- mesmo `code` e o auto-match do balancete (plano-trabalho.js:1171) passa a
-- casar com o projeto errado, em silêncio.
--
-- O `30.XXX` fica de fora: é o placeholder literal que o próprio Drive usa
-- para projeto ainda sem centro de custo atribuído (hoje só `Kalungas`, mas
-- nada impede que apareça outro).
drop index if exists public.idx_projects_code_unico;
create unique index idx_projects_code_unico
  on public.projects (code)
  where code is not null and code <> '30.XXX';


-- ============================================================================
-- (B) RPCs estreitas
--
-- Nenhuma delas altera `save_project`. Adicionar um parâmetro lá exigiria
-- `drop function` da assinatura de 9 argumentos primeiro — `create or replace`
-- com lista de argumentos diferente cria uma SOBRECARGA, não uma substituição,
-- e o PostgREST fica ambíguo entre as duas. Mexer numa função da qual o app
-- inteiro depende, só para acrescentar um campo, não paga.
--
-- Efeito colateral bom de não mexer: como `save_project` não nomeia
-- `drive_folder_url`, editar um projeto pela tela de Gestão NÃO apaga o link.
-- ============================================================================

create or replace function public.set_project_drive_folder(
  p_project_id uuid,
  p_url        text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  -- admin passa; professor só nos centros de custo dele
  perform public.assert_project_allowed(p_project_id);

  if p_url is not null and p_url !~ '^https://drive\.google\.com/' then
    raise exception 'URL não é do Google Drive: %', p_url;
  end if;

  update public.projects
     set drive_folder_url = p_url
   where id = p_project_id;

  if not found then
    raise exception 'Projeto não encontrado: %', p_project_id;
  end if;
end;
$$;

comment on function public.set_project_drive_folder is
  'Grava (ou limpa, com NULL) a URL da pasta do Drive de UM projeto. Toca uma '
  'única coluna — ao contrário de save_project, que sobrescreve todas as que nomeia.';


create or replace function public.set_project_code(
  p_project_id uuid,
  p_code       text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  perform public.assert_project_allowed(p_project_id);

  -- Formato do centro de custo FUNAPE: 30.113, 78.215 — ou o placeholder.
  if p_code is not null and p_code !~ '^([0-9]{2}\.[0-9]{3}|30\.XXX)$' then
    raise exception 'Código fora do formato XX.XXX: %', p_code;
  end if;

  update public.projects
     set code = p_code
   where id = p_project_id;

  if not found then
    raise exception 'Projeto não encontrado: %', p_project_id;
  end if;
  -- Colisão com outro projeto levanta unique_violation pelo índice da seção A.
end;
$$;

comment on function public.set_project_code is
  'Grava (ou limpa, com NULL) o código de centro de custo de UM projeto. Toca uma '
  'única coluna. Colisão com outro projeto é barrada por idx_projects_code_unico.';


-- A mig. 035 fechou o schema para `public`/`anon` e pôs `alter default
-- privileges` para que função nova já nasça fechada. Explícito mesmo assim:
-- a 036 registra que atributo de função some em silêncio quando alguém recria.
revoke execute on function public.set_project_drive_folder(uuid, text) from public;
revoke execute on function public.set_project_drive_folder(uuid, text) from anon;
grant  execute on function public.set_project_drive_folder(uuid, text) to authenticated;

revoke execute on function public.set_project_code(uuid, text) from public;
revoke execute on function public.set_project_code(uuid, text) from anon;
grant  execute on function public.set_project_code(uuid, text) to authenticated;


-- ============================================================================
-- (C) Auditoria nas tabelas que faltavam
--
-- O plano é o free, então NÃO há point-in-time recovery: `audit_logs` é a
-- única forma de desfazer um valor sobrescrito. A mig. 023 cobriu 4 tabelas
-- (`projects`, `scholarship_holders`, `scholarships`, `funding_releases`) e a
-- 032 acrescentou `monitoramento`. As 6 abaixo são o resto do que importa.
--
-- DUAS EXCLUSÕES DELIBERADAS:
--
-- 1. `balancete_lancamentos` fica de fora. É a tabela de maior volume (dezenas
--    de linhas por balancete) e é a única totalmente RECONSTRUÍVEL: o PDF de
--    origem está arquivado no bucket `balancete-pdfs` e no Drive, e o parser é
--    determinístico. Auditar dobraria o volume em troca de recuperar o que já
--    se recupera reimportando.
--
-- 2. `conta_rubrica_map`, `app_users` e `user_projects` NÃO PODEM receber este
--    trigger: `audit_trigger_function` (023) faz `rec_id := NEW.id`, e nenhuma
--    das três tem coluna `id` — as PKs são `conta_prefix text`, `user_id` e
--    (`user_id`,`project_id`). Pôr o trigger nelas quebraria toda escrita em
--    runtime, não na criação (plpgsql só resolve o campo ao executar). Auditar
--    as três exige uma segunda função que receba o nome da chave por TG_ARGV;
--    fica registrado como pendência, e não foi feito aqui para manter esta
--    migração aditiva e conferível. `app_users`/`user_projects` são tabelas de
--    permissão — são as que mais mereceriam auditoria.
-- ============================================================================

drop trigger if exists audit_planos_trabalho_trigger on public.planos_trabalho;
create trigger audit_planos_trabalho_trigger
  after insert or update or delete on public.planos_trabalho
  for each row execute function public.audit_trigger_function();

drop trigger if exists audit_plano_rubricas_trigger on public.plano_rubricas;
create trigger audit_plano_rubricas_trigger
  after insert or update or delete on public.plano_rubricas
  for each row execute function public.audit_trigger_function();

drop trigger if exists audit_plano_desembolsos_trigger on public.plano_desembolsos;
create trigger audit_plano_desembolsos_trigger
  after insert or update or delete on public.plano_desembolsos
  for each row execute function public.audit_trigger_function();

drop trigger if exists audit_balancetes_trigger on public.balancetes;
create trigger audit_balancetes_trigger
  after insert or update or delete on public.balancetes
  for each row execute function public.audit_trigger_function();

drop trigger if exists audit_reconciliacoes_trigger on public.reconciliacoes;
create trigger audit_reconciliacoes_trigger
  after insert or update or delete on public.reconciliacoes
  for each row execute function public.audit_trigger_function();

drop trigger if exists audit_rubricas_trigger on public.rubricas;
create trigger audit_rubricas_trigger
  after insert or update or delete on public.rubricas
  for each row execute function public.audit_trigger_function();


-- ============================================================================
-- ASSERÇÃO — reauditoria
--
-- Reexecutável a qualquer momento. Aborta se algo desta migração tiver sido
-- desfeito por uma migração posterior (é exatamente o que a 036 documenta:
-- `create or replace` reescreve atributos junto com o corpo, em silêncio).
-- ============================================================================

do $$
declare
  bad text := '';
  n   int;
begin
  -- (A) coluna, check e índice único
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'projects'
       and column_name = 'drive_folder_url'
  ) then
    bad := bad || E'\n  projects.drive_folder_url não existe';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'projects_drive_folder_url_check'
  ) then
    bad := bad || E'\n  check projects_drive_folder_url_check ausente';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'idx_projects_code_unico'
  ) then
    bad := bad || E'\n  idx_projects_code_unico ausente';
  end if;

  -- (B) as duas RPCs: definer, com search_path, fechadas para anon
  for n in
    select 1 from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('set_project_drive_folder', 'set_project_code')
       and (
            not p.prosecdef
         or p.proconfig is null
         or not (p.proconfig::text like '%search_path%')
       )
  loop
    bad := bad || E'\n  RPC sem security definer ou sem search_path';
  end loop;

  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('set_project_drive_folder', 'set_project_code');
  if n <> 2 then
    bad := bad || E'\n  esperava 2 RPCs novas, encontrei ' || n;
  end if;

  if has_function_privilege('anon', 'public.set_project_drive_folder(uuid,text)', 'execute')
  or has_function_privilege('anon', 'public.set_project_code(uuid,text)', 'execute') then
    bad := bad || E'\n  RPC nova executável por anon';
  end if;

  -- (C) os 6 triggers
  select count(*) into n
    from pg_trigger t
   where not t.tgisinternal
     and t.tgname in (
       'audit_planos_trabalho_trigger', 'audit_plano_rubricas_trigger',
       'audit_plano_desembolsos_trigger', 'audit_balancetes_trigger',
       'audit_reconciliacoes_trigger', 'audit_rubricas_trigger'
     );
  if n <> 6 then
    bad := bad || E'\n  esperava 6 triggers de auditoria novos, encontrei ' || n;
  end if;

  if bad <> '' then
    raise exception 'Migração 041 — reauditoria falhou:%', bad;
  end if;

  raise notice 'Migração 041: OK (coluna, índice único, 2 RPCs, 6 triggers).';
end $$;

commit;

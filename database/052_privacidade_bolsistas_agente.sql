-- ============================================================
-- 052_privacidade_bolsistas_agente.sql
--
-- O BURITI NÃO LÊ CPF NEM E-MAIL DE BOLSISTA.
--
-- A 051 impediu o agente de GRAVAR; esta impede de LER dado pessoal.
-- A policy "Escopo lê bolsistas" (033) entrega a LINHA INTEIRA de
-- scholarship_holders — cpf e email inclusive — de quem tem bolsa nos
-- centros do agente. O consultar_bolsas do MCP pede só full_name, mas
-- isso é disciplina do adaptador: o agente tem a própria credencial
-- (ambiente do processo, ~/.claude.json) e um modelo que vá direto ao
-- REST — por iniciativa ou induzido por prompt injection num e-mail —
-- lê CPF. A barreira tem de ser do banco.
--
-- Inventário do que carrega dado pessoal e o que acontece com cada um:
--   • scholarship_holders.cpf/.email ........ (A) linha fechada ao agente
--   • app_users.email ........................ já só o próprio perfil (033)
--   • audit_logs ............................. já admin-only
--   • scholarship_audit.details .............. só contagens
--   • reconciliacoes.resumo .................. só contagens
--   • v_scholarship_timeline ................. security_invoker → herda (A):
--                                              para o agente volta vazia
--   • storage bolsa-planilhas ................ (C) planilha da FUNAPE TEM CPF
--   • storage plano-trabalho-docs ............ (C) plano às vezes traz roster
--                                              com CPF (ver plano-so-rubricas)
--   • propostas_agente ....................... (D) o agente não pode copiar
--                                              CPF para dentro de uma proposta
--
-- (A) Policy RESTRITIVA de SELECT em scholarship_holders: `not is_agente()`.
--     RLS é por linha, não por coluna — e GRANT por coluna não serve,
--     porque humano e agente usam o mesmo papel `authenticated` e o
--     humano precisa do CPF na conciliação. Então a linha inteira some
--     para o agente; o nome volta por (B).
--
-- (B) RPC `bolsistas_nomes(p_ids, p_busca)` → (id, full_name), e nada
--     mais. security definer (precisa passar por cima de (A)) com o
--     escopo da policy de leitura da 033 refeito DENTRO dela. Não é
--     view: view definer reabriria o alerta do Linter que a 018 fechou,
--     e com security_invoker a própria (A) a esvaziaria.
--
-- (C) Storage: policy RESTRITIVA de SELECT confina a leitura do agente
--     aos buckets `propostas-agente` (dele) e `balancete-pdfs` (sem
--     dado pessoal). Planilha de bolsas e documento de plano, não.
--
-- (D) criar_proposta recusa resumo ou payload com sequência no formato
--     de CPF (11 dígitos, pontuados ou não) que passe no dígito
--     verificador. Defesa contra copiar CPF de um PDF ou e-mail para o
--     sistema; não é a barreira principal (que é (A)/(C)). Corpo da 051
--     + a checagem; atributos repetidos (lição da 036).
--
-- Conferência: tests/sql/test_052_privacidade_bolsistas.sql
-- ============================================================

begin;

-- ------------------------------------------------------------
-- (A) A linha do bolsista some para o agente
-- ------------------------------------------------------------
drop policy if exists "Agente não lê bolsistas" on public.scholarship_holders;
create policy "Agente não lê bolsistas" on public.scholarship_holders
  as restrictive for select to authenticated
  using (not public.is_agente());

-- ------------------------------------------------------------
-- (B) Nome, e só o nome, pelo escopo de sempre
-- ------------------------------------------------------------
create or replace function public.bolsistas_nomes(
  p_ids   uuid[] default null,
  p_busca text   default null
)
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select h.id, h.full_name
    from public.scholarship_holders h
   where (p_ids is null or h.id = any(p_ids))
     and (p_busca is null or h.full_name ilike '%' || p_busca || '%')
     -- o escopo da policy "Escopo lê bolsistas" (033), refeito aqui
     -- porque a função é definer e passa por cima do RLS
     and (
       public.is_admin()
       or h.created_by = auth.uid()
       or exists (
         select 1 from public.scholarships s
          where s.holder_id = h.id
            and s.project_id = any(public.allowed_project_ids())
       )
     )
   order by h.full_name
   limit 1000;
$$;

comment on function public.bolsistas_nomes is
  'Id e nome dos bolsistas visíveis ao chamador (escopo da 033), sem CPF nem e-mail. É como o agente (mig. 052) — que não lê scholarship_holders — obtém nomes.';

-- ------------------------------------------------------------
-- (C) Storage: o agente só lê o bucket dele e os balancetes
-- ------------------------------------------------------------
drop policy if exists agente_le_so_buckets_sem_pii on storage.objects;
create policy agente_le_so_buckets_sem_pii on storage.objects
  as restrictive for select to authenticated
  using (not public.is_agente() or bucket_id in ('propostas-agente', 'balancete-pdfs'));

-- ------------------------------------------------------------
-- (D) Nada com cara de CPF dentro de proposta
-- ------------------------------------------------------------
create or replace function public.contem_cpf(p_texto text)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  m   text[];
  d   int[];
  s   int;
  dv1 int;
  dv2 int;
begin
  if p_texto is null then return false; end if;
  -- 11 dígitos, pontuados (000.000.000-00) ou corridos, sem dígito colado
  -- antes ou depois — 12+ dígitos seguidos não é CPF.
  for m in
    select regexp_matches(p_texto, '(?<![0-9])([0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2})(?![0-9])', 'g')
  loop
    d := regexp_split_to_array(regexp_replace(m[1], '[^0-9]', '', 'g'), '')::int[];
    if array_length(d, 1) <> 11 then continue; end if;
    if (select count(distinct x) from unnest(d) x) = 1 then continue; end if;  -- 000…, 111…
    s := 0;
    for i in 1..9 loop s := s + d[i] * (11 - i); end loop;
    dv1 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
    s := 0;
    for i in 1..10 loop s := s + d[i] * (12 - i); end loop;
    dv2 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
    if dv1 = d[10] and dv2 = d[11] then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

comment on function public.contem_cpf is
  'true se o texto tem uma sequência no formato de CPF que passa no dígito verificador (mig. 052).';

create or replace function public.criar_proposta(
  p_tipo         text,
  p_project_id   uuid,
  p_resumo       text,
  p_payload      jsonb default '{}'::jsonb,
  p_arquivo_path text  default null,
  p_chave        text  default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.is_agente() then
    raise exception 'Só o agente cria propostas.' using errcode = '42501';
  end if;
  if p_project_id is not null then
    perform public.assert_project_allowed(p_project_id);
  elsif p_tipo not in ('pergunta', 'aviso') then
    raise exception 'Proposta do tipo % precisa de centro de custo.', p_tipo;
  end if;
  if coalesce(btrim(p_resumo), '') = '' then
    raise exception 'Resumo é obrigatório: é o que o humano lê primeiro.';
  end if;
  if p_arquivo_path is not null
     and split_part(p_arquivo_path, '/', 1) is distinct from p_project_id::text then
    raise exception 'O arquivo da proposta tem de ficar na pasta do centro de custo (%/…).', p_project_id;
  end if;
  -- mig. 052: dado pessoal não entra no sistema por proposta
  if public.contem_cpf(p_resumo) or public.contem_cpf(coalesce(p_payload, '{}'::jsonb)::text) then
    raise exception 'A proposta contém um número com formato de CPF. Dado pessoal não entra em proposta: retire-o e refaça.'
      using errcode = '22023';
  end if;

  -- Refazer a mesma proposta substitui a anterior, não empilha.
  if p_chave is not null then
    update public.propostas_agente
       set status = 'obsoleta'
     where status = 'pendente'
       and tipo = p_tipo
       and project_id is not distinct from p_project_id
       and chave = p_chave;
  end if;

  insert into public.propostas_agente (tipo, project_id, chave, resumo, payload, arquivo_path)
  values (p_tipo, p_project_id, p_chave, p_resumo, coalesce(p_payload, '{}'::jsonb), p_arquivo_path)
  returning id into v_id;
  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- ACL (funções novas nascem fechadas pela 035)
-- ------------------------------------------------------------
revoke all on function public.bolsistas_nomes(uuid[], text) from public, anon;
grant execute on function public.bolsistas_nomes(uuid[], text) to authenticated;
revoke all on function public.contem_cpf(text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- Asserções
-- ------------------------------------------------------------
do $$
begin
  if not public.contem_cpf('fulano 529.982.247-25 x') or not public.contem_cpf('52998224725') then
    raise exception '052: contem_cpf não reconhece um CPF válido.';
  end if;
  if public.contem_cpf('529.982.247-24')                 -- DV errado
     or public.contem_cpf('111.111.111-11')               -- repetido
     or public.contem_cpf('{"saldo": 1107372.93, "conta": "7.1.3.05.01.00042", "red": "71199553"}')
     or public.contem_cpf('529982247250')                 -- 12 dígitos
  then
    raise exception '052: contem_cpf deu falso positivo.';
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'scholarship_holders'
                    and policyname = 'Agente não lê bolsistas' and permissive = 'RESTRICTIVE') then
    raise exception '052: policy restritiva de bolsistas ausente.';
  end if;

  if not exists (select 1 from pg_proc
                  where proname = 'criar_proposta' and pronamespace = 'public'::regnamespace
                    and prosecdef and pg_get_functiondef(oid) like '%contem_cpf%') then
    raise exception '052: criar_proposta não checa CPF (ou perdeu o security definer).';
  end if;
end $$;

commit;

-- ============================================================================
-- 045_rendimento_informativo.sql
--
-- **Quanto daquele saldo é rendimento.** O rendimento tem regra de uso própria
-- (não é dinheiro igual ao repasse), então quem olha o saldo precisa enxergar a
-- composição. Esta migração devolve essa informação ao eixo do saldo, de onde a
-- 043 a tirou sem querer.
--
-- O QUE ESTAVA ERRADO. A 043 acertou a conta e perdeu o componente. O rodapé do
-- balancete traz DUAS linhas:
--
--     SALDO DISPONÍVEL PÓS IR/IOF ESTIMADO S/ REND. APL. FINANCEIRA ==>> R$ ...
--     RENDIMENTO LÍQUIDO APURADO                                   ==>> R$ ...
--
-- e a 043 mapeou a primeira para `initial_balance` e gravou `yield_amount = 0`,
-- porque somar as duas duplicaria (o rendimento já está dentro da primeira).
-- Isso continua certo. O efeito colateral é que o gatilho **não copiava
-- `rendimento_liquido` para lugar nenhum** de `project_balances`, e a aba Saldos
-- só mostra a composição quando `yield_amount > 0` — condição que, depois da
-- 043, só as linhas digitadas antes dela satisfazem. Resultado: toda competência
-- nova nasce sem a composição, e o mesmo vale para o card "Saldo Atual" das abas
-- Projetos, Visão do Projeto e Visão Geral, que leem `projects`.
--
-- O dado nunca saiu do banco — `balancetes.rendimento_liquido` continua lá. O
-- que sumiu foi o caminho até as telas de saldo.
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA COLUNA NOVA, E NÃO `yield_amount`
--
-- Porque `yield_amount` é somado. `saldo = initial_balance + yield_amount` está
-- em `pure-fns.js` (`calcProjectMonthly`), em `calc_project_monthly` e nos 4
-- cards de saldo do frontend. Escrever o rendimento ali reintroduziria
-- exatamente a duplicação que a 043 removeu — e sem barulho nenhum, porque o
-- número continuaria plausível.
--
-- A coluna nova é **informativa por contrato**: entra em legenda, nunca em
-- conta. O nome carrega a regra de propósito (`rendimento_informativo`, não
-- `rendimento_liquido`), porque o próximo a mexer nisto lê o nome antes de ler
-- este cabeçalho. O custo é a mistura pt/en na mesma tabela; vale.
--
-- NULL É "NÃO SEI", NÃO É ZERO. Balancete cujo rodapé não foi lido por inteiro
-- grava NULL, e a tela omite a legenda. Gravar 0 afirmaria "não houve
-- rendimento" — mesma armadilha que a 043 evita ao não gerar saldo a partir de
-- balancete sem `saldo_disponivel`.
--
-- ---------------------------------------------------------------------------
-- POR QUE EM `project_balances` **E** EM `projects`
--
-- A composição tem que percorrer o mesmo caminho que o saldo, senão só a aba
-- Saldos consegue mostrá-la. O saldo vai `balancetes` -> `project_balances`
-- (gatilho da 043) -> `projects` (gatilho `sync_project_balance`, da 017/021) ->
-- `v_project_summary` -> telas. Parar em `project_balances` deixaria Projetos,
-- Visão do Projeto e Visão Geral sem a informação, que é onde o saldo é mais
-- olhado.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRAÇÃO NÃO FAZ
--
--   • Não muda nenhum valor de saldo. `initial_balance` e `yield_amount` saem
--     daqui exatamente como entraram — a asserção final confere isso.
--   • Não mexe em `get_previsto_vs_realizado`. Ele já devolve
--     `rendimento_liquido` do último balancete, e é o eixo da EXECUÇÃO; aqui é o
--     eixo do SALDO, por competência. São perguntas diferentes com respostas
--     iguais no mês corrente, e juntá-las esconderia a diferença.
--   • Não altera `upsert_project_balance`. Acrescentar parâmetro mudaria a
--     assinatura, exigindo drop+recreate e restauração de ACL numa função que a
--     044 já deixou sem EXECUTE (correção pontual pelo SQL Editor). Uma
--     correção manual de saldo preserva o `rendimento_informativo` que o
--     balancete gravou, que é o comportamento certo: quem corrige o total pelo
--     extrato não está corrigindo a origem do rendimento.
--
-- ATENÇÃO AO REAPLICAR: `create or replace` reescreve os ATRIBUTOS junto com o
-- corpo — `security`/`search_path` repetidos nas duas funções abaixo (lição da
-- 036, que já teve de consertar `sync_project_balance` depois de a 021 desfazer
-- a 019). Depende da **043** (`source`, gatilho e `get_balances_for_month`).
--
-- Roteiro: `tests/sql/test_045_rendimento_informativo.sql`.
-- ============================================================================

begin;

-- ── A. As duas colunas ─────────────────────────────────────────────────────
alter table public.project_balances
  add column if not exists rendimento_informativo numeric(14,2);

alter table public.projects
  add column if not exists rendimento_informativo numeric(14,2);

comment on column public.project_balances.rendimento_informativo is
  'Quanto do saldo desta competência é rendimento de aplicação (RENDIMENTO LÍQUIDO '
  'APURADO do balancete). COMPONENTE de initial_balance, NUNCA parcela a somar — '
  'somar reintroduz a duplicação que a mig. 043 removeu. NULL = não informado.';

comment on column public.projects.rendimento_informativo is
  'Espelho de project_balances.rendimento_informativo da competência mais recente, '
  'mantido por sync_project_balance. Legenda, nunca conta. NULL = não informado.';


-- ── B. O gatilho do balancete passa a copiar o rendimento ──────────────────
-- Único ponto que muda: `NEW.rendimento_liquido` entra na coluna nova. O resto
-- do corpo é o da 043, incluindo a regra de conflito ("vence a observação mais
-- recente") e o `yield_amount = 0`.
create or replace function public.sync_balance_from_balancete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  -- Balancete cujo rodapé não foi lido não vira saldo. Gravar 0 aqui seria
  -- afirmar "a conta está zerada", que é a mesma armadilha que a aba Saldos
  -- já evita ao recusar campo vazio.
  if NEW.saldo_disponivel is null or NEW.data_referencia is null then
    return NEW;
  end if;

  insert into public.project_balances (
    project_id, reference_month, reference_year,
    initial_balance, yield_amount, rendimento_informativo,
    balance_date, source, notes
  ) values (
    NEW.project_id,
    extract(month from NEW.data_referencia)::integer,
    extract(year  from NEW.data_referencia)::integer,
    NEW.saldo_disponivel,
    0,                          -- ver "A SEMÂNTICA" no cabeçalho da 043
    NEW.rendimento_liquido,     -- componente informativo; pode ser NULL (mig. 045)
    NEW.data_referencia,
    'balancete',
    'Preenchido pelo balancete de ' || to_char(NEW.data_referencia, 'DD/MM/YYYY') || '.'
  )
  on conflict (project_id, reference_month, reference_year) do update set
    initial_balance        = excluded.initial_balance,
    yield_amount           = excluded.yield_amount,
    rendimento_informativo = excluded.rendimento_informativo,
    balance_date           = excluded.balance_date,
    source                 = excluded.source,
    notes                  = excluded.notes,
    updated_at             = now()
  where project_balances.balance_date is null
     or excluded.balance_date >= project_balances.balance_date;

  return NEW;
end;
$fn$;

comment on function public.sync_balance_from_balancete is
  'Deriva o saldo do projeto do SALDO DISPONÍVEL do balancete, guardando à parte '
  'quanto dele é rendimento (mig. 045). Só sobrescreve a linha do mês se a data do '
  'balancete for igual ou mais recente que a que já está lá.';


-- ── C. O gatilho de project_balances leva a composição até `projects` ──────
-- Corpo da 021 (INSERT + UPDATE + DELETE) com a coluna nova acompanhando as
-- outras três. `security definer` e `search_path` repetidos porque o `create or
-- replace` os apagaria — foi assim que a 021 desfez a 019 (ver a 036).
create or replace function public.sync_project_balance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_project_id uuid;
begin
  v_project_id := coalesce(NEW.project_id, OLD.project_id);

  update public.projects
  set
    initial_balance = (
      select pb.initial_balance
      from public.project_balances pb
      where pb.project_id = v_project_id
      order by pb.reference_year desc, pb.reference_month desc
      limit 1
    ),
    yield_amount = (
      select pb.yield_amount
      from public.project_balances pb
      where pb.project_id = v_project_id
      order by pb.reference_year desc, pb.reference_month desc
      limit 1
    ),
    rendimento_informativo = (
      select pb.rendimento_informativo
      from public.project_balances pb
      where pb.project_id = v_project_id
      order by pb.reference_year desc, pb.reference_month desc
      limit 1
    ),
    balance_date = (
      select pb.balance_date
      from public.project_balances pb
      where pb.project_id = v_project_id
      order by pb.reference_year desc, pb.reference_month desc
      limit 1
    )
  where id = v_project_id;

  -- Se não houver mais registros, zera os campos.
  -- (`rendimento_informativo` volta a NULL, não a 0: sem saldo registrado não
  -- se sabe quanto era rendimento — não se sabe que era nada.)
  if not exists (select 1 from public.project_balances pb where pb.project_id = v_project_id) then
    update public.projects
    set initial_balance = 0, yield_amount = 0,
        rendimento_informativo = null, balance_date = null
    where id = v_project_id;
  end if;

  return coalesce(NEW, OLD);
end;
$fn$;

comment on function public.sync_project_balance is
  'Sincroniza as colunas de saldo em projects com o registro mais recente de '
  'project_balances, inclusive a composição informativa do rendimento (mig. 045). '
  'Suporta INSERT, UPDATE e DELETE.';


-- ── D. get_balances_for_month devolve a composição ─────────────────────────
-- DROP + CREATE, e não `create or replace`: acrescentar coluna ao `returns
-- table` muda o tipo de retorno e o `replace` recusa. Mesmo caminho da 043 —
-- inclusive a restauração explícita da ACL da 035, que o DROP leva junto.
drop function if exists public.get_balances_for_month(integer, integer);

create function public.get_balances_for_month(
  p_month integer,
  p_year  integer
)
returns table (
  id                     uuid,
  project_id             uuid,
  project_name           text,
  project_active         boolean,
  reference_month        integer,
  reference_year         integer,
  initial_balance        numeric,
  yield_amount           numeric,
  rendimento_informativo numeric,
  balance_date           date,
  notes                  text,
  source                 text,
  created_at             timestamptz,
  updated_at             timestamptz
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
begin
  return query
  select
    pb.id,
    p.id as project_id,      -- correção da mig. 042; ver o cabeçalho de lá
    p.name   as project_name,
    p.active as project_active,
    pb.reference_month,
    pb.reference_year,
    pb.initial_balance,
    pb.yield_amount,
    pb.rendimento_informativo,
    pb.balance_date,
    pb.notes,
    pb.source,
    pb.created_at,
    pb.updated_at
  from public.projects p
  left join public.project_balances pb
    on pb.project_id      = p.id
   and pb.reference_month = p_month
   and pb.reference_year  = p_year
  order by p.active desc, p.name;
end;
$fn$;

comment on function public.get_balances_for_month is
  'Retorna todos os projetos visíveis com seus saldos para o mês/ano selecionado. '
  'Projetos sem saldo vêm com os campos do balanço nulos, mas SEMPRE com project_id '
  'preenchido (p.id). `source` diz se o valor foi digitado ou veio do balancete; '
  '`rendimento_informativo` diz quanto do saldo é rendimento (mig. 045).';

-- Restaura a ACL da mig. 035, perdida no DROP acima.
revoke execute on function public.get_balances_for_month(integer, integer) from public, anon;
grant  execute on function public.get_balances_for_month(integer, integer) to authenticated;


-- ── E. v_project_summary carrega a composição para a Visão Geral ───────────
-- `create or replace view` (e não drop+create como fizeram a 018 e a 032):
-- acrescentar coluna NO FIM da lista é permitido pelo replace, e assim os GRANTs
-- da view não são perdidos — evita depender do `alter default privileges` do
-- Supabase para restaurá-los. `security_invoker` é repetido pela mesma razão que
-- os atributos das funções acima: faz parte da definição.
create or replace view public.v_project_summary
  with (security_invoker = true)
as
select
  p.id,
  p.name,
  p.start_date,
  p.end_date,
  p.initial_balance,
  p.yield_amount,
  p.balance_date,
  p.active,
  coalesce(ds.include_in_general, false) as in_general_dashboard,

  -- Total de bolsas ativas
  (select count(*) from public.scholarships s
   where s.project_id = p.id and s.status = 'active') as active_scholarships,

  -- Soma mensal das bolsas ativas hoje
  coalesce((
    select sum(s.amount) from public.scholarships s
    where s.project_id = p.id
      and s.status = 'active'
      and s.start_date <= current_date
      and s.end_date >= current_date
  ), 0) as current_monthly_scholarships,

  -- Total de desembolsos recebidos
  coalesce((
    select sum(fr.amount) from public.funding_releases fr
    where fr.project_id = p.id
  ), 0) as total_funding,

  -- Componente informativo do saldo (mig. 045). Última coluna de propósito:
  -- é o que permite o `create or replace` acima.
  p.rendimento_informativo

from public.projects p
left join public.dashboard_settings ds on ds.project_id = p.id
order by p.active desc, p.name;

comment on view public.v_project_summary is
  'Resumo consolidado de cada projeto com totais calculados.';


-- ── F. Backfill: os balancetes que já viraram saldo ────────────────────────
-- Sem isto a composição só existiria para uploads futuros, e as competências já
-- fechadas ficariam sem — inclusive a atual, que é a que todo mundo olha.
--
-- Só toca linhas `source = 'balancete'`: as digitadas antes da 043 já guardam a
-- composição em `yield_amount`, e sobrescrevê-las apagaria essa informação.
--
-- O `distinct on` é determinístico porque `balancetes` tem `unique (project_id,
-- data_referencia)` desde a mig. 026 — no máximo um documento por data, e o
-- reupload é UPDATE. Sem essa restrição haveria empate a desempatar e o
-- backfill poderia escolher o rendimento de um PDF já corrigido.
update public.project_balances pb
   set rendimento_informativo = origem.rendimento_liquido
  from (
    select distinct on (b.project_id,
                        extract(year  from b.data_referencia),
                        extract(month from b.data_referencia))
           b.project_id,
           extract(month from b.data_referencia)::integer as ref_mes,
           extract(year  from b.data_referencia)::integer as ref_ano,
           b.rendimento_liquido
      from public.balancetes b
     where b.saldo_disponivel is not null
       and b.data_referencia  is not null
     order by b.project_id,
              extract(year  from b.data_referencia),
              extract(month from b.data_referencia),
              b.data_referencia desc
  ) origem
 where pb.project_id      = origem.project_id
   and pb.reference_month = origem.ref_mes
   and pb.reference_year  = origem.ref_ano
   and pb.source          = 'balancete';

-- E leva ao `projects`, que é de onde as telas de saldo leem. O gatilho da
-- seção C só dispara em escrita na tabela, e o UPDATE acima já passou por ele —
-- mas só nas linhas que tocou. Este comando alinha todo mundo, inclusive
-- projeto cuja competência mais recente é uma linha digitada.
--
-- Subconsulta escalar no SET, e não `from lateral (...)`: um LATERAL no FROM de
-- um UPDATE não enxerga a tabela-alvo ("invalid reference to FROM-clause entry").
-- Sem cláusula WHERE de propósito — projeto sem nenhum saldo registrado recebe
-- NULL, que é o valor certo e o mesmo que o gatilho grava no ramo "não há mais
-- registros".
update public.projects p
   set rendimento_informativo = (
     select pb.rendimento_informativo
       from public.project_balances pb
      where pb.project_id = p.id
      order by pb.reference_year desc, pb.reference_month desc
      limit 1
   );


-- ── G. Asserção ────────────────────────────────────────────────────────────
do $chk$
declare
  v_sem_comp  integer;
  v_desalinha integer;
  v_somado    integer;
begin
  -- 1. Toda linha derivada de balancete que TEM rendimento no PDF tem que ter
  --    a composição gravada.
  select count(*) into v_sem_comp
    from public.project_balances pb
    join lateral (
      select b.rendimento_liquido
        from public.balancetes b
       where b.project_id = pb.project_id
         and extract(month from b.data_referencia)::integer = pb.reference_month
         and extract(year  from b.data_referencia)::integer = pb.reference_year
         and b.saldo_disponivel is not null
       order by b.data_referencia desc
       limit 1
    ) ult on true
   where pb.source = 'balancete'
     and ult.rendimento_liquido is not null
     and pb.rendimento_informativo is distinct from ult.rendimento_liquido;

  if v_sem_comp > 0 then
    raise exception '% linha(s) de saldo derivadas de balancete sem o rendimento correspondente.', v_sem_comp;
  end if;

  -- 2. `projects` tem que espelhar a competência mais recente.
  select count(*) into v_desalinha
    from public.projects p
    join lateral (
      select pb.rendimento_informativo
        from public.project_balances pb
       where pb.project_id = p.id
       order by pb.reference_year desc, pb.reference_month desc
       limit 1
    ) ult on true
   where p.rendimento_informativo is distinct from ult.rendimento_informativo;

  if v_desalinha > 0 then
    raise exception 'projects.rendimento_informativo desalinhado em % projeto(s).', v_desalinha;
  end if;

  -- 3. O QUE ESTA MIGRAÇÃO MAIS PRECISA NÃO FAZER: mexer no saldo. Nenhuma
  --    linha derivada de balancete pode ter ganhado `yield_amount`, senão o
  --    rendimento voltou a ser somado e o saldo inflou.
  select count(*) into v_somado
    from public.project_balances
   where source = 'balancete'
     and coalesce(yield_amount, 0) <> 0;

  if v_somado > 0 then
    raise exception '% linha(s) de balancete com yield_amount <> 0 — rendimento voltou a ser somado.', v_somado;
  end if;

  raise notice 'OK: composição do rendimento disponível em project_balances, projects e v_project_summary.';
end $chk$;

commit;

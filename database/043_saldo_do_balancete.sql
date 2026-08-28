-- ============================================================================
-- 043_saldo_do_balancete.sql
--
-- **Um saldo só.** O `SALDO DISPONÍVEL` do balancete passa a alimentar
-- automaticamente `project_balances` — e portanto `projects.initial_balance`,
-- `calc_project_monthly`, o card "Saldo Projetado", o gráfico de Projeção
-- Mensal, o Dashboard e os alertas. Subir o PDF deixa de exigir que alguém
-- redigite o mesmo número na aba Saldos.
--
-- O QUE ESTAVA ERRADO. Não era decisão de projeto, era lacuna: `balancetes`
-- (upload do PDF) e `project_balances` (digitação na aba Saldos) nunca se
-- falaram, e só o segundo chega na projeção. O 30.068 tinha balancete de
-- 03/08/2026 com R$ 1.960.650,04 em conta e projetava a partir de ZERO,
-- exibindo "Saldo Projetado −R$ 126.000,00" com três alertas `danger`.
--
-- ---------------------------------------------------------------------------
-- A SEMÂNTICA, QUE O RODAPÉ DO PDF RESOLVE
--
-- O rótulo completo do campo é:
--
--     SALDO DISPONÍVEL PÓS IR/IOF ESTIMADO S/ REND. APL. FINANCEIRA ==>> R$ ...
--     RENDIMENTO LÍQUIDO APURADO                                   ==>> R$ ...
--
-- O primeiro já é o valor líquido consolidado — inclusive o rendimento, já
-- descontados IR e IOF estimados. O segundo é COMPONENTE dele, informativo, e
-- **não** é parcela a somar. Como o app calcula `saldo = initial_balance +
-- yield_amount`, o mapeamento correto é:
--
--     initial_balance ← saldo_disponivel
--     yield_amount    ← 0                 (somar rendimento_liquido duplicaria)
--     balance_date    ← data_referencia
--
-- Os dois campos separados da aba Saldos continuam fazendo sentido para quem
-- digita olhando um extrato bancário, onde principal e rendimento vêm em
-- linhas distintas. O balancete já entrega a soma pronta.
--
-- ---------------------------------------------------------------------------
-- A REGRA DE CONFLITO: VENCE A OBSERVAÇÃO MAIS RECENTE
--
-- Um mês pode receber um saldo digitado e um balancete. A regra é `balance_date`
-- maior ganha, **independente da origem** — e não "balancete sempre vence".
-- Duas razões:
--
--   • O balancete da FUNAPE sai com semanas de atraso. Quem digitou ontem o
--     saldo do extrato tem número mais fresco que um PDF de três semanas atrás;
--     deixar o documento sobrescrever seria trocar dado bom por dado velho.
--   • Reupload do MESMO balancete (mesma `data_referencia`) tem que propagar
--     correção — por isso a comparação é `>=` e não `>`.
--
-- A coluna `source` registra de onde veio a linha viva, para a aba Saldos poder
-- dizer "veio do balancete" em vez de deixar o campo preenchido sem explicação
-- (quem não sabe a origem redigita — que é justamente o retrabalho a eliminar).
--
-- NOTA POSTERIOR (mig. 044): a digitação foi desativada, então `source =
-- 'manual'` passa a existir só nas linhas antigas (as 10 de mai/2026). A regra
-- de conflito continua valendo — agora entre balancetes: reupload fora de ordem
-- não pode rebobinar o saldo para o de um PDF mais velho.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRAÇÃO NÃO FAZ
--
--   • Não mexe em `get_previsto_vs_realizado` / `get_saldo_livre` / `get_panorama`.
--     Eles leem `balancetes` direto e continuam iguais.
--   • Não trata DELETE de balancete (não existe fluxo de exclusão na interface).
--     O `project_balances` derivado sobreviveria — apagar é manual, pela aba Saldos.
--   • Não resolve a bolsa do mês corrente contada duas vezes (uma dentro do saldo
--     do balancete, outra na projeção). Isso já é o seletor "Desconto de Bolsas"
--     da aba Projetos, que existe exatamente para isso e não mudou de
--     comportamento — a origem do saldo não altera essa escolha.
--
-- ATENÇÃO AO REAPLICAR: `create or replace` reescreve os ATRIBUTOS junto com o
-- corpo — `security`/`search_path` repetidos aqui (lição da 036). Depende da
-- **042** (`get_balances_for_month` devolvendo `p.id`), que esta migração
-- redefine para acrescentar `source`.
--
-- Roteiro: `tests/sql/test_043_saldo_do_balancete.sql`.
-- ============================================================================

begin;

-- ── A. Origem da linha ─────────────────────────────────────────────────────
alter table public.project_balances
  add column if not exists source text not null default 'manual';

do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'chk_project_balances_source'
       and conrelid = 'public.project_balances'::regclass
  ) then
    alter table public.project_balances
      add constraint chk_project_balances_source
      check (source in ('manual', 'balancete'));
  end if;
end $$;

comment on column public.project_balances.source is
  'De onde veio o saldo vivo desta linha: "balancete" (derivado do PDF, mig. 043) '
  'ou "manual" (digitado na aba Saldos). Não é histórico — é a origem do valor atual.';


-- ── B. Balancete → project_balances ────────────────────────────────────────
create or replace function public.sync_balance_from_balancete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Balancete cujo rodapé não foi lido não vira saldo. Gravar 0 aqui seria
  -- afirmar "a conta está zerada", que é a mesma armadilha que a aba Saldos
  -- já evita ao recusar campo vazio.
  if NEW.saldo_disponivel is null or NEW.data_referencia is null then
    return NEW;
  end if;

  insert into public.project_balances (
    project_id, reference_month, reference_year,
    initial_balance, yield_amount, balance_date, source, notes
  ) values (
    NEW.project_id,
    extract(month from NEW.data_referencia)::integer,
    extract(year  from NEW.data_referencia)::integer,
    NEW.saldo_disponivel,
    0,                       -- ver "A SEMÂNTICA" no cabeçalho: não somar rendimento
    NEW.data_referencia,
    'balancete',
    'Preenchido pelo balancete de ' || to_char(NEW.data_referencia, 'DD/MM/YYYY') || '.'
  )
  on conflict (project_id, reference_month, reference_year) do update set
    initial_balance = excluded.initial_balance,
    yield_amount    = excluded.yield_amount,
    balance_date    = excluded.balance_date,
    source          = excluded.source,
    notes           = excluded.notes,
    updated_at      = now()
  where project_balances.balance_date is null
     or excluded.balance_date >= project_balances.balance_date;

  return NEW;
end;
$$;

comment on function public.sync_balance_from_balancete is
  'Deriva o saldo do projeto do SALDO DISPONÍVEL do balancete. Só sobrescreve a '
  'linha do mês se a data do balancete for igual ou mais recente que a que já está lá.';

drop trigger if exists trg_sync_balance_from_balancete on public.balancetes;
create trigger trg_sync_balance_from_balancete
  after insert or update on public.balancetes
  for each row execute function public.sync_balance_from_balancete();


-- ── C. upsert_project_balance marca a linha como manual ────────────────────
-- Sem isto, digitar por cima de uma linha derivada deixaria `source` dizendo
-- "balancete" para um número que uma pessoa escreveu.
create or replace function public.upsert_project_balance(
  p_project_id      uuid,
  p_reference_month integer,
  p_reference_year  integer,
  p_initial_balance numeric default 0,
  p_yield_amount    numeric default 0,
  p_balance_date    date default null,
  p_notes           text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.project_balances
    (project_id, reference_month, reference_year,
     initial_balance, yield_amount, balance_date, notes, source)
  values
    (p_project_id, p_reference_month, p_reference_year,
     p_initial_balance, p_yield_amount, p_balance_date, p_notes, 'manual')
  on conflict (project_id, reference_month, reference_year)
  do update set
    initial_balance = p_initial_balance,
    yield_amount    = p_yield_amount,
    balance_date    = p_balance_date,
    notes           = coalesce(p_notes, project_balances.notes),
    source          = 'manual',
    updated_at      = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.upsert_project_balance is
  'Insere ou atualiza o saldo de um projeto para um mês/ano de referência, marcando-o '
  'como digitado (source = manual). Retorna o ID do registro.';


-- ── D. get_balances_for_month devolve a origem ─────────────────────────────
-- Mantém a correção da 042 (`p.id as project_id`) e acrescenta `source`, para a
-- aba Saldos poder dizer de onde veio o número já preenchido.
--
-- DROP + CREATE, e não `create or replace`: acrescentar coluna ao `returns table`
-- muda o tipo de retorno, e o `replace` recusa ("cannot change return type").
-- Foi o mesmo caminho da mig. 032 com `calc_project_monthly`.
--
-- O DROP LEVA A ACL JUNTO. Diferente do corpo, os GRANTs não sobrevivem a um
-- drop — e é justamente o que a mig. 035 configurou (nada executável por
-- `public`/`anon`, EXECUTE devolvido a `authenticated`). O `alter default
-- privileges` da 035 provavelmente recriaria isso sozinho, mas ele vale para o
-- role que o executou, e apostar nisso é o tipo de suposição silenciosa que a
-- própria 035 existe para não deixar de pé. Os três comandos abaixo do CREATE
-- restauram a ACL explicitamente.
drop function if exists public.get_balances_for_month(integer, integer);

create function public.get_balances_for_month(
  p_month integer,
  p_year  integer
)
returns table (
  id              uuid,
  project_id      uuid,
  project_name    text,
  project_active  boolean,
  reference_month integer,
  reference_year  integer,
  initial_balance numeric,
  yield_amount    numeric,
  balance_date    date,
  notes           text,
  source          text,
  created_at      timestamptz,
  updated_at      timestamptz
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
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
$$;

comment on function public.get_balances_for_month is
  'Retorna todos os projetos visíveis com seus saldos para o mês/ano selecionado. '
  'Projetos sem saldo vêm com os campos do balanço nulos, mas SEMPRE com project_id '
  'preenchido (p.id). `source` diz se o valor foi digitado ou veio do balancete.';

-- Restaura a ACL da mig. 035, perdida no DROP acima.
revoke execute on function public.get_balances_for_month(integer, integer) from public, anon;
grant  execute on function public.get_balances_for_month(integer, integer) to authenticated;


-- ── E. Backfill: balancetes que já estão no banco ──────────────────────────
-- Sem isto a integração só valeria para uploads futuros, e quem já subiu o PDF
-- continuaria tendo que digitar — exatamente o retrabalho que a migração remove.
-- `distinct on` escolhe o balancete mais recente de cada mês; a cláusula do
-- `on conflict` aplica a mesma regra do gatilho e preserva digitação mais nova.
insert into public.project_balances (
  project_id, reference_month, reference_year,
  initial_balance, yield_amount, balance_date, source, notes
)
select distinct on (b.project_id,
                    extract(year  from b.data_referencia),
                    extract(month from b.data_referencia))
  b.project_id,
  extract(month from b.data_referencia)::integer,
  extract(year  from b.data_referencia)::integer,
  b.saldo_disponivel,
  0,
  b.data_referencia,
  'balancete',
  'Preenchido pelo balancete de ' || to_char(b.data_referencia, 'DD/MM/YYYY') || '.'
from public.balancetes b
where b.saldo_disponivel is not null
  and b.data_referencia  is not null
order by b.project_id,
         extract(year  from b.data_referencia),
         extract(month from b.data_referencia),
         b.data_referencia desc
on conflict (project_id, reference_month, reference_year) do update set
  initial_balance = excluded.initial_balance,
  yield_amount    = excluded.yield_amount,
  balance_date    = excluded.balance_date,
  source          = excluded.source,
  notes           = excluded.notes,
  updated_at      = now()
where project_balances.balance_date is null
   or excluded.balance_date >= project_balances.balance_date;


-- ── F. Asserção ────────────────────────────────────────────────────────────
-- Todo balancete legível tem que ter virado saldo, e o saldo vivo do projeto
-- tem que bater com o balancete mais recente dele.
do $$
declare
  v_orfaos    integer;
  v_divergem  integer;
begin
  select count(*) into v_orfaos
    from public.balancetes b
   where b.saldo_disponivel is not null
     and b.data_referencia  is not null
     and not exists (
       select 1 from public.project_balances pb
        where pb.project_id      = b.project_id
          and pb.reference_month = extract(month from b.data_referencia)::integer
          and pb.reference_year  = extract(year  from b.data_referencia)::integer
     );

  if v_orfaos > 0 then
    raise exception '% balancete(s) com saldo não geraram linha em project_balances.', v_orfaos;
  end if;

  -- Confere a ponta final da cadeia: projects.initial_balance é o que a
  -- projeção usa. Só compara onde o balancete mais recente é também o saldo
  -- mais recente do projeto (senão a divergência é legítima — digitação nova).
  select count(*) into v_divergem
    from public.projects p
    join lateral (
      select pb.initial_balance, pb.source
        from public.project_balances pb
       where pb.project_id = p.id
       order by pb.reference_year desc, pb.reference_month desc
       limit 1
    ) ult on true
   where ult.source = 'balancete'
     and p.initial_balance is distinct from ult.initial_balance;

  if v_divergem > 0 then
    raise exception 'projects.initial_balance divergiu do balancete em % projeto(s).', v_divergem;
  end if;

  raise notice 'OK: saldo do balancete propagado até projects.initial_balance.';
end $$;

commit;

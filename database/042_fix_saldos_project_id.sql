-- ============================================================================
-- 042_fix_saldos_project_id.sql
--
-- Uma linha de correção em `get_balances_for_month`: devolver `p.id` como
-- `project_id`, e não `pb.project_id`.
--
-- O BUG. A função monta a aba Saldos com
--
--     from public.projects p
--     left join public.project_balances pb on pb.project_id = p.id and <mês/ano>
--
-- e devolvia `pb.project_id`. Num LEFT JOIN sem par, TODA coluna do lado
-- direito vem nula — inclusive a que era a única identidade da linha. Ou seja:
-- o projeto que ainda NÃO tem saldo naquele mês voltava com `project_id: null`,
-- exatamente o projeto que a tela existe para cadastrar.
--
-- O ESTRAGO NA TELA. `saldos.js` usa `row.project_id` como chave de tudo:
-- `data-project-id` de cada input, o argumento de `markDirty()`, a chave do
-- `dirtyRows` e o `p_project_id` do `upsert_project_balance`. Com o valor nulo,
-- toda linha vazia renderiza `data-project-id="null"` — a MESMA string nas 17
-- linhas — e o salvamento falha de duas maneiras, nenhuma delas dizendo o que
-- houve:
--
--   1. `readNumber()` faz `querySelector('[data-project-id="null"]')`, que casa
--      com a primeira linha vazia da tabela e não com a que a pessoa editou.
--      Digitar o saldo do 12º projeto lê o input vazio do 1º.
--   2. Se o valor lido não for nulo, a RPC recebe a string 'null' onde espera
--      uuid e o Postgres devolve `invalid input syntax for type uuid`.
--
-- O efeito líquido é um ovo-e-galinha: **só dá para editar o saldo de um
-- projeto que já tem saldo naquele mês.** O primeiro saldo de cada projeto
-- nunca pôde ser cadastrado pela interface. As 10 linhas que existem em
-- `project_balances` (todas de mai/2026) entraram por outro caminho.
--
-- POR QUE ISSO NÃO ERA UM BUG DE TELA. `project_balances` é a origem de
-- `projects.initial_balance` (trigger `sync_project_balance`, mig. 017/021), que
-- por sua vez é o ponto de partida de `calc_project_monthly` — e portanto do
-- card "Saldo Projetado", do gráfico de Projeção Mensal, do Dashboard geral e
-- dos alertas `negative_balance` de `get_project_alerts`. Projeto sem saldo
-- cadastrado projeta a partir de ZERO, desconta as bolsas e exibe um saldo
-- negativo grande com alerta `danger`. Foi assim que o 30.068 (CEMPA FAPEG)
-- apareceu com "Saldo Projetado −R$ 126.000,00" no mesmo dia em que o balancete
-- de 03/08/2026 registrava R$ 1.960.650,04 em conta: o balancete alimenta o eixo
-- previsto×realizado (`get_previsto_vs_realizado`, `get_saldo_livre`), nunca
-- `project_balances`. Os dois eixos são independentes de propósito; o que
-- faltava era a tela que preenche o segundo.
--
-- O QUE ESTA MIGRAÇÃO NÃO FAZ. Não faz o upload do balancete gravar em
-- `project_balances`, e não muda a régua dos alertas. **Isso é escopo, não
-- desenho:** o saldo do balancete É o saldo real do projeto, e ter que
-- redigitá-lo na aba Saldos era retrabalho, não uma separação intencional —
-- quem liga os dois é a migração **043**. Esta aqui só conserta o LEFT JOIN, e
-- continua necessária: a aba Saldos segue existindo para projeto e mês sem
-- balancete, e sem `project_id` ela não funciona nem para esses.
--
-- ATENÇÃO AO REAPLICAR: `create or replace function` reescreve os ATRIBUTOS
-- junto com o corpo — `security invoker` e `set search_path` precisam ser
-- repetidos aqui ou se perdem (lição da mig. 036, regressão 021→025/026). A
-- função é `security invoker` desde a 019: quem filtra é o RLS das mig. 033/034,
-- e por isso ela não precisa de guard `assert_project_allowed`. Os GRANTs da
-- mig. 035 sobrevivem ao `create or replace` (ACL não é atributo de corpo).
--
-- Roteiro de conferência: `tests/sql/test_042_saldos_project_id.sql`.
-- ============================================================================

create or replace function public.get_balances_for_month(
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
    pb.id,                 -- continua do balanço: null = "ainda não informado",
                           -- e é o que o frontend lê como `hasBalance`.
    p.id as project_id,    -- <<< a correção: identidade vem do PROJETO, que
                           -- existe em toda linha, e não do LEFT JOIN.
    p.name   as project_name,
    p.active as project_active,
    pb.reference_month,
    pb.reference_year,
    pb.initial_balance,
    pb.yield_amount,
    pb.balance_date,
    pb.notes,
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
  'preenchido (p.id) — é a chave que a aba Saldos usa para cadastrar o primeiro saldo.';

-- ── Asserção: nenhuma linha pode voltar sem project_id ─────────────────────
-- Roda contra o dado real no momento da aplicação. Se algum mês devolver linha
-- com project_id nulo, a correção não pegou e a migração aborta.
do $$
declare
  v_nulos integer;
begin
  select count(*) into v_nulos
    from public.get_balances_for_month(
      extract(month from current_date)::integer,
      extract(year  from current_date)::integer
    )
   where project_id is null;

  if v_nulos > 0 then
    raise exception
      'get_balances_for_month ainda devolve % linha(s) com project_id nulo.', v_nulos;
  end if;

  raise notice 'OK: get_balances_for_month devolve project_id em todas as linhas.';
end $$;

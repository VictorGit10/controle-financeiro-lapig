-- ============================================================
-- Roteiro de conferência da migração 047
--
-- Blocos autossuficientes: o SQL Editor do Supabase não preserva
-- estado entre execuções, então cada bloco resolve o project_id que
-- precisa. Contra o Postgres descartável, rode na ordem:
--
--   stub.sql  ->  stub-047.sql  ->  [BLOCO 0]  ->  047  ->  1..5
--
-- O BLOCO 0 roda ANTES da migração e serve para provar que o defeito
-- existe. Se ele passar depois da 047 aplicada, o roteiro não está
-- medindo nada.
-- ============================================================


-- ------------------------------------------------------------
-- BLOCO 0 — o defeito, ANTES da 047
-- Esperado: c com realizado ZERO, e passagens somada dentro de b.
-- ------------------------------------------------------------
select
  r->>'rubrica_code'                     as rubrica,
  (r->>'previsto')::numeric              as previsto,
  (r->>'realizado')::numeric             as realizado
from public.projects p
cross join lateral jsonb_array_elements(
  public.get_previsto_vs_realizado(p.id) -> 'rubricas'
) as r
where p.code = '30.068-STUB'
  and r->>'rubrica_code' in ('b','c')
order by 1;
-- ANTES:  b realizado = 119337.41  |  c realizado =         0
-- DEPOIS: b realizado =   3050.00  |  c realizado = 116287.41


-- ------------------------------------------------------------
-- BLOCO 1 — a regra entrou e o longest-prefix a escolhe
-- ------------------------------------------------------------
select
  public.resolve_rubrica_for_conta('7.1.3.05.01.00042') as passagens_esperado_c,
  public.resolve_rubrica_for_conta('7.1.3.05.01.00004') as outra_05_esperado_b,
  public.resolve_rubrica_for_conta('7.1.3.05.01.00051') as dao_esperado_dao,
  (select count(*) from public.conta_rubrica_map
    where conta_prefix = '7.1.3.05.01.00042' and rubrica_code = 'c' and ativo) as regra_ativa;
-- Esperado: c | b | dao | 1
-- A 2ª e a 3ª colunas são o ponto: a regra nova é mais específica que
-- 7.1.3.05, então não pode ter arrastado as vizinhas junto.


-- ------------------------------------------------------------
-- BLOCO 2 — nenhum lançamento de passagem ficou para trás
-- ------------------------------------------------------------
select
  count(*) filter (where rubrica_code = 'c')                as em_c,
  count(*) filter (where rubrica_code is distinct from 'c') as fora_de_c
from public.balancete_lancamentos
where conta_codigo like '7.1.3.05.01.00042%';
-- Esperado: fora_de_c = 0


-- ------------------------------------------------------------
-- BLOCO 3 — o detalhe do PLANO chega na resposta
-- `e` tem três linhas; `f` tem duas, uma delas SEM descrição — a sem
-- descrição soma no total mas não vira item.
-- ------------------------------------------------------------
select
  r->>'rubrica_code'                        as rubrica,
  (r->>'previsto')::numeric                 as previsto_total,
  jsonb_array_length(r->'detalhes')         as qtd_detalhes,
  (select sum((d->>'previsto')::numeric)
     from jsonb_array_elements(r->'detalhes') d) as soma_detalhes
from public.projects p
cross join lateral jsonb_array_elements(
  public.get_previsto_vs_realizado(p.id) -> 'rubricas'
) as r
where p.code = '30.068-STUB'
  and r->>'rubrica_code' in ('b','e','f')
order by 1;
-- Esperado: b -> 3 detalhes, soma 174758.77 = previsto_total
--           e -> 3 detalhes, soma  51905.00 = previsto_total
--           f -> 1 detalhe,  soma 1584230.60 < previsto_total 1756641.60
--                (a linha sem descrição não vira item, mas continua no total)


-- ------------------------------------------------------------
-- BLOCO 4 — o detalhe do BALANCETE chega, e é o que torna o
-- defeito (A) visível: dá para ver de qual conta veio cada número.
-- ------------------------------------------------------------
select
  r->>'rubrica_code'          as rubrica,
  c->>'conta_codigo'          as conta,
  c->>'conta_descricao'       as descricao,
  (c->>'realizado')::numeric  as realizado
from public.projects p
cross join lateral jsonb_array_elements(
  public.get_previsto_vs_realizado(p.id) -> 'rubricas'
) as r
cross join lateral jsonb_array_elements(r->'contas') as c
where p.code = '30.068-STUB'
order by 1, 4 desc;
-- Esperado: a conta 7.1.3.05.01.00042 aparece sob `c`, não sob `b`.


-- ------------------------------------------------------------
-- BLOCO 5 — os totais gerais não mudaram
-- Mover passagens de b para c redistribui, não cria nem destrói.
-- ------------------------------------------------------------
select
  sum((r->>'previsto')::numeric)  as previsto_total,
  sum((r->>'realizado')::numeric) as realizado_total
from public.projects p
cross join lateral jsonb_array_elements(
  public.get_previsto_vs_realizado(p.id) -> 'rubricas'
) as r
where p.code = '30.068-STUB';
-- Esperado: idêntico ao que o BLOCO 0 somaria antes da migração —
-- previsto 3868905.37 | realizado 2154430.18

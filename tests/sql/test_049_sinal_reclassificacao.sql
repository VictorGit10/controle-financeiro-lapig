-- ============================================================
-- Roteiro de conferência da migração 049
--
-- Contra o Postgres descartável, rode na ordem:
--
--   stub.sql -> stub-047.sql -> 047 -> stub-049.sql -> [BLOCO 0]
--            -> 049 -> [BLOCO 0 de novo] -> 1..4 -> 049 (2ª vez) -> 1
--
-- O BLOCO 0 roda antes e depois: antes prova que o defeito existe;
-- se ele desse o valor "depois" já na primeira vez, o roteiro não
-- estaria medindo nada. A segunda aplicação da 049 prova que ela é
-- idempotente (nada pode mudar).
--
-- Em produção, troque '30.068-STUB49' pelo código real no editor
-- (não no arquivo) e rode 0 e 3.
-- ============================================================


-- ------------------------------------------------------------
-- BLOCO 0 — realizado e saldo por rubrica
-- ------------------------------------------------------------
select r->>'rubrica_code'           as rubrica,
       (r->>'previsto')::numeric    as previsto,
       (r->>'realizado')::numeric   as realizado,
       (r->>'saldo')::numeric       as saldo
from public.projects p
cross join lateral jsonb_array_elements(
  public.get_previsto_vs_realizado(p.id) -> 'rubricas') as r
where p.code = '30.068-STUB49'
order by 1;
-- ANTES:  b realizado  146414.67 | f realizado 1908868.19 (saldo -152226.59)
-- DEPOIS: b realizado   65157.83 | f realizado 1520362.59 (saldo  236279.01)
--         a.bolsas, c, d, e e dao idênticos antes e depois:
--         1284800.00 | 116287.41 | 67015.70 | 32701.60 | 132595.69


-- ------------------------------------------------------------
-- BLOCO 1 — sinais gravados
-- ------------------------------------------------------------
select
  count(*) filter (where conta_codigo like '7.1.3.%' and conta_descricao ~ '^\(\s*-\s*\)'
                     and saldo_atual > 0)                      as redutora_positiva,
  count(*) filter (where conta_codigo like '7.1.1.08.%' and saldo_atual > 0) as estorno_positivo,
  count(*) filter (where conta_codigo like '7.1.1.01.%' and saldo_atual < 0) as receita_negativa,
  sum(saldo_atual) filter (where conta_codigo like '7.1.3.05.%')             as soma_7135
from public.balancete_lancamentos bl
join public.balancetes b on b.id = bl.balancete_id
join public.projects p on p.id = b.project_id
where p.code = '30.068-STUB49';
-- Esperado: 0 | 0 | 0 | 314560.17  (= conta-mãe 7.1.3.05 impressa no PDF)


-- ------------------------------------------------------------
-- BLOCO 2 — o longest-prefix escolhe as regras novas sem arrastar
-- as vizinhas
-- ------------------------------------------------------------
select
  public.resolve_rubrica_for_conta('7.1.3.50.06.08942') as doacao_f,
  public.resolve_rubrica_for_conta('7.1.3.50.02.94664') as entre_cc_f,
  public.resolve_rubrica_for_conta('7.1.1.08.22.98772') as recup_equip_f,
  public.resolve_rubrica_for_conta('7.1.1.08.50.97012') as adto_import_f,
  public.resolve_rubrica_for_conta('7.1.1.08.20.99553') as recup_serv_b,
  public.resolve_rubrica_for_conta('7.1.3.05.01.00004') as vizinha_b,
  public.resolve_rubrica_for_conta('7.1.1.01.02.96789') as receita_null;
-- Esperado: f | f | f | f | b | b | NULL


-- ------------------------------------------------------------
-- BLOCO 3 — nao_mapeados sem receita
-- ------------------------------------------------------------
select n->>'conta_codigo' as conta, (n->>'saldo_atual')::numeric as valor
from public.projects p
cross join lateral jsonb_array_elements(
  public.get_previsto_vs_realizado(p.id) -> 'nao_mapeados') as n
where p.code = '30.068-STUB49';
-- ANTES:  10 linhas (receitas 7.1.1.01, estornos e doações)
-- DEPOIS: nenhuma linha — no 30.068 tudo o que não é receita tem rubrica


-- ------------------------------------------------------------
-- BLOCO 4 — o total do gasto fecha com o caixa do balancete
-- Entradas (4.491.499,02) − aplicação (1.182.140,96) = 3.309.358,06
-- saíram da conta. Realizado + IR (62.272,91) + perda cambial
-- (22.362,35), que o parser não grava, tem de ficar a poucos
-- milhares disso (contas a pagar do período).
-- ------------------------------------------------------------
select sum((r->>'realizado')::numeric)                          as realizado_total,
       sum((r->>'realizado')::numeric) + 62272.91 + 22362.35   as com_ir_e_cambio,
       3309358.06                                              as saida_de_caixa
from public.projects p
cross join lateral jsonb_array_elements(
  public.get_previsto_vs_realizado(p.id) -> 'rubricas') as r
where p.code = '30.068-STUB49';
-- DEPOIS: realizado_total 3218920.82 | com_ir_e_cambio 3303556.08
--         (diferença de 5.801,98 para a saída de caixa)
-- ANTES dava 3688683.26 — R$ 379 mil a MAIS do que saiu da conta.

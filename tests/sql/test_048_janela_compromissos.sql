-- ============================================================
-- Roteiro de conferência da migração 048
--
-- Contra o Postgres descartável, na ordem:
--   stub.sql -> 038 -> stub-048.sql -> [BLOCO 0] -> 048 -> 1..4
--
-- O BLOCO 0 roda ANTES e prova que o defeito existe. Se passar depois
-- da 048 aplicada, o roteiro não está medindo nada.
--
-- O stub tem 9 bolsas: as 7 reais do 30.068, mais uma ENCERRADA em
-- 31/08 e uma CANCELADA. As duas últimas são sintéticas e existem só
-- para exercitar a parte (B) — por isso os totais do stub são 3.000
-- maiores que os do projeto real (129.000 em vez de 126.000).
-- ============================================================


-- ------------------------------------------------------------
-- BLOCO 0 — o defeito, ANTES da 048
-- ------------------------------------------------------------
select (r->>'compromissos_inicio')            as janela_inicio,
       (r->>'balancete_defasagem_meses')      as defasagem,
       (r->>'compromissos_bolsas')::numeric   as compromissos,
       (g->>'saldo_livre')::numeric           as saldo_livre,
       jsonb_array_length(r->'bolsas_ativas') as qtd_bolsas
from public.projects p
cross join lateral public.get_saldo_livre(p.id) r
cross join lateral jsonb_array_elements(r->'grupos') g
where p.code = '30.068-S048' and g->>'grupo_code' = 'a';
-- ANTES : 2026-09-01 | 0 |  91400 | 92600 | 7
-- DEPOIS: 2026-08-01 | 1 | 129000 | 55000 | 8
--
-- O balancete é de 03/08 — antes do dia 07 —, então a folha de agosto
-- não está nele. Antes da 048 ela também não era compromisso: sumia.


-- ------------------------------------------------------------
-- BLOCO 1 — (A) a janela respeita o dia do pagamento
-- ------------------------------------------------------------
select (r->>'data_referencia')       as balancete,
       (r->>'balancete_cobre_ate')   as cobre_ate,
       (r->>'compromissos_inicio')   as janela_inicio
from public.projects p
cross join lateral public.get_saldo_livre(p.id) r
where p.code = '30.068-S048';
-- Esperado: 2026-08-03 | 2026-07-01 | 2026-08-01
-- Balancete de 03/08 cobre só até julho; compromissos começam em agosto.


-- ------------------------------------------------------------
-- BLOCO 2 — (B) encerrada dentro da janela conta; cancelada nunca
-- ------------------------------------------------------------
select b->>'bolsista'                as bolsista,
       (b->>'valor_mensal')::numeric as mensal,
       (b->>'meses')::int            as meses,
       (b->>'compromisso')::numeric  as compromisso
from public.projects p
cross join lateral public.get_saldo_livre(p.id) r
cross join lateral jsonb_array_elements(r->'bolsas_ativas') b
where p.code = '30.068-S048'
order by 4 desc;
-- Esperado: 8 linhas.
--   "Bolsista Encerrado" aparece com 1 mês (agosto) = 3.000 — o
--   pagamento de 07/08 não está no balancete de 03/08.
--   "Bolsista Cancelado" NÃO aparece: cancelada não gera pagamento.


-- ------------------------------------------------------------
-- BLOCO 3 — (C) a defasagem mede o mês coberto, não o do documento
-- ------------------------------------------------------------
select (r->>'balancete_cobre_ate')           as cobre_ate,
       (r->>'balancete_defasagem_meses')::int as defasagem
from public.projects p
cross join lateral public.get_saldo_livre(p.id) r
where p.code = '30.068-S048';
-- Esperado: 2026-07-01 | 1  (a 038 devolvia 0, escondendo o mês que faltava)


-- ------------------------------------------------------------
-- BLOCO 4 — a regra da janela nos dois lados do dia 07
-- Não depende do stub: é a regra pura.
-- ------------------------------------------------------------
select d::date as data_balancete,
       (case when extract(day from d) > 7
             then date_trunc('month', d)
             else date_trunc('month', d) - interval '1 month' end)::date as cobre_ate
from (values (date '2026-08-01'), (date '2026-08-06'), (date '2026-08-07'),
             (date '2026-08-08'), (date '2026-08-20'), (date '2026-08-31')) as t(d);
-- Esperado: 01,06,07/08 -> cobre até 2026-07-01
--           08,20,31/08 -> cobre até 2026-08-01
-- O dia 07 exato conta como NÃO coberto de propósito: erra para
-- "cabe menos", que é o lado seguro numa decisão de gasto.

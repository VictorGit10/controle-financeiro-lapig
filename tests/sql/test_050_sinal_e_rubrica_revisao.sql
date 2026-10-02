-- ============================================================
-- Roteiro de conferência da migração 050
--
-- Contra o Postgres descartável:
--
--   stub.sql -> stub-047.sql -> 047 -> stub-049.sql -> stub-050.sql
--            -> 049 -> [BLOCO 0] -> 050 -> [BLOCO 0 de novo] -> 1..3
--
-- O BLOCO 0 antes da 050 mostra o defeito que a 049 deixou em produção.
--
-- Em produção, rode o BLOCO 0 (troque '30.111-STUB50' por um código real
-- com pessoal CLT no editor, não no arquivo) antes e depois.
-- ============================================================


-- ------------------------------------------------------------
-- BLOCO 0 — pessoal CLT por rubrica
-- ------------------------------------------------------------
select bl.rubrica_code, sum(bl.saldo_atual) as realizado
from public.balancete_lancamentos bl
join public.balancetes b on b.id = bl.balancete_id
join public.projects p on p.id = b.project_id
where p.code = '30.111-STUB50'
group by 1 order by 1;
-- DEPOIS DA 049 (defeito): a.colab 7338.61 | a.enc  3672.18 | a.outros 1030.16 | b -100.00
-- DEPOIS DA 050:           a.colab 10881.39 | a.enc 3889.88 | a.outros 1030.16 | b -100.00
-- (soma de 7.1.3.01 = 15801.43, o total que o PDF imprime)


-- ------------------------------------------------------------
-- BLOCO 1 — invariante: toda "( - )" de 7.1.3 vale débito − crédito
-- ------------------------------------------------------------
select count(*) filter (where saldo_atual is distinct from valor_debito - valor_credito) as fora_da_regra,
       count(*) filter (where valor_debito = 0 and valor_credito > 0 and saldo_atual >= 0) as redutora_positiva
from public.balancete_lancamentos
where conta_codigo like '7.1.3.%' and conta_descricao ~ '^\(\s*-\s*\)'
  and (valor_debito <> 0 or valor_credito <> 0);
-- Esperado: 0 | 0


-- ------------------------------------------------------------
-- BLOCO 2 — rubrica respondida na revisão é gravada; sem resposta,
-- o gatilho resolve pelo mapa como antes
-- ------------------------------------------------------------
select public.upsert_balancete(jsonb_build_object(
  'project_id', (select id from public.projects where code = '30.111-STUB50'),
  'data_referencia', '2026-10-02',
  'lancamentos', jsonb_build_array(
    -- código cortado, rubrica respondida
    jsonb_build_object('conta_codigo','7.1.3.05.01.97','conta_descricao','CARTAZES/BRINDES',
                       'valor_debito',1400,'valor_credito',0,'saldo_atual',1400,'rubrica_code','e'),
    -- sem resposta: gatilho
    jsonb_build_object('conta_codigo','7.1.3.05.01.00042','conta_descricao','PASSAGENS',
                       'valor_debito',10,'valor_credito',0,'saldo_atual',10),
    -- string vazia equivale a nula
    jsonb_build_object('conta_codigo','7.1.3.05.01.00004','conta_descricao','SERV TECNICOS',
                       'valor_debito',5,'valor_credito',0,'saldo_atual',5,'rubrica_code','')
  )
)) is not null as gravou;

select conta_codigo, rubrica_code
from public.balancete_lancamentos bl
join public.balancetes b on b.id = bl.balancete_id
where b.data_referencia = '2026-10-02'
order by 1;
-- Esperado: 7.1.3.05.01.00004 -> b | 7.1.3.05.01.00042 -> c | 7.1.3.05.01.97 -> e


-- ------------------------------------------------------------
-- BLOCO 3 — rubrica inexistente é recusada (FK)
-- ------------------------------------------------------------
do $$ begin
  perform public.upsert_balancete(jsonb_build_object(
    'project_id', (select id from public.projects where code = '30.111-STUB50'),
    'data_referencia', '2026-10-03',
    'lancamentos', jsonb_build_array(jsonb_build_object(
      'conta_codigo','7.1.3.05.01.97','saldo_atual',1,'rubrica_code','nao-existe'))));
  raise exception 'BLOCO 3 FALHOU: rubrica inexistente foi aceita';
exception when foreign_key_violation then
  raise notice 'BLOCO 3 ok: rubrica inexistente recusada';
end $$;

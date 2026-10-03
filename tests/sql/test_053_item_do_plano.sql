-- ============================================================
-- Roteiro de conferência da migração 053 (item do plano)
--
-- Contra o Postgres descartável, depois de stub-053.sql e da 053.
-- AUTOCONFERIDO: cada bloco aborta (raise) se a garantia não se
-- sustentar; rode com ON_ERROR_STOP e procure "ok" nos NOTICEs.
--
-- A conferência principal (BLOCO 1) é a tabela que o Victor mandou ao
-- professor em 2026-09-30, a partir do balancete do 30.068 de 03/08:
-- o backfill tem de reproduzi-la item por item.
--
-- Em produção, rode o BLOCO 0 (troque o código no editor, não aqui).
-- ============================================================

\set ON_ERROR_STOP on

-- ------------------------------------------------------------
-- BLOCO 0 — realizado por item do balancete mais recente (leitura)
-- ------------------------------------------------------------
select bl.rubrica_code, coalesce(bl.item_descricao, '(sem item)') as item, sum(bl.saldo_atual) as realizado
  from public.balancete_lancamentos bl
  join public.balancetes b on b.id = bl.balancete_id
  join public.projects p on p.id = b.project_id
 where p.code = '30.068' and bl.rubrica_code is not null
   and b.data_referencia = (select max(data_referencia) from public.balancetes where project_id = p.id)
 group by 1, 2 order by 1, 2;

-- ------------------------------------------------------------
-- BLOCO 1 — o backfill reproduz a tabela do professor
-- ------------------------------------------------------------
do $$
declare
  v_proj uuid := (select id from public.projects where code = '30.068');
  r      record;
  v_got  numeric;
  erros  text := '';
begin
  for r in select * from (values
    ('a.bolsas', 'Bolsas',                                                     1284800.00),
    ('b',  'Serviços técnicos especializaos',                                   18396.63),
    ('b',  'Pagamento inscrição para participação de congressos, eventos, simpósios entre outros', 8852.33),
    ('b',  'Manutenção de máquinas e equipamentos',                                  0.00),
    ('c',  'Passagens e Despesas com Locomoção',                               116287.41),
    ('d',  'Despesas com diárias',                                              67015.70),
    ('e',  'Componentes eletronicos Manutenção de máquinas e equipamentos',     23700.00),
    ('e',  'Componentes eletronicos Peças de informática',                       9001.60),
    ('e',  'Impressão de material gráfico para divulgação do CEMPA-Cerrado',      450.00),
    ('f',  'Bens permanentes (clusters e equipamentos)',                      1520362.59),
    ('f',  'Serviços de transporte de equipamentos e taxas de importação',      37458.87),
    ('dao','DAO Funape',                                                       132595.69)
  ) as e(rubrica, item, valor)
  loop
    select coalesce(sum(bl.saldo_atual), 0) into v_got
      from public.balancete_lancamentos bl
      join public.balancetes b on b.id = bl.balancete_id
     where b.project_id = v_proj and bl.rubrica_code = r.rubrica
       and public.norm_item(bl.item_descricao) = public.norm_item(r.item);
    if v_got <> r.valor then
      erros := erros || format(E'\n  %s › %s: %s (esperado %s)', r.rubrica, r.item, v_got, r.valor);
    end if;
  end loop;
  if erros <> '' then raise exception 'BLOCO 1 FALHOU:%', erros; end if;

  -- f total = 1.557.821,46, como na tabela do professor
  select sum(saldo_atual) into v_got from public.balancete_lancamentos bl
    join public.balancetes b on b.id = bl.balancete_id
   where b.project_id = v_proj and bl.rubrica_code = 'f';
  if v_got <> 1557821.46 then raise exception 'BLOCO 1 FALHOU: f total % (esperado 1557821.46)', v_got; end if;
  raise notice 'BLOCO 1 ok: os 12 itens batem com a tabela do professor (f = 1.557.821,46)';
end $$;

-- ------------------------------------------------------------
-- BLOCO 2 — o que ficou sem item é só o que não tem decisão
-- ------------------------------------------------------------
do $$
declare v text;
begin
  select string_agg(bl.conta_codigo, ', ' order by bl.conta_codigo) into v
    from public.balancete_lancamentos bl
    join public.balancetes b on b.id = bl.balancete_id
    join public.projects p on p.id = b.project_id
   where p.code = '30.068' and bl.rubrica_code is not null and bl.item_descricao is null;
  -- tarifa bancária e o estorno dela (somam zero): sem decisão do Victor
  if v is distinct from '7.1.1.08.20.99553, 7.1.3.05.01.00054' then
    raise exception 'BLOCO 2 FALHOU: sem item = %', v;
  end if;
  if exists (select 1 from public.balancete_lancamentos where conta_codigo like '7.1.1.01.%' and (rubrica_code is not null or item_descricao is not null)) then
    raise exception 'BLOCO 2 FALHOU: receita ganhou rubrica ou item';
  end if;
  raise notice 'BLOCO 2 ok: sem item só a tarifa bancária e o estorno dela; receita intocada';
end $$;

-- ------------------------------------------------------------
-- BLOCO 3 — gravação nova: regra, item único, resposta explícita,
-- contradição e item que não existe no plano
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$
declare
  v_proj uuid := (select id from public.projects where code = '30.068');
  v_bal  uuid;
  f text; f_item text;
begin
  v_bal := public.upsert_balancete(jsonb_build_object(
    'project_id', v_proj, 'data_referencia', '2026-09-02',
    'new_item_mappings', jsonb_build_array(jsonb_build_object(
      'conta_prefix', '7.1.3.05.01.00054', 'rubrica_code', 'b', 'item_descricao', 'servicos tecnicos especializaos')),
    'lancamentos', jsonb_build_array(
      -- regra do projeto vence a letra do mapa (frete: b no mapa → f)
      jsonb_build_object('conta_codigo','7.1.3.05.01.00043','saldo_atual',100),
      -- item único
      jsonb_build_object('conta_codigo','7.1.3.05.01.00042','saldo_atual',10),
      -- resposta explícita (cartaz, código cortado) com item
      jsonb_build_object('conta_codigo','7.1.3.05.01.97','saldo_atual',1400,'rubrica_code','e',
                         'item_descricao','Impressão de material gráfico para divulgação do CEMPA-Cerrado'),
      -- resposta explícita que CONTRADIZ a regra: fica a letra respondida, sem item
      jsonb_build_object('conta_codigo','7.1.3.05.01.00069','saldo_atual',5,'rubrica_code','b'),
      -- item que não existe no plano: não é aceito
      jsonb_build_object('conta_codigo','7.1.3.03.01.00009','saldo_atual',7,'rubrica_code','e','item_descricao','Item inventado'),
      -- regra recém-gravada na mesma chamada
      jsonb_build_object('conta_codigo','7.1.3.05.01.00054','saldo_atual',3)
    )));

  select rubrica_code, item_descricao into f, f_item from public.balancete_lancamentos where balancete_id = v_bal and conta_codigo = '7.1.3.05.01.00043';
  if f <> 'f' or f_item <> 'Serviços de transporte de equipamentos e taxas de importação' then
    raise exception 'BLOCO 3 FALHOU: regra não venceu o mapa (% / %)', f, f_item; end if;
  if (select item_descricao from public.balancete_lancamentos where balancete_id = v_bal and conta_codigo = '7.1.3.05.01.00042') is distinct from 'Passagens e Despesas com Locomoção' then
    raise exception 'BLOCO 3 FALHOU: item único não escolhido'; end if;
  if (select item_descricao from public.balancete_lancamentos where balancete_id = v_bal and conta_codigo = '7.1.3.05.01.97') is distinct from 'Impressão de material gráfico para divulgação do CEMPA-Cerrado' then
    raise exception 'BLOCO 3 FALHOU: item respondido não gravado'; end if;
  select rubrica_code, item_descricao into f, f_item from public.balancete_lancamentos where balancete_id = v_bal and conta_codigo = '7.1.3.05.01.00069';
  if f <> 'b' or f_item is not null then
    raise exception 'BLOCO 3 FALHOU: contradição virou % / % (esperado b sem item)', f, f_item; end if;
  if (select item_descricao from public.balancete_lancamentos where balancete_id = v_bal and conta_codigo = '7.1.3.03.01.00009') is not null then
    raise exception 'BLOCO 3 FALHOU: aceitou item inexistente no plano'; end if;
  if (select item_descricao from public.balancete_lancamentos where balancete_id = v_bal and conta_codigo = '7.1.3.05.01.00054') is distinct from 'Serviços técnicos especializaos' then
    raise exception 'BLOCO 3 FALHOU: regra nova (new_item_mappings) não aplicada'; end if;
  raise notice 'BLOCO 3 ok: regra > mapa; item único; resposta explícita; contradição e item inexistente ficam sem item';
end $$;

-- ------------------------------------------------------------
-- BLOCO 4 — Previsto × Realizado por item
-- ------------------------------------------------------------
do $$
declare
  v_proj uuid := (select id from public.projects where code = '30.068');
  j jsonb;
  e jsonb;
begin
  j := public.get_previsto_vs_realizado(v_proj);
  select r into e from jsonb_array_elements(j->'rubricas') r where r->>'rubrica_code' = 'e';
  if (select (d->>'realizado')::numeric from jsonb_array_elements(e->'detalhes') d
       where d->>'descricao' like 'Impressão%') <> 1400 then
    raise exception 'BLOCO 4 FALHOU: realizado por item ausente: %', e->'detalhes';
  end if;
  if (select (d->>'saldo')::numeric from jsonb_array_elements(e->'detalhes') d
       where d->>'descricao' like 'Impressão%') <> 8600 then
    raise exception 'BLOCO 4 FALHOU: saldo por item errado';
  end if;
  if (e->>'realizado_sem_item')::numeric <> 7 then
    raise exception 'BLOCO 4 FALHOU: realizado_sem_item de e = % (esperado 7: o item inventado)', e->>'realizado_sem_item';
  end if;
  raise notice 'BLOCO 4 ok: detalhes trazem previsto, realizado e saldo por item; sem item à parte';
end $$;

-- ------------------------------------------------------------
-- BLOCO 5 — o agente não grava regra de item (barreira da 051)
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
do $$
begin
  begin
    insert into public.conta_item_map (project_id, conta_prefix, rubrica_code, item_descricao)
    select id, '7.1.3.99', 'b', 'x' from public.projects where code = '30.068';
    raise exception 'BLOCO 5 FALHOU: o agente gravou regra de item';
  exception when insufficient_privilege then null;
  end;
  raise notice 'BLOCO 5 ok: conta_item_map tem a barreira do agente';
end $$;

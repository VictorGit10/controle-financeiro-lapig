-- Stub para validar a migração 050 num Postgres descartável.
-- Ordem: stub.sql -> stub-047.sql -> 047 -> stub-049.sql -> stub-050.sql
--        -> 049 -> [BLOCO 0] -> 050 -> 1..3
-- NÃO faz parte do projeto.
--
-- Reproduz o estado de produção DEPOIS da 049: um centro com pessoal
-- CLT cujos encargos "( - )" são débitos. Ele nasce aqui com o sinal
-- certo, e é a 049 — rodada depois deste stub — que os vira negativos,
-- exatamente como aconteceu em produção. Sem isso o roteiro test_050
-- passaria por acidente.

-- Colunas e peças do schema real (026/033) que o stub.sql não tinha.
alter table public.balancete_lancamentos
  add column if not exists valor_debito  numeric(14,2) not null default 0,
  add column if not exists valor_credito numeric(14,2) not null default 0;

alter table public.balancetes
  add column if not exists data_emissao         date,
  add column if not exists periodo_inicio       date,
  add column if not exists total_debitos        numeric(14,2),
  add column if not exists total_creditos       numeric(14,2),
  add column if not exists arquivo_storage_path text,
  add column if not exists arquivo_nome         text,
  add column if not exists observacoes          text,
  add column if not exists raw_extraction       jsonb,
  add column if not exists created_by           uuid,
  add column if not exists updated_at           timestamptz;

do $$ begin
  alter table public.balancetes add constraint balancetes_proj_data_uk unique (project_id, data_referencia);
exception when duplicate_object or duplicate_table then null; end $$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid
language sql stable as $$ select null::uuid $$;

-- gatilho real (mig. 026): só resolve quando a rubrica vem nula
create or replace function public.auto_resolve_rubrica_lancamento()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.rubrica_code is null then
    new.rubrica_code := public.resolve_rubrica_for_conta(new.conta_codigo);
  end if;
  return new;
end; $$;

drop trigger if exists trg_auto_resolve_rubrica on public.balancete_lancamentos;
create trigger trg_auto_resolve_rubrica
  before insert on public.balancete_lancamentos
  for each row execute function public.auto_resolve_rubrica_lancamento();

-- mapa de pessoal CLT (mig. 027)
insert into public.conta_rubrica_map (conta_prefix, rubrica_code, descricao) values
  ('7.1.3.01.01', 'a.colab', 'ORDENADOS E SALARIOS'),
  ('7.1.3.01.02', 'a.enc',   'ENCARGOS SOCIAIS'),
  ('7.1.3.01.03', 'a.outros','BENEFICIOS')
on conflict (conta_prefix) do nothing;

-- Centro com CLT: pessoal do 30.111 de 2026-09 (valores reais do PDF).
-- 7.1.3.01 fecha em 15.801,43 com TODOS positivos.
do $$
declare
  v_proj uuid;
  v_bal  uuid;
begin
  insert into public.projects (name, code, start_date, end_date)
  values ('Stub 050 CLT', '30.111-STUB50', '2025-01-01', '2027-12-31')
  returning id into v_proj;

  insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido)
  values (v_proj, '2026-09-07', 469259.97, 21637.70)
  returning id into v_bal;

  insert into public.balancete_lancamentos
    (balancete_id, conta_codigo, conta_descricao, valor_debito, valor_credito, saldo_atual)
  values
    (v_bal, '7.1.3.01.01.00001', 'SALARIOS',                      9110.00,  0.00, 9110.00),
    (v_bal, '7.1.3.01.01.00007', '( - ) 13º SALARIO',              759.16,  0.00,  759.16),
    (v_bal, '7.1.3.01.01.00016', '( - ) FÉRIAS',                  1012.23,  0.00, 1012.23),
    (v_bal, '7.1.3.01.02.00001', 'DESPESA C/ FGTS S/FOLHA (PRJ)',  870.50,  0.00,  870.50),
    (v_bal, '7.1.3.01.02.00002', 'CONTRIBUIÇÃO PREVIDENCIARIA',   2910.53,  0.00, 2910.53),
    (v_bal, '7.1.3.01.02.00004', '( - ) PIS S/ FOLHA',             108.82,  0.01,  108.81),
    (v_bal, '7.1.3.01.02.00010', '( - ) FGTS S/FÉRIAS PRJ',          0.02,  0.00,    0.02),
    (v_bal, '7.1.3.01.02.00014', '( - ) INSS S/FÉRIAS PRJ',          0.01,  0.00,    0.01),
    (v_bal, '7.1.3.01.02.00015', '( - ) INSS S/13º SALARIO PRJ',     0.01,  0.00,    0.01),
    (v_bal, '7.1.3.01.03.00005', 'VALE ALIMENTAÇÃO FUNCIONÁRIOS',  1040.16, 10.00, 1030.16),
    -- redutora de verdade (só crédito), já gravada como o parser velho gravava
    (v_bal, '7.1.3.05.01.00129', '( - ) FRETES E TRANSP S/ IMPORTA',  0.00, 100.00, 100.00);
end $$;

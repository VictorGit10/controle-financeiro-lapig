-- Stub para validar a migração 047 num Postgres descartável.
-- Complementa `stub.sql` (rode-o antes). NÃO faz parte do projeto.
--
-- Traz de propósito o estado COM O DEFEITO:
--   • `conta_rubrica_map` com `7.1.3.05 -> b` e `7.1.3.07 -> c`, e SEM
--     regra para 7.1.3.05.01.00042 — é assim que passagens vira `b`;
--   • `get_previsto_vs_realizado` na versão da mig. 033, que faz
--     `group by rubrica_code` e descarta `descricao_livre`.
--
-- Sem isso o roteiro test_047 passaria por acidente: ele confere que
-- a 047 CONSERTA algo, e para isso o algo tem de estar quebrado antes.

-- Colunas que o stub.sql não tinha (existem em 025/026 no schema real).
alter table public.plano_rubricas
  add column if not exists descricao_livre text;

alter table public.balancete_lancamentos
  add column if not exists conta_codigo    text,
  add column if not exists conta_descricao text;

create table if not exists public.conta_rubrica_map (
  conta_prefix text primary key,
  rubrica_code text not null references public.rubricas(code),
  descricao    text,
  ativo        boolean not null default true
);

-- longest-prefix-match (mig. 026)
create or replace function public.resolve_rubrica_for_conta(p_conta text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rubrica text;
begin
  select rubrica_code
    into v_rubrica
    from public.conta_rubrica_map
   where ativo = true
     and p_conta like conta_prefix || '%'
   order by length(conta_prefix) desc
   limit 1;
  return v_rubrica;
end;
$$;

-- O mapa como estava ANTES da 047: nada aponta para 00042.
insert into public.conta_rubrica_map (conta_prefix, rubrica_code, descricao) values
  ('7.1.3.02',          'd',        'DIARIAS'),
  ('7.1.3.03',          'e',        'MATERIAL DE CONSUMO'),
  ('7.1.3.04',          'a.bolsas', 'STPF / BOLSAS'),
  ('7.1.3.05',          'b',        'SERVICOS TERCEIROS PJ'),
  ('7.1.3.05.01.00051', 'dao',      'DAO'),
  ('7.1.3.07',          'c',        'PASSAGENS (arvore propria - nao usada pela FUNAPE)'),
  ('7.1.3.20',          'f',        'DESPESAS DE CAPITAL')
on conflict (conta_prefix) do nothing;

-- ------------------------------------------------------------
-- get_previsto_vs_realizado na versão PRÉ-047 (mig. 033)
-- ------------------------------------------------------------
create or replace function public.get_previsto_vs_realizado(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plano_id        uuid;
  v_balancete_id    uuid;
  v_balancete_data  date;
  v_balancete_saldo numeric;
  v_balancete_rend  numeric;
  v_rubricas        jsonb;
  v_nao_mapeados    jsonb;
begin
  perform public.assert_project_allowed(p_project_id);

  select id into v_plano_id
    from public.planos_trabalho
   where project_id = p_project_id and ativo = true
   limit 1;

  select id, data_referencia, saldo_disponivel, rendimento_liquido
    into v_balancete_id, v_balancete_data, v_balancete_saldo, v_balancete_rend
    from public.balancetes
   where project_id = p_project_id
   order by data_referencia desc
   limit 1;

  if v_plano_id is null then
    return jsonb_build_object('has_plano', false,
                              'has_balancete', v_balancete_id is not null);
  end if;

  with previsto as (
    select rubrica_code, sum(valor_previsto) as total_previsto
      from public.plano_rubricas where plano_id = v_plano_id group by rubrica_code
  ),
  realizado as (
    select rubrica_code, sum(saldo_atual) as total_realizado
      from public.balancete_lancamentos
     where balancete_id = v_balancete_id and rubrica_code is not null
     group by rubrica_code
  ),
  todas as (
    select r.code as rubrica_code, r.name, r.parent_code, r.ordem,
           coalesce(p.total_previsto, 0)   as previsto,
           coalesce(rr.total_realizado, 0) as realizado
      from public.rubricas r
      left join previsto  p  on p.rubrica_code  = r.code
      left join realizado rr on rr.rubrica_code = r.code
     where coalesce(p.total_previsto, 0) > 0 or coalesce(rr.total_realizado, 0) > 0
     order by r.ordem
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'rubrica_code', rubrica_code, 'rubrica_name', name, 'parent_code', parent_code,
      'previsto', previsto, 'realizado', realizado, 'saldo', (previsto - realizado),
      'perc_executado', case when previsto > 0 then round((realizado/previsto)*100,2) else null end
  )), '[]'::jsonb) into v_rubricas from todas;

  select coalesce(jsonb_agg(jsonb_build_object(
      'conta_codigo', conta_codigo, 'conta_descricao', conta_descricao,
      'saldo_atual', saldo_atual)), '[]'::jsonb)
    into v_nao_mapeados
    from public.balancete_lancamentos
   where balancete_id = v_balancete_id and rubrica_code is null;

  return jsonb_build_object(
    'has_plano', true, 'has_balancete', v_balancete_id is not null,
    'balancete_id', v_balancete_id, 'data_referencia', v_balancete_data,
    'saldo_disponivel', v_balancete_saldo, 'rendimento_liquido', v_balancete_rend,
    'rubricas', coalesce(v_rubricas,'[]'::jsonb), 'nao_mapeados', v_nao_mapeados);
end;
$$;

-- ------------------------------------------------------------
-- Dado com a forma do 30.068 (valores reais de 2026-08-03)
-- ------------------------------------------------------------
do $$
declare
  v_proj uuid;
  v_plano uuid;
  v_bal uuid;
begin
  insert into public.projects (name, code, start_date, end_date)
  values ('Stub 047 CEMPA', '30.068-STUB', '2021-12-13', '2026-12-13')
  returning id into v_proj;

  insert into public.planos_trabalho (project_id, ativo) values (v_proj, true)
  returning id into v_plano;

  -- Plano: três linhas de `e` e quatro de `b` — é o detalhe que a 047
  -- passa a devolver. Uma linha sem descrição de propósito, para
  -- conferir que ela soma no total mas não vira item.
  insert into public.plano_rubricas (plano_id, rubrica_code, valor_previsto, descricao_livre) values
    (v_plano, 'a.bolsas', 1459800.00, 'Bolsas'),
    (v_plano, 'b',           7314.00, '"Manutencao de maquinas e equipamentos "'),
    (v_plano, 'b',         132444.77, '"Servicos tecnicos especializaos "'),
    (v_plano, 'b',          35000.00, 'Inscricao em congressos'),
    (v_plano, 'c',         135000.00, 'Passagens e Despesas com Locomocao'),
    (v_plano, 'd',         290800.00, 'Despesas com diarias'),
    (v_plano, 'e',          33000.00, 'Componentes eletronicos - manutencao'),
    (v_plano, 'e',           8905.00, 'Componentes eletronicos - pecas de informatica'),
    (v_plano, 'e',          10000.00, 'Impressao de material grafico'),
    (v_plano, 'f',        1584230.60, 'Bens permanentes'),
    (v_plano, 'f',         172411.00, null);

  insert into public.balancetes (project_id, data_referencia, saldo_disponivel, rendimento_liquido)
  values (v_proj, '2026-08-03', 1960650.04, 150383.77)
  returning id into v_bal;

  -- Lançamentos: a rubrica é resolvida pelo mapa COM O DEFEITO, então
  -- passagens nasce em `b`. É exatamente o que a 047 tem de corrigir.
  insert into public.balancete_lancamentos (balancete_id, conta_codigo, conta_descricao, saldo_atual, rubrica_code)
  select v_bal, c.codigo, c.descr, c.valor, public.resolve_rubrica_for_conta(c.codigo)
    from (values
      ('7.1.3.02.01.00001', 'DESPESAS C/ DIARIAS NO PAIS',        49030.00),
      ('7.1.3.03.01.00009', 'MATERIAL DE INFORMATICA',             9001.60),
      ('7.1.3.04.01.09142', 'BOLSA DOACAO',                     1284800.00),
      ('7.1.3.05.01.00004', 'SERVICOS TECNICOS PROFISSIONAIS',     3050.00),
      ('7.1.3.05.01.00042', 'PASSAGENS E DEPESAS COM LOCOMOCAO', 116287.41),
      ('7.1.3.05.01.00051', 'DESPESA ADM E OPERACIONAL (DAO)',   132595.69),
      ('7.1.3.20.50.00003', 'APAR. EQUIPAMENTOS/ UTENSILIOS',    559665.48)
    ) as c(codigo, descr, valor);
end $$;

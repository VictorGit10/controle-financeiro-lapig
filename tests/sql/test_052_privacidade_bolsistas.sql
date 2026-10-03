-- ============================================================
-- Roteiro de conferência da migração 052 (o Buriti não lê CPF)
--
-- Contra o Postgres descartável, depois de stub-052.sql e da 052.
-- AUTOCONFERIDO: cada bloco aborta (raise) se a garantia não se
-- sustentar; rode com ON_ERROR_STOP e procure "ok" nos NOTICEs.
--
-- Em produção, depois de aplicar a 052, os BLOCOS 1 e 5 podem ser
-- rodados logado como o agente pelo PostgREST (não no SQL Editor, que
-- roda como dono das tabelas e passa por cima do RLS):
--   GET /rest/v1/scholarship_holders?select=cpf      → []
--   POST /rest/v1/rpc/bolsistas_nomes {}             → só id e nome
-- ============================================================

\set ON_ERROR_STOP on

-- ------------------------------------------------------------
-- BLOCO 1 — como agente: nenhuma linha de bolsista, nenhum CPF
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
set role authenticated;
do $$
begin
  if (select count(*) from public.scholarship_holders) <> 0 then
    raise exception 'BLOCO 1 FALHOU: o agente lê linhas de scholarship_holders';
  end if;
  if exists (select cpf from public.scholarship_holders) then
    raise exception 'BLOCO 1 FALHOU: o agente lê CPF';
  end if;
  raise notice 'BLOCO 1 ok: agente não lê bolsista (nem CPF nem e-mail)';
end $$;

-- ------------------------------------------------------------
-- BLOCO 2 — como agente: o nome continua chegando, só do escopo,
-- e o "embed" do consultar_bolsas (bolsa + nome) funciona
-- ------------------------------------------------------------
do $$
declare
  n int;
  cols int;
begin
  select count(*) into n from public.bolsistas_nomes();
  if n <> 1 then
    raise exception 'BLOCO 2 FALHOU: bolsistas_nomes devolveu % linha(s); esperado 1 (só o do centro X)', n;
  end if;
  if not exists (select 1 from public.bolsistas_nomes(null, 'X Teste')) then
    raise exception 'BLOCO 2 FALHOU: busca por nome não acha o bolsista do escopo';
  end if;
  if exists (select 1 from public.bolsistas_nomes(null, 'Y Teste')) then
    raise exception 'BLOCO 2 FALHOU: bolsistas_nomes vaza bolsista fora do escopo';
  end if;
  -- só (id, full_name): a assinatura não tem lugar para CPF
  select count(*) into cols
    from information_schema.routines r
    join information_schema.parameters p on p.specific_name = r.specific_name
   where r.routine_name = 'bolsistas_nomes' and p.parameter_mode = 'OUT';
  if cols <> 2 then
    raise exception 'BLOCO 2 FALHOU: bolsistas_nomes devolve % colunas; esperado 2', cols;
  end if;
  -- o que o MCP faz: bolsas do centro + nome pela RPC
  select count(*) into n
    from public.scholarships s
    join public.bolsistas_nomes(array(select holder_id from public.scholarships), null) h
      on h.id = s.holder_id;
  if n <> 1 then
    raise exception 'BLOCO 2 FALHOU: bolsa + nome deu % linha(s); esperado 1', n;
  end if;
  raise notice 'BLOCO 2 ok: nome do bolsista do escopo chega pela RPC, sem CPF';
end $$;
reset role;

-- ------------------------------------------------------------
-- BLOCO 3 — o professor do escopo continua lendo CPF (conciliação)
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set role authenticated;
do $$
begin
  if (select cpf from public.scholarship_holders where full_name = 'Bolsista X Teste') is distinct from '52998224725' then
    raise exception 'BLOCO 3 FALHOU: o professor perdeu o CPF do bolsista do escopo';
  end if;
  if exists (select 1 from public.scholarship_holders where full_name = 'Bolsista Y Teste') then
    raise exception 'BLOCO 3 FALHOU: o professor lê bolsista fora do escopo';
  end if;
  raise notice 'BLOCO 3 ok: humano do escopo segue com CPF; escopo da 033 intacto';
end $$;
reset role;

-- ------------------------------------------------------------
-- BLOCO 4 — storage: o agente não lê a planilha de bolsas
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
set role authenticated;
do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'bolsa-planilhas') then
    raise exception 'BLOCO 4 FALHOU: o agente enxerga a planilha de bolsas (tem CPF)';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'balancete-pdfs') then
    raise exception 'BLOCO 4 FALHOU: o agente perdeu os PDFs de balancete';
  end if;
  raise notice 'BLOCO 4 ok: agente lê balancete, não lê planilha de bolsas';
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set role authenticated;
do $$
begin
  if not exists (select 1 from storage.objects where bucket_id = 'bolsa-planilhas') then
    raise exception 'BLOCO 4 FALHOU: o humano perdeu a planilha de bolsas';
  end if;
  raise notice 'BLOCO 4 ok: humano segue lendo a planilha';
end $$;
reset role;

-- ------------------------------------------------------------
-- BLOCO 5 — proposta com CPF é recusada; proposta de balancete passa
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
do $$
declare
  x uuid := (select id from public.projects where code = '51.X');
begin
  begin
    perform public.criar_proposta('pergunta', x, 'Bolsista de CPF 529.982.247-25 está ativo?');
    raise exception 'BLOCO 5 FALHOU: aceitou CPF pontuado no resumo';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.criar_proposta('balancete', x, 'balancete', '{"bolsista": {"cpf": "52998224725"}}'::jsonb);
    raise exception 'BLOCO 5 FALHOU: aceitou CPF corrido no payload';
  exception when invalid_parameter_value then null;
  end;
  -- números de balancete não podem disparar falso positivo
  perform public.criar_proposta('balancete', x, 'Balancete 30.068 até 02/09/2026 · saldo R$ 1.107.372,93',
    '{"lancamentos": [{"conta": "7.1.3.05.01.00042", "red": "71199553", "valor": 24543248.95}],
      "project_id": "9f1c2d3e-4a5b-46c7-8d9e-0a1b2c3d4e5f"}'::jsonb, null, '2026-09-02');
  raise notice 'BLOCO 5 ok: CPF fora da proposta; balancete normal passa';
end $$;

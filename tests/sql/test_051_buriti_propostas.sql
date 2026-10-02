-- ============================================================
-- Roteiro de conferência da migração 051 (Buriti — propostas do agente)
--
-- Contra o Postgres descartável, depois de stub-051.sql e da 051.
-- AUTOCONFERIDO: cada bloco aborta (raise exception) se a garantia não
-- se sustentar; rode com ON_ERROR_STOP e procure "ok" nos NOTICEs.
-- Troca de usuário com set_config('request.jwt.claim.sub', …) — é de
-- onde auth.uid() lê no Supabase.
--
-- Em produção, só o BLOCO 1 faz sentido (cobertura da barreira); rode-o
-- depois de CADA migração nova que crie tabela.
-- ============================================================

\set ON_ERROR_STOP on

-- o agente (o check de role só passa a aceitá-lo com a 051)
insert into public.app_users (user_id, role)
values ('00000000-0000-0000-0000-0000000000c1', 'agente')
on conflict (user_id) do update set role = 'agente';

-- ------------------------------------------------------------
-- BLOCO 1 — toda tabela de public, exceto propostas_agente, tem a barreira
-- ------------------------------------------------------------
do $$
declare v text;
begin
  select string_agg(c.relname, ', ') into v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p') and c.relname <> 'propostas_agente'
     and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'trg_bloqueia_agente');
  if v is not null then raise exception 'BLOCO 1: sem barreira: %', v; end if;
  raise notice 'BLOCO 1 ok: barreira em todas as tabelas';
end $$;

-- ------------------------------------------------------------
-- BLOCO 2 — o agente não grava em tabela financeira, nem direto nem
-- por RPC definer (upsert_balancete). Professor no mesmo escopo grava.
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
do $$
declare x uuid := (select id from public.projects where code = '51.X');
begin
  begin
    insert into public.monitoramento (project_id, note_date, observacao) values (x, current_date, 'agente');
    raise exception 'BLOCO 2 FALHOU: agente gravou direto';
  exception when insufficient_privilege then null;
           when undefined_table then null;   -- stub sem monitoramento
  end;
  begin
    update public.projects set name = name where id = x;
    raise exception 'BLOCO 2 FALHOU: agente alterou projects';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.upsert_balancete(jsonb_build_object('project_id', x, 'data_referencia', '2026-09-02'));
    raise exception 'BLOCO 2 FALHOU: agente gravou balancete pela RPC';
  exception when insufficient_privilege then null;
  end;
  raise notice 'BLOCO 2 ok: agente barrado (direto e por RPC definer)';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$
declare x uuid := (select id from public.projects where code = '51.X');
begin
  perform public.upsert_balancete(jsonb_build_object('project_id', x, 'data_referencia', '2026-08-03'));
  raise notice 'BLOCO 2 ok: professor do escopo grava normalmente';
end $$;

-- ------------------------------------------------------------
-- BLOCO 3 — criar_proposta: só agente, só no escopo, refazer substitui
-- ------------------------------------------------------------
do $$
declare x uuid := (select id from public.projects where code = '51.X');
begin
  -- professor não cria
  begin
    perform public.criar_proposta('balancete', x, 'teste');
    raise exception 'BLOCO 3 FALHOU: professor criou proposta';
  exception when insufficient_privilege then null;
  end;
  raise notice 'BLOCO 3 ok: humano não cria proposta';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
do $$
declare
  x uuid := (select id from public.projects where code = '51.X');
  y uuid := (select id from public.projects where code = '51.Y');
  p1 uuid; p2 uuid;
begin
  begin
    perform public.criar_proposta('balancete', y, 'fora do escopo');
    raise exception 'BLOCO 3 FALHOU: agente propôs fora do escopo';
  exception when raise_exception then
    if sqlerrm not like 'Acesso negado%' then raise; end if;
  end;
  begin
    perform public.criar_proposta('balancete', x, '   ');
    raise exception 'BLOCO 3 FALHOU: proposta sem resumo';
  exception when raise_exception then
    if sqlerrm not like 'Resumo%' then raise; end if;
  end;
  begin
    perform public.criar_proposta('balancete', x, 'arquivo de outro centro', '{}', 'outro/arq.pdf');
    raise exception 'BLOCO 3 FALHOU: arquivo fora da pasta do centro';
  exception when raise_exception then
    if sqlerrm not like 'O arquivo%' then raise; end if;
  end;
  p1 := public.criar_proposta('balancete', x, 'balancete 02/09', '{"v":1}', x::text || '/a.pdf', '2026-09-02');
  p2 := public.criar_proposta('balancete', x, 'balancete 02/09 refeito', '{"v":2}', x::text || '/b.pdf', '2026-09-02');
  if (select status from public.propostas_agente where id = p1) <> 'obsoleta' then
    raise exception 'BLOCO 3 FALHOU: refazer não tornou a anterior obsoleta';
  end if;
  perform public.criar_proposta('pergunta', null, 'Cartazes/brindes do 30.068: b ou e?');
  raise notice 'BLOCO 3 ok: escopo, resumo, pasta e substituição';

  -- o agente não decide nem aplica
  begin
    perform public.decidir_proposta(p2, 'rejeitada', 'auto');
    raise exception 'BLOCO 3 FALHOU: agente decidiu';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.marcar_proposta_aplicada(p2);
    raise exception 'BLOCO 3 FALHOU: agente aplicou';
  exception when insufficient_privilege then null;
  end;
  raise notice 'BLOCO 3 ok: agente não decide nem aplica a própria proposta';
end $$;

-- ------------------------------------------------------------
-- BLOCO 4 — humano decide; aplicar balancete é atômico
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$
declare
  x  uuid := (select id from public.projects where code = '51.X');
  p  uuid := (select id from public.propostas_agente where chave = '2026-09-02' and status = 'pendente');
  pq uuid := (select id from public.propostas_agente where tipo = 'pergunta');
  b  uuid;
begin
  begin
    perform public.decidir_proposta(p, 'rejeitada', '');
    raise exception 'BLOCO 4 FALHOU: rejeitou sem motivo';
  exception when raise_exception then
    if sqlerrm not like 'Rejeitar exige%' then raise; end if;
  end;
  -- pergunta sem centro de custo: só admin responde
  begin
    perform public.decidir_proposta(pq, 'respondida', 'e');
    raise exception 'BLOCO 4 FALHOU: professor respondeu pergunta sem centro';
  exception when insufficient_privilege then null;
  end;

  b := public.upsert_balancete(jsonb_build_object(
         'project_id', x, 'data_referencia', '2026-09-02', 'proposta_id', p,
         'lancamentos', jsonb_build_array(jsonb_build_object(
            'conta_codigo', '7.1.3.05.01.97', 'saldo_atual', 1400, 'rubrica_code', 'e'))));
  if (select status from public.propostas_agente where id = p) <> 'aplicada'
     or (select objeto_id from public.propostas_agente where id = p) <> b
     or (select decidida_por from public.propostas_agente where id = p) <> '00000000-0000-0000-0000-0000000000b1' then
    raise exception 'BLOCO 4 FALHOU: proposta não marcada junto com a gravação';
  end if;

  -- reaplicar a mesma proposta: falha e NÃO grava nada
  begin
    perform public.upsert_balancete(jsonb_build_object(
      'project_id', x, 'data_referencia', '2026-09-03', 'proposta_id', p));
    raise exception 'BLOCO 4 FALHOU: reaplicou proposta já aplicada';
  exception when raise_exception then
    if sqlerrm not like '%não pendente%' then raise; end if;
  end;
  if exists (select 1 from public.balancetes where project_id = x and data_referencia = '2026-09-03') then
    raise exception 'BLOCO 4 FALHOU: gravou o balancete mesmo com a proposta inválida';
  end if;
  raise notice 'BLOCO 4 ok: decisão humana, motivo obrigatório, aplicação atômica';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$
declare pq uuid := (select id from public.propostas_agente where tipo = 'pergunta');
begin
  perform public.decidir_proposta(pq, 'respondida', 'Material de consumo (e): divulgação.');
  raise notice 'BLOCO 4 ok: admin responde pergunta sem centro';
end $$;

-- ------------------------------------------------------------
-- BLOCO 4b — a tela de usuários não tira o agente do papel sem querer
-- ------------------------------------------------------------
do $$
declare x uuid := (select id from public.projects where code = '51.X');
begin
  -- ainda logado como admin (a1)
  perform public.save_user_assignments('00000000-0000-0000-0000-0000000000c1', 'agente', array[x]);
  begin
    perform public.save_user_assignments('00000000-0000-0000-0000-0000000000c1', 'professor', array[x]);
    raise exception 'BLOCO 4b FALHOU: a tela rebaixou o agente a professor';
  exception when insufficient_privilege then null;
  end;
  if (select role from public.app_users where user_id = '00000000-0000-0000-0000-0000000000c1') <> 'agente' then
    raise exception 'BLOCO 4b FALHOU: papel do agente mudou';
  end if;
  raise notice 'BLOCO 4b ok: escopo do agente editável, papel travado';
end $$;

-- ------------------------------------------------------------
-- BLOCO 5 — RLS: quem vê o quê, e ninguém escreve direto na tabela
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
set role authenticated;
do $$
begin
  if (select count(*) from public.propostas_agente) <> 3 then   -- obsoleta, aplicada e a pergunta respondida
    raise exception 'BLOCO 5 FALHOU: agente não lê as próprias propostas e decisões';
  end if;
  begin
    update public.propostas_agente set status = 'aplicada';
    raise exception 'BLOCO 5 FALHOU: escrita direta na tabela de propostas';
  exception when insufficient_privilege then null;
  end;
  raise notice 'BLOCO 5 ok: agente lê as decisões, ninguém escreve direto';
end $$;

-- ------------------------------------------------------------
-- BLOCO 6 — storage: agente só no bucket dele, na pasta do escopo
-- ------------------------------------------------------------
do $$
declare
  x text := (select id::text from public.projects where code = '51.X');
  y text := (select id::text from public.projects where code = '51.Y');
begin
  insert into storage.objects (bucket_id, name) values ('propostas-agente', x || '/bal.pdf');
  begin
    insert into storage.objects (bucket_id, name) values ('balancete-pdfs', x || '/bal.pdf');
    raise exception 'BLOCO 6 FALHOU: agente subiu no bucket de balancetes';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('propostas-agente', y || '/bal.pdf');
    raise exception 'BLOCO 6 FALHOU: agente subiu na pasta de centro fora do escopo';
  exception when insufficient_privilege then null;
  end;
  raise notice 'BLOCO 6 ok: storage confinado';
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set role authenticated;
do $$
begin
  insert into storage.objects (bucket_id, name)
  values ('balancete-pdfs', (select id::text from public.projects where code = '51.X') || '/humano.pdf');
  raise notice 'BLOCO 6 ok: humano segue subindo balancete normalmente';
end $$;
reset role;

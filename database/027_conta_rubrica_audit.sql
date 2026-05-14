-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Migração 027
-- Auditoria do conta_rubrica_map com base nos balancetes reais
-- (30.099, 30.113, 30.076, 30.087) + suporte a cadastro inline
-- de mapeamentos durante o upsert do balancete.
-- ============================================================

-- ── 1. Seeds adicionais (confirmados nos PDFs reais) ─────────
-- Estes mapeamentos cobrem códigos que apareceram nos balancetes
-- inspecionados mas não estavam na seed inicial da migração 026.
-- Casos AMBÍGUOS são deliberadamente deixados de fora — serão
-- cadastrados pelo usuário via tela de classificação inline.

insert into public.conta_rubrica_map (conta_prefix, rubrica_code, descricao) values
  -- Confirmado pelo usuário em 2026-05: FUNDO INSTITUCIONAL (sem CIP no nome)
  -- equivale ao FUNDO INSTITUCIONAL CIP (99521) → cip_ufg
  ('7.1.3.05.01.00062', 'cip_ufg',  'FUNDO INSTITUCIONAL (variante sem CIP no nome)'),

  -- Equipamentos e material permanente → Investimento (f).
  ('7.1.3.20',          'f',        'DESPESAS DE CAPITAL / EQUIPAMENTOS E MATERIAL PERMANENTE'),

  -- Pessoal CLT: Ordenados e Salários
  ('7.1.3.01.01',       'a.colab',  'ORDENADOS E SALARIOS (Colaboradores CLT)'),
  -- Pessoal CLT: Encargos s/ folha (FGTS, INSS, PIS)
  ('7.1.3.01.02',       'a.enc',    'ENCARGOS SOCIAIS S/ CLT'),
  -- Benefícios sociais (vale alimentação, vale transporte) — vinculados aos colaboradores
  ('7.1.3.01.03',       'a.colab',  'BENEFÍCIOS SOCIAIS (vinculados aos CLT)')

on conflict (conta_prefix) do nothing;

-- Os códigos a seguir aparecem nos balancetes mas NÃO são mapeados
-- automaticamente: são tributos sobre rendimento de aplicação
-- financeira e despesas financeiras (IOF s/ recebimento). Caem em
-- "Lançamentos não mapeados" no relatório Previsto vs Realizado.
-- Decisão consciente: tributos sobre rendimento não fazem parte
-- das rubricas do plano de trabalho (não há previsão para eles).
--   7.1.3.60.01.*  (IR/IOF s/ aplicação financeira)
--   7.1.3.62.01.*  (Despesas financeiras — IOF s/ recebimento)


-- ── 2. Estender upsert_balancete para aceitar new_mappings ───
-- O usuário pode, durante a revisão do balancete, classificar
-- inline um código contábil ainda não mapeado e marcar a opção
-- "Salvar para próximas execuções". Quando faz isso, o frontend
-- envia o payload com a chave opcional new_mappings:
--   { ..., new_mappings: [{ conta_prefix, rubrica_code }, ...] }
-- Estes mapeamentos são inseridos em conta_rubrica_map ANTES dos
-- lançamentos, de modo que o trigger trg_auto_resolve_rubrica
-- já encontre a rubrica correta.

create or replace function public.upsert_balancete(p_payload jsonb)
returns uuid
language plpgsql
security definer
as $$
declare
  v_id           uuid;
  v_project_id   uuid;
  v_data_ref     date;
  r_lanc         jsonb;
  r_map          jsonb;
begin
  v_project_id := (p_payload->>'project_id')::uuid;
  v_data_ref   := (p_payload->>'data_referencia')::date;

  if v_project_id is null or v_data_ref is null then
    raise exception 'project_id e data_referencia são obrigatórios.';
  end if;

  -- Novos mapeamentos cadastrados pelo usuário durante a revisão.
  -- Inseridos ANTES dos lançamentos para que o trigger auto-resolve
  -- já encontre a rubrica correta.
  if jsonb_typeof(p_payload->'new_mappings') = 'array' then
    for r_map in select * from jsonb_array_elements(p_payload->'new_mappings')
    loop
      if r_map->>'conta_prefix' is not null and r_map->>'rubrica_code' is not null then
        insert into public.conta_rubrica_map (conta_prefix, rubrica_code, descricao)
        values (
          r_map->>'conta_prefix',
          r_map->>'rubrica_code',
          coalesce(r_map->>'descricao', 'Cadastrado via revisão do balancete')
        )
        on conflict (conta_prefix) do update set
          rubrica_code = excluded.rubrica_code,
          ativo        = true;
      end if;
    end loop;
  end if;

  insert into public.balancetes (
    project_id, data_referencia, data_emissao, periodo_inicio,
    saldo_disponivel, rendimento_liquido, total_debitos, total_creditos,
    arquivo_storage_path, arquivo_nome, observacoes, raw_extraction, created_by
  ) values (
    v_project_id, v_data_ref,
    nullif(p_payload->>'data_emissao','')::date,
    nullif(p_payload->>'periodo_inicio','')::date,
    nullif(p_payload->>'saldo_disponivel','')::numeric,
    nullif(p_payload->>'rendimento_liquido','')::numeric,
    nullif(p_payload->>'total_debitos','')::numeric,
    nullif(p_payload->>'total_creditos','')::numeric,
    p_payload->>'arquivo_storage_path',
    p_payload->>'arquivo_nome',
    p_payload->>'observacoes',
    p_payload->'raw_extraction',
    auth.uid()
  )
  on conflict (project_id, data_referencia) do update set
    data_emissao         = excluded.data_emissao,
    periodo_inicio       = excluded.periodo_inicio,
    saldo_disponivel     = excluded.saldo_disponivel,
    rendimento_liquido   = excluded.rendimento_liquido,
    total_debitos        = excluded.total_debitos,
    total_creditos       = excluded.total_creditos,
    arquivo_storage_path = coalesce(excluded.arquivo_storage_path, balancetes.arquivo_storage_path),
    arquivo_nome         = coalesce(excluded.arquivo_nome,         balancetes.arquivo_nome),
    observacoes          = excluded.observacoes,
    raw_extraction       = coalesce(excluded.raw_extraction,       balancetes.raw_extraction),
    updated_at           = now()
  returning id into v_id;

  -- Substitui os lançamentos (idempotente)
  delete from public.balancete_lancamentos where balancete_id = v_id;

  if jsonb_typeof(p_payload->'lancamentos') = 'array' then
    for r_lanc in select * from jsonb_array_elements(p_payload->'lancamentos')
    loop
      insert into public.balancete_lancamentos
        (balancete_id, conta_codigo, conta_descricao, valor_debito, valor_credito, saldo_atual)
      values (
        v_id,
        r_lanc->>'conta_codigo',
        r_lanc->>'conta_descricao',
        coalesce((r_lanc->>'valor_debito')::numeric, 0),
        coalesce((r_lanc->>'valor_credito')::numeric, 0),
        coalesce((r_lanc->>'saldo_atual')::numeric, 0)
      );
      -- rubrica_code é setado pelo trigger trg_auto_resolve_rubrica,
      -- que já enxerga os mapeamentos recém-inseridos acima.
    end loop;
  end if;

  return v_id;
end;
$$;

comment on function public.upsert_balancete is
  'Cria ou atualiza um balancete a partir do JSON revisado. Os lançamentos são substituídos integralmente. rubrica_code é resolvido automaticamente via mapeamento (trigger). Aceita new_mappings opcional para cadastrar mapeamentos durante a revisão.';

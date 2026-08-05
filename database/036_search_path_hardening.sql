-- ============================================================
-- Migração 036 — search_path fixo nas funções remanescentes
-- ============================================================
-- Encontrado na auditoria pré-publicação: 5 funções vivas ficaram
-- sem `set search_path`, três delas `security definer`.
--
-- Por que importa: sem search_path explícito, `pg_temp` entra
-- implicitamente NA FRENTE do caminho de busca. Um chamador que
-- consiga criar objeto temporário pode sombrear uma chamada não
-- qualificada de dentro de uma função `security definer` e rodar
-- código próprio com os privilégios do dono. É o lint 0011 do
-- Supabase (function_search_path_mutable).
--
-- Exploração pela web hoje é impraticável: o PostgREST não expõe
-- execução de SQL arbitrário, então não há como criar o objeto
-- temporário pela API. Isto é endurecimento de defesa em
-- profundidade, não correção de furo explorável.
--
-- Como o buraco reapareceu (vale registrar, porque vai repetir):
-- a migração 019 já tinha corrigido `sync_project_balance` via
-- ALTER. A 021 recriou a função com `create or replace` — e
-- CREATE OR REPLACE **substitui a definição inteira**, incluindo
-- os atributos SET e SECURITY. A correção da 019 evaporou sem
-- nenhum sinal. Mesma história em 025/026 para as demais.
--
-- Regra para o futuro: `set search_path = public, pg_temp` faz
-- parte do CORPO da função, não é ajuste externo. Toda função
-- nova já nasce com ele.
-- ============================================================

do $$
declare
  v_fn   text;
  v_done text[] := '{}';
  v_miss text[] := '{}';
begin
  foreach v_fn in array array[
    'public.update_updated_at()',                  -- 001, invoker, trigger
    'public.sync_project_balance()',               -- 021 desfez a 019, definer
    'public.enforce_single_plano_ativo()',         -- 025, definer
    'public.resolve_rubrica_for_conta(text)',      -- 026, definer
    'public.auto_resolve_rubrica_lancamento()'     -- 026, invoker, trigger
  ]
  loop
    begin
      execute format('alter function %s set search_path = public, pg_temp', v_fn);
      v_done := v_done || v_fn;
    exception
      when undefined_function then
        -- Função não existe nesta instalação (ex.: ordem de migração
        -- diferente). Registra e segue — não é motivo para abortar.
        v_miss := v_miss || v_fn;
    end;
  end loop;

  raise notice 'search_path fixado em % função(ões): %', array_length(v_done, 1), array_to_string(v_done, ', ');
  if array_length(v_miss, 1) > 0 then
    raise notice 'ausentes (ignoradas): %', array_to_string(v_miss, ', ');
  end if;
end$$;


-- ============================================================
-- Verificação — aborta se sobrar qualquer função sem search_path
-- ============================================================
-- Cobre também funções futuras: reexecute esta migração a qualquer
-- momento como reauditoria. Ignora funções de extensão (que não
-- são nossas e vivem fora do controle do projeto).

do $$
declare
  v_bad text;
begin
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by p.proname)
    into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and not exists (
       select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e'   -- pertence a extensão
     )
     and (p.proconfig is null or not exists (
       select 1 from unnest(p.proconfig) c where c like 'search_path=%'
     ));

  if v_bad is not null then
    raise exception 'FALHA: funções sem search_path fixo: %', v_bad;
  end if;

  raise notice 'OK — todas as funções do schema public têm search_path fixo.';
end$$;

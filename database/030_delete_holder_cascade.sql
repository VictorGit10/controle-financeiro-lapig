-- ============================================================
-- CONTROLE FINANCEIRO — Migração 030
-- Exclusão em cascata consciente de bolsista
-- ============================================================
-- Contexto: as FKs scholarships.holder_id e scholarships.project_id
-- são ON DELETE RESTRICT (migração 022/024) para proteger o histórico
-- financeiro contra exclusão acidental. Isso, porém, impede excluir um
-- bolsista que tenha bolsas vinculadas — mesmo em casos legítimos, como
-- uma duplicata criada por engano.
--
-- Esta RPC dá uma saída deliberada: a tela de Bolsistas avisa o usuário,
-- mostra a contagem de bolsas e, só após confirmação explícita, chama
-- esta função, que remove as bolsas e o bolsista numa única transação.
-- O RESTRICT no banco continua intacto como rede de segurança; a decisão
-- de cascatear é tomada conscientemente na interface.
--
-- As exclusões são registradas automaticamente em audit_logs (trigger da
-- migração 023, com old_data completo), permitindo recuperação se preciso.
-- ============================================================

create or replace function public.delete_holder_cascade(p_holder_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_deleted integer := 0;
begin
  if p_holder_id is null then
    raise exception 'holder não informado';
  end if;

  -- Remove as bolsas vinculadas primeiro (libera a FK RESTRICT)
  delete from public.scholarships where holder_id = p_holder_id;
  get diagnostics v_deleted = row_count;

  -- Remove o bolsista
  delete from public.scholarship_holders where id = p_holder_id;

  -- Retorna quantas bolsas foram removidas junto
  return v_deleted;
end;
$$;

comment on function public.delete_holder_cascade(uuid) is
  'Exclui um bolsista e todas as suas bolsas numa única transação. Usado pela tela de Bolsistas após confirmação explícita do usuário; o trigger de auditoria (023) registra os registros removidos em audit_logs.';

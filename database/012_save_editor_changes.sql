-- ============================================================
-- CONTROLE FINANCEIRO — Editor Mode transacional
-- Migração 011: RPC save_editor_changes
-- ============================================================
-- Executa delete/update/insert de bolsas em uma única transação
-- PL/pgSQL e registra auditoria ao final.
-- ============================================================

create or replace function public.save_editor_changes(
  p_project_id uuid,
  p_deletes    uuid[],
  p_updates    jsonb,
  p_inserts    jsonb
)
returns integer
language plpgsql
security definer
as $$
declare
  v_item       jsonb;
  v_total      integer := 0;
begin
  -- Deletions
  if array_length(p_deletes, 1) is not null then
    delete from public.scholarships
    where id = any(p_deletes)
      and project_id = p_project_id;
    v_total := v_total + array_length(p_deletes, 1);
  end if;

  -- Updates
  for v_item in select * from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb))
  loop
    update public.scholarships
    set
      amount     = (v_item->>'amount')::numeric,
      start_date = (v_item->>'start_date')::date,
      end_date   = (v_item->>'end_date')::date,
      status     = v_item->>'status',
      updated_at = now()
    where id = (v_item->>'id')::uuid
      and project_id = p_project_id;
    v_total := v_total + 1;
  end loop;

  -- Inserts
  for v_item in select * from jsonb_array_elements(coalesce(p_inserts, '[]'::jsonb))
  loop
    insert into public.scholarships (
      holder_id, project_id, amount, start_date, end_date, status, notes
    ) values (
      (v_item->>'holder_id')::uuid,
      p_project_id,
      (v_item->>'amount')::numeric,
      (v_item->>'start_date')::date,
      (v_item->>'end_date')::date,
      v_item->>'status',
      nullif(v_item->>'notes', '')
    );
    v_total := v_total + 1;
  end loop;

  -- Audit log
  insert into public.scholarship_audit (
    project_id,
    action,
    changes_count,
    details
  ) values (
    p_project_id,
    'editor_save',
    v_total,
    jsonb_build_object(
      'deleted',  coalesce(array_length(p_deletes, 1), 0),
      'updated',  jsonb_array_length(coalesce(p_updates, '[]'::jsonb)),
      'inserted', jsonb_array_length(coalesce(p_inserts, '[]'::jsonb))
    )
  );

  return v_total;
end;
$$;

comment on function public.save_editor_changes(uuid, uuid[], jsonb, jsonb) is
  'Aplica alterações do Modo Editor (delete/update/insert de bolsas) em uma única transação e registra auditoria.';

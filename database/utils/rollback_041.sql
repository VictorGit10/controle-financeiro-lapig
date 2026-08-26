-- Desfaz a migração 041 por completo.
--
-- Existe porque a 041 foi aplicada sem `supabase db dump` prévio: ela é DDL
-- puramente ADITIVA e não escreve em nenhuma linha existente, então o caminho
-- de volta é conhecido e curto — não precisa de backup para ser reversível.
-- Isso NÃO vale para migração que mexe em dado; ali o dump continua obrigatório
-- (ver `docs/acesso-ao-banco.md`).
--
-- O que se perde ao rodar isto: os valores já gravados em
-- `projects.drive_folder_url` (o vínculo com as pastas do Drive) e as linhas de
-- `audit_logs` das 6 tabelas param de ser geradas. Nada mais.
--
-- `projects.code` NÃO é tocado aqui: os códigos foram preenchidos antes da 041
-- e são independentes dela.

begin;

drop trigger if exists audit_planos_trabalho_trigger   on public.planos_trabalho;
drop trigger if exists audit_plano_rubricas_trigger    on public.plano_rubricas;
drop trigger if exists audit_plano_desembolsos_trigger on public.plano_desembolsos;
drop trigger if exists audit_balancetes_trigger        on public.balancetes;
drop trigger if exists audit_reconciliacoes_trigger    on public.reconciliacoes;
drop trigger if exists audit_rubricas_trigger          on public.rubricas;

drop function if exists public.set_project_drive_folder(uuid, text);
drop function if exists public.set_project_code(uuid, text);

drop index if exists public.idx_projects_code_unico;

alter table public.projects drop constraint if exists projects_drive_folder_url_check;
alter table public.projects drop column if exists drive_folder_url;

commit;

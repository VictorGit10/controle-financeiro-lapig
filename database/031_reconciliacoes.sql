-- ============================================================
-- CONTROLE FINANCEIRO DE PROJETOS — Migração 031
-- Registro mensal das reconciliações de bolsas FUNAPE
-- (rotina de Fechamento Mensal) + bucket para as planilhas XLSX.
-- ============================================================
-- Cada importação de planilha FUNAPE (aba Reconciliação / página
-- Fechamento Mensal) gera um registro aqui, com a competência
-- (mês de referência), o resumo do diff aprovado e o caminho da
-- planilha arquivada no Storage. É a fonte do checklist
-- "planilha de bolsas conferida?" do Fechamento Mensal.

-- ============================================================
-- 1. TABELA: reconciliacoes
-- ============================================================

create table public.reconciliacoes (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects(id) on delete cascade,
  competencia           date not null,
  arquivo_nome          text,
  arquivo_storage_path  text,
  resumo                jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id) default auth.uid(),

  -- competência sempre normalizada para o dia 1 do mês
  constraint chk_reconciliacao_competencia_dia1
    check (competencia = date_trunc('month', competencia)::date)
);

comment on table public.reconciliacoes is
  'Registro de cada reconciliação de bolsas FUNAPE aplicada (planilha × banco), por projeto e competência. Alimenta o checklist do Fechamento Mensal.';
comment on column public.reconciliacoes.competencia is
  'Mês de referência do fechamento (sempre dia 1). Escolhido pelo usuário na revisão da importação.';
comment on column public.reconciliacoes.resumo is
  'Contagens do diff no momento da aplicação: { novos, removidos, alterados, iguais, aplicadas }.';
comment on column public.reconciliacoes.arquivo_storage_path is
  'Caminho da planilha XLSX no bucket bolsa-planilhas (trilha de auditoria). Null se o upload falhou.';

create index idx_reconciliacoes_proj_comp
  on public.reconciliacoes(project_id, competencia desc);
create index idx_reconciliacoes_comp
  on public.reconciliacoes(competencia);

-- ============================================================
-- 2. RLS (mesmo modelo das demais tabelas: acesso autenticado)
-- ============================================================

alter table public.reconciliacoes enable row level security;

create policy "Autenticado lê reconciliacoes"     on public.reconciliacoes for select to authenticated using (true);
create policy "Autenticado insere reconciliacoes" on public.reconciliacoes for insert to authenticated with check (true);
create policy "Autenticado edita reconciliacoes"  on public.reconciliacoes for update to authenticated using (true) with check (true);
create policy "Autenticado exclui reconciliacoes" on public.reconciliacoes for delete to authenticated using (true);

-- ============================================================
-- 3. Storage: bucket privado para as planilhas FUNAPE
-- ============================================================

insert into storage.buckets (id, name, public)
values ('bolsa-planilhas', 'bolsa-planilhas', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'bolsa_auth_select'
  ) then
    create policy bolsa_auth_select on storage.objects
      for select to authenticated using (bucket_id = 'bolsa-planilhas');
    create policy bolsa_auth_insert on storage.objects
      for insert to authenticated with check (bucket_id = 'bolsa-planilhas');
    create policy bolsa_auth_update on storage.objects
      for update to authenticated using (bucket_id = 'bolsa-planilhas') with check (bucket_id = 'bolsa-planilhas');
    create policy bolsa_auth_delete on storage.objects
      for delete to authenticated using (bucket_id = 'bolsa-planilhas');
  end if;
end$$;

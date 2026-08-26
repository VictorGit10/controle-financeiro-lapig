-- ============================================================================
-- Roteiro de conferência da migração 041.
--
-- ⚠️  ESCREVE E APAGA DADOS. Roda só no container descartável do nível
--     sintético (`tools/replica-local/README.md`), NUNCA contra produção.
--
--   docker run -d --name cf-041 -e POSTGRES_PASSWORD=postgres postgres:17-alpine
--   docker exec cf-041 psql -U postgres -c 'create database cf'
--   docker exec -i cf-041 psql -U postgres -d cf < tools/replica-local/sintetico/stub.sql
--   docker exec -i cf-041 psql -U postgres -d cf < tools/replica-local/sintetico/stub-041.sql
--   docker exec -i cf-041 psql -U postgres -d cf < database/041_drive_folder_e_auditoria.sql
--   docker exec -i cf-041 psql -U postgres -d cf < tests/sql/test_041_drive_folder.sql
--
-- Os 10 blocos devem imprimir PASSA. É reexecutável: limpa o próprio rastro
-- antes de começar (a primeira versão não limpava, e a segunda rodada dava um
-- falso negativo no bloco 7 — o `on conflict do nothing` virava no-op e nenhuma
-- linha de auditoria nova aparecia).
--
-- Três propriedades a mais, conferidas fora deste arquivo, rodando a 041:
--   • banco limpo      → asserção final imprime "Migração 041: OK"
--   • reaplicar        → idempotente, imprime OK de novo
--   • código duplicado → aborta nomeando o código repetido, e NÃO deixa nada
--                        aplicado (0 coluna, 0 rpc, 0 trigger) — é o que o
--                        begin/commit da 041 garante e o autocommit não daria
-- ============================================================================

\pset pager off

-- Porteiro. Sem ele, os blocos com `exception when others` PASSAM quando a 041
-- não foi aplicada: o handler engole "function does not exist" como se fosse a
-- rejeição esperada. Aconteceu de verdade na primeira versão deste arquivo —
-- três blocos verdes contra um banco onde nada da 041 existia.
do $$ begin
  if to_regprocedure('public.set_project_drive_folder(uuid,text)') is null
  or to_regprocedure('public.set_project_code(uuid,text)') is null
  or not exists (select 1 from information_schema.columns
                  where table_name='projects' and column_name='drive_folder_url') then
    raise exception 'Migração 041 não aplicada. Rode database/041_drive_folder_e_auditoria.sql antes deste roteiro.';
  end if;
end $$;

create or replace function pg_temp.chk(nome text, cond boolean) returns void
language plpgsql as $$ begin
  raise notice '%  %', case when cond then 'PASSA' else '>>> FALHA' end, nome;
end $$;

-- rastro de execuções anteriores
delete from public.audit_logs where table_name in ('rubricas','planos_trabalho','projects');
delete from public.planos_trabalho where project_id in
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');
delete from public.projects where id in
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');
delete from public.rubricas where code = 'zz';

insert into public.projects (id,name,code,start_date,end_date,active) values
 ('11111111-1111-1111-1111-111111111111','Alfa','30.001','2025-01-01','2027-01-01',true),
 ('22222222-2222-2222-2222-222222222222','Beta',null,'2025-06-01','2028-06-01',true);


-- A razão de existir da RPC: gravar UM campo sem tocar no resto. É isso que
-- save_project não consegue fazer — ela sobrescreve todas as colunas que nomeia.
select public.set_project_drive_folder('11111111-1111-1111-1111-111111111111',
       'https://drive.google.com/drive/folders/ABC123');
select pg_temp.chk('1. grava drive_folder_url',
  (select drive_folder_url='https://drive.google.com/drive/folders/ABC123' from projects where name='Alfa'));
select pg_temp.chk('1b. demais colunas intactas',
  (select code='30.001' and start_date='2025-01-01' and end_date='2027-01-01' and active
     from projects where name='Alfa'));

do $$ begin
  perform public.set_project_drive_folder('22222222-2222-2222-2222-222222222222','https://evil.example.com/x');
  perform pg_temp.chk('2. rejeita URL fora do Drive', false);
exception when others then perform pg_temp.chk('2. rejeita URL fora do Drive', true);
end $$;

select public.set_project_drive_folder('11111111-1111-1111-1111-111111111111', null);
select pg_temp.chk('3. NULL limpa o vinculo',
  (select drive_folder_url is null from projects where name='Alfa'));

do $$ begin
  perform public.set_project_code('22222222-2222-2222-2222-222222222222','ABC');
  perform pg_temp.chk('4. rejeita codigo mal formado', false);
exception when others then perform pg_temp.chk('4. rejeita codigo mal formado', true);
end $$;

-- Dois projetos não podem reivindicar o mesmo centro de custo: seria o
-- auto-match do balancete (plano-trabalho.js:1171) casando com o projeto
-- errado, em silêncio.
do $$ begin
  perform public.set_project_code('22222222-2222-2222-2222-222222222222','30.001');
  perform pg_temp.chk('5. barra codigo duplicado', false);
exception when unique_violation then perform pg_temp.chk('5. barra codigo duplicado', true);
end $$;

-- Mas o placeholder pode repetir: é o que o Drive usa para projeto ainda sem
-- centro de custo atribuído.
select public.set_project_code('11111111-1111-1111-1111-111111111111','30.XXX');
select public.set_project_code('22222222-2222-2222-2222-222222222222','30.XXX');
select pg_temp.chk('6. permite 30.XXX repetido',
  (select count(*)=2 from projects where code='30.XXX'));

insert into public.rubricas(code,name,ordem) values ('zz','Teste',99);
select pg_temp.chk('7. audit_logs registra rubricas',
  (select count(*)>0 from audit_logs where table_name='rubricas'));

insert into public.planos_trabalho(id,project_id,ativo)
  values (gen_random_uuid(),'11111111-1111-1111-1111-111111111111',true);
select pg_temp.chk('7b. audit_logs registra planos_trabalho',
  (select count(*)>0 from audit_logs where table_name='planos_trabalho'));

-- É `old_data` que torna um valor sobrescrito recuperável. Sem PITR no plano
-- free, é a única forma de desfazer.
update public.planos_trabalho set ativo=false
 where project_id='11111111-1111-1111-1111-111111111111';
select pg_temp.chk('8. audit guarda old_data em UPDATE',
  (select count(*)>0 from audit_logs
    where table_name='planos_trabalho' and action='UPDATE' and old_data is not null));

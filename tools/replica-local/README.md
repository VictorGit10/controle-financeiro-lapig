# Réplica local do banco

Rig para rodar as RPCs da camada de decisão (`get_saldo_livre`, `simular_alocacao`)
contra um Postgres descartável, em vez do SQL Editor do Supabase.

Nasceu na validação da migração 039, que só foi possível porque havia um banco
com forma de banco real para conferir: foi ele que expôs o viés do ranking
(centro de custo sem balancete subindo ao topo porque o `realizado` era zero por
**ausência de dado**, não por execução) — o achado que gerou
`risco_devolucao.base` e o alerta em `resumo.observacao`.

São **dois níveis**, com custos bem diferentes. Comece pelo sintético.

---

## Nível 1 — sintético (`sintetico/`)

Não precisa de credencial, de dump nem de acesso ao banco real. Cinco centros de
custo desenhados para exercitar uma restrição cada:

| | Cenário | O que exercita |
|---|---|---|
| Alfa | pequeno, vence em 2026, tem pessoal e caixa | deve liderar o ranking |
| Beta | grande, vai até 2029 | mais dinheiro, menos urgência |
| Gama | plano sem nenhuma rubrica do grupo `a` | o portão duro (`sem_rubrica_pessoal`) |
| Delta | orçamento sobra, caixa não (parcela só em 2027) | `motivo_codigo = 'caixa'` |
| Epsilon | sem plano ativo | `sem_plano` |

```bash
docker run -d --name cf-teste -e POSTGRES_PASSWORD=postgres postgres:17-alpine
docker exec -i cf-teste psql -U postgres -c 'create database cf'
docker exec -i cf-teste psql -U postgres -d cf < tools/replica-local/sintetico/stub.sql
docker exec -i cf-teste psql -U postgres -d cf < database/038_saldo_livre.sql
docker exec -i cf-teste psql -U postgres -d cf < database/039_simular_alocacao.sql
docker exec -i cf-teste psql -U postgres -d cf < tools/replica-local/sintetico/seed.sql
```

`stub.sql` recria só o suficiente do schema para as duas migrações criarem e
executarem, e **stuba `is_admin()` como `true`** — ou seja, este nível não testa
escopo por usuário. Para isso, use o nível 2 ou a stack local completa.

## Nível 2 — réplica do banco real (`replica/`)

Mesma forma, volume e distorções dos dados de produção — planos que orçam na
letra-mãe, balancetes atrasados, centros de custo sem balancete nenhum. É o que
pega o caso que ninguém imaginaria escrever à mão.

Precisa de um dump da produção e do Docker. Desde 06/10/2026 a senha do banco só existe no cofre: o dump vem de um backup do cofre (Artifacts, decifrado pelo Victor com a senha dele, fora do PC; ver `docs/aplicar-migracao.md`). Os comandos abaixo valem para quem tiver a senha.

```bash
# 1. Puxar schema e dados. A tabela de bolsistas fica FORA: é onde moram
#    nome, CPF e e-mail. O resto é valor e data.
npx supabase db dump --db-url "$DB_URL" -f dump/schema.sql
npx supabase db dump --db-url "$DB_URL" --data-only --use-copy \
    -x public.scholarship_holders -f dump/dados.sql

# 2. Antes de restaurar, tirar do schema.sql o que não existe num Postgres
#    oficial (pg_stat_statements, supabase_vault) e a FK de scholarships →
#    scholarship_holders, que a pos_carga recria depois de inventar os bolsistas.

# 3. Restaurar
docker run -d --name cf-real -e POSTGRES_PASSWORD=postgres postgres:17-alpine
docker exec -i cf-real psql -U postgres -c 'create database cf'
docker exec -i cf-real psql -U postgres -d cf < tools/replica-local/replica/prep.sql
docker exec -i cf-real psql -U postgres -d cf < dump/schema.sql
docker exec -i cf-real psql -U postgres -d cf < dump/dados.sql
docker exec -i cf-real psql -U postgres -d cf < tools/replica-local/replica/pos_carga.sql
```

`prep.sql` cria o que o Supabase tem e o dump do schema `public` não traz: os
roles do PostgREST, o schema `extensions` e um stub de `auth.users` com
`auth.uid()` lendo o JWT do request — é isso que faz a impersonação por
`set_config('request.jwt.claims', ...)` funcionar igual à produção, e é o que as
policies de RLS e os guards das RPCs consultam.

`pos_carga.sql` inventa os bolsistas que faltam (só id e `Bolsista NNN`, para
satisfazer a FK), zera as colunas de texto livre que sobraram e **aborta** se
encontrar nome fora do padrão sintético ou PII em `app_users`.

### O que nunca é versionado

Os dumps. Mesmo sem a tabela de bolsistas, são valores financeiros reais de
projetos identificáveis, e o repositório é público. Escreva-os em
`tools/replica-local/dump/`, que está no `.gitignore`. O que fica versionado são
os scripts que **removem** dado, nunca os que o carregam.

Pela mesma razão, nenhum arquivo daqui contém senha, host ou id de projeto —
mesma regra dos roteiros em `tests/sql/`.

## Stack Supabase completa

Os dois níveis acima são Postgres puro: validam **cálculo**, sob impersonação
manual. Não têm PostgREST nem GoTrue, então não dizem nada sobre grant a
`authenticated`, exposição de RPC, parsing de JWT ou tradução de erro — que é
onde as migrações 035 e 037 acharam problema (o SQL calculava certo; a questão
era quem alcançava).

Para isso existe `supabase start`, já configurada em `supabase/config.toml` com
só o necessário ligado (db, auth, rest — realtime, storage, studio, edge_runtime
e analytics desligados). Restaure nela o schema `public` da réplica: a stack traz
o schema `auth` de verdade, no lugar do stub do `prep.sql`, e aí dá para logar
com e-mail e senha, receber um JWT real e chamar `/rest/v1/rpc/...` exatamente
como o servidor MCP vai chamar.

```bash
npx supabase start                       # config.toml ja versionado
DB=supabase_db_controle-financeiro-lapig

# Do container da replica para a stack. Sem --no-privileges: os 183 GRANTs e as
# 11 ALTER DEFAULT PRIVILEGES sao justamente o que se quer testar aqui.
docker exec cf-real pg_dump -U postgres -d cf --schema=public --schema-only --no-owner > dump/pub_schema.sql
docker exec cf-real pg_dump -U postgres -d cf --schema=public --data-only --no-owner --column-inserts \
    --exclude-table=public.app_users --exclude-table=public.user_projects > dump/pub_data.sql

docker exec "$DB" psql -U postgres -d postgres -c 'drop schema if exists public cascade;'
docker exec -i "$DB" psql -U postgres -d postgres < dump/pub_schema.sql
docker exec "$DB" psql -U postgres -d postgres -c 'create extension if not exists pg_trgm with schema extensions;'
# rubricas tem FK circular (parent_code): carregue com os triggers desligados.
(echo 'set session_replication_role = replica;'; cat dump/pub_data.sql) | docker exec -i "$DB" psql -U postgres -d postgres
```

`app_users` e `user_projects` ficam de fora do dump de propósito: os `user_id`
apontam para `auth.users` do projeto real, que não existem aqui. Crie usuários
locais pela admin API (`POST /auth/v1/admin/users` com a service_role key e
`email_confirm: true`) e insira as linhas apontando para os ids novos,
reproduzindo o escopo que interessa testar (1 admin sem centros, 1 professor com
alguns). Recrie também o trigger `on_auth_user_created` — ele mora em
`auth.users`, fora do dump do schema `public`.

**Armadilha:** não ponha `enable_signup = false` no `config.toml` para "espelhar
a produção". No `[auth.email]` isso vira `EXTERNAL_EMAIL_ENABLED=false` no
GoTrue, que desliga o **login** por e-mail junto com o cadastro — todo
`grant_type=password` passa a devolver `422 email_provider_disabled`. Em produção
o signup é fechado por outro parâmetro. Deixe ligado no local.

### O que este nível pega e os outros não

Com login de verdade, a matriz que importa passa a ser verificável ponta a ponta:

| Chamador | `get_saldo_livre` |
|---|---|
| anon, sem login | `401 permission denied for function` — o revoke da migração 035 |
| professor, centro de custo dele | `200` |
| professor, centro de custo alheio | `400 P0001 Acesso negado ao projeto …` — o `assert_project_allowed` |
| admin, o mesmo centro | `200` |

E dá para conferir o contrato que a 039 promete a quem consome (`todos os itens
têm o mesmo conjunto de chaves, inclusive os de curto-circuito`) contra o JSON
que de fato sai pelo PostgREST, não contra o que o SQL devolve no psql.

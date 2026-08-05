# Segurança para publicação (repo público + site no GitHub Pages)

Os dados do sistema (CPFs, e-mails, valores de bolsas, saldos) são **sensíveis**.
Publicar o repositório e o site **não** expõe esses dados por si só — eles vivem
no Supabase, atrás de autenticação + RLS. Mas isso só é verdade se **todos** os
itens abaixo estiverem garantidos. Revise este checklist **antes** de tornar o
repositório público e sempre que criar tabela/bucket novo.

## O modelo de segurança em uma frase

A `SUPABASE_KEY` do frontend (`sb_publishable_...`) é pública **por design** —
qualquer pessoa com ela pode chamar a API do Supabase. A proteção real é:
**(1) ninguém consegue criar conta** e **(2) toda tabela/bucket exige usuário
autenticado via RLS**. Se qualquer um dos dois falhar, os dados vazam.

## Checklist obrigatório (antes de publicar)

### 1. Desativar signup no Supabase — CRÍTICO

Dashboard → **Authentication → Sign In / Providers**:

- [ ] **Desmarcar "Allow new users to sign up"** (Email provider).
      Com signup aberto, qualquer pessoa com a anon key chama
      `supabase.auth.signUp()` direto pela API (sem passar pela nossa tela de
      login, que nem tem formulário de cadastro), vira `authenticated` e as
      políticas RLS (`to authenticated using (true)`) liberam **tudo**.
- [ ] Confirmar que **Anonymous sign-ins** está desativado.
- [ ] Usuários novos passam a ser criados só pelo Dashboard
      (Authentication → Users → "Add user").

### 2. RLS em todas as tabelas

- [ ] Rodar no SQL Editor e confirmar que **nenhuma** tabela aparece:

```sql
select schemaname, tablename
  from pg_tables
 where schemaname = 'public'
   and rowsecurity = false;
```

- [ ] Conferir que não há política `to anon` inesperada:

```sql
select tablename, policyname, roles
  from pg_policies
 where schemaname = 'public'
   and 'anon' = any(roles);
```

> Exceção conhecida: a landing page (e o keep-alive do n8n) lê `projects`
> ativos — se existir política `anon` para isso, confirme que ela expõe
> apenas os campos/linhas realmente públicos.

### 2b. Nenhuma função executável por `anon` — CRÍTICO

Esta é a barreira que **não** é o RLS. Funções `security definer` rodam
como o dono e **burlam o RLS**; o Postgres concede EXECUTE a `PUBLIC` por
padrão e o PostgREST expõe o schema `public` como RPC ao `anon`. Uma única
função definer sem guard = vazamento sem senha.

- [ ] Rodar `database/035_lockdown_anon.sql` (revoga EXECUTE de `anon` em
      todo o schema + `alter default privileges` para as funções futuras).
- [ ] Confirmar que a query abaixo volta **vazia**:

```sql
select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and has_function_privilege('anon', p.oid, 'EXECUTE');
```

> A própria migração 035 já faz essa asserção e aborta se falhar — dá para
> reexecutá-la a qualquer momento como reauditoria.

### 3. Storage privado

- [ ] Buckets `plano-trabalho-docs`, `balancete-pdfs` e `bolsa-planilhas`
      com `public = false` (Dashboard → Storage) e políticas apenas
      `to authenticated` (migrações 025, 026 e 031).

### 4. Nenhum segredo no repositório (nem no histórico)

- [ ] A `service_role` key **nunca** entra no código. Verificar histórico:

```bash
git log -S service_role --oneline
git log -S sb_secret --oneline
```

- [ ] `OLLAMA_API_KEY` vive só em Supabase Secrets (Edge Functions
      deprecated) — não aparece no repo.
- [ ] Cientes de que ficam públicos (aceitável por design): URL do projeto
      Supabase, anon/publishable key, DSN do Sentry (se configurado).
- [ ] `frontend/js/auth.js` tem o `USER_MAPPING` com e-mails reais dos
      usuários — avaliar se aceita expô-los ou remover o atalho de login.

### 5. Hardening opcional (recomendado)

- [ ] Authentication → Passwords: mínimo de 12+ caracteres e ativar
      **leaked password protection**.
- [ ] Authentication → Sessions: revisar tempo de expiração.
- [ ] Ativar MFA para os usuários do Dashboard (conta Supabase em si).
- [ ] Sentry: manter o DSN fora do repo (já é opt-in via `window.SENTRY_DSN`).

## Publicação no GitHub Pages

O workflow `.github/workflows/deploy.yml` publica `frontend/` a cada push na
branch principal. Para ativar:

1. Settings → Pages → **Source: GitHub Actions**.
2. Push na `master`/`main` (ou rodar o workflow manualmente).
3. O site fica em `https://<usuario>.github.io/<repo>/` — os paths do app são
   relativos, então funciona em subdiretório sem ajuste.

Lembretes:

- GitHub Pages **não** suporta headers HTTP customizados — a CSP do app é via
  `<meta http-equiv>` no `index.html`, o que já cobre o essencial.
- O site é público; a tela de login + RLS são a barreira. Não há problema em a
  URL circular, **desde que o checklist acima esteja 100%**.
- Se um dia o repositório precisar voltar a ser privado, GitHub Pages de repo
  privado exige plano pago — alternativas gratuitas: Cloudflare Pages/Netlify
  (ambos aceitam repo privado no free tier).

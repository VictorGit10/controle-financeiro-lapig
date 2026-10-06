# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Financial control system for LAPIG (Laboratório de Processamento de Imagens e Geoprocessamento / UFG). Migrated from Google Sheets + Apps Script to a Vanilla JS + Supabase web app. The entire UI and documentation are in **Brazilian Portuguese (pt-BR)**.

## Running the App

No build step. Serve `frontend/` with any static file server:
```bash
cd frontend && python -m http.server 8080
```
Or use `abrir-site.bat` in the project root. **Must use HTTP** — `file://` breaks `<script type="module">` (pure-fns.js). Supabase credentials live in `frontend/js/supabase-config.js`.

## Dev Tooling

The frontend has no build step — all JS loads via `<script>` tags. For linting, testing, and CI, the project uses Node.js:
```bash
npm ci          # install dev dependencies (eslint, vitest)
npm run lint    # run ESLint on frontend/js/ e mcp/
npm test        # run Vitest on tests/
```

CI runs on GitHub Actions (`.github/workflows/ci.yml`) on push/PR to main/master.

## Database Setup

Execute SQL scripts in `database/` **in numerical order** (001 → 053). Utility scripts are in `database/utils/` and test SQL in `tests/sql/`. Script `000_reset_completo.sql` is destructive — drops all tables and data. Never run it unless intentionally resetting.

Antes de mexer em qualquer área coberta por uma migração, leia a linha dela em **[docs/migracoes.md](docs/migracoes.md)** (025–053: tabelas, RPCs e o gotcha operacional de cada uma) e o cabeçalho do próprio `.sql`. Regras que valem para toda migração nova, aprendidas nelas:
- `create or replace` reescreve os atributos da função: repita `security definer`/`invoker`, `set search_path = public, pg_temp` e o guard (lição da 036).
- `drop` + `create` leva a ACL junto: restaure os grants da 035 explicitamente.
- Tabela nova não ganha sozinha o gatilho que barra o agente (051): rode o BLOCO 1 de `tests/sql/test_051_buriti_propostas.sql`.
- Toda migração vem com roteiro autoconferido em `tests/sql/` (+ stub que prova o defeito antes da correção) e asserções no fim do próprio arquivo, dentro de `begin/commit`.
- Acrescente a linha da migração em `docs/migracoes.md`, não aqui.

**Como uma migração chega à produção:** pelo cofre (`CofreIA/cofre-lapig`, fora do alcance dos agentes), não colando no SQL Editor. Publique o commit no `master`; o Claude dispara `ensaiar` no cofre, manda ao Victor um resumo (relatório + revisão do SQL por outra IA) e, com o "ok" dele no chat, dispara `aplicar` com o código de aprovação. Comandos na receita "Aplicar migração no banco" do `CLAUDE.md` do Projeto Regente. Para passar no cofre:
- BEGIN só na primeira linha de comando e COMMIT só na última (o cofre os retira e controla a transação); nada de COMMIT/SAVEPOINT no meio, `CREATE INDEX CONCURRENTLY`, VACUUM, gatilho adiável;
- nada de papéis, extensões, `ALTER DEFAULT PRIVILEGES`, COPY, `set role`/`search_path` de sessão, nem as palavras `net.`, `http(`, `dblink`, `cron.`, `vault.`, `password`, `service_role` no texto (recusa por leitura);
- tabela nova: RLS ligado, `revoke ... from anon` (tabela e função) e o gatilho `trg_bloqueia_agente` **BEFORE INSERT OR UPDATE OR DELETE FOR EACH STATEMENT**, sem WHEN; SECURITY DEFINER sempre com `set search_path`;
- não tocar `is_agente`, `is_admin`, `allowed_project_ids`, `assert_project_allowed`, `contem_cpf`, `bloqueia_escrita_do_agente` (o cofre recusa; mudança nelas é decisão à parte);
- até 90 KB. Policy, view, SECURITY DEFINER ou DO/EXECUTE fazem o relatório pedir revisão técnica: rode a revisão do SQL do commit por outra IA e mande o resumo ao Victor junto.

## Detailed Documentation

Detailed reference docs are in `docs/` — índice completo em **[docs/README.md](docs/README.md)**. Read them when working on the related area:
- **[Architecture](docs/architecture.md)** — Script load order, module pattern, auth, ChartBuilder, SimulationEngine
- **[Pages](docs/pages.md)** — Dashboard, Projects, Holders, Funding, Observações, CrudPage factory
- **[Database](docs/database.md)** — Core tables, schema details, RPC functions, views
- **[Globals](docs/globals.md)** — Global utilities from pure-fns.js and supabase-config.js
- **[Planos fora do padrão](docs/planos-fora-do-padrao.md)** — Leitura do PROAD em PDF, modelos-exceção (FAPEG, Prefeitura/emenda impositiva), detecção de modelo, roteamento por conteúdo e preenchimento manual
- **[Migrações](docs/migracoes.md)** — uma linha por migração 025–053: o que cria, a semântica e o gotcha. Leia antes de mexer na área.
- **[Convenções](docs/convencoes.md)** — o detalhe (porquê, incidente, teste) de cada item de "Key Conventions" abaixo.
- **[Acesso ao banco](docs/acesso-ao-banco.md)** — **Leia ANTES de qualquer escrita no banco de produção.** As 4 credenciais e o alcance de cada uma, regras duras (nunca PATCH/DELETE sem filtro; simular e aplicar em turnos separados), protocolo de escrita, login de automação e recuperação
- **[Histórico](docs/historico/)** — relatórios datados (bug hunt e revisão externa, ambos de 2026-07-16). **Não são referência viva**: cada um diz quando foi conferido pela última vez e o que segue aberto. Não descrevem o sistema de hoje — consulte antes de "redescobrir" um bug, e nunca como fonte sobre o estado atual.

`AGENTS.md` na raiz é só um **ponteiro** para este arquivo. Era uma cópia manual e divergiu (descrevia `expenses.js`, ignorava o multi-tenancy); virou ponteiro em 2026-08-28 para que não haja duas versões. Se estas instruções mudarem, o `AGENTS.md` não precisa de nada.

## Key Conventions

Uma linha por regra; o porquê e os incidentes de cada uma estão em **[docs/convencoes.md](docs/convencoes.md)**. Leia o item antes de mexer na área.

- **Sem build no frontend**: JS nativo por `<script>`; só `pure-fns.js` é `type="module"` e se expõe no `window`. Lint/teste/CI via Node (`package.json`).
- **Conventional commits**: `feat:`, `fix:`, `chore:`, `docs:`.
- **CSS**: design system em `frontend/css/style.css` com custom properties.
- **CDN com fallback local** (`frontend/vendor/`, SRI): as 7 cópias têm de existir; procedimento em `frontend/vendor/README.md`.
- **Keep-alive do Supabase** por n8n a cada 2 dias (`tools/n8n-keep-alive-lapig.json`, `docs/keep-alive-n8n.md`).
- **Segurança**: CSP no `index.html`, Sentry em `supabase-config.js`.
- **Multi-tenancy (033/034)**: papéis `admin`/`professor`/`agente` em `app_users`, escopo em `user_projects`. **O RLS é a barreira real** (a anon key é pública); a `service_role` nunca vai ao frontend; o sidebar é só UX.
- **localStorage** com prefixo `cf_`; `cf_selected_project_id` é o "projeto atual", lido por 5 telas (Saldos destaca em vez de filtrar).
- **Mudanças não salvas**: `Router.registerGuard`/`registerDirtyChecker`, hoje só em `projetos.js`.
- **Edge Functions**: só `assistente` está viva; `extract-*` são deprecated (a extração é determinística nos parsers). Deploy manual (`supabase/functions/assistente/README.md`).
- **Servidor MCP** (`mcp/`): **zero lógica financeira no adaptador** (todo número sai de RPC); login por usuário (o RLS decide); stdout só para o protocolo; smoke com os dois logins. Tools do Buriti só no MCP.
- **Aba Assistente**: o laço de tool calling roda no browser sobre as mesmas RPCs; os dois adaptadores (`mcp/src/tools.js` e `frontend/js/ai/tools.js`) são travados por `tests/ai-tools.test.js`.
- **Testes locais do banco**: `tools/replica-local/` (sintético, réplica sem PII, stack Supabase local). Dumps nunca versionados.
- **Parsers determinísticos** em `frontend/js/parsers/` (balancete, plano DOCX/PDF, planilha de bolsas) e split-views em `frontend/js/components/`.
- **Visão do Projeto** (`hub.js`): tela agregadora experimental, só leitura.
- **Fila de importação** (`import-queue.js`): contrato de handler no cabeçalho do arquivo; `fallbackExt`, `rerouteTo` e `manualFallback` existem para os planos fora do padrão.
- **Sino de alertas** é montado no boot (`app.js`), cobre os centros ativos visíveis e tem 3 estados (consultando/indisponível/contagem).
- **Falha de consulta nunca vira zero**: banner do que falhou e `—` no KPI, nunca `formatBRL(0)`.
- **Detalhe técnico só para admin** (`detalheTecnico()`): não é segurança, é público-alvo.
- **Página Buriti**: o agente propõe, o humano aplica pela mesma revisão da importação comum; a revisão tem três grupos (Precisa de você / Já classificadas / Não entram em rubrica).
- **Sidebar em seções**: Rotina Mensal / Acompanhamento / Cadastros; só "Usuários & Centros de Custo" é admin.
- **Publicação**: `deploy.yml` publica `frontend/` no GitHub Pages a partir do `master`; antes de tornar o repo público, `docs/seguranca-publicacao.md`.
- **A projeção mensal vem da RPC** (`calc_project_monthly`); o `SimulationEngine` só responde dentro da simulação.
- **Valores monetários** em `numeric`; exibição com `formatBRL()`.
- **Página inicial** é `projetos` (também na re-inicialização).

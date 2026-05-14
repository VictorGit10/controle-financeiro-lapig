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
npm run lint    # run ESLint on frontend/js/
npm test        # run Vitest on tests/
```

CI runs on GitHub Actions (`.github/workflows/ci.yml`) on push/PR to main/master.

## Database Setup

Execute SQL scripts in `database/` **in numerical order** (001 → 027). Utility scripts are in `database/utils/` and test SQL in `tests/sql/`. Script `000_reset_completo.sql` is destructive — drops all tables and data. Never run it unless intentionally resetting.

Migration `025_plano_trabalho.sql` adds the Plano de Trabalho stack (tables `rubricas`, `planos_trabalho`, `plano_rubricas`, `plano_desembolsos`), Storage bucket `plano-trabalho-docs`, RPCs (`upsert_plano_trabalho`, `ativar_plano_trabalho`, `get_plano_ativo`, `get_planos_historico`), and the `funape_managed` flag on `projects`.

Migration `026_balancetes.sql` adds the Balancete stack (tables `balancetes`, `balancete_lancamentos`, `conta_rubrica_map`), Storage bucket `balancete-pdfs`, RPCs (`upsert_balancete`, `get_balancetes_by_project`, `get_balancete_detalhado`, `get_previsto_vs_realizado`), a trigger (`block_expenses_for_funape`) que **bloqueia inserts em `expenses` para projetos FUNAPE**, e uma deleção one-time dos expenses existentes desses projetos. O mapeamento conta → rubrica usa **longest-prefix-match** via `resolve_rubrica_for_conta()`.

Migration `027_conta_rubrica_audit.sql` adiciona seeds de mapeamento descobertos na auditoria dos balancetes reais (`7.1.3.05.01.00062 FUNDO INSTITUCIONAL → cip_ufg`, `7.1.3.20 EQUIPAMENTOS → f`, `7.1.3.01.01/02/03 → a.colab/a.enc/a.colab`) e estende `upsert_balancete` para aceitar `new_mappings: [{ conta_prefix, rubrica_code }]` opcional — cadastrado pelo usuário durante a revisão do balancete (UI marca checkbox "salvar" em linhas não-mapeadas).

## Detailed Documentation

Detailed reference docs are in `docs/`. Read them when working on the related area:
- **[Architecture](docs/architecture.md)** — Script load order, module pattern, auth, ChartBuilder, SimulationEngine
- **[Pages](docs/pages.md)** — Dashboard, Projects, Holders, Funding, Expenses, CrudPage factory
- **[Database](docs/database.md)** — Core tables, schema details, RPC functions, views
- **[Globals](docs/globals.md)** — Global utilities from pure-fns.js and supabase-config.js

## Key Conventions

- **No frontend build step.** All JS is browser-native ES5/ES6 loaded via `<script>` tags, except `pure-fns.js` which loads as `<script type="module">` and bridges exports to `window` for classic scripts. Dev tooling (eslint, vitest) runs via Node.js (`package.json`).
- **Conventional commits:** `feat:`, `fix:`, `chore:`, `docs:` prefixes.
- **CSS design system:** `frontend/css/style.css` (~1760 lines) uses CSS custom properties for theming. LAPIG institutional colors, glassmorphism effects.
- **CDN with local fallback:** Libraries (Chart.js, Lucide, Supabase SDK) load from CDN with SRI integrity hashes. If CDN fails, `frontend/vendor/` provides local copies.
- **Security:** CSP meta tag in `index.html`. Sentry integration in `supabase-config.js` for error monitoring.
- **localStorage keys** use `cf_` prefix: `cf_selected_project_id`, `cf_dashboard_selected_projects`, `cf_plano_trabalho_project_id`.
- **Edge Functions** ficam em `supabase/functions/`. Ambas (`extract-plano-trabalho` e `extract-balancete`) eram proxies Ollama Cloud (`kimi-k2.6:cloud`) e estão **deprecated** desde 2026-05. O frontend não chama mais nenhuma — a extração é 100% determinística: `frontend/js/parsers/balancete-parser.js` (PDF→regex) e `frontend/js/parsers/pt-parser.js` (DOCX→mammoth→HTML→parser). As funções permanecem deployadas como histórico. Deploy manual via `supabase functions deploy <name>`. Secret `OLLAMA_API_KEY` continua configurado mas não é mais consumido em runtime.
- **Parsers e componentes determinísticos** ficam em `frontend/js/parsers/` (balancete + plano de trabalho + tabela de aliases de rubrica) e `frontend/js/components/` (split-views PDF e DOCX). São módulos ES carregados via `<script type="module">` no `index.html` e bridge-ados ao `window` para uso pelos scripts clássicos.
- **All monetary values** are stored and calculated as numeric (no integer cents). Display uses `formatBRL()`.
- **Default landing page** is `projetos`, not dashboard (re-init cai em `saldos` se não houver rota corrente — ver `app.js:11,45`).
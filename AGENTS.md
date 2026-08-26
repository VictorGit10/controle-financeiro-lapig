# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Financial control system for LAPIG (Laboratório de Processamento de Imagens e Geoprocessamento / UFG). Migrated from Google Sheets + Apps Script to a Vanilla JS + Supabase web app. The entire UI and documentation are in **Brazilian Portuguese (pt-BR)**.

## Running the App

No build step. Serve `frontend/` with any static file server:
```bash
cd frontend && python -m http.server 8080
```
Or open `frontend/index.html` directly in a browser. Supabase credentials live in `frontend/js/supabase-config.js`.

## Dev Tooling

The frontend has no build step — all JS loads via `<script>` tags. For linting, testing, and CI, the project uses Node.js:
```bash
npm ci          # install dev dependencies (eslint, vitest)
npm run lint    # run ESLint on frontend/js/
npm test        # run Vitest on tests/
```

CI runs on GitHub Actions (`.github/workflows/ci.yml`) on push/PR to main/master.

## Database Setup

Execute SQL scripts in `database/` **in numerical order** (001 → 041). Utility scripts are in `database/utils/` and test SQL in `tests/sql/`. Script `000_reset_completo.sql` is destructive — drops all tables and data. Never run it unless intentionally resetting. Stop short of the last migration and the decision-layer RPCs are missing: `get_saldo_livre` (038), `simular_alocacao` (039) and `get_panorama` (040) — the MCP server in `mcp/` does not run without them.

## Detailed Documentation

Detailed reference docs are in `docs/`. Read them when working on the related area:
- **[Architecture](docs/architecture.md)** — Script load order, module pattern, auth, ChartBuilder, SimulationEngine
- **[Pages](docs/pages.md)** — Dashboard, Projects, Holders, Funding, Expenses, CrudPage factory
- **[Database](docs/database.md)** — Core tables, schema details, RPC functions, views
- **[Globals](docs/globals.md)** — Global utilities from supabase-config.js
- **[Acesso ao banco](docs/acesso-ao-banco.md)** — **Leia ANTES de qualquer escrita no banco de produção.** As 4 credenciais e o alcance de cada uma, regras duras (nunca PATCH/DELETE sem filtro; simular e aplicar em turnos separados), protocolo de escrita, login de automação e recuperação

## Key Conventions

- **No frontend build step.** All JS is browser-native ES5/ES6 loaded via `<script>` tags. Dev tooling (eslint, vitest) runs via Node.js (`package.json`).
- **Conventional commits:** `feat:`, `fix:`, `chore:`, `docs:` prefixes.
- **CSS design system:** `frontend/css/style.css` (~1700 lines) uses CSS custom properties for theming. LAPIG institutional colors, glassmorphism effects.
- **CDN with local fallback:** Libraries (Chart.js, Lucide, Supabase SDK) load from CDN with SRI integrity hashes. If CDN fails, `frontend/vendor/` provides local copies.
- **Security:** Content-Security-Policy header in `index.html`. Sentry integration in `supabase-config.js` for error monitoring.
- **localStorage keys** use `cf_` prefix: `cf_selected_project_id`, `cf_dashboard_selected_projects`.
- **All monetary values** are stored and calculated as numeric (no integer cents). Display uses `formatBRL()`.
- **MCP server** lives in `mcp/` (own Node package, `type: module`). Thin adapter over the decision RPCs (038/039/040) with **zero financial logic** — the site tab consumes the same RPCs, and two implementations of the same math would diverge. Authenticates per user, so RLS is the barrier. See `mcp/README.md`.
- **Assistente tab** (`frontend/js/ai/` + `frontend/js/pages/assistente.js` + Edge Function `assistente`) is phase 3 of the AI layer: native tool calling against Ollama Cloud, **same rule — zero financial logic**. The loop runs in the browser (tools call the RPCs through the already-logged-in `supabaseClient`, so RLS is the barrier and the screen can show which RPC was consulted, with the raw JSON); the Edge Function only guards `OLLAMA_API_KEY` and the model allowlist. `tests/ai-tools.test.js` locks the tool list and the four framing rules against the MCP source so the two adapters cannot drift apart.
- **Default landing page** is `projects`, not dashboard.
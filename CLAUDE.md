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

Execute SQL scripts in `database/` **in numerical order** (001 → 031). Utility scripts are in `database/utils/` and test SQL in `tests/sql/`. Script `000_reset_completo.sql` is destructive — drops all tables and data. Never run it unless intentionally resetting.

Migration `025_plano_trabalho.sql` adds the Plano de Trabalho stack (tables `rubricas`, `planos_trabalho`, `plano_rubricas`, `plano_desembolsos`), Storage bucket `plano-trabalho-docs`, RPCs (`upsert_plano_trabalho`, `ativar_plano_trabalho`, `get_plano_ativo`, `get_planos_historico`), and the `funape_managed` flag on `projects`.

Migration `026_balancetes.sql` adds the Balancete stack (tables `balancetes`, `balancete_lancamentos`, `conta_rubrica_map`), Storage bucket `balancete-pdfs`, RPCs (`upsert_balancete`, `get_balancetes_by_project`, `get_balancete_detalhado`, `get_previsto_vs_realizado`), a trigger (`block_expenses_for_funape`) que **bloqueia inserts em `expenses` para projetos FUNAPE**, e uma deleção one-time dos expenses existentes desses projetos. O mapeamento conta → rubrica usa **longest-prefix-match** via `resolve_rubrica_for_conta()`.

Migration `027_conta_rubrica_audit.sql` adiciona seeds de mapeamento descobertos na auditoria dos balancetes reais (`7.1.3.05.01.00062 FUNDO INSTITUCIONAL → cip_ufg`, `7.1.3.20 EQUIPAMENTOS → f`, `7.1.3.01.01/02/03 → a.colab/a.enc/a.colab`) e estende `upsert_balancete` para aceitar `new_mappings: [{ conta_prefix, rubrica_code }]` opcional — cadastrado pelo usuário durante a revisão do balancete (UI marca checkbox "salvar" em linhas não-mapeadas).

Migration `028_reconciliacao_bolsas.sql` adiciona as colunas `cpf` (text, 11 dígitos, `unique`, normalizado para só-dígitos) e `education_level` (text, "Formação" do FUNAPE) em `scholarship_holders`, e `scholarship_type` (text, "Tipo" do FUNAPE) em `scholarships`. Cria o índice parcial `idx_holders_cpf` e a RPC `apply_reconciliation(p_project_id, p_actions jsonb)` — aplica as mudanças aprovadas na revisão de reconciliação (creates/updates/ends numa transação) e registra em `scholarship_audit` com `action='reconciliation'`.

Migration `029_holder_merge_reconciliacao_global.sql` reescreve `apply_reconciliation` para reconciliação **global**: `creates` agora aceita `holder_id` (vincula a bolsa a um holder já cadastrado via outro projeto em vez de criar duplicado, com backfill de cpf/e-mail/formação e nome da planilha FUNAPE como fonte da verdade), faz upsert por CPF quando só o CPF bate, ou cria holder novo. Adiciona a RPC `merge_holders(p_canonical_id, p_duplicate_ids uuid[])` — repointa as bolsas dos duplicados para o holder canônico, consolida cpf/e-mail/formação/ativo (canônico tem precedência, nulos preenchidos a partir dos duplicados) e remove os duplicados. Loga em `scholarship_audit` com `action='merge_holders'`.

Migration `030_delete_holder_cascade.sql` adiciona a RPC `delete_holder_cascade(p_holder_id)` — remove as bolsas vinculadas e o bolsista numa única transação, dando uma saída deliberada ao `ON DELETE RESTRICT` das FKs (migrações 022/024). É chamada pela tela de Bolsistas **somente após confirmação explícita** do usuário quando o bolsista possui bolsas (ex.: duplicata); o RESTRICT no banco continua intacto como rede de segurança, e as exclusões são registradas em `audit_logs` pelo trigger da migração 023.

Migration `031_reconciliacoes.sql` adiciona a tabela `reconciliacoes` — registro de cada reconciliação de bolsas FUNAPE aplicada (projeto, `competencia` normalizada para o dia 1 do mês, `resumo` jsonb com as contagens do diff, caminho do XLSX arquivado) — e o bucket privado `bolsa-planilhas` no Storage. Alimenta o checklist da página **Fechamento Mensal** e o histórico da aba Reconciliação. O frontend trata a ausência da migração com banner de aviso (registro best-effort, sem quebrar o `apply_reconciliation`).

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
- **CDN with local fallback:** Libraries (Chart.js, Lucide, Supabase SDK, Mammoth, pdf.js, SheetJS) load from CDN with SRI integrity hashes. If CDN fails, `frontend/vendor/` provides local copies.
- **Keep-alive do Supabase via n8n:** `n8n-keep-alive-lapig.json` (workflow) + `N8N_KEEP_ALIVE_SETUP.md` (guia) evitam que o projeto gratuito do Supabase entre em pausa por inatividade (7 dias). A cada 2 dias, o workflow faz uma query de leitura idêntica à da landing page (`projects` ativos). Não altera dados.
- **Security:** CSP meta tag in `index.html`. Sentry integration in `supabase-config.js` for error monitoring.
- **localStorage keys** use `cf_` prefix: `cf_selected_project_id`, `cf_dashboard_selected_projects`, `cf_plano_trabalho_project_id`, `cf_plano_trabalho_tab`, `cf_holders_tab`. (`cf_recon_project_id` foi aposentada — o projeto da reconciliação agora é escolhido por arquivo na fila de importação.)
- **Navegação com mudanças não salvas:** o `Router` expõe `registerGuard(fn)` e `registerDirtyChecker(fn)` (consumidos por `projetos.js` e `saldos.js`); `hasUnsavedChanges()` alimenta o `beforeunload` em `app.js` que avisa ao fechar/recarregar a aba. Mudanças não salvas no modo editor (Projetos) e nos saldos pendentes (Saldos) pedem confirmação antes de trocar de rota.
- **Edge Functions** ficam em `supabase/functions/`. Ambas (`extract-plano-trabalho` e `extract-balancete`) eram proxies Ollama Cloud (`kimi-k2.6:cloud`) e estão **deprecated** desde 2026-05. O frontend não chama mais nenhuma — a extração é 100% determinística: `frontend/js/parsers/balancete-parser.js` (PDF→regex) e `frontend/js/parsers/pt-parser.js` (DOCX→mammoth→HTML→parser). As funções permanecem deployadas como histórico. Deploy manual via `supabase functions deploy <name>`. Secret `OLLAMA_API_KEY` continua configurado mas não é mais consumido em runtime.
- **Parsers e componentes determinísticos** ficam em `frontend/js/parsers/` (balancete + plano de trabalho + tabela de aliases de rubrica + planilha de bolsas FUNAPE) e `frontend/js/components/` (split-views PDF e DOCX). São módulos ES carregados via `<script type="module">` no `index.html` e bridge-ados ao `window` para uso pelos scripts clássicos. `bolsa-parser.js` lê XLSX via **SheetJS** (`window.XLSX`, CDN `xlsx@0.18.5` + fallback em `frontend/vendor/xlsx.full.min.js`) e devolve `{ data, warnings }`; `bolsa-comparator.js` compara planilha × banco e devolve `{ novos, removidos, alterados, iguais }` (com `matchKind` `link`/`new` e `existingHolderId` para evitar duplicados globais).
- **Página "Visão do Projeto" (`hub.js`)** é uma tela agregadora **experimental** (somente leitura) que reúne os 4 KPIs-chave de um projeto e atalhos "Abrir" para cada área. Compartilha o projeto selecionado com a aba Projetos (`cf_selected_project_id`). Registrada no `Router` como `hub` e no sidebar com ícone `telescope`.
- **Fila de importação genérica (`frontend/js/import-queue.js`)** — componente global `ImportQueue` (classic script) com o contrato de handler documentado no cabeçalho do arquivo. Handlers existentes: plano DOCX e balancete PDF (`PlanoTrabalhoPage.getImportHandlers()`) e bolsas XLSX (`HoldersPage.getBolsaImportHandler()`). A página **Fechamento Mensal** (`fechamento.js`, rota `fechamento`) abre a fila com os 3 handlers de uma vez (roteamento por extensão) e mostra o checklist da competência: projetos FUNAPE ativos × balancete recebido × planilha de bolsas conferida × plano ativo.
- **Sidebar em seções** (`index.html` + `.sidebar__section` no CSS): "Rotina Mensal" (Fechamento, Saldos), "Acompanhamento" (Projetos, Visão do Projeto, Plano de Trabalho, Visão Geral), "Cadastros" (Bolsistas, Gestão de Projetos, Desembolsos, Gastos).
- **Publicação:** `.github/workflows/deploy.yml` publica `frontend/` no GitHub Pages (Settings → Pages → Source: GitHub Actions). **Antes de tornar o repo público**, cumprir o checklist de `docs/seguranca-publicacao.md` — em especial desativar signup no Supabase Auth (a anon key é pública; a proteção é signup fechado + RLS `to authenticated`).
- **All monetary values** are stored and calculated as numeric (no integer cents). Display uses `formatBRL()`.
- **Default landing page** is `projetos`, not dashboard (re-init cai em `saldos` se não houver rota corrente — ver `app.js:11,45`).
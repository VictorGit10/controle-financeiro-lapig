# Page Modules

## DashboardPage (`dashboard.js`)

Consolidated overview with project filter, notification bell alerts, monthly chart. Uses `calc_projects_batch` RPC to avoid N+1 queries.

**Features:**
- **Project filter panel** — toggleable checkbox grid; persists selection to `localStorage` (`cf_dashboard_selected_projects`); "Todos" / "Nenhum" quick-select
- **Notification bell** — dropdown showing alerts per project (severity-colored: danger/warning/info); uses `get_alerts_for_projects` batch RPC; badge count
- **Balance status control** — `<select>` with 3 modes: `unpaid_current`, `paid_current`, `unpaid_previous`; auto-inferred from `balance_date` via `inferBalanceStatus()`
- **4 KPI cards** — Active Projects, Saldo Atual (FUNAPE), Bolsistas Ativos (scholarships with `status='active'` and dates within current period), Bolsas/Mes Atual
- **Monthly projection chart** — aggregated stacked bar via `ChartBuilder.buildFinancialChart`; tries `calc_projects_batch` first, falls back to N+1
- **Active holders table** — scholarships with `status='active'` AND `start_date <= today` AND `end_date >= today` across selected projects; shows name, project badge, amount, dates, "Vencida" badge

## ProjetosPage (`projetos.js`)

Project detail with monthly chart, holders panel, and Editor Mode for what-if simulation. Persists selected project in `localStorage` (`cf_selected_project_id`).

**Features:**
- **Project selector dropdown** — warns before switching if editor mode has unsaved changes
- **4 KPI cards** — Saldo Atual, Bolsas/Mes, Vigencia, Saldo Projetado ("Simulacao" badge in editor mode)
- **Monthly chart** — per-project projection; in editor mode, shows `originalData` overlay for comparison
- **Editor Mode** — inline editing of scholarships (amount, dates, status); drafts kept in `draftScholarships` array; real-time chart recalculation via `SimulationEngine`; saved via `save_editor_changes` RPC
- **CRUD modal** — create/edit project with fields including "Incluir no Dashboard Geral" checkbox (uses `save_project` RPC for transactional project + dashboard_settings upsert)

## GestaoPage (`gestao-projetos.js`)

Project management CRUD built on `CrudPage` with custom `onSave` (delegates to `save_project` RPC for transactional project + dashboard_settings upsert) and `onDelete` (RESTRICT-safe). Uses `loadExtra` to fetch `dashboard_settings.include_in_general`.

## HoldersPage (`holders.js`)

Custom CRUD for scholarship holders (not using CrudPage) because of unique features: scholarship management sub-modals, timeline chart, alert banner.

**Features:**
- **Search bar** — text filter by holder name (150ms debounce)
- **Project filter dropdown** — filters holders by project association
- **Inactive filter** — toggle to show/hide holders with only inactive scholarships (`onToggleInactive`)
- **Group by project** — checkbox to group the holder list by their primary associated project (`toggleProjectGroup`)
- **Alert banner** — collapsible warning for scholarships ending within 90 days (`ALERT_DAYS = 90`), grouped by project
- **Holders table** — Name (with "Encerrando" badge), Active Scholarships (list with project names and amounts — only scholarships with `status='active'` and dates within current period), Total Monthly Amount (highlighted), Status
- **Manage Scholarships modal** — sub-table listing all scholarships for a holder; "Adicionar Nova Bolsa" button; edit opens nested scholarship form
- **Scholarship form** — "external funding source" checkbox (hides project dropdown, shows free-text field); fields: project/funding source, amount, dates, status, notes
- **Timeline chart** (`viewTimeline`) — stacked bar chart showing monthly scholarship amounts over the actual scholarship period (earliest start to latest end), colored per project; scrollable data table below

## SaldosPage (`saldos.js`)

Monthly balance entry per project. Uses `get_balances_for_month` RPC to list all projects and their balances for a reference month.

**Features:**
- **Month navigation** — dropdown month/year selectors with prev/next buttons; warns before navigating if there are unsaved changes
- **3 KPI cards** — Total FUNAPE, Com Saldo (projects with a balance row), Pendentes (active projects without a balance row)
- **Balance table** — inline editable fields per project: Saldo FUNAPE (R$), Rendimentos (R$), Data do Saldo. Empty fields are treated as "not reported" (null), distinct from a zero value. Rows with no data entered are skipped on save.
- **Dirty tracking** — changed rows highlighted; batch save via `upsert_project_balance` RPC; discard button with confirmation

## FundingPage (`funding.js`) and ExpensesPage (`expenses.js`)

Both built on the generic `CrudPage` module with server-side pagination, debounced search (300ms), and CSV export.

**Funding** — entity "Desembolso" (masculine), table `funding_releases`, stats via `funding_stats` RPC (total + count). Fields: project, description, date+amount (composite row), notes.

**Expenses** — entity "Gasto" (masculine), table `expenses`, stats via `expenses_stats` RPC (total + count + category count). Fields: project, description, date+amount (composite row), category (with `<datalist>` suggestions), notes. Values display with `currency--negative` CSS class. **Projetos FUNAPE são filtrados do dropdown de projeto** (gastos vêm do balancete; o backend bloqueia inserts via trigger `block_expenses_for_funape`).

## PlanoTrabalhoPage (`plano-trabalho.js`)

Página agregadora com **3 abas** que cobre todo o ciclo orçamentário de um projeto. Página custom (não usa `CrudPage`).

**Seletor de projeto** — dropdown único no topo (persistido em `cf_plano_trabalho_project_id`). Aba atual lembrada em `cf_plano_trabalho_tab`. Botão "Importar" no topbar muda de label conforme a aba ativa (Plano vs. Balancete).

### Aba "Orçamento"

Visualização da versão **ativa** do Plano de Trabalho.

- **4 cards de KPI** — Total do plano, Despesas, CIP, DAO.
- **Tabela hierárquica de rubricas** — a-g com sub-itens de `a-Pessoal` indentados; sub-itens livres de b/e/f via `descricao_livre`.
- **Cronograma de desembolso** — parcela, data prevista, valor.
- **Sidebar de versões** — chips Original/Remanejamento, badge Ativa, botões Ver / Ativar / Baixar / Excluir.
- **Importação** (modal 3 steps): seleciona DOCX → Mammoth.js extrai texto → Edge Function `extract-plano-trabalho` → form editável → upload Storage + `upsert_plano_trabalho` RPC. `versao` é calculado server-side; trigger `enforce_single_plano_ativo` garante 1 versão ativa.

### Aba "Balancetes"

Lista cronológica dos balancetes mensais importados (FUNAPE PDF).

- **Tabela** — data referência, emissão, saldo disponível, rendimento, total débitos, ações (Ver / Baixar / Excluir).
- **Detalhamento** — clicar "Ver" abre modal com todos os lançamentos `7.1.3.x` e a rubrica resolvida.
- **Importação** (modal 3 steps): seleciona PDF → **pdf.js** extrai texto preservando quebras de linha pela coordenada Y → Edge Function `extract-balancete` (Ollama Cloud `kimi-k2.6:cloud`) → form de revisão com **detecção automática do projeto** pelo `project_code` no PDF (procura em `projects.code`) → upload `balancete-pdfs` + `upsert_balancete` RPC. O trigger `trg_auto_resolve_rubrica` em `balancete_lancamentos` resolve a rubrica de cada lançamento automaticamente.
- Após importar, a aba muda para "Previsto x Realizado" automaticamente.

### Aba "Previsto x Realizado"

Cruzamento do plano ativo com o balancete mais recente (RPC `get_previsto_vs_realizado`).

- **4 KPIs** — Saldo disponível, Rendimento, Previsto total, Realizado total.
- **Tabela por rubrica** — Previsto, Realizado, Saldo (R$), % Executado (colorido: verde ≤90%, amarelo 90-100%, vermelho >100%).
- **Lançamentos não mapeados** — card secundário com despesas tributárias/bancárias que não bateram com nenhuma rubrica (configurável via `conta_rubrica_map`).

**Globais usadas:** `formatBRL`, `escapeAttr`, `formatDate`, `toInputDate`, `showToast`, `createModal`, `confirmAction`, `supabaseClient`, `mammoth`, `pdfjsLib`.

## CrudPage Generic Module

`CrudPage(config)` in `crud-page.js` is a factory function that generates a full CRUD page from a config object. Key config properties: `tableName`, `dateField`, `entityLabel`, `entityIcon`, `globalName`, `gender`, `columns`, `formFields`, `statsCards`, `statsRpc`. Returns `{ load, openForm, remove, refresh, onSearch, goToPage, exportCSV }`. Server-side pagination via `.range(from, to)` with `{ count: 'exact' }`. CSV export fetches all records without pagination.
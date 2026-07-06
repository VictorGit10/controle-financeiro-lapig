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
- **Guard de simulação** — `registerGuard`/`registerDirtyChecker` (`hasDraftChanges` = rascunhos novos/modificados ou contagem diferente do original): ao trocar de rota com simulação não salva, pede confirmação e descarta (`discardSimulationChanges`); o `beforeunload` em `app.js` avisa ao fechar/recarregar a aba
- **CRUD modal** — create/edit project with fields including "Incluir no Dashboard Geral" checkbox (uses `save_project` RPC for transactional project + dashboard_settings upsert)

## GestaoPage (`gestao-projetos.js`)

Project management CRUD built on `CrudPage` with custom `onSave` (delegates to `save_project` RPC for transactional project + dashboard_settings upsert) and **`allowDelete: false`** — a exclusão de projetos é intencionalmente desabilitada na UI porque um projeto carrega histórico financeiro (bolsas, desembolsos, gastos, balancetes); projetos são encerrados via status, nunca removidos. O `onDelete` foi removido em favor do `allowDelete`. Usa `loadExtra` (com try/catch) para buscar `dashboard_settings.include_in_general`.

## HoldersPage (`holders.js`)

Custom CRUD for scholarship holders (not using CrudPage) because of unique features: scholarship management sub-modals, timeline chart, alert banner. Agora organizada em **2 abas** (persistidas em `cf_holders_tab`): **Bolsistas** e **Reconciliação**.

### Aba "Bolsistas"

**Features:**
- **Search bar** — text filter by holder name (150ms debounce)
- **Project filter dropdown** — filters holders by project association
- **Inactive filter** — toggle to show/hide holders with only inactive scholarships (`onToggleInactive`)
- **Group by project** — checkbox to group the holder list by their primary associated project (`toggleProjectGroup`)
- **Alert banner** — collapsible warning for scholarships ending within 90 days (`ALERT_DAYS = 90`), grouped by project
- **Duplicate banner** — detecta bolsistas com o mesmo nome normalizado (`findDuplicateHolderGroups`) e oferece "Revisar e mesclar" → abre a ferramenta de merge
- **Holders table** — Name (with "Encerrando" badge), Active Scholarships (list with project names and amounts — only scholarships with `status='active'` and dates within current period), Total Monthly Amount (highlighted), Status
- **Manage Scholarships modal** — sub-table listing all scholarships for a holder; "Adicionar Nova Bolsa" button; edit opens nested scholarship form
- **Scholarship form** — "external funding source" checkbox (hides project dropdown, shows free-text field); fields: project/funding source, amount, dates, status, **CPF**, **Tipo** (`scholarship_type`), **Formação** (`education_level`), notes
- **Timeline chart** (`viewTimeline`) — stacked bar chart showing monthly scholarship amounts over the actual scholarship period (earliest start to latest end), colored per project; scrollable data table below
- **Exclusão em cascata consciente** (`remove`) — se o bolsista tem bolsas vinculadas, avisa a contagem e exige confirmação antes de chamar `delete_holder_cascade` (migração 030); sem bolsas, exclusão direta

### Aba "Reconciliação"

Compara as planilhas de bolsas baixadas do sistema FUNAPE (.xlsx, **uma por projeto**) com os dados cadastrados no banco, permitindo sincronizar o cadastro.

- **Importação em lote** (`openImportBolsas`) — roda na **ImportQueue** (`js/import-queue.js`) com o handler de bolsas (`getBolsaImportHandler`, também usado pelo Fechamento Mensal): seleciona um ou vários XLSX → revisão um-por-um. `parseBolsaSpreadsheet` (`bolsa-parser.js`, SheetJS) extrai as linhas (só status "Ativo" da FUNAPE entram na comparação) → o **projeto é sugerido automaticamente** pelos CPFs (maioria com bolsa ativa no projeto) e pode ser trocado; o usuário informa a **competência** (default: mês anterior) → `compareBolsaData` (`bolsa-comparator.js`) classifica as diferenças contra as bolsas ativas do projeto + o universo global de holders.
- **Diff** — 4 categorias com checkboxes de aprovação (marcar/desmarcar todos por categoria):
  - **Novos** — bolsas na planilha e não no banco. `matchKind='link'` (pessoa já existe em outro projeto via CPF/nome único → vincula, `existingHolderId` preenchido) ou `'new'` (pessoa realmente nova). Backfills de `cpfNew`/`nameNew`/`formacaoNew` quando o banco está em branco.
  - **Removidos** — bolsas no banco sem correspondência na planilha (serão encerradas).
  - **Alterados** — mesmo bolsista, campos divergentes (nome, valor, datas, tipo) ou backfill de CPF/formação.
  - **Iguais** — match exato, sem ação.
- **Matching** — Tier 1 por CPF exato (no projeto), Tier 2 por nome normalizado; resolução global via CPF → nome (nome único only) para evitar duplicados.
- **Salvar** (botão da fila) — monta `{ creates, updates, ends }` com os itens marcados e chama `apply_reconciliation` (migrações 028/029). `creates` com `holder_id` viram vínculo (não criam duplicado). Em seguida arquiva o XLSX no bucket `bolsa-planilhas` e registra a reconciliação em `reconciliacoes` (migração 031) — best-effort: se a migração não rodou, avisa sem desfazer o apply. Com o diff 100% "iguais", Salvar apenas registra a conferência do mês.
- **Histórico** — a aba lista as últimas reconciliações registradas (competência, projeto, arquivo, contagens do diff, aplicadas).
- **Merge de duplicados** (`openMergeTool`) — lista grupos de mesmo nome (sugere como canônico quem tem CPF) com radio "Manter" e botão "Mesclar este grupo" → `merge_holders`. Há também mescla **manual** (escolher quaisquer cadastros) para duplicados com nomes divergentes que a detecção automática não agrupa.

## SaldosPage (`saldos.js`)

Monthly balance entry per project. Uses `get_balances_for_month` RPC to list all projects and their balances for a reference month.

**Features:**
- **Month navigation** — dropdown month/year selectors with prev/next buttons; warns before navigating if there are unsaved changes
- **3 KPI cards** — Total FUNAPE, Com Saldo (projects with a balance row), Pendentes (active projects without a balance row)
- **Balance table** — inline editable fields per project: Saldo FUNAPE (R$), Rendimentos (R$), Data do Saldo. Empty fields are treated as "not reported" (null), distinct from a zero value. Rows with no data entered are skipped on save.
- **Dirty tracking** — changed rows highlighted; batch save via `upsert_project_balance` RPC (salva em lote todas as linhas marcadas como sujas); discard button with confirmation
- **Guard de navegação** — `registerGuard`/`registerDirtyChecker` (`isDirty` = `dirtyRows.size > 0`): ao trocar de rota com saldos pendentes, pede confirmação antes de descartar; o `beforeunload` em `app.js` avisa ao fechar/recarregar a aba

## FundingPage (`funding.js`) and ExpensesPage (`expenses.js`)

Both built on the generic `CrudPage` module with server-side pagination, debounced search (300ms), and CSV export. O campo de data usa `<input type="date">` nativo (antes era texto livre).

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
- **Importação** (fila em lote, `ImportQueue`): seleciona um ou vários DOCX → revisão um-por-um com cabeçalho "Arquivo X de N" e botões **Salvar e próximo** / **Salvar e concluir** / **Pular**. Mammoth.js extrai HTML → `parsePtFromHtml` (`pt-parser.js`, parser determinístico, sem IA) → form editável (com seletores Projeto + Tipo no topo do lote) → split-view DOCX ↔ form → upload Storage + `upsert_plano_trabalho` RPC. O projeto salvo vira default do próximo arquivo. `versao` é calculado server-side; trigger `enforce_single_plano_ativo` garante 1 versão ativa. A Edge Function `extract-plano-trabalho` permanece deployada mas **não é mais chamada** (deprecated).

### Aba "Balancetes"

Lista cronológica dos balancetes mensais importados (FUNAPE PDF).

- **Tabela** — data referência, emissão, saldo disponível, rendimento, total débitos, ações (Ver / Baixar / Excluir).
- **Detalhamento** — clicar "Ver" abre modal com todos os lançamentos `7.1.3.x` e a rubrica resolvida.
- **Importação** (fila em lote, `ImportQueue`): seleciona um ou vários PDF → revisão um-por-um ("Arquivo X de N", Salvar/Pular). **pdf.js** extrai texto preservando quebras de linha pela coordenada Y → `parseBalanceteText` (`balancete-parser.js`, parser determinístico, sem IA) → form de revisão com **detecção automática do projeto** pelo `project_code` no PDF (procura em `projects.code`) → split-view PDF ↔ form → upload `balancete-pdfs` + `upsert_balancete` RPC. Linhas não-mapeadas podem ser salvas como `new_mappings` inline (checkbox "salvar") — cadastradas em `conta_rubrica_map` antes dos lançamentos. O trigger `trg_auto_resolve_rubrica` em `balancete_lancamentos` resolve a rubrica de cada lançamento automaticamente. A Edge Function `extract-balancete` permanece deployada mas **não é mais chamada** (deprecated).
- Após importar, a aba muda para "Previsto x Realizado" automaticamente (`afterAllSaved`).

### Aba "Previsto x Realizado"

Cruzamento do plano ativo com o balancete mais recente (RPC `get_previsto_vs_realizado`).

- **4 KPIs** — Saldo disponível, Rendimento, Previsto total, Realizado total.
- **Tabela por rubrica** — Previsto, Realizado, Saldo (R$), % Executado (colorido: verde ≤90%, amarelo 90-100%, vermelho >100%).
- **Lançamentos não mapeados** — card secundário com despesas tributárias/bancárias que não bateram com nenhuma rubrica (configurável via `conta_rubrica_map`).

**Globais usadas:** `formatBRL`, `escapeAttr`, `formatDate`, `toInputDate`, `showToast`, `createModal`, `confirmAction`, `supabaseClient`, `mammoth`, `pdfjsLib`.

## CrudPage Generic Module

`CrudPage(config)` in `crud-page.js` is a factory function that generates a full CRUD page from a config object. Key config properties: `tableName`, `dateField`, `entityLabel`, `entityIcon`, `globalName`, `gender`, `columns`, `formFields`, `statsCards`, `statsRpc`, **`allowDelete`** (default `true` — quando `false`, oculta o botão de excluir da tabela; usado por `gestao-projetos.js`). `formFields` agora usam `f.render(record, projectsCache)` (antes `f(...)`) e suportam `type: 'date'` (campo vazio vira `null` — enviar `""` para coluna `date` do Postgres causa `invalid input syntax`). `openForm` e `remove` envolvem o acesso ao banco em `try/catch` com toast de erro. Returns `{ load, openForm, remove, refresh, onSearch, goToPage, exportCSV }`. Server-side pagination via `.range(from, to)` with `{ count: 'exact' }`. CSV export fetches all records without pagination.

## FechamentoPage (`fechamento.js`)

Rotina de conciliação mensal — a porta de entrada única dos 3 artefatos que todo projeto FUNAPE recebe por mês.

- **Seletor de competência** — `<input type="month">`, default mês anterior (o fechamento cuida do mês que passou).
- **4 stat cards** — Projetos fechados (balancete + bolsas ok), Balancetes, Planilhas de bolsas, Planos ativos (X / total).
- **Checklist da competência** — tabela com os projetos `funape_managed` ativos × colunas Plano de Trabalho (ativo?), Balancete (existe `balancetes.data_referencia` no mês?) e Planilha de Bolsas (existe `reconciliacoes.competencia` no mês? — migração 031; sem a migração mostra banner de aviso).
- **Importar arquivos do mês** — abre a **ImportQueue** com os 3 handlers ao mesmo tempo (`PlanoTrabalhoPage.getImportHandlers()` + `HoldersPage.getBolsaImportHandler({ defaultCompetencia })`): PDFs viram balancetes, DOCX viram planos/remanejamentos, XLSX viram reconciliações de bolsas — tudo numa fila só, com badge de tipo por arquivo e revisão human-in-the-loop um-por-um.

## ImportQueue (`js/import-queue.js`)

Componente global (classic script, não é página) extraído de `plano-trabalho.js`. `ImportQueue.open({ title, handlers, onFinished })` — tela de seleção com drag-and-drop, roteamento de cada arquivo para o primeiro handler cujo `validExt()` aceite, revisão sequencial ("Arquivo X de N", Salvar/Pular), parse com cache por arquivo, toast de resumo e `afterAllSaved()` por handler. `onFinished({ saved, skipped, errored, newMappings, savedByType, results })` deixa cada página decidir seu refresh. Contrato do handler documentado no cabeçalho do arquivo.

## HubPage (`hub.js`)

Página **experimental** (somente leitura) que agrega numa tela só os 4 KPIs-chave de um projeto e atalhos "Abrir" para as telas completas de cada área. Não substitui nenhuma tela existente — apenas consome as mesmas RPCs.

- **Seletor de projeto** — compartilha `cf_selected_project_id` com a aba Projetos de propósito (ideia de "projeto atual" único). Botões "Abrir" propagam o projeto para a tela de destino.
- **4 KPI cards** — Saldo Atual (+ rendimento), Execução do Orçamento (% previsto×realizado, colorido), Bolsas/Mês (custo mensal + nº encerrando em 90d), Saldo Projetado (último mês da projeção).
- **Blocos por área** — Orçamento, Bolsistas, Execução (Balancete FUNAPE para `funape_managed` ou Gastos para projetos não-FUNAPE), Vigência & Saldo — cada um com botão "Abrir ..." que navega via `Router`.
- **Fontes** — `projects`, `scholarships`, `calc_project_monthly`, `get_previsto_vs_realizado`, `expenses` (carregadas em paralelo com `Promise.all`).
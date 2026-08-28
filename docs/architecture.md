# Architecture

**Serverless SPA with BaaS pattern** — no custom backend, no frontend build step. All JS loads via `<script>` tags in `index.html`. Node.js is used only for dev tooling (ESLint, Vitest, CI).

## Security

- **Content-Security-Policy** — configured via `<meta>` tag in `index.html`, restricts script/style/font/connect sources
- **Subresource Integrity (SRI)** — all CDN scripts include `integrity` hashes; tampered CDN responses are rejected
- **CDN fallback** — if a CDN script fails to load, a local copy from `frontend/vendor/` is used via `document.write` fallback. As 7 cópias existem no diretório (até 2026-08-28 faltavam mammoth e pdf.js — as duas importações que mais dependem disso). Procedimento de atualização e conferência do hash em [`frontend/vendor/README.md`](../frontend/vendor/README.md)
- **Sentry** — optional error monitoring, enabled by setting `window.SENTRY_DSN` before `supabase-config.js` loads

## Script Load Order

Scripts in `index.html` must load in dependency order. Changing the order will break the app:
1. `pure-fns.js` — ES module (`type="module"`), bridges utility functions to `window` (formatBRL, escapeAttr, localISODate, etc.). Deferred but executes before DOMContentLoaded.
2. `supabase-config.js` — creates `window.supabaseClient` + UI utilities (showToast, createModal, etc.)
3. `auth.js` — depends on `supabaseClient`
4. `simulation.js` — delegates to `window.calcProjectMonthly`, `window.generateMonthSeries`, `window.diffProjections` (set by pure-fns.js bridge)
5. `router.js` — no dependencies
6. `chart-builder.js` — depends on Chart.js (CDN)
7. `pages/crud-page.js` — depends on `supabaseClient`, `handleSupabaseResponse`
8. Page modules (dashboard, saldos, projetos, gestao, holders, funding, monitoramento, plano-trabalho, fechamento, hub, assistente, usuarios) — depend on `Router`, `supabaseClient`, `ChartBuilder`, `SimulationEngine`, `CrudPage`, `ImportQueue` (`js/import-queue.js`, carregado logo após `router.js`)
9. `app.js` — bootstrap, depends on `Router`, `Auth`. Registra também um handler `beforeunload` que chama `Router.hasUnsavedChanges()` para avisar ao fechar/recarregar a aba com mudanças pendentes.

The page `plano-trabalho` also depends on `mammoth` (DOCX → HTML, CDN com fallback em `frontend/vendor/mammoth.browser.min.js`), `pdfjsLib` (PDF → texto, CDN `pdfjs-dist@3.11.174` + worker), e dos parsers determinísticos `pt-parser.js` / `balancete-parser.js` (ES modules bridge-ados ao `window` como `parsePtFromHtml` / `parseBalanceteText`). A importação é em **lote** (`ImportQueue`, componente global): uma fila selection→review percorre N arquivos com "Arquivo X de N" e Salvar/Pular, roteando cada arquivo para o handler do seu tipo (PDF → balancete, DOCX → plano, XLSX → bolsas FUNAPE). O CSP em `index.html` inclui `worker-src 'self' https://cdn.jsdelivr.net blob:` para permitir o worker do pdf.js **das duas origens**: o `workerSrc` é escolhido em runtime e só aponta para `vendor/pdf.worker.min.js` quando o próprio `pdf.min.js` veio do vendor. Buscar o worker no CDN depois de o CDN ter falhado derrubaria o worker junto, e o pdf.js cairia no *fake worker* — parse na thread principal, tela travada em PDF grande.

The page `holders` (aba Reconciliação) depende de `XLSX` (SheetJS, CDN `xlsx@0.18.5` + fallback em `frontend/vendor/xlsx.full.min.js`) e dos parsers `bolsa-parser.js` / `bolsa-comparator.js` (ES modules bridge-ados ao `window` como `parseBolsaSpreadsheet` / `compareBolsaData`).

The page `assistente` depende dos ES modules de `js/ai/` (bridge-ados ao `window` como `CFTools`, `CFAgent` e `CFMarkdown`) e da Edge Function `assistente`. Nenhuma biblioteca de CDN: a chamada ao modelo vai por `supabaseClient.functions.invoke`, e a mesma origem do Supabase já está no `connect-src` do CSP — a aba **não** exigiu mudança de CSP.

## Router Guards & Dirty Tracking

`router.js` expõe além de `register/navigate/getCurrent`: `registerGuard(fn)`, `registerDirtyChecker(fn)` e `hasUnsavedChanges()`. Guards são funções `async (from, to) => boolean` consultadas antes de cada `navigate` (uma retornando `false` cancela a troca). Dirty checkers são funções `() => boolean` cuja união alimenta `hasUnsavedChanges()`. `projetos.js` registra ambos para o modo Editor (rascunhos não salvos); `saldos.js` registra ambos para linhas sujas (`dirtyRows`). `app.js` usa `hasUnsavedChanges()` no `beforeunload`. Navegar para a página corrente é no-op (evita re-render redundante).

## Frontend Module Pattern

Every JS module is an IIFE that registers globals on `window`. Inline `onclick` handlers in HTML call these globals directly (e.g., `onclick="DashboardPage.selectAll()"`). Page modules self-register with `Router.register()` providing name, title, render function, and optional action buttons.

## Auth System

Simplified login: users type a short name (e.g., "Laerte") which is mapped to a Supabase email via `USER_MAPPING` in `auth.js`. Direct email input (containing `@`) also works. Session persistence via Supabase Auth.

## ChartBuilder

`chart-builder.js` provides `buildFinancialChart()` — a shared Chart.js configuration for the monthly projection charts used by both DashboardPage and ProjectsPage. Also exports a `COLORS` object with the palette: funding (teal), bolsas (gold), gastos (red), positive balance (green), negative balance (red).

## Edge Functions

Edge Functions Deno/TypeScript ficam em `supabase/functions/<name>/`. Deploy via `npx supabase functions deploy <name> --project-ref <ref>`; secrets via `npx supabase secrets set KEY=value --project-ref <ref>` (o `--project-ref` é necessário porque o repositório não está linkado; receita completa em `supabase/functions/assistente/README.md`). As funções recebem `SUPABASE_URL` e `SUPABASE_ANON_KEY` automaticamente do runtime.

**`assistente`** — a única viva. Proxy entre a aba Assistente e o Ollama Cloud (`https://ollama.com/api/chat`), existindo por um motivo só: a `OLLAMA_API_KEY` não pode ir num bundle público. Não executa tool, não chama RPC, não guarda conversa, não tem lógica financeira — o laço mora no browser. Exige JWT; `{ "acao": "modelos" }` devolve a allowlist que alimenta o seletor da tela. Ver `supabase/functions/assistente/README.md`.

### Extração (deprecated)

> **Deprecated desde 2026-05.** O frontend **não chama mais** as duas Edge Functions de extração — ela é 100% determinística no browser (`pt-parser.js` para DOCX, `balancete-parser.js` para PDF). Permanecem deployadas como histórico. O secret `OLLAMA_API_KEY` que elas usavam voltou a ser consumido em runtime pela `assistente`. Descrições históricas abaixo.

**`extract-plano-trabalho`** — recebe `{ text: string }` (texto bruto do DOCX extraído pelo Mammoth.js no browser), chama o **Ollama Cloud** (`kimi-k2.6:cloud`, endpoint `https://ollama.com/api/chat`, secret `OLLAMA_API_KEY`) e retorna `{ data: {...plano...}, warnings: [...], raw_extraction: {...} }`. Exige JWT do Supabase (rejeita anônimo). O prompt do sistema mapeia rubrica → código estável (a-g, cip_*, dao) e usa um exemplo few-shot do Plano Acelen para guiar a extração.

**`extract-balancete`** — análogo, mas para PDF do Balancete Contábil Analítico da FUNAPE. Recebe texto extraído pelo **pdf.js** no browser (com preservação de quebras de linha via coordenada Y), devolve `{ data: { project_code, data_referencia, saldo_disponivel, rendimento_liquido, total_debitos, total_creditos, lancamentos: [...] }, warnings, raw_extraction }`. O `project_code` (ex.: "30.099") é detectado pela linha da conta bancária dentro do PDF.

## Camada de decisão e IA

Três fases, com uma regra que decide o desenho de todas: **a lógica financeira mora no Postgres; os consumidores são adaptadores finos.** A fase 3 vai consumir exatamente as mesmas RPCs que a fase 2, e duas implementações da mesma conta divergiriam — por isso o servidor MCP não tem uma linha de cálculo. Se um número está errado, o conserto é na migração.

```
                    ┌── fase 2 ──┐   ┌──────── fase 3 ────────┐
                    │  mcp/      │   │  aba Assistente        │
                    │  (stdio)   │   │  frontend/js/ai/       │
                    │            │   └───────────┬────────────┘
                    │            │      Edge Function `assistente`
                    │            │      (só guarda a chave) ──► Ollama Cloud
                    └─────┬──────┘   ┌───────────┘
                          │  supabase-js (JWT do usuário)
                          └───────────┬───────────┘
                            ┌─────────▼─────────┐
                            │  RPCs de decisão  │  fase 1
                            │  038 / 039 / 040  │
                            └─────────┬─────────┘
                            ┌─────────▼─────────┐
                            │  Postgres + RLS   │  mig. 033/034
                            └───────────────────┘
```

**Fase 1 — RPCs** (`docs/database.md` tem o contrato de cada uma): `get_saldo_livre` (038) responde "quanto está livre neste centro de custo?", `simular_alocacao` (039) "onde colocar este gasto?" e `get_panorama` (040) "como estão os projetos?". As três carregam um campo `nota` em prosa, que **não é decoração**: é o enquadramento que o modelo lê e repete ao usuário — que a simulação é shortlist e não recomendação, que balancete ausente superestima o saldo e defasado o subestima, que a ordem do panorama é alfabética e não prioridade.

**Fase 2 — servidor MCP** (`mcp/`, ver `mcp/README.md`): pacote Node próprio, transporte stdio, 9 tools. Autentica **por usuário** (`CF_EMAIL`/`CF_PASSWORD`), faz login real no GoTrue e viaja com o JWT daquele usuário — então o RLS é a barreira e o servidor não tem lógica de permissão própria. Duas pessoas com logins diferentes veem coisas diferentes, como deve ser.

**Fase 3 — aba Assistente** (`frontend/js/ai/` + `frontend/js/pages/assistente.js` + Edge Function `assistente`): **MCP não é o que se usa aqui** — MCP existe para conectar clientes de IA de terceiros; no próprio site usa-se *tool calling* no formato nativo do provedor (Ollama Cloud, `/api/chat`). O que portou da fase 2 é `mcp/src/tools.js` (resolve nome → id, chama RPC, devolve o JSON) e as descrições das tools, que são a parte cara de escrever.

O **laço roda no browser**, não na Edge Function, e as três razões são independentes: (a) as tools chamam as RPCs pelo `supabaseClient` já logado — mesmo JWT, mesmo RLS, mesmo caminho das outras telas, sem repassar token nem manter uma segunda cópia do adaptador em Deno; (b) a tela mostra **ao vivo qual RPC está sendo consultada**, com o JSON cru dobrável, e isso é o que permite conferir a regra "todo número sai de RPC" sem acreditar na palavra do modelo — um número sem passo correspondente é invenção; (c) ajustar prompt e descrição não exige deploy. À Edge Function sobrou o que só ela pode fazer: guardar a `OLLAMA_API_KEY`, que não pode ir num bundle público, e a allowlist de modelos que alimenta o seletor da tela (trocável por secret `ASSISTENTE_MODELOS`, sem redeploy).

Os **dois adaptadores** (`mcp/src/tools.js` e `frontend/js/ai/tools.js`) existem separados por encanamento — stdio/zod/npm de um lado, `<script type="module">` sem build do outro — não por terem regras diferentes, e é o tipo de par que deriva em silêncio. `tests/ai-tools.test.js` lê o fonte do MCP como texto e trava as duas coisas que não podem divergir: a **lista de tools** e o bloco das **quatro regras** transversais, comparado palavra por palavra. As descrições individuais podem divergir de propósito (no MCP viajam no `registerTool`; no site, no próprio objeto da tool).

Fora do adaptador, dois pontos de atenção viraram teste porque só falhariam em produção: `tests/ai-agent.test.js` exercita o laço com modelo e banco dublês (ida e volta de tool, erro de tool voltando como resultado em vez de exceção, `arguments` como objeto **e** como string JSON, teto de rodadas), e `tests/ai-markdown.test.js` trava o escape da resposta — é ali que texto de fora vira HTML, e o modelo repete dentro dele nome de bolsista e de projeto vindos do banco.

**Conversa é generativa; cálculo nunca.** Todo número sai de RPC — o modelo não soma nem projeta. É a mesma lição que aposentou as Edge Functions do Ollama em favor dos parsers determinísticos.

## SimulationEngine

`simulation.js` is a thin delegation layer that calls `window.calcProjectMonthly`, `window.diffProjections`, and `window.generateMonthSeries` — all set by the `pure-fns.js` browser bridge. The actual implementation lives in `pure-fns.js` and mirrors the PostgreSQL `calc_project_monthly()` function client-side for the what-if Editor Mode on the Projects page. Changes are local-only until explicitly saved. Both the server RPC and client engine accept a `balance_status` parameter (`paid_current` / `unpaid_current` / `unpaid_previous`) that adjusts whether the current month's scholarships are counted as paid.
# Key Global Utilities

## Fornecidas por `pure-fns.js` (window-bridged)

`pure-fns.js` é o arquivo de funções utilitárias puras — a fonte única de verdade, importada diretamente pelos testes via ES modules e exposta no `window` pelo browser bridge no final do arquivo (carregado como `<script type="module">` em `index.html`).

- `formatBRL(value)`, `formatDate(dateStr)`, `toInputDate(dateStr)` — formatação de moeda, data display e campos de input
- `localISODate(date?)` — retorna `YYYY-MM-DD` no fuso local (evita shift UTC de `toISOString()` no UTC-3). Padrão: data atual.
- `escapeAttr(str)` — escaping de atributos HTML (previne XSS)
- `inferBalanceStatus(balanceDate)` — retorna `paid_current` só quando o saldo é do mês corrente com data posterior ao dia 7 (dia em que as bolsas do mês são debitadas); qualquer outro caso (saldo antigo, do início do mês ou ausente) retorna `unpaid_current`
- `generateMonthSeries(startDate, endDate)` — gera array de `{ month_start, month_end, month_label }` entre duas datas
- `calcProjectMonthly(project, scholarships, fundingReleases, expenses, options)` — calcula projeção mensal de saldo de um projeto
- `diffProjections(original, simulated)` — compara duas projeções e retorna os meses com diferença de saldo > R$ 0,01

## Fornecidas por `supabase-config.js`

- `supabaseClient` — o client Supabase (atribuído a `window.supabaseClient`, NÃO `window.supabase` — esse é o namespace da lib CDN)
- `showToast(message, type)`, `createModal({...})`, `confirmAction(message)` — primitivos de UI. `showToast` auto-cria o container via `createToastContainer()`. `createModal` remove qualquer modal existente antes de criar um novo (sem modal stacking). Suporta `hideCancelBtn: true` e `canClose: () => bool` (veta X/backdrop/Cancelar — usado pela ImportQueue durante o save).
- `handleSupabaseResponse({data, error}, errorMsg)` — tratamento centralizado de erros do Supabase, retorna `null` em erro e exibe toast
- `exportToCSV(data, columns, filename)` — exportação CSV com BOM para compatibilidade pt-BR no Excel

## Fornecidas por `auth.js`

- `Auth.getUser()` — o usuário Supabase autenticado (ou `null`).
- `Auth.isAdmin()` — `true` se o papel em `app_users` é `admin`. Carregado em `loadProfile` **antes** de `App.init()` (o papel precisa estar pronto para ocultar links admin e registrar o guard de rota).
- `Auth.getRole()` — `'admin'` | `'professor'` | `null` (antes do login).
- `Auth.getAllowedProjectIds()` — cópia do array de centros de custo permitidos (`user_projects`). Vazio para admins (eles veem tudo) e para professores sem atribuição. O fallback `ADMIN_EMAILS` em `auth.js` garante admin mesmo sem a linha em `app_users` (ex.: pré-migração 033).

## Sentry Integration

Sentry só é inicializado se `window.SENTRY_DSN` for definido antes de `supabase-config.js` carregar. Configure ambiente via `window.SENTRY_ENV` (padrão `'production'`) e release via `window.SENTRY_RELEASE`.

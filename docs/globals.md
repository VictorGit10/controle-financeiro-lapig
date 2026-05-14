# Key Global Utilities

## Fornecidas por `pure-fns.js` (window-bridged)

`pure-fns.js` é o arquivo de funções utilitárias puras — a fonte única de verdade, importada diretamente pelos testes via ES modules e exposta no `window` pelo browser bridge no final do arquivo (carregado como `<script type="module">` em `index.html`).

- `formatBRL(value)`, `formatDate(dateStr)`, `toInputDate(dateStr)` — formatação de moeda, data display e campos de input
- `localISODate(date?)` — retorna `YYYY-MM-DD` no fuso local (evita shift UTC de `toISOString()` no UTC-3). Padrão: data atual.
- `escapeAttr(str)` — escaping de atributos HTML (previne XSS)
- `inferBalanceStatus(balanceDate)` — infere status pago/não-pago baseado em se o dia 7 do mês já passou; retorna `paid_current` ou `unpaid_current`
- `generateMonthSeries(startDate, endDate)` — gera array de `{ month_start, month_end, month_label }` entre duas datas
- `calcProjectMonthly(project, scholarships, fundingReleases, expenses, options)` — calcula projeção mensal de saldo de um projeto
- `diffProjections(original, simulated)` — compara duas projeções e retorna os meses com diferença de saldo > R$ 0,01

## Fornecidas por `supabase-config.js`

- `supabaseClient` — o client Supabase (atribuído a `window.supabaseClient`, NÃO `window.supabase` — esse é o namespace da lib CDN)
- `showToast(message, type)`, `createModal({...})`, `confirmAction(message)` — primitivos de UI. `showToast` auto-cria o container via `createToastContainer()`. `createModal` remove qualquer modal existente antes de criar um novo (sem modal stacking). Suporta `hideCancelBtn: true`.
- `handleSupabaseResponse({data, error}, errorMsg)` — tratamento centralizado de erros do Supabase, retorna `null` em erro e exibe toast
- `exportToCSV(data, columns, filename)` — exportação CSV com BOM para compatibilidade pt-BR no Excel

## Sentry Integration

Sentry só é inicializado se `window.SENTRY_DSN` for definido antes de `supabase-config.js` carregar. Configure ambiente via `window.SENTRY_ENV` (padrão `'production'`) e release via `window.SENTRY_RELEASE`.

# Controle Financeiro — LAPIG

Sistema de controle financeiro para gestão de projetos e bolsas do Laboratório de Processamento de Imagens e Geoprocessamento (LAPIG / UFG).

Migrado de uma arquitetura Google Sheets + Apps Script para uma aplicação web moderna com banco de dados relacional.

---

## Stack

| Camada    | Tecnologia                        |
|-----------|-----------------------------------|
| Frontend  | HTML + Vanilla JS + CSS           |
| Backend   | Supabase (PostgreSQL + Auth + RLS)|
| Gráficos  | Chart.js                          |
| Ícones    | Lucide Icons                      |
| Fontes    | DM Sans · Exo 2 · JetBrains Mono (Google Fonts) |

---

## Estrutura do Repositório

```
ControleFinanceiro/
├── .github/
│   └── workflows/
│       └── ci.yml              # CI: lint + testes no push/PR
│
├── data/
│   └── DadosDoDashBoardAtual.xlsx  # Planilha legada (fonte original dos dados)
│
├── database/
│   ├── 000_reset_completo.sql  # Reset completo do banco (⚠️ destrutivo)
│   ├── 001_schema.sql          # Estrutura das tabelas
│   ├── 002_rls_policies.sql    # Políticas de segurança (RLS)
│   ├── 003_views_functions.sql # Views e funções de cálculo
│   ├── 004_seed_data.sql       # Dados iniciais / configurações
│   ├── 005_import_real_data.sql# Importação dos dados legados
│   ├── 006–011_*.sql           # Audits, cascata, bolsas externas, saldo, batch RPC, balance_date
│   ├── 012_save_editor_changes.sql  # Save do modo editor
│   ├── 013_portuguese_months_batch_alerts_stats.sql  # Localização + alertas + stats
│   ├── 014_audit_invalid_data.sql   # Audit de dados inválidos
│   ├── 015_check_constraints.sql    # CHECK constraints de integridade
│   ├── 016_save_project.sql        # RPC transacional save_project
│   ├── 017_project_balances.sql    # Tabela de saldos mensais por projeto
│   ├── 018_fix_security_definer_views.sql  # Corrige views SECURITY DEFINER
│   ├── 019_fix_function_security.sql       # Segurança de funções RPC
│   ├── 020_toggle_active.sql       # Triggers de auto-sync holder/project active
│   ├── 021_integrity_fixes.sql     # Restrições de integridade adicionais
│   ├── 022_remove_cascade_delete.sql  # FKs financeiras: CASCADE → RESTRICT
│   ├── 023_database_triggers_audit.sql # Triggers de auditoria
│   ├── 024_restrict_project_balances.sql # project_balances FK → RESTRICT
│   ├── 025_plano_trabalho.sql    # Plano de Trabalho (rubricas, versões, desembolsos) + funape_managed
│   ├── 026_balancetes.sql        # Balancete FUNAPE (PDF), conta_rubrica_map, Previsto x Realizado, bloqueia expenses em FUNAPE
│   └── utils/
│       ├── generate_import_sql.py  # Gerador de SQL a partir do Excel
│       └── check_dupes.py          # Verificador de duplicatas
│
├── docs/
│   ├── architecture.md         # Ordem de scripts, padrão de módulos, auth
│   ├── pages.md                # Dashboard, Projetos, Bolsistas, etc.
│   ├── database.md             # Tabelas, RPCs, views, migrations
│   └── globals.md              # Utilitários globais de supabase-config.js
│
├── frontend/
│   ├── index.html              # Ponto de entrada da aplicação
│   ├── css/
│   │   └── style.css           # Design system completo (~1700 linhas)
│   ├── images/
│   │   └── lapig-logo.svg      # Logo institucional LAPIG
│   ├── js/
│   │   ├── app.js              # Bootstrap e utilitários globais
│   │   ├── auth.js             # Autenticação Supabase
│   │   ├── chart-builder.js    # Wrapper para Chart.js
│   │   ├── pure-fns.js         # Funções utilitárias puras (ES module + window bridge)
│   │   ├── router.js           # Sistema de rotas SPA
│   │   ├── simulation.js       # Engine de simulação financeira
│   │   ├── supabase-config.js  # Configuração do cliente Supabase
│   │   └── pages/
│   │       ├── crud-page.js    # Fábrica genérica de CRUD
│   │       ├── dashboard.js    # Dashboard geral consolidado
│   │       ├── projetos.js     # Seletor de projetos + KPIs
│   │       ├── gestao-projetos.js  # Editor/CRUD de projetos
│   │       ├── saldos.js       # Saldos mensais por projeto
│   │       ├── holders.js      # Gestão de bolsistas
│   │       ├── funding.js      # Desembolsos (CrudPage)
│   │       ├── expenses.js     # Gastos gerais (CrudPage)
│   │       └── plano-trabalho.js  # Plano de Trabalho (import DOCX + IA)
│   └── vendor/                 # Fallback local dos CDN libs
│       ├── chart.umd.js
│       ├── lucide.js
│       ├── mammoth.browser.min.js  # (baixar de jsdelivr/mammoth@1.8.0)
│       ├── pdf.min.js              # (baixar de jsdelivr/pdfjs-dist@3.11.174)
│       └── supabase.js
│
├── supabase/
│   └── functions/
│       ├── extract-plano-trabalho/ # Edge Function: DOCX → JSON (Ollama)
│       └── extract-balancete/      # Edge Function: PDF → JSON (Ollama)
│
├── tests/
│   ├── simulation.test.js      # Testes do SimulationEngine
│   ├── utils.test.js            # Testes de funções utilitárias
│   └── sql/
│       └── test_rpcs.sql        # Testes de integração das RPCs
│
├── CLAUDE.md                   # Guia para Claude Code
├── eslint.config.mjs           # Configuração do ESLint
├── package.json                # Dev dependencies (eslint, vitest)
├── vitest.config.js            # Configuração do Vitest
└── README.md
```

---

## Funcionalidades

- **Dashboard Geral** — KPIs consolidados, gráfico de projeção mensal, painel de bolsistas ativos, alertas via sino de notificação
- **Projetos** — Seletor suspenso, gráfico mensal por projeto, painel de bolsistas, Modo Editor com simulação em tempo real
- **Bolsistas** — CRUD completo + visualização de rendimentos mensais com gráfico de barras empilhadas por projeto
- **Desembolsos e Gastos** — Registro e acompanhamento por projeto
- **Plano de Trabalho** — Página com 3 abas:
  - **Orçamento** — Import de DOCX (plano + remanejamentos) com extração de rubricas por IA (Ollama Cloud `kimi-k2.6:cloud`) e versionamento
  - **Balancetes** — Import de PDF mensal da FUNAPE com detecção automática do projeto e dos lançamentos contábeis
  - **Previsto x Realizado** — Comparação do orçamento previsto com o realizado por rubrica, % executado e saldo disponível
- **Autenticação** — Login seguro via Supabase Auth com persistência de sessão

---

## Dev Tooling

```bash
npm ci          # instala dependências de desenvolvimento
npm run lint    # roda ESLint no frontend/js/
npm test        # roda Vitest em tests/
```

CI via GitHub Actions: lint + testes em todo push/PR para main/master.

---

## Configuração

1. Crie um projeto no [Supabase](https://supabase.com)
2. Execute os scripts SQL em `/database/` na ordem numérica (001 → 026)
3. Preencha as credenciais em `frontend/js/supabase-config.js`
4. Abra `frontend/index.html` no navegador (ou sirva com qualquer servidor estático)

### Edge Functions (Plano de Trabalho + Balancete)

A página **Plano de Trabalho** depende de duas Edge Functions que fazem proxy para o Ollama Cloud:

**Via CLI:**
```bash
supabase secrets set OLLAMA_API_KEY=<sua-chave-do-ollama-cloud>
supabase functions deploy extract-plano-trabalho
supabase functions deploy extract-balancete
```

**Via dashboard (sem CLI):**
- Project Settings → Edge Functions → Secrets → Add `OLLAMA_API_KEY`
- Edge Functions → Deploy a new function → Via Editor → cole `supabase/functions/extract-plano-trabalho/index.ts` (nome `extract-plano-trabalho`)
- Repita para `extract-balancete` colando `supabase/functions/extract-balancete/index.ts`

(Opcional) Para fallback offline, baixe:
- `mammoth.browser.min.js` de `https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js`
- `pdf.min.js` de `https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js`

para `frontend/vendor/`.

---

## Versionamento

Este repositório segue o fluxo de trabalho simplificado:

- `main` — versão estável em produção
- Commits com prefixo convencional: `feat:`, `fix:`, `chore:`, `docs:`
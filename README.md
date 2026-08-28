# Controle Financeiro — LAPIG

Sistema de controle financeiro para gestão de centros de custo (projetos) e
bolsas do Laboratório de Processamento de Imagens e Geoprocessamento
(LAPIG / UFG).

Migrado de Google Sheets + Apps Script para uma aplicação web com banco
relacional. Toda a interface e a documentação estão em **português do Brasil**.

---

## Stack

| Camada     | Tecnologia                                        |
|------------|---------------------------------------------------|
| Frontend   | HTML + Vanilla JS + CSS — **sem build step**       |
| Backend    | Supabase (PostgreSQL + Auth + RLS + Storage)       |
| Gráficos   | Chart.js                                           |
| Ícones     | Lucide Icons                                       |
| Fontes     | DM Sans · Exo 2 · JetBrains Mono (Google Fonts)    |
| Dev tools  | Node.js (ESLint + Vitest) — só para lint/teste/CI  |

---

## Como rodar

Não há build. Sirva `frontend/` com qualquer servidor estático:

```bash
cd frontend && python -m http.server 8080
```

Ou use `abrir-site.bat` na raiz (Windows), que faz isso e abre o navegador.

> **Tem que ser HTTP.** Abrir `frontend/index.html` como `file://` quebra os
> `<script type="module">` (`pure-fns.js` e os parsers) por CORS, e a aplicação
> sobe pela metade — sem mensagem de erro óbvia.

As credenciais do Supabase ficam em `frontend/js/supabase-config.js`. A anon key
é pública por natureza; quem protege os dados é o RLS (ver
[`docs/seguranca-publicacao.md`](docs/seguranca-publicacao.md)).

### Dev tooling

```bash
npm ci          # instala as dependências de desenvolvimento
npm run lint    # ESLint em frontend/js/ e mcp/
npm test        # Vitest em tests/
```

CI no GitHub Actions (`.github/workflows/ci.yml`): lint + testes a cada push/PR
para `main`/`master`. Há um job separado que sobe o servidor MCP e confere o
contrato das tools sem precisar de credencial.

### Banco de dados

Execute os scripts de `database/` **na ordem numérica**, 001 → 041.

O alvo é a **última** migração, não uma parada intermediária: a camada de
decisão nasce nas 038/039/040 (`get_saldo_livre`, `simular_alocacao`,
`get_panorama`) e nem o servidor MCP nem a aba Assistente sobem sem elas.

> `000_reset_completo.sql` é **destrutivo** — dropa todas as tabelas e dados.
> Nunca rode sem a intenção explícita de zerar o banco.

Antes de qualquer escrita no banco de **produção**, leia
[`docs/acesso-ao-banco.md`](docs/acesso-ao-banco.md).

---

## Estrutura do repositório

Mapa por diretório. A lista arquivo a arquivo vive nos docs de referência
(linkados abaixo) — mantê-la em três lugares foi o que fez as três versões
divergirem.

```
├── frontend/          Aplicação (index.html + css/ + js/ + images/ + vendor/)
│   └── js/            app, auth, router, chart-builder, simulation, pure-fns,
│                      import-queue · pages/ · parsers/ · components/ · ai/
├── database/          Migrações SQL 000–041, em ordem · utils/ (scripts Python)
├── docs/              Documentação de referência (índice em docs/README.md)
├── tests/             Vitest (parsers, simulação, camada de IA) · sql/ (roteiros)
├── mcp/               Servidor MCP — pacote Node próprio (fase 2 da camada de IA)
├── supabase/          config.toml da stack local · functions/ (Edge Functions)
├── tools/             Utilitários operacionais (n8n, userscript, réplica local)
├── data/              Planilha legada (não versionada — ver data/README.md)
└── .github/workflows/ CI (lint + testes) e deploy (GitHub Pages)
```

---

## Documentação

O índice completo está em [`docs/README.md`](docs/README.md). Os quatro pontos
de partida:

| Documento | Para quê |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Ordem de carga dos scripts, padrão de módulos, auth, camada de decisão |
| [`docs/pages.md`](docs/pages.md) | O que cada tela faz e de onde tira os dados |
| [`docs/database.md`](docs/database.md) | Tabelas, RPCs, views e o histórico das migrações |
| [`docs/tutorial-novo-usuario.md`](docs/tutorial-novo-usuario.md) | Para quem vai **usar** o sistema, não mexer nele |

---

## Funcionalidades

**Rotina mensal**

- **Fechamento Mensal** — checklist da competência (projeto ativo × balancete ×
  planilha de bolsas × plano ativo) e um botão único que abre a fila de
  importação com os 3 handlers, roteando cada arquivo por extensão com revisão
  humana um a um.
- **Saldos** — saldo mensal por projeto, com salvamento em lote das linhas
  alteradas e aviso ao sair da tela com mudanças pendentes.

**Acompanhamento**

- **Projetos** — seletor, projeção mensal, painel de bolsistas e Modo Editor com
  simulação em tempo real (o cálculo JS espelha o SQL).
- **Visão do Projeto (Hub)** — tela agregadora (somente leitura) com os 4
  KPIs-chave e atalhos para cada área, incluindo a pasta do projeto no Drive.
- **Plano de Trabalho** — 3 abas: **Orçamento** (import de DOCX/PDF com extração
  determinística e versionamento), **Balancetes** (import do PDF mensal da
  FUNAPE, mapeamento conta → rubrica) e **Previsto × Realizado**.
- **Visão Geral** — KPIs consolidados, projeção agregada e sino de alertas.

**Cadastros**

- **Bolsistas** — CRUD, rendimentos mensais e aba **Reconciliação**: importa a
  planilha FUNAPE (XLSX), compara com o banco (novos/removidos/alterados/iguais)
  e aplica o aprovado numa transação. Inclui merge de duplicados e exclusão em
  cascata consciente.
- **Gestão de Projetos**, **Desembolsos**, **Observações**, **Usuários &
  Centros de Custo** (admin).

**Assistente** — aba de conversa sobre os dados do sistema. Ver abaixo.

---

## Extração de documentos (determinística)

Tudo que entra por arquivo é parseado **no browser, sem modelo de IA**:

| Origem | Caminho |
|---|---|
| Plano de Trabalho DOCX | `mammoth` → HTML → `pt-parser.js` |
| Plano de Trabalho PDF | `pdf.js` → linhas → `pt-pdf-parser.js` |
| Balancete PDF | `pdf.js` → texto → `balancete-parser.js` |
| Planilha de bolsas XLSX | SheetJS → `bolsa-parser.js` → `bolsa-comparator.js` |

O plano PROAD tem **dois** parsers porque o pdf.js não entrega estrutura de
tabela. Os modelos fora do padrão (FAPEG, prefeitura/emenda impositiva) estão em
[`docs/planos-fora-do-padrao.md`](docs/planos-fora-do-padrao.md).

---

## Camada de IA

Três fases sobre as **mesmas** RPCs de decisão (038/039/040), com uma regra
dura: **zero lógica financeira fora do banco**. Todo número sai de RPC — duas
implementações da mesma conta divergiriam do site.

1. **RPCs de decisão** (`database/038`–`040`) — `get_saldo_livre` (quanto sobra
   neste centro), `simular_alocacao` (onde cabe este gasto) e `get_panorama`
   (como estão os centros). `panorama` **descreve**; `simular_alocacao`
   **ranqueia**.
2. **Servidor MCP** ([`mcp/README.md`](mcp/README.md)) — adaptador para clientes
   de IA de terceiros. Autentica com o login de cada pessoa, então o RLS é a
   barreira; o servidor não tem lógica de permissão própria.
3. **Aba Assistente** (`frontend/js/ai/` + Edge Function
   [`assistente`](supabase/functions/assistente/README.md)) — tool calling
   nativo, com o laço rodando **no browser**: as tools chamam as RPCs pelo
   `supabaseClient` já logado (mesmo JWT, mesmo RLS das outras telas). A tela
   mostra **qual RPC foi consultada**, com o JSON cru dobrável embaixo de cada
   passo — é assim que se confere a regra sem acreditar na palavra do modelo:
   número na resposta sem passo correspondente é invenção. À Edge Function
   sobrou guardar a `OLLAMA_API_KEY` e a allowlist de modelos.

`tests/ai-tools.test.js` trava a lista de tools e o bloco de regras do
adaptador do site contra o do MCP, palavra por palavra — os dois são separados
só por encanamento (stdio/npm × módulo ES sem build), e é o tipo de par que
deriva em silêncio.

### Edge Functions de extração (deprecated)

`extract-plano-trabalho` e `extract-balancete` eram proxies do Ollama Cloud e
estão **deprecated desde 2026-05**: o frontend não as chama mais (a extração é
determinística). Permanecem deployadas como histórico.

---

## Operação

- **Keep-alive do Supabase** — o plano gratuito pausa após 7 dias sem atividade.
  O workflow `tools/n8n-keep-alive-lapig.json` faz, a cada 2 dias, uma leitura
  idêntica à da landing page. Importação em
  [`docs/keep-alive-n8n.md`](docs/keep-alive-n8n.md).
- **Publicação** — `.github/workflows/deploy.yml` publica `frontend/` no GitHub
  Pages. Antes de tornar o repositório público, cumprir o checklist de
  [`docs/seguranca-publicacao.md`](docs/seguranca-publicacao.md) — em especial
  **desativar o signup** no Supabase Auth.
- **Teste local do banco** — três níveis (sintético, réplica raspada de PII e
  stack Supabase completa) em
  [`tools/replica-local/README.md`](tools/replica-local/README.md).

---

## Convenções

- **Commits convencionais:** `feat:`, `fix:`, `chore:`, `docs:`.
- `main` — versão estável em produção.
- Valores monetários são `numeric` (não centavos inteiros); exibição via
  `formatBRL()`.
- Chaves de `localStorage` usam o prefixo `cf_`.
- Bibliotecas de CDN carregam com hash SRI e caem para `frontend/vendor/` se o
  CDN falhar.

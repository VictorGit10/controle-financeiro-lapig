# Revisão externa do sistema — 2026-07-16

**Origem:** leitura completa do repositório por um modelo externo, em conversa.
Era um despejo bruto de texto (`docs/ConversaFable.txt`), sem estrutura e sem
indicação do que ainda valia. Foi reescrito aqui em 2026-08-28 com o **status de
cada achado conferido contra o código atual** — sem isso o arquivo era pior que
nada: uma lista de bugs em que metade já estava corrigida, e não havia como
saber qual metade sem reler tudo.

**Como ler:** é um documento **histórico**. Todos os 11 achados de bug estão
fechados — os 4 que seguiam abertos na conferência de 2026-08-28 foram
corrigidos no mesmo dia. Ficam aqui para não serem "redescobertos" e porque a
correção de vários deles depende de um contexto que só este relatório registra.
As duas últimas seções (fusão de telas, automação) não são bugs: são propostas
de rumo que nunca foram decididas, e é o que dá valor a este arquivo hoje.

Relatório irmão, do mesmo dia e com metodologia diferente (fan-out de 21
subagentes): [`bug-hunt-2026-07-16.md`](bug-hunt-2026-07-16.md). Os dois se
sobrepõem pouco — este achou bugs de fluxo de UI, aquele achou bugs de parsing
e de cálculo.

---

## Resumo do fluxo do sistema (ainda válido)

SPA vanilla JS sem build, Supabase como backend (PostgREST + RPCs + Storage +
Auth). Cada página é um IIFE que se registra num `Router` em memória (sem
hash/URL); o estado compartilhado entre telas vive em `localStorage` (`cf_*`).
O ciclo operacional mensal:

1. **Fechamento Mensal** (`fechamento.js`) — checklist por competência: cada
   projeto ativo precisa de balancete (PDF), planilha de bolsas conferida
   (XLSX) e plano ativo (DOCX). O botão único abre a `ImportQueue` com os 3
   handlers, roteando por extensão, com revisão humana arquivo a arquivo.
2. **Parsers determinísticos no browser** — `balancete-parser` (pdf.js →
   regex), `pt-parser` (mammoth → HTML), `bolsa-parser`/`bolsa-comparator`
   (SheetJS → diff contra o banco). O save de cada um chama RPCs transacionais
   (`upsert_balancete`, `upsert_plano_trabalho`, `apply_reconciliation`).
3. **Saldos** (`saldos.js`) — digitação manual mensal em `project_balances`; um
   trigger sincroniza o saldo mais recente para `projects.initial_balance`
   (cache), que alimenta todas as projeções.
4. **Projeções** — `calc_project_monthly` (SQL) espelhado em `pure-fns.js` (JS)
   para a simulação client-side da aba Projetos; Dashboard agrega via
   `calc_projects_batch`.

---

## Achados — status em 2026-08-28

| # | Achado | Situação |
| --- | --- | --- |
| 1 | Desembolsos não salvam (`readOnly` no campo de data impedia a coleta de `release_date`) | ✅ corrigido — `funding.js:71` não tem mais `readOnly` |
| 2 | Sino de notificações para de abrir na 2ª visita (listeners duplicados) | ✅ corrigido — guard `_bellInited` em `dashboard.js:33,91` |
| 3 | Botão de ação de Bolsistas dispara duas ações | ✅ corrigido — `holders.js:13-16` usa `onclick`, com comentário explicando por quê |
| 4 | Saldos: `null` vira `0` e "não informado" some | ✅ corrigido em 2026-08-28 — ver abaixo |
| 5 | CSP do Sentry inválida (wildcard no meio do host) | ✅ corrigido em 2026-08-28 — `https://*.ingest.sentry.io` |
| 6 | `inferBalanceStatus` ignora a idade do saldo depois do dia 7 | ✅ corrigido — `pure-fns.js:109-113` checa ano e mês |
| 7 | Exclusão apaga o Storage antes do banco | ✅ corrigido em 2026-08-28 — ordem invertida nos dois pontos |
| 8 | `exportCSV` lança `TypeError` quando `data` vem vazio sem `error` | ✅ corrigido em 2026-08-28 — `error` e `!data` tratados à parte |
| 9 | Busca do CrudPage perdia o foco a cada tecla | ✅ corrigido — shell fixo em `crud-page.js:98-102` |
| 10 | `h.email` interpolado sem `escapeAttr` no merge de duplicados | ✅ corrigido — `holders.js:1950` |
| 11 | `docs/pages.md` e `docs/architecture.md` descreviam `ExpensesPage` e `funape_managed` | ✅ corrigido em 2026-08-28 |

### Detalhe dos quatro corrigidos em 2026-08-28

**#4 — Saldos: `null` vira `0`.** Era o mais grave dos quatro, e por um motivo
que o achado original não mencionava. `saldos.js` enviava
`initialBalance ?? 0` / `yieldAmount ?? 0`, e as colunas são
`NOT NULL DEFAULT 0` (migração 017) — então enviar `0` não grava "vazio", grava
a afirmação "a conta está zerada". O relatório notou o efeito no KPI "Com
Saldo"; o efeito real é maior: o trigger `sync_project_balance` copia o saldo
mais recente para `projects.initial_balance`, que alimenta
`calc_project_monthly` e **toda projeção** da aba Projetos e do Dashboard. Um
saldo fabricado por preenchimento parcial contaminava os gráficos.

Correção sem mudar o schema: `readNumber()` separa "vazio" (`null`) de "lixo
digitado" (`NaN`) e de número. Campo vazio com linha já salva **preserva o valor
salvo** — editar só o rendimento não pode mais zerar o saldo. Campo vazio sem
linha salva **recusa a gravação**, nomeando o projeto e dizendo por quê, em vez
de inventar um número. Isso fechou também o achado #23 do
[`bug-hunt-2026-07-16.md`](bug-hunt-2026-07-16.md) (NaN indo para o banco), que
atacava o mesmo trecho por outro ângulo.

A segunda metade do achado também foi feita: a data do saldo passa a ser
validada contra o mês de referência **no frontend**, com mensagem clara. Antes,
o constraint `chk_balance_date_matches_month` estourava no banco e o toast
mostrava o erro cru do Postgres — o que acontecia toda vez que o saldo de junho
era informado em 3 de julho.

> A correção de raiz continua sendo tornar as colunas anuláveis, para que "não
> informado" seja representável no banco. Isso é migração e mexe em dado de
> produção; o que está feito impede a fabricação do número sem tocar no schema.

**#5 — CSP do Sentry.** `https://o450*.ingest.sentry.io` — wildcard no meio de
um label não é host-source válido, e o browser descartava a *source* inteira em
silêncio. Passou a `https://*.ingest.sentry.io` (wildcard como label mais à
esquerda, que é a forma válida). Continua sem efeito prático até alguém definir
`window.SENTRY_DSN`, que é o gatilho do Sentry — mas agora, quando isso
acontecer, os eventos vão sair.

**#7 — Ordem de exclusão.** Em `excluir` e `excluirBalancete` o arquivo saía do
bucket antes do `DELETE` na tabela. A ordem foi invertida nos dois pontos, com o
raciocínio no comentário: falhar depois do delete deixa um órfão no bucket, que
não quebra tela nenhuma; falhar antes deixava um registro vivo apontando para
arquivo inexistente, e o botão Baixar quebrava sem forma de recuperar.

**#8 — `exportCSV`.** `if (error || !data)` seguido de `error.message` lançava
`TypeError` quando a resposta vinha sem erro e sem linhas. Os dois casos agora
são tratados à parte: erro mostra o erro; lista vazia mostra "Nada a exportar".

---

## Gargalos de performance e UX (não conferidos desde 2026-07-16)

1. **Dashboard em cascata** — `renderFull()` espera `calc_projects_batch`,
   depois `scholarships`, depois `get_alerts_for_projects` em série (3+
   round-trips que poderiam ser um `Promise.all`).
2. **Contagens buscando linhas inteiras** — `hub.js` baixa todos os ids de
   `monitoramento` só para contar; usar `{ count: 'exact', head: true }` (como
   `holders.remove` já faz).
3. **Re-render total a cada tecla no modo Simulação** — `projetos.js`
   `updateDraftField` re-renderiza a página inteira a cada `onchange`, perdendo
   o foco do campo.
4. **Bolsistas recarrega tudo a cada micro-operação** — salvar uma bolsa refaz a
   query completa de holders+bolsas. Aceitável na escala atual (~dezenas), é o
   padrão que mais pesa conforme crescer.

---

## Proposta: fusão de telas (de 10 para ~6)

Nunca decidida. Fica registrada porque o argumento continua de pé: o hub
("Visão do Projeto") já validou a ideia de um "projeto atual" único
compartilhado (`cf_selected_project_id`), e as páginas são IIFEs desacopladas —
dá para compor os renderers existentes como abas sem reescrever a lógica.

| Hoje | Proposta |
| --- | --- |
| Fechamento, Saldos | **Fechamento Mensal** absorve Saldos: a tabela de saldos da competência vira parte do checklist |
| Projetos, Visão do Projeto, Plano de Trabalho, Observações | **Projeto** — hub promovido a tela central, com abas: Visão · Projeção & Simulação · Plano & Execução · Observações |
| Visão Geral | **Visão Geral** (inalterada) |
| Bolsistas | **Bolsistas** (já tem abas Bolsistas/Reconciliação) |
| Gestão de Projetos, Desembolsos | **Cadastros** — Desembolsos vira aba de Gestão de Projetos |

O maior ganho de rotina é o Fechamento absorver Saldos: hoje a pessoa digita à
mão em Saldos um número (`saldo_disponivel`) que já está no PDF do balancete que
ela acabou de importar na mesma competência.

---

## Proposta: automação da entrada de dados

Objetivo declarado: "a pessoa entra e os saldos do mês já estão lá, pendentes só
de aprovação". Caminho incremental, com as peças que já existem:

1. **Quick win, sem infra nova** — o handler de balancete já extrai
   `saldo_disponivel`, `rendimento_liquido` e `data_referencia`. Ao salvar,
   oferecer no mesmo modal um checkbox "registrar como saldo do mês" que chama
   `upsert_project_balance`. O comentário da migração 017 já previa essa
   automação. Sozinho, elimina a digitação da tela Saldos para todo projeto com
   balancete.
2. **Ingestão automática** — os arquivos chegam por e-mail da FUNAPE. O n8n (já
   usado para o keep-alive) pode monitorar a caixa via IMAP e depositar os
   anexos num bucket `inbox/` + tabela `import_inbox`
   (`status='pending_review'`). O Fechamento mostra "N arquivos recebidos
   aguardando revisão" e o clique abre a mesma `ImportQueue` de hoje, com o
   arquivo já baixado — o human-in-the-loop vira só a aprovação.
3. A revisão/aprovação continua usando `upsert_balancete` /
   `apply_reconciliation` / `upsert_project_balance` — auditoria (migração 023)
   e RLS já cobrem.

**Pré-requisito do passo 2:** o checklist de
[`../seguranca-publicacao.md`](../seguranca-publicacao.md), porque a ingestão
via n8n precisa de uma credencial de serviço, não da anon key.

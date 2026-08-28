# Documentação — Controle Financeiro LAPIG

Índice do que existe aqui e **quando** ler cada coisa. A visão geral do projeto
está no [`README.md`](../README.md) da raiz; as instruções para agentes de IA,
em [`CLAUDE.md`](../CLAUDE.md).

## Referência do sistema

Leia o documento da área antes de mexer nela.

| Documento | Quando |
|---|---|
| [`architecture.md`](architecture.md) | Ordem de carga dos scripts, padrão de módulos (IIFE + `window`), auth, guards de rota, ChartBuilder, SimulationEngine, camada de decisão e IA |
| [`pages.md`](pages.md) | O que cada tela faz, de onde tira os dados e o que a fábrica `CrudPage` resolve |
| [`database.md`](database.md) | Tabelas, RPCs, views e o histórico do que cada migração mudou |
| [`globals.md`](globals.md) | Utilitários globais de `pure-fns.js`, `supabase-config.js` e `auth.js` |
| [`planos-fora-do-padrao.md`](planos-fora-do-padrao.md) | Planos que não seguem o modelo PROAD (FAPEG, emenda impositiva): detecção de modelo, roteamento por conteúdo, preenchimento manual |

> A justificativa **completa** de cada migração (semântica, investigação,
> validação) vive no cabeçalho do próprio arquivo `.sql`, não aqui. Consulte a
> migração antes de mexer naquela área; `database.md` é o mapa, não o território.

## Operação e segurança

| Documento | Quando |
|---|---|
| [`acesso-ao-banco.md`](acesso-ao-banco.md) | **Antes de qualquer escrita no banco de produção.** As 4 credenciais e o alcance de cada uma, as regras duras, o protocolo de escrita e a recuperação |
| [`seguranca-publicacao.md`](seguranca-publicacao.md) | Antes de tornar o repositório público ou publicar no GitHub Pages. Checklist obrigatório |
| [`keep-alive-n8n.md`](keep-alive-n8n.md) | Importar o workflow que impede o Supabase gratuito de pausar por inatividade |

## Para quem usa o sistema

| Documento | Quando |
|---|---|
| [`tutorial-novo-usuario.md`](tutorial-novo-usuario.md) | Primeiro acesso: entrar, criar o centro de custo, importar os arquivos do mês |
| [`Tutorial-Novo-Usuario.pdf`](Tutorial-Novo-Usuario.pdf) | O mesmo tutorial em PDF, para enviar a quem não abre o repositório |

## Histórico

[`historico/`](historico/) guarda relatórios datados que **não** são referência
viva — auditorias e revisões que já foram parcialmente resolvidas. Cada arquivo
diz o que segue aberto e o que já fechou. Ver
[`historico/README.md`](historico/README.md).

## Onde a documentação NÃO está

Nem tudo cabe em `docs/`. Quando a informação só faz sentido colada ao código,
ela mora lá:

- **Cabeçalho de cada migração** (`database/*.sql`) — por que a migração existe,
  o que se decidiu e como foi conferida.
- **Roteiros de conferência** (`tests/sql/*.sql`) — blocos autossuficientes para
  rodar no SQL Editor do Supabase.
- **Contrato do handler da fila de importação** — cabeçalho de
  `frontend/js/import-queue.js`.
- **Servidor MCP** — [`mcp/README.md`](../mcp/README.md), incluindo a pendência
  de verbosidade da 2ª rodada.
- **Edge Functions** — README próprio em cada
  [`supabase/functions/*/`](../supabase/functions/).
- **Ambientes de teste local do banco** —
  [`tools/replica-local/README.md`](../tools/replica-local/README.md).

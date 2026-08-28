# AGENTS.md

**As instruções deste repositório estão em [`CLAUDE.md`](CLAUDE.md). Leia aquele
arquivo — ele vale integralmente para qualquer agente, não só para o Claude
Code.**

Este arquivo é só um ponteiro, de propósito.

Até 2026-08-28 ele era uma **cópia** do `CLAUDE.md`, mantida à mão. As duas
versões divergiram, como toda cópia manual diverge: o `AGENTS.md` seguia
descrevendo a página `expenses.js` (removida pela migração 032), mandava abrir
`frontend/index.html` direto no navegador (o que quebra os `<script
type="module">`), apontava a landing page errada e não sabia nada sobre o
multi-tenancy por centro de custo (migrações 033/034), sobre os parsers
determinísticos nem sobre a fila de importação.

O problema disso não é o arquivo desatualizado — é que um agente que lesse só
este arquivo tomaria decisões erradas com confiança, sem sinal nenhum de que
estava lendo uma versão velha. Um ponteiro não tem como ficar desatualizado.

Para quem usa **Codex**: `AGENTS.md` continua sendo o arquivo lido
automaticamente; ele agora aponta para o conteúdo em vez de duplicá-lo.

## Atalhos

- Visão geral do projeto e como rodar: [`README.md`](README.md)
- Índice da documentação de referência: [`docs/README.md`](docs/README.md)
- **Antes de escrever no banco de produção:**
  [`docs/acesso-ao-banco.md`](docs/acesso-ao-banco.md)

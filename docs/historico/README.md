# Histórico

Relatórios datados que **não** são referência viva. Ficam aqui em vez de serem
apagados porque contêm achados que nunca foram fechados — e ficam separados de
`docs/` porque, misturados à referência, eram lidos como se descrevessem o
sistema de hoje.

**Regra deste diretório:** todo arquivo diz, no topo, quando foi conferido pela
última vez e o que segue aberto. Um relatório sem status é um relatório que
ninguém consegue usar — dá o mesmo trabalho reconferir tudo do que refazer a
análise.

| Arquivo | O que é | Última conferência |
|---|---|---|
| [`bug-hunt-2026-07-16.md`](bug-hunt-2026-07-16.md) | Varredura com 21 subagentes paralelos + verificação adversarial. 25 achados, focados em parsing e cálculo | 2026-08-28 (os 4 críticos + o #23) |
| [`revisao-externa-2026-07-16.md`](revisao-externa-2026-07-16.md) | Leitura do repositório por um modelo externo. Bugs de fluxo de UI + propostas de fusão de telas e de automação da entrada de dados | 2026-08-28 — **todos os 11 achados fechados** |

Os dois são do mesmo dia e se sobrepõem pouco: metodologias diferentes acharam
classes de bug diferentes. As **propostas** da revisão externa (fusão de telas,
ingestão automática por e-mail) nunca foram decididas e continuam de pé — é o
que dá mais valor ao arquivo hoje.

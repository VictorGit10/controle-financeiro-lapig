# Planos de Trabalho fora do padrão PROAD/UFG

Os leitores automáticos cobrem **um** modelo: o padrão PROAD/UFG, identificado
pela tabela canônica *"Plano de Aplicação dos Recursos Financeiros"* — em DOCX
(`pt-parser.js`) e em PDF assinado (`pt-pdf-parser.js`). Ele é o normal e o
esperado.

Mas o LAPIG capta recursos de mais de uma fonte, e cada financiador tem o seu
formulário. Este documento registra os modelos-exceção já vistos, o que cada um
tem no lugar da tabela canônica, e como o sistema lida com eles.

> **Atenção:** os documentos originais desses modelos trazem CPF, e-mail e
> telefone de coordenador e bolsistas. Eles ficam em `NãoColocarNoGit/`
> (ignorada pelo git) e **nunca** entram no repositório — que é público.
> Ver [seguranca-publicacao.md](seguranca-publicacao.md).

## Decisão de arquitetura

**Nada no banco muda por causa desses modelos.** `plano_rubricas`
(`rubrica_code` + `descricao_livre` + `valor_previsto`) e `plano_desembolsos`
(parcela / data / valor) são genéricos o bastante para guardar os três. O que
varia é só a *leitura* do documento.

Consequência importante: **todo modelo precisa cair no mesmo catálogo de
`rubrica_code`**. É isso que mantém o *Previsto × Realizado* funcionando, já
que o realizado vem do balancete da FUNAPE ancorado nas letras a–g via
`conta_rubrica_map`. Um plano da FAPEG cujas rubricas ficassem num vocabulário
paralelo simplesmente não bateria com nada.

Por isso a estratégia **não** é escrever um parser por financiador. É:

1. **Reconhecer** o modelo e dizer ao usuário qual é (`pt-model-detect.js`).
2. **Deixar cadastrar à mão** quando não há leitor (`manualFallback` na fila de
   importação), com o documento original anexado como comprovante.
3. Só automatizar um modelo novo quando o volume justificar.

## Os modelos

### `proad` — padrão PROAD/UFG (o normal)

Tabela canônica com as letras `a- Pessoal`, `b – Serviços de Terceiros P.
Jurídica`, `c – Passagens`, `d – Diárias`, `e – Material de Consumo`,
`f – Investimento`, `g/h – Ganho econômico`, mais CIP e DAO.

**Lido automaticamente nos dois formatos:**

- **DOCX** → `pt-parser.js` (mammoth → `<table>` → linhas).
- **PDF** (plano já assinado) → `pt-pdf-parser.js` (pdf.js → texto → linhas).

São parsers separados porque o pdf.js **não entrega estrutura de tabela** — só
texto quebrado por coordenada Y. Não há `<tr>`/`<td>` para reaproveitar o
`parseLinhas()` do DOCX.

Um plano PROAD em PDF costuma também não ter linha de CIP (quando o financiador
é externo, o DAO entra dentro do `b`) e escrever a vigência como
`Novembro/2025 – Novembro/2027`; o parser de PDF entende Mês/Ano (o do DOCX só
entende `dd/mm/aaaa`).

#### A regra que evita um plano silenciosamente errado

No texto do pdf.js, as linhas de rubrica-pai saem sempre limpas e trazem o
próprio total:

```
a- Pessoal   Total   864.000,00
b – Serviços de Terceiros P. Jurídica   Total   73.000,00
```

As **folhas** é que se desalinham: um rótulo longo quebra e o valor cai na
linha seguinte —

```
Inscrição em eventos
8.000,00
```

Daí duas decisões no `pt-pdf-parser.js`:

1. **`mergeValoresOrfaos`** junta um rótulo sem valor com a linha seguinte
   **quando ela é só um número**. Rótulo seguido de outro rótulo (como o
   agrupador `Outros serviços`) continua sem valor e é ignorado.
2. **O total declarado de cada letra é o árbitro.** As folhas só são usadas
   quando somam exatamente esse total. Quando não somam, emite-se uma única
   linha com o total da letra mais um aviso nomeando a divergência.

O efeito é que **o valor global nunca sai errado** — no máximo perde-se
detalhe, com aviso. Confiar nas folhas sem essa checagem produziria, no
documento real que motivou o parser, um plano 86 mil reais abaixo do total sem
nenhum sinal. Há ainda uma conferência final entre a soma das rubricas e o
total declarado em `2 - Previsão de Despesas`. Coberto em
`tests/pt-pdf-parser.test.js`.

### `fapeg-adequacao` — Adequação de Plano de Trabalho (FAPEG)

Planilha XLSX com 8 formulários (`FOR-001` a `FOR-007`). É semanticamente um
**remanejamento**: as abas trazem `VALOR ORIGINAL` × `VALOR FINAL`.

| Aba | Conteúdo | Equivalência |
| --- | --- | --- |
| `5_Custeio FOR 005` | coluna `RUBRICA` com vocabulário FAPEG | `Pessoal` → `a` · `Outros Serviços de Terceiros - PJ` → `b` · `Passagens e Despesas com Locomoção` → `c` · `Hospedagem e Alimentação` → `d` · `Material de Consumo` → `e` |
| `6_Bens Duráveis FOR 006` | itens de investimento | `f — Investimento` |
| `7_Remanej_ Financeiro FOR 007` | totais Custeio + Bens Duráveis | `valor_total_plano` |
| `3.1_Equipe Executora Bolsistas` | roster com CPF, modalidade, valor mensal e nº de meses | sobrepõe-se à reconciliação de bolsas |

O item `DAO Funape`, que aparece como linha dentro de "Outros Serviços de
Terceiros - PJ", vai para `dao`.

**Sem leitor automático** — cadastro manual. Vale escrever um parser se o
volume de projetos FAPEG crescer: as abas são tabelas regulares e o vocabulário
de rubrica é fixo e pequeno.

### `prefeitura-fomento` — Termo de Fomento / Colaboração (emenda impositiva)

DOCX de emenda parlamentar municipal. **Não tem tabela de rubricas nenhuma.**

- `10. Custos` — colunas `Tipo de Despesas | Período | Quantidade | Valor Unit`.
  Linhas em texto livre, sem código de rubrica e sem total por linha.
- `16. Cronograma de Desembolso` — `Parcelas | Responsável | Mês | Ano | Valor`,
  que encaixa direto em `plano_desembolsos`.
- Vigência no cabeçalho como `Outubro 2025` / `Outubro 2026`.

**Sem leitor automático, e deliberadamente.** Classificar "Editoração" ou
"coffee break" em `b` ou `e` é julgamento humano; automatizar isso seria chutar.
Este modelo deve continuar manual.

### `fapeg-plano` — Plano de Trabalho FAPEG sem a tabela canônica

Rede de segurança: reconhece um documento da FAPEG que não seja Adequação nem
use a tabela do PROAD. Cadastro manual.

## Como o sistema lida

### Detecção do modelo (`frontend/js/parsers/pt-model-detect.js`)

`detectPtModel(texto)` → `{ id, label, isPlano, message }`. Nunca lança; texto
irreconhecível devolve `desconhecido`. O texto pode vir do HTML do mammoth, do
text layer do pdf.js ou do CSV do SheetJS (`sniffDocText` em
`plano-trabalho.js` produz o que der para cada extensão).

A ordem dos testes importa: **`proad` vem primeiro**, porque um plano da FAPEG
que use a tabela canônica (acontece — a FUNAPE costuma ser interveniente) deve
ser tratado como legível.

Serve a duas coisas: a mensagem de erro (`pt-parser.js` a usa no lugar de
"tabela não encontrada") e o roteamento por conteúdo.

### Roteamento por conteúdo (PDF)

Plano assinado e balancete chegam ambos em `.pdf`, e a fila roteia por
extensão. `BALANCETE_HANDLER.parse` roda o detector antes de parsear: se o
texto é de um plano, lança um erro com `rerouteTo: 'plano'` e o `ImportQueue`
reentrega o arquivo ao handler de plano (uma vez só), que aí o lê com o
`pt-pdf-parser.js`. **`PLANO_HANDLER.validExt` continua só com `.docx` de
propósito** — se reivindicasse `.pdf`, roubaria todo balancete na aba Orçamento
e no Fechamento, onde ele vem primeiro na lista. O teste é positivo e
específico — o balancete da FUNAPE não fala em "Plano de Aplicação dos Recursos
Financeiros" nem em Termo de Fomento — então um balancete real nunca é
desviado. Coberto em `tests/pt-model-detect.test.js`.

Por isso `openQueue` em `plano-trabalho.js` sempre abre a fila com **os dois**
handlers (o da aba atual primeiro): sem o handler de plano na fila não há para
onde rerotear.

### Preenchimento manual (`manualFallback`)

Quando o parse falha, a tela de erro do `ImportQueue` oferece **"Preencher
manualmente"** além de "Pular". Ela reaproveita o mesmo formulário de revisão
da importação — que já é um editor completo: cabeçalho, rubricas com
adicionar/remover e desembolsos.

- O esqueleto vem com as rubricas que os modelos-exceção usam
  (`a.bolsas, b, c, d, e, f, dao`); linhas deixadas sem valor são descartadas
  no `collectReviewForm`.
- O arquivo original **é anexado assim mesmo** ao bucket `plano-trabalho-docs`
  — o comprovante não se perde por não ter sido lido.
- `raw_extraction` fica `null` (nada foi extraído; gravar o esqueleto vazio
  mentiria sobre a origem dos números).
- PDF ganha o split-view do pdf.js ao lado do formulário; DOCX, o HTML
  convertido; XLSX/DOC/ODT ficam só com o formulário.

Formatos aceitos pelo handler de plano além do DOCX: `.doc`, `.odt`, `.xlsx`,
`.xls`, `.ods`, via `fallbackExt` — que só é consultado quando **nenhum** outro
handler reivindicou o arquivo por `validExt`. É o que impede o handler de plano
de roubar o XLSX de bolsas no Fechamento Mensal.

# Tutorial — Começando a usar o Controle Financeiro

Este guia é para quem vai usar o sistema no dia a dia. Ele mostra só o
caminho necessário: **entrar, criar o centro de custo e importar os
arquivos** (plano de trabalho + balancete/saldos). Não precisa saber
nada de técnica — é tudo clicar e confirmar.

> O login e a senha você recebe por mensagem separada.

---

## 1. Entrar no sistema

1. Abra o site: **https://victorgit10.github.io/controle-financeiro-lapig/**
2. Clique em **Entrar** e digite o login e a senha que você recebeu.
3. Se for a primeira vez, a tela vai aparecer **vazia** — isso é normal.
   O próximo passo é criar o centro de custo.

---

## 2. Criar o centro de custo (uma vez por projeto)

O "centro de custo" é o projeto que você vai acompanhar. Cada projeto é
criado uma única vez. Depois disso, você só importa os arquivos dele.

1. No menu lateral, clique em **Gestão de Projetos**.
2. Clique no botão **Novo Projeto** (canto superior direito).
3. Preencha:
   - **Nome** *(obrigatório)* — nome do projeto.
   - **Código** *(obrigatório)* — **coloque aqui o código FUNAPE do
     projeto, exatamente como aparece nos documentos.** Isso é
     importante por dois motivos:
     - Quando você importar o balancete em PDF, o sistema lê esse código
       e **já seleciona o projeto sozinho**. Sem o código, você teria que
       escolher o projeto manualmente a cada balancete.
     - É assim que você garante que cada arquivo cai no projeto certo.
   - **Início** e **Término** — vigência do projeto (pode deixar em
     branco se não souber).
   - **Projeto ativo** — deixe marcado.
   - **Incluir no Dashboard Geral** — deixe marcado.
4. Clique em **Salvar**.

> Repita para cada centro de custo que você for cadastrar.
> O projeto que você cria fica automaticamente vinculado a você — você
> já consegue editá-lo e importar arquivos nele na hora.

---

## 3. Importar os arquivos do mês (rotina)

Aqui é o trabalho de todo mês. Você vai receber **duas pastas** com os
arquivos:

- **Planos de trabalho** → arquivos **.docx**
- **Saldos (balancetes)** → arquivos **.pdf**

Os dois tipos de arquivo são importados **no mesmo lugar**, de uma vez
só. Vamos aos passos.

### Passo a passo (comum a todos os arquivos)

1. No menu lateral, clique em **Fechamento Mensal**.
2. No campo **Competência** (em cima), escolha o **mês/ano** dos
   arquivos que você vai importar (ex.: se os arquivos são de
   julho/2026, selecione `2026-07`). Por padrão ele já vem no mês
   anterior — confira se é o certo.
3. Clique no botão **Importar arquivos do mês**.
4. Vai abrir uma janela. **Arraste os arquivos das duas pastas para
   dentro dela** (pode ser todos de uma vez: os .docx e os .pdf
   juntos). Também dá pra clicar e escolher.
   - O sistema separa automaticamente pelo tipo: **.docx = plano**,
     **.pdf = balancete/saldos**.
5. Clique em **Continuar**.
6. O sistema vai mostrar **um arquivo por vez** para você **conferir e
   confirmar**. No topo aparece "Arquivo X de N" com pontinhos de
   progresso.

### O que conferir em cada tipo de arquivo

**Plano de trabalho (.docx):**
- No topo, confira se o **Projeto** selecionado está certo (se não,
  escolha o certo no menu).
- Confira o **Tipo**: `Plano original` (primeiro plano do projeto) ou
  `Remanejamento` (já vem marcado por padrão — deixe assim se for um
  remanejamento).
- Dê uma olhada nos valores extraídos (total do plano, rubricas,
  desembolsos). Se algo vier errado, dá pra editar antes de salvar.
- Se aparecerem avisos em amarelo, leia — às vezes é só um campo que o
  sistema não conseguiu ler e você pode preencher à mão.
- Clique em **Salvar e próximo** (ou **Salvar e concluir** no último).

**Balancete / saldos (.pdf):**
- O sistema **detecta o projeto sozinho** quando o código do PDF bate
  com o código que você cadastrou no passo 2. Se não bater, aparece um
  aviso amarelo e você escolhe o projeto no menu **Projeto**.
- Confira a **Data de referência**, o **Saldo disponível** e o
  **Rendimento líquido**.
- Vem uma tabela de lançamentos de despesa. As linhas em amarelo são as
  que ainda não têm uma rubrica associada. **Se quiser, classifique a
  rubrica nelas e marque a caixinha "salvar"** — assim o sistema
  aprende e da próxima vez já vem classificado. (Isso é opcional; se
  preferir, pode deixar e pedir ajuda ao administrador.)
- Clique em **Salvar e próximo**.

### Botões durante a revisão

- **Salvar e próximo** — confirma o arquivo atual e vai para o
  próximo.
- **Pular** — pula o arquivo atual sem salvar (ele fica pendente; você
  pode importar de novo depois). Use se algo vier muito errado e você
  quiser revisar com calma.
- **Cancelar / fechar (×)** — fecha a fila. O que já foi salvo fica
  salvo; o restante é cancelado.

7. No final aparece um resumo: *"X salvo(s) · Y pulado(s)"*. Pronto.

---

## 4. Ver o resultado

Depois de importar o plano e o balancete de um projeto:

1. No menu lateral, clique em **Plano de Trabalho**.
2. Escolha o projeto no seletor **Projeto** (em cima).
3. Use as abas:
   - **Orçamento** — mostra o plano importado (rubricas e desembolsos).
   - **Balancetes** — lista os balancetes importados, com saldo,
     rendimento e total de débitos.
   - **Previsto x Realizado** — o cruzamento: quanto foi previsto no
     plano × quanto de fato saiu no balancete, por rubrica. (Só aparece
     depois que você tem pelo menos 1 plano ativo e 1 balancete
     importado.)

O **Fechamento Mensal** também vira um checklist: ele mostra quais
projetos já receberam o balancete do mês e quais ainda estão pendentes.

---

## Resumo da rotina mensal

1. Receber as duas pastas (planos .docx + saldos/balancetes .pdf).
2. Entrar no sistema → **Gestão de Projetos**: criar o centro de custo
   **só se for um projeto novo** (uma única vez por projeto, e
   **sempre com o código FUNAPE** no campo Código).
3. **Fechamento Mensal** → escolher a competência → **Importar
   arquivos do mês** → arrastar tudo → conferir cada arquivo → salvar.
4. **Plano de Trabalho** → ver o cruzamento previsto x realizado.

---

## O que NÃO está disponível para você (procure o administrador)

- **Criar outros usuários / atribuir projetos a outra pessoa** — tela
  "Usuários & Centros de Custo" (só o administrador acessa).
- **Mesclar bolsistas duplicados** — botão "Mesclar duplicados" (só o
  administrador).
- **Importar a planilha de bolsas FUNAPE** — por enquanto o documento
  do FUNAPE não indica a qual centro de custo cada bolsa pertence, então
  essa importação fica desativada nesta etapa. Se chegar uma planilha de
  bolsas, encaminhe ao administrador.
- Qualquer coisa que apareça como "somente administrador".

Se esbarrar em algo bloqueado, não se preocupe — é o sistema protegendo
o dado. Avise o administrador.

---

## Se der algum problema

- **"Não foi possível processar o arquivo"** — o arquivo pode estar em
  formato diferente do esperado (o plano precisa ser **.docx**, o
  balancete precisa ser **.pdf** com texto selecionável — não imagem
  escaneada). Pule o arquivo e avise.
- **Tela vazia ao entrar** — normal no primeiro acesso. Vá em
  **Gestão de Projetos** e crie o primeiro centro de custo.
- **Balancete não achou o projeto** — o código do PDF não bate com o
  código cadastrado. Escolha o projeto manualmente no menu, ou
  corrija o Código do projeto em **Gestão de Projetos**.
- **Internet caiu no meio** — o que já foi salvo fica salvo. Abra de
  novo e reimporte o que faltou.
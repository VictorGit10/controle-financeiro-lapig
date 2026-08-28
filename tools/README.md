# Utilitários operacionais

Ferramentas que **não** fazem parte da aplicação nem do banco: rodam fora dele,
em máquina de quem opera ou em serviço de terceiro. Estão juntas aqui por isso,
não por terem relação entre si.

## `n8n-keep-alive-lapig.json`

Workflow do n8n que impede o projeto gratuito do Supabase de pausar por
inatividade (7 dias). A cada 2 dias faz uma query de leitura **idêntica à da
landing page** (projetos ativos) — não altera dado nenhum.

Importação e configuração: [`../docs/keep-alive-n8n.md`](../docs/keep-alive-n8n.md).

## `funape-nomear-planilha-bolsas.user.js`

Userscript (Tampermonkey/Violentmonkey) para o portal FUNAPE Conecta.

O Conecta exporta a planilha de bolsas como `bolsas.xlsx` — sem aba nomeada, sem
propriedades de documento, sem pista nenhuma de qual centro de custo gerou o
arquivo. Baixando quatro planilhas seguidas viram `bolsas (1..4).xlsx` e não há
como saber depois qual é qual.

A informação existe: a página sabe qual centro de custo está selecionado no
instante do export, e só descarta isso na hora de nomear. O script injeta o
código FUNAPE no nome — `bolsas-30.068.xlsx` — para que a importação no Controle
Financeiro detecte o projeto sozinha.

Instale no gerenciador de userscripts do navegador; ele roda em
`conecta.funape.org.br`.

## `replica-local/`

Três níveis de ambiente de teste local do banco, do mais barato ao mais fiel:
sintético (5 centros de custo, um por restrição, sem credencial), réplica do
banco real raspada de PII, e a stack Supabase completa.

**Só a stack completa testa o que os adaptadores podem errar** — grant a
`authenticated`, exposição de RPC, parsing de JWT e tradução de erro. Postgres
puro valida cálculo, não transporte.

Receitas em [`replica-local/README.md`](replica-local/README.md). Dumps **nunca**
são versionados (`replica-local/dump/` está no `.gitignore`): versiona-se o
script que *remove* dado, nunca o que o carrega.

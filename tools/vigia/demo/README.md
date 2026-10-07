# Demonstração local do vigia

Este executor roda **`tools/vigia/dist/Vigia.gs` real** num `vm` do Node. O Supabase recebe as chamadas reais
de login e das quatro RPCs do [contrato v1](../CONTRATO.md). O Gmail é a caixa sintética de seis mensagens;
e-mail e ntfy só imprimem `AVISO: ...`, sem enviar nada. Não entra em `npm test`.

## Preparar

1. Tenha Node e o executável **curl** no PATH. No PowerShell, o executor chama o binário `curl`, sem usar
   o alias de `Invoke-WebRequest`. Não precisa instalar pacotes adicionais.
2. Use uma **stack Supabase local descartável** (Auth + REST + banco), com a 054 e as dependências já
   instaladas pelo responsável pelo banco. Postgres puro não serve: esta demo faz login HTTP real.
3. Peça ao responsável uma conta `automacao`, registrada como `vigia`, sem centros atribuídos, e uma
   tarefa aberta do projeto `30.068`. O executor não cria tarefas, logins ou migrações.
4. A tarefa deve existir **antes de 06/10/2026 às 09h**, ter título sobre os 2 meses de bolsa do Otávio,
   chaves `thread:T1`, `centro_custo:30.068`, `pessoa:Otávio` e três passos. Passos manuais não são comprovados
   pela leitura do e-mail. Para o passo 3 (`pendente`), use esta regra:

```json
{
  "tipo": "email",
  "de": "arthur@exemplo.invalid",
  "para_dominio": "funape.org.br",
  "cc_inclui": ["victor@exemplo.invalid", "manuel@ufg.br"],
  "contem_todos": ["30.068"],
  "contem_algum": ["Otávio", "bolsistas"]
}
```

Os endereços são fictícios; Arthur, Ranielly e FUNAPE representam seus papéis no fluxo. O anexo do quadro
é apenas contado, não lido. Ninguém confirma passo ou conclui tarefa automaticamente.

Se a tarefa local foi criada em outra data, copie a caixa para outro JSON, ajuste `recebida_em` para **depois**
da criação da tarefa e use `--caixa caminho.json`. As datas devem estar ordenadas, com fuso explícito.
O relógio do `vm` fica um segundo depois da última mensagem liberada e avança com o tempo real da execução;
assim fixtures antigas podem ser demonstradas sem perder a janela de captura nem esconder timeout.
O estado do banco/cursor deve corresponder a essas datas. Use esta stack só para a demo, sem cursor de produção.

## Configurar o ambiente

Defina as variáveis na sessão que executará o Node. Não há leitura de `.env`, arquivo de credenciais ou
configuração do frontend. Valores vazios obrigatórios são reportados pelo nome, sem imprimir segredos.

| Variável | Uso |
| --- | --- |
| `SUPABASE_URL` | URL local, ex. `http://127.0.0.1:54321`; aceita localhost/127.0.0.1/IPv6 loopback |
| `SUPABASE_ANON_KEY` | Chave pública da stack local |
| `VIGIA_EMAIL`, `VIGIA_SENHA` | Login real de automação da stack local |
| `SITE_URL` | Link HTTPS, ex. `https://site.exemplo.invalid/#buriti` para uma demonstração sem site |
| `EMAIL_AVISO` | Use `victor@exemplo.invalid`; os avisos só vão ao console |
| `VICTOR_EMAIL` | Use `victor@exemplo.invalid` para identificar a mensagem própria M1 |
| `OLLAMA_LOCAL` | `1` ativa Ollama local, sem API key na requisição |
| `OLLAMA_MODEL` | Lido do ambiente; no modo local usa `glm-5.3-flash:cloud` |
| `OLLAMA_API_KEY` | Opcional: vazio e sem modo local = somente regras; preenchido = Cloud real |
| `OLLAMA_TIMEOUT_MS` | Opcional; no modo local, padrão 90000 (90 s) |
| `NTFY_TOPICO` | Opcional; se preenchido, também é simulado no console |

Exemplo PowerShell (substitua os valores de chave/login/senha por valores da **stack local**):

```powershell
$env:SUPABASE_URL = 'http://127.0.0.1:54321'
$env:SUPABASE_ANON_KEY = '<chave pública local>'
$env:VIGIA_EMAIL = '<login local de automação>'
$env:VIGIA_SENHA = '<senha local>'
$env:SITE_URL = 'https://site.exemplo.invalid/#buriti'
$env:EMAIL_AVISO = 'victor@exemplo.invalid'
$env:VICTOR_EMAIL = 'victor@exemplo.invalid'
$env:OLLAMA_LOCAL = '1'
node tools/vigia/build.js
```

Para Ollama local, deixe o serviço atendendo em `http://localhost:11434` e autentique previamente o Ollama
para o modelo Cloud. O stub troca **somente URL e Authorization** da chamada do Gas, que continua com o
mesmo payload `format:json`, `stream:false`. Uma sentinela em memória ativa o adaptador sem chave real;
`PropertiesService` define o nome do modelo local. Nenhuma sentinela/Authorization vai ao Ollama local.
Para Supabase HTTP, a propriedade expõe uma fachada HTTPS em memória e o stub volta ao endereço HTTP local;
isso mantém intacta a validação HTTPS do Gas. Curl recebe método, cabeçalhos e corpo por stdin, com `.curlrc`
desativado, sem segredo em argumentos do processo. O executor recusa Supabase remoto.

## Rodadas

Execute as rodadas na mesma stack, em ordem crescente; o banco mantém captura, cursor e efeitos:

```sh
node tools/vigia/demo-local.js --ate 3
node tools/vigia/demo-local.js --ate 4
node tools/vigia/demo-local.js --ate 5
node tools/vigia/demo-local.js --ate 6
```

| Até | História / comportamento esperado |
| --- | --- |
| 1 | Victor delega ao Arthur na thread **T1**: mensagem própria, sem autoaviso |
| 2 | Aceite de agenda: rotina |
| 3 | Newsletter: rotina por cabeçalhos |
| 4 | Arthur abre **T2**, envia o quadro 30.068 à Ranielly, copia Victor e Prof. Manuel: sugere passo 3 por regra |
| 5 | Ranielly pede justificativa assinada em T2: modelo pode classificar exigência e chamar atenção do Victor |
| 6 | TJGO pede informação sobre outro assunto, sem centro: avaliado; se demanda nova, vai para esclarecer |

O nome de uma thread nova só passa a ser chave forte depois que um humano aceita o vínculo no site.
M5 ainda menciona `30.068` no assunto/corpo, permitindo candidato ao modelo mesmo sem essa confirmação.
Sem modelo, o que as regras não decidirem fica em esclarecer; não há resposta de modelo fabricada na demo.
Repetir `--ate 4` não deve duplicar sugestões/eventos/avisos no banco. Não volte a um N menor após avançar:
o cursor é monotônico. IDs fixos `DEMO-M1` a `DEMO-M6` e threads T1/T2 deixam a repetição visível.

No fim há um resumo da **rodada**: capturas da janela, quantas novas o banco inseriu, filas/motivos,
vínculos sugeridos, passos sugeridos, avisos simulados, chamadas de modelo e erros registrados.
Mensagens já capturadas não reprocessadas são identificadas; o resumo não inventa sua fila anterior.
Avisos simulados são reconhecidos como enviados **no banco local**, para demonstrar idempotência da outbox.
Timeout/indisponibilidade do modelo deixa captura pendente para repetir na próxima rodada. Uma mudança
incompatível da 054 aparece como erro; a demo não reinterpreta silenciosamente outro contrato.

## Conferir sem banco/modelo

```sh
node --test tools/vigia/demo/demo-local.test.js
npx eslint --config tools/vigia/eslint.config.mjs tools/vigia/
node tools/vigia/demo-local.js --ajuda
```

Os testes manuais verificam montagem/parse de respostas curl, isolamento de segredos, limite de chegada,
roteamento local e a execução do `.gs` real com respostas HTTP sintéticas através do stub de curl.
Um teste também usa `curl` real contra um servidor HTTP de teste em loopback. Não acessam Supabase,
Ollama ou rede externa e não integram o `npm test`. A conexão com os serviços reais exige as variáveis acima.

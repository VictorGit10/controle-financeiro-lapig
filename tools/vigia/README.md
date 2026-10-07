# Vigia do Buriti

O vigia acompanha e-mails e prazos, registra tudo para revisão e **sugere** passos. A confirmação é do
Victor na página Buriti. Funciona no Google Apps Script com o computador desligado, a cada 30 minutos.
Modelo e ntfy são opcionais e começam desligados. Esta entrega é código + testes; depende das RPCs
da migração 054 com o formato de [CONTRATO.md](CONTRATO.md). Não aplique este script antes desse banco estar pronto.

## Instalar, passo a passo

A publicação é pelo **clasp**, já logado na conta Google **victoramaral.lapig** — quem roda é o Claude,
como no Correio do Buriti:

```sh
node tools/vigia/publicar.js          # build + create (1ª vez) + push; imprime o link do editor
node tools/vigia/publicar.js --seco   # só monta o palco em .publicar/ e mostra os passos, sem rede
```

O projeto **Vigia LAPIG** é criado na primeira publicação e reaproveitado nas seguintes (o scriptId
fica em `tools/vigia/.publicar/.clasp.json`, pasta fora do git). O `appsscript.json` já leva fuso
**America/Sao_Paulo**, runtime **V8** e os escopos mínimos; o vigia não é web app, não há implantação.

Com o link do editor que a publicação imprime, sobram para o Victor:

1. Na engrenagem **Configurações do projeto → Propriedades do script → Adicionar propriedade**, preencha
   a tabela abaixo. Pegue os valores com o administrador; não cole senhas em código, chat ou captura.
2. No seletor de função da barra superior, selecione **testarConfiguracao**, clique **Executar** e leia
   o registro: as propriedades obrigatórias devem dizer `ok`. O teste mostra nomes/status, nunca valores.
3. Selecione **checar** e clique **Executar**. Na primeira vez o Google pede autorização: autorize Gmail,
   envio de e-mail, conexões externas e gatilhos com essa mesma conta. Confira a última execução e os
   registros de Triagem na página Buriti.
4. Selecione **resumoDiario** e execute uma vez: deve chegar um resumo, mesmo sem tarefas.
5. Selecione **instalarGatilhos** e execute. Ele cria checagem a cada 30 min e resumo na faixa das 8h,
   no fuso de São Paulo (o Google pode variar os minutos). Reexecutar substitui os dois gatilhos sem
   duplicá-los.
6. No ícone de relógio **Acionadores**, confira `checar` e `resumoDiario`. Em **Execuções** veja falhas;
   na página confira a última checagem. O monitor da página aponta atraso após duas horas.

O login Supabase é o **mesmo do "Buriti operador"** (migração 055): papel **automacao**, registro
`vigia` em `automacoes` e **nenhum** centro de custo em `user_projects`; atua só pelas RPCs. Não use
conta admin nem chave de serviço.

**Alternativa sem o clasp:** crie um projeto novo em <https://script.google.com>, copie **todo** o
conteúdo de [dist/Vigia.gs](dist/Vigia.gs) para o `Código.gs`, ajuste o fuso America/Sao_Paulo e o
runtime V8 nas Configurações do projeto e siga os passos 1–6 acima. Não copie os arquivos `src`
individualmente nem o código dos testes.

| Propriedade | Obrigatória? | O que preencher |
| --- | --- | --- |
| `SUPABASE_URL` | Sim | Endereço HTTPS do projeto Supabase |
| `SUPABASE_ANON_KEY` | Sim | Chave pública anon fornecida pelo administrador |
| `VIGIA_EMAIL` | Sim | E-mail do login de automação no Supabase |
| `VIGIA_SENHA` | Sim | Senha desse login |
| `SITE_URL` | Sim | Link HTTPS para a página Buriti |
| `EMAIL_AVISO` | Sim | E-mail que recebe avisos e o resumo; reserva se ntfy falhar |
| `VICTOR_EMAIL` | Não | Endereço do próprio Victor no Gmail; padrão `EMAIL_AVISO`. Preencha se o destinatário dos avisos for outro endereço |
| `OLLAMA_API_KEY` | Não | Vazio = somente regras; preencher ativa o modelo Cloud |
| `OLLAMA_MODEL` | Não | Padrão `glm-5.3-flash` |
| `NTFY_TOPICO` | Não | Nome de tópico privado/difícil de adivinhar no ntfy.sh; vazio = e-mail |
| `OLLAMA_TIMEOUT_MS` | Não | Padrão 45000; de 1000 a 120000, limite para aceitar resposta tardia |
| `DOMINIOS_INSTITUCIONAIS` | Não | Lista separada por vírgula; padrão `funape.org.br,ufg.br,tjgo.jus.br` |
| `REMETENTES_AUTOMATICOS` | Não | Lista de endereços exatos, separados por vírgula; padrão notificações GitHub |

Para ntfy, instale o aplicativo no celular e assine o mesmo tópico. Tópicos públicos não têm controle de
acesso por padrão: use um nome imprevisível e não compartilhe. Avisos contêm só título mascarado, centro,
tipo e link. Não incluem corpo, remetente ou resumo livre do modelo.

## O que significa cada aviso

- **Passo aguarda confirmação:** há uma evidência que bate com a regra. Abra a tarefa e confirme ou dispense.
- **Mensagem requer atenção:** exigência/dúvida ligada a tarefa. Leia no Gmail e revise no site.
- **Mensagem aguarda revisão:** faltou ligação segura, o modelo respondeu de modo inválido ou a máscara bloqueou.
- **Prazo requer atenção:** D-5, D-2, dia do prazo ou vencido. Se uma execução foi perdida, recupera só
  o alerta mais grave atual; alterar o prazo inicia uma nova sequência.
- **Vigia requer atenção:** uma checagem falhou. Consulte Execuções no Apps Script e a saúde no site.
- **Resumo diário:** tarefas abertas, contagens de atenção/triagem/rotina e saúde. Às segundas lembra
  a auditoria da fila Rotina no site, sem reproduzir assuntos pessoais nas notificações.

`rotina` é fila para auditoria, não descarte. Domínio desconhecido sempre é avaliado. Resposta de férias
fica como ausência/informativo para revisão, sem sugerir cumprimento. Anexos são contados, **não lidos**;
um passo sugerido a partir do texto não comprova o conteúdo do anexo.

Mensagens da passada no spam ficam em `rotina`, motivo `spam`, sem modelo. Uma ligação forte (thread/número)
ou média (centro + pessoa) permite o fluxo normal, registrando `spam_com_vinculo`; um centro isolado não basta.
Pares já rejeitados não reabrem essa exceção. Mensagens do próprio Victor são registradas sem autoavisos
ou evidência de passo de outra pessoa; confira `VICTOR_EMAIL` para que essa identificação use o endereço certo.
O núcleo bloqueia sugestão de passo nos padrões reconhecidos de injeção/negação e impede classificação
`concluido` nesses casos. Com tarefa vinculada, alegação de envio sem regra de evidência correspondente pede
revisão com `alegacao_sem_evidencia`, inclusive no modo somente regras. A classificação do modelo não confirma nada.
Quando o modelo não encontra tarefa relacionada nem demanda nova, a mensagem fica em `rotina`, motivo
`sem_tarefa_relacionada`, mantendo a classificação sem gerar aviso. A 054 não oferece outra fila para esse
caso. Se o modelo indicar demanda nova sem vínculo, vai a `esclarecer`, motivo `demanda_nova`, para revisão.

## Recuperação e limites

Primeira checagem busca o último dia. Depois lê desde um dia antes do cursor, incluindo arquivadas,
enviadas e spam, excluindo lixeira. Captura é persistida antes da classificação; duplicatas não repetem
eventos. Uma busca que alcançar 1000 threads numa passada falha sem avançar cursor: peça ao administrador
para reduzir/particionar a janela. Nada é descartado como se estivesse capturado.

Modelo indisponível deixa mensagem capturada para tentar novamente. Com a chave removida, uma mensagem
que as regras não decidirem vai a `esclarecer`. CPF residual impede chamada e retenção do trecho com problema.
Nomes conhecidos nas chaves/responsáveis também são pseudonimizados; a máscara não identifica todo nome
livre ou toda forma possível de documento. Revise fixtures quando aparecer um formato novo.

`UrlFetchApp` não tem parâmetro para cancelar por timeout na [documentação do Google](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app).
O script rejeita respostas que ultrapassam `OLLAMA_TIMEOUT_MS`, trata timeout da plataforma como falha
recuperável e para de iniciar mensagens após 240 s. Uma chamada em curso pode ultrapassar esse orçamento;
se o Google encerrar a execução, as capturas permanecem e a falta de fim fica visível no monitor.

Avisos são uma outbox do banco. Falha de ntfy usa e-mail; falha dos dois é registrada e tenta novamente
na próxima checagem. Uma interrupção depois do envio e antes de registrar o recibo pode repetir o aviso.
O expurgo de assuntos/trechos após 90 dias é responsabilidade de `vigia_expurgar`.

## Desligar ou atualizar

Para desligar tudo, abra **Acionadores**, exclua os gatilhos `checar` e `resumoDiario`; não exclua tarefas
ou mensagens. O administrador pode revogar o login de automação. Para desligar apenas modelo/ntfy,
apague os valores de `OLLAMA_API_KEY`/`NTFY_TOPICO` nas propriedades.
Para atualizar, gere novamente o `.gs`, substitua todo `Código.gs` e execute `testarConfiguracao` e `checar`.

## Desenvolvimento e conferência

Somente `tools/vigia/` e `tests/vigia/` são alterados. Núcleo IIFE global V8 + exportação CommonJS;
`build.js` resolve a ordem e remove os trechos exclusivos do Node do `.gs`. Sem dependências de produção.

```sh
node tools/vigia/build.js
npx vitest run tests/vigia
npm run lint
npx eslint --config tools/vigia/eslint.config.mjs tools/vigia/
```

No PowerShell com execução de scripts desabilitada, use `npx.cmd` e `npm.cmd`.
O lint da raiz foi mantido por estar fora do escopo; há configuração própria para o vigia.
Os testes usam fixtures **sintéticas**, relógio fixo, `vm` e serviços falsos; não chamam rede.
Avaliação opcional do modelo real, com Ollama local ligado e autenticado para o modelo Cloud:

```sh
node tools/vigia/avaliar-modelo.js
```

Essa avaliação usa `http://localhost:11434/api/chat` e `glm-5.3-flash:cloud`, imprime acertos por fixture,
aguarda até 90 segundos por tentativa e repete uma vez em falha antes de declarar o modelo indisponível.
O limite cobre também a leitura da resposta; resposta de classificação inválida conta como divergência,
sem repetir a chamada. Não lê credenciais e não roda em `npm test`. Não foi necessária para validar o núcleo determinístico.

Para demonstrar a história completa com o `.gs` real, Gmail sintético, Supabase local e avisos no console,
use [demo-local.js](demo-local.js). O [guia da demo](demo/README.md) explica configuração e rodadas `--ate 3`,
`--ate 4`, `--ate 5` e `--ate 6`. Seus testes são manuais e ficam fora de `npm test`.

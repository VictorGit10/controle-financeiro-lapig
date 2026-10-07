# Contrato Vigia v1

Este é o contrato proposto para a migração 054. Nenhuma RPC foi implantada por esta tarefa.
O adaptador só usa as quatro RPCs abaixo, com login `automacao`, sem centros atribuídos.
O banco deve validar `is_automacao('vigia')`, projeto obrigatório e escopo das tarefas em toda escrita.
Campos ausentes não significam exclusão; RPCs não recebem SQL, texto de erro externo, corpo bruto ou anexos.

## Objeto de mensagem no núcleo (somente memória)

```json
{
  "gmail_message_id": "msg-123", "gmail_thread_id": "thread-456",
  "recebida_em": "2026-10-06T13:00:00Z",
  "de": "pessoa@exemplo.invalid", "para": "bolsas@funape.org.br", "cc": "victor@exemplo.invalid",
  "assunto": "Bolsa 30.068", "corpo": "Texto novo, com histórico se houver",
  "headers": { "Auto-Submitted": "no", "Content-Type": "text/plain" },
  "content_type": "text/plain", "anexos": 1, "spam": false
}
```

Data/hora absoluta em ISO com offset ou Z; datas de prazo são `YYYY-MM-DD`. Não há relógio ou I/O no núcleo.
`contexto.mapa` persiste em memória entre mensagens da execução, com `codigos`, `pessoas` e
`dominiosInstitucionais`; os pseudônimos são estáveis nessa execução, não entre execuções.
O histórico citado não vai ao modelo. Encaminhamentos são dados separados e preservam a data original
quando reconhecível (ISO/RFC, `dd/mm/aaaa hh:mm`, datas Gmail em português). Sem data válida, usa recebimento.
O envelope novo não prova a direção do e-mail antigo: encaminhamento nunca sugere passo automaticamente.

`msg.spam` é booleano extraído da passada no spam (ou `isInSpam()` na recuperação por ID); permanece
somente no objeto em memória. Spam sem candidato forte/médio, após excluir pares rejeitados, termina em
`rotina/spam`, sem chamada do modelo. Com candidato forte/médio segue o fluxo normal e o motivo persistido
é `spam_com_vinculo`; quando houver evento de mensagem, `detalhe.motivo` preserva o motivo da análise.
Resposta automática continua sem evidência, inclusive na exceção de spam. `filaInicial` aceita candidatos
como terceiro argumento; sem candidatos a triagem de spam é conservadora.

`contexto.config.emailVictor` identifica o remetente próprio por endereço exato (sem diferenciar caixa),
e `emailsVictor` permite aliases a quem chama o núcleo. No Apps Script, `VICTOR_EMAIL` é opcional e usa
`EMAIL_AVISO` como padrão. Não confundir com `VIGIA_EMAIL`, que é o login Supabase de automação.
Mensagem própria não chama o modelo nem produz evidência de passo; registra vínculo forte se houver,
classificação `informativo`, motivo `mensagem_propria` (ou `spam_com_vinculo`), sem `precisa_victor`.
Sem vínculo seguro, mensagem própria vai para rotina. Falha de máscara ainda retém o conteúdo, sem autoaviso.

Negação/promessa futura e comando de injeção reconhecidos impedem evidência, inclusive para regra de
thread. O validador normaliza a classificação indevida do modelo para `informativo` (negação) ou `duvida`
(injeção); injeção só pode resultar em `sem_acao|duvida`. O avaliador real ainda conta a resposta original
indevida como divergência do modelo. **Com tarefa vinculada**, alegação `concluido` sem regra correspondente,
ou afirmação explícita de envio sem prova no modo regras, liga `precisa_victor` com motivo `alegacao_sem_evidencia`.
Uma referência fraca a centro de custo não obriga vínculo: o modelo pode devolver `tarefa_id:null`;
após uma resposta válida, sem vínculos e `demanda_nova:false`, preserva a classificação e termina em
`rotina`, motivo `sem_tarefa_relacionada`, sem `precisa_victor`, eventos ou sugestões de passo. A 054 só
aceita `tarefa|esclarecer|rotina`; não existe fila `avaliada_sem_tarefa`. Mesmo `concluido`, sem vínculo,
não representa conclusão de tarefa nem exige prova de passo. Sem vínculos e `demanda_nova:true`, vai a
`esclarecer`, motivo `demanda_nova`, com `precisa_victor`. Esses motivos substituem `spam_com_vinculo`
quando o modelo recusa todos os candidatos de spam: candidato não é vínculo. Se o modelo estiver desligado,
uma mensagem ainda não decidida pelas regras continua em `esclarecer/sem_modelo`; não se presume ausência
de demanda. Uma resposta inválida também mantém a revisão obrigatória.

## `vigia_contexto()`

Entrada HTTP `{}`. Saída é um objeto JSON, nunca uma lista de linhas:

```json
{
  "versao_esquema": 1,
  "cursor_em": "2026-10-05T16:00:00Z",
  "tarefas": [{
    "id": "t-1", "project_id": "projeto-1", "titulo": "Implantar bolsa",
    "centro_custo": "30.068", "responsavel": "Pessoa Sintética",
    "status": "em_andamento", "criada_em": "2026-10-01T12:00:00Z",
    "prazo": "2026-10-30", "precisa_atencao": false,
    "chaves": [{ "tipo": "numero", "valor": "PED-456/2026" }],
    "passos": [{
      "id": "p-3", "estado": "pendente",
      "evidencia": { "tipo": "email", "de": "arthur@exemplo.invalid",
        "para_dominio": "funape.org.br", "cc_inclui": ["victor@exemplo.invalid"],
        "contem_todos": ["30.068"], "contem_algum": ["bolsa"] }
    }]
  }],
  "vinculos": [{ "gmail_message_id": "msg-123", "tarefa_id": "t-2", "estado": "rejeitado" }],
  "pendentes": [{ "gmail_message_id": "msg-123", "mascara_falhou": false }],
  "alertas_emitidos": ["prazo:t-1:2026-10-30:D-5"],
  "esclarecer": 2, "rotina": 7, "saude": "ok"
}
```

`tarefas` contém apenas abertas com projeto; chaves: `thread|centro_custo|pessoa|termo|numero`.
Pode devolver passos em todos os estados; o núcleo avalia só `pendente`.
`vinculos` deve incluir os rejeitados e os confirmados de todas as mensagens candidatas ao reprocessamento.
`pendentes` aceita também lista de IDs, inclui `capturada` e `erro` (tentativas é contador, não estado).
Não omitir pendências fora da janela Gmail. Não truncar silenciosamente: o protótipo processa a lista completa,
até o orçamento de 240 s e deixa o restante pendente.
`alertas_emitidos` aceita chaves ou objetos `{chave}`; inclui alertas antigos com seus prazos.
`esclarecer`/`rotina` são contagens de auditoria; `saude` é `ok|atrasado|indisponivel`.
Uma versão diferente de 1 causa erro explícito. Campos de configuração/`mapa` são acrescentados só em memória.
As regras completas de `passos[].evidencia` vêm exclusivamente desta RPC para o vigia ativo.
São armazenadas em `tarefa_passos_regras`, cuja leitura direta é exclusiva do admin.
`tarefa_passos.evidencia` continua existindo, sempre `{}`, para manter a forma pública sem endereços.

## `vigia_capturar(p jsonb)`

Entrada HTTP `{ "p": { ... } }`:

```json
{
  "execucao_id": "exec-1",
  "janela": { "inicio": "2026-10-04T16:00:00Z", "fim": "2026-10-06T16:00:00Z", "completa": true },
  "mensagens": [{
    "gmail_message_id": "msg-123", "gmail_thread_id": "thread-456",
    "recebida_em": "2026-10-06T13:00:00Z", "remetente": "[P1]", "remetente_dominio": "exemplo.invalid",
    "assunto": "Bolsa 30.068", "trecho": "Texto [P2]",
    "estado": "capturada", "fila": null, "motivo": null,
    "classificacao": null, "confianca": null, "modelo": null,
    "encaminhada": false, "ocorrido_em": "2026-10-06T13:00:00Z", "anexos": 1
  }]
}
```

Saída `{ "processar_ids": ["msg-123"], "mensagens_novas": 1, "cursor_em": "2026-10-06T16:00:00Z" }`.
Captura e avanço do cursor são **atômicos**. PK por `gmail_message_id`; duplicata preserva revisão
humana, vínculos e interpretação. A única atualização de conteúdo por recaptura é reforçar a retenção
quando houver nova indicação de falha de máscara. Retorna em `processar_ids` apenas capturadas/erro,
nunca as já processadas. O cursor avança monotonicamente apenas se a janela inteira foi capturada;
validar janela completa, fim >= início, timestamps e IDs. Captura vazia também avança uma janela completa.
Na primeira carga (`cursor_em:null`), o adaptador **deve** acrescentar
`janela.primeira_carga:true` e informar `execucao_id` já retornado pelo registro de início.
`inicio` deve ser no máximo `execucao.iniciada_em - 24 h` e `fim` no mínimo esse início de execução.
Use o mesmo instante registrado na execução para calcular a janela inicial; calcular depois pelo
relógio local pode produzir uma janela alguns milissegundos curta e recusada.
Depois, `inicio <= cursor_em - 24 h` é obrigatório, inclusive em janela incompleta ou vazia.
O banco trava o cursor e valida contra o valor confirmado mais recente; fim antigo nunca o reduz.
Uma janela sem continuidade/sobreposição é recusada com SQLSTATE `22023`, sem captura parcial.
Falha/paginação incompleta não chama `vigia_capturar`, não avança cursor e grava execução com erro.
Mensagens que falharem são recuperadas pelo ID no Gmail na próxima execução. Nenhum corpo bruto é armazenado.
Se a máscara falhar, assunto vira `[Conteúdo retido: máscara falhou]`, trecho vazio e remetente `[Retido]`.
O adaptador pode informar `mensagens[].mascara_falhou:true`; o banco também detecta conteúdo residual
e o marcador de retenção. `vigia_mensagens.mascara_falhou` é persistente: erro, nova tentativa,
recaptura com `false` ou outro motivo nunca o apagam. Uma recaptura com `true` pode reforçar retenção.
Conteúdo retido permanece sem classificação, vínculos, eventos ou sugestões automáticas; vai a
`esclarecer`, com motivo `mascara_falhou`, inclusive depois de falha do modelo.

## `vigia_registrar(p jsonb)`

Há três usos, todos pelo mesmo endpoint; aceitar campos opcionais e executar cada chamada atomicamente.

**Início**, antes de consultar Gmail: `{ "versao":"vigia-1", "execucao":{
"tipo":"checagem", "iniciada_em":"2026-10-06T16:00:00Z"} }`.
Saída obrigatória `{ "execucao_id":"exec-1" }`. Tipos: `checagem|resumo_diario`.

**Fim e efeitos**, exemplo:

```json
{
  "versao": "vigia-1",
  "execucao": { "id": "exec-1", "terminada_em": "2026-10-06T16:01:00Z",
    "mensagens_novas": 1, "chamadas_modelo": 0, "alertas": 0, "erros": [] },
  "resultados": [{
    "registro_mensagem": {
      "gmail_message_id": "msg-123", "gmail_thread_id": "thread-456",
      "recebida_em": "2026-10-06T13:00:00Z", "remetente": "[P1]", "remetente_dominio": "exemplo.invalid",
      "assunto": "Bolsa 30.068", "trecho": "Texto [P2]", "estado": "processada",
      "fila": "tarefa", "motivo": "regra", "classificacao": "informativo", "confianca": "alta",
      "modelo": null, "encaminhada": false, "ocorrido_em": "2026-10-06T13:00:00Z", "anexos": 1
    },
    "vinculos": [{ "gmail_message_id":"msg-123", "tarefa_id":"t-1", "estado":"sugerido", "origem":"regra" }],
    "eventos": [{ "chave":"msg:msg-123:passo:p-3", "tarefa_id":"t-1", "tipo":"sugestao",
      "origem":"vigia", "resumo":"Evidência encontrada; aguarda confirmação humana.",
      "detalhe":{"passo_id":"p-3","trecho":"Texto [P2]"},
      "gmail_message_id":"msg-123", "gmail_thread_id":"thread-456", "ocorrido_em":"2026-10-06T13:00:00Z" }],
    "passos_sugeridos": [{ "tarefa_id":"t-1", "passo_id":"p-3", "estado":"sugerido", "evento_chave":"msg:msg-123:passo:p-3" }],
    "precisa_victor": true, "chamou_modelo": false
  }],
  "eventos": [], "resumo_diario": null
}
```

Saída `{ "avisos": [{ "chave":"aviso:msg:msg-123:passo:p-3", "tipo":"sugestao", "tarefa_id":"t-1" }] }`.
Sempre retorna a outbox pendente/falhou, inclusive avisos de execuções anteriores, mesmo sem mensagens novas.
Tipos para aviso: `mensagem|sugestao|alerta_prazo|esclarecer|saude|resumo_diario`.
Para `resumo_diario`, retornar também `dia`; entrada de fim inclui
`resumo_diario:{"chave":"resumo:2026-10-06","dia":"2026-10-06"}`. Um resumo por dia, mesmo vazio.
Avisos não recebem texto arbitrário: o adaptador usa só título mascarado, centro, tipo e link configurado.

Regras **também impostas no banco**, protegendo contra concorrência com a revisão humana:

- Fila persistida `tarefa|esclarecer|rotina`; `avaliar` é apenas interna da triagem, jamais persistida.
- Ausência: `informativo`, motivo `ausencia`, sem evidência de passo. Sem vínculo vai a `esclarecer`.
- Resultado com `estado:capturada,motivo:modelo_indisponivel` só incrementa tentativas/erro técnico;
  mantém fila/classificação nulas e elegibilidade para retry, sem eventos, passos ou vínculos parciais.
  Se a mensagem tem `mascara_falhou:true`, prevalecem a retenção e a fila `esclarecer`.
- Erros de uma mensagem: `{gmail_message_id,codigo}`; erros globais: `{codigo}`. Não gravar stack ou resposta HTTP.
  `orcamento_esgotado` mantém a captura; falta de mensagem no Gmail fica pendente com erro auditável.
- Eventos unique por `chave`, nunca UPDATE/DELETE; passo só muda com `WHERE estado='pendente'`.
- Evento de mensagem: `msg:<id>:tarefa:<tarefa>`; sugestão: `msg:<id>:passo:<passo>`.
- Alertas globais: `prazo:<tarefa>:<YYYY-MM-DD>:D-5|D-2|D-0|vencido`, tipo `alerta_prazo`,
  detalhe `{prazo,nivel}`, origem `vigia`, `precisa_victor:true`. Só o limiar mais grave devido é emitido.
- Vínculos N:N unique por mensagem/tarefa. Rejeitado não reabre; confirmado não regride. A automação
  nunca cria confirmação: `estado:confirmado` no payload só preserva uma confirmação humana existente.
- Com vínculo, `precisa_victor` e `exigencia|duvida` ligam atenção; nunca desligar atenção humana ao chegar mensagem informativa.
- Classificação `concluido` é interpretação, **não** status da tarefa; nunca concluir nem confirmar automaticamente.
- Registros processados/revisados por humano não são sobrescritos por reexecuções antigas.
- Enfileirar aviso com chave unique quando houver nova atenção/sugestão/alerta ou mensagem para esclarecer;
  não gerar aviso por cada repetição da captura. Mensagem de rotina não notifica.
- Em falha fatal, `execucao` de fim pode ter apenas `id,terminada_em,erros`; contadores ausentes preservam/defaultam,
  nunca fingir sucesso. Sem fim após 2 h é atraso, detectado pela página/monitor externo.

Todas as escritas do protótipo são serializadas por lock transacional do módulo. Lotes travam todas
as tarefas por UUID crescente antes das mensagens por ID crescente; passos são travados depois.
Em `40001` ou `40P01`, repetir a chamada/transação inteira, com os mesmos IDs e chaves, usando tentativas
limitadas. Se a captura recebe `22023` por sobreposição após concorrência, recarregar `vigia_contexto`,
buscar novamente a janela com 24 h de sobreposição e só então repetir a captura; nunca avançar o início
para evitar o erro. A notificação externa continua fora da transação do banco.

**Confirmação de envio**:
`{"versao":"vigia-1","avisos_resultados":[{"chave":"aviso:...","estado":"enviado","canal":"email"}]}`.
Estado `enviado|falhou`; falha leva `motivo:sem_canal|envio_falhou`. Incrementar tentativas e guardar estado;
não reabrir aviso enviado. Canal `ntfy|email`. O envio ocorre antes do ack: uma queda nesse intervalo pode
repetir a notificação (entrega pelo menos uma vez), mas nunca duplica eventos ou passos no banco.

## `vigia_expurgar()`

Entrada `{}`; saída `{ "mensagens_expurgadas": 0 }`. Chamada após cada execução bem-sucedida.
Limpa `assunto` e `trecho` de mensagens com 90 dias, preservando IDs, captura, vínculos e auditoria.
Eventos imutáveis recebem só texto mascarado/estruturado; não armazenar resumo livre devolvido pelo modelo.
CPF residual nas fichas também bloqueia modelo. Validar e limitar strings e arrays na RPC; o núcleo não
é barreira de autorização. Retenção de remetente pseudônimo segue a política definida pela migração.

## Leitura das propostas pelos adaptadores do Buriti

O payload bruto das propostas `tipo='tarefa'` fica acessível só ao admin, pois conserva regras completas.
Agente e professor no escopo usam `listar_propostas_tarefa_seguras()` (sem argumentos), que devolve
linhas com as mesmas colunas de `propostas_agente`, metadados/status e payload projetado: `evidencia:{}`,
strings com endereços/CPF retidas e chaves sensíveis removidas, inclusive em payload legado malformado.
As consultas comuns da tabela continuam trazendo os demais tipos; acrescentar à lista as tarefas desta
RPC, sem duplicar por ID quando o admin já consulta a tabela. `propor_tarefa` recebe a regra completa
como antes; `aplicar_proposta_tarefa` conserva sua assinatura e é a única aplicação de tarefa.
`marcar_proposta_aplicada` e os caminhos financeiros recusam esse tipo, mesmo para humano no escopo.

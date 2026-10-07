# Buriti · Tarefas e vigia (especificação do protótipo)

Status: protótipo em `feat/buriti-tarefas` (06/10/2026). Nada aplicado em produção.

## Para que serve
O Victor delega trâmites à equipe (ex.: "implantar 2 meses de bolsa do Otávio no 30.068": o Arthur atualiza
o quadro, cadastra no Conecta e envia à FUNAPE até 30/10). Hoje ninguém acompanha depois do envio. Este
módulo:
1. guarda cada **tarefa** delegada (passos, prazo, chaves de ligação) fora de qualquer conversa;
2. roda um **vigia** (Google Apps Script, na conta do Gmail do Victor, a cada 30 min, com o PC desligado)
   que registra **toda** mensagem nova, liga mensagens a tarefas, sugere passos cumpridos e vigia prazos;
3. mostra tudo na **página Buriti** (abas Tarefas e Triagem), onde o Victor confirma, corrige e conclui;
4. avisa no celular (ntfy, com e-mail como reserva) só quando há algo para o Victor.

## Princípios (não negociáveis)
- **Nada é descartado em silêncio.** Toda mensagem que o vigia vê vira linha em `vigia_mensagens`, com fila e
  motivo. Filtros ordenam; nunca apagam. Domínio sozinho nunca decide relevância.
- **Três estados separados:** mensagem recebida → interpretação sugerida (vigia/modelo) → etapa confirmada
  (só humano). O vigia e o modelo nunca confirmam passo nem concluem tarefa.
- **O agente propõe, o humano aplica** (051): o Buriti cria tarefa como `propostas_agente` tipo `tarefa`;
  o Victor aplica na página. O agente não ganha escrita direta em tabela nenhuma.
- **Vigia com login de automação** (docs/acesso-ao-banco.md §4): usuário `professor` escopado + registro em
  `automacoes`, escrevendo só por RPCs estreitas `vigia_*`. Nunca admin, nunca service role.
- **LGPD:** o que vai ao modelo é mascarado (CPF, RG, dados bancários, telefone, e-mail de pessoa física →
  pseudônimo estável `[P1]`, `[P2]`). Se depois da máscara ainda houver padrão de CPF, não envia (fila
  `esclarecer`, motivo `mascara_falhou`). Notificações não levam dado pessoal.
- **Falha nunca parece silêncio:** cada execução grava `vigia_execucoes`; a página mostra a última checagem;
  o resumo das 8h chega mesmo vazio.
- **Número de dinheiro não sai do vigia.** Ele só lida com mensagens, datas e estados.

## Dados (migração 054_buriti_tarefas.sql)
- `propostas_agente.tipo` ganha `'tarefa'`.
- `automacoes(user_id pk → auth.users, nome text check in ('vigia'), criada_em)`; função
  `is_automacao(p_nome)`.
- `tarefas`: id, project_id (nullable → só admin vê quando null), titulo, descricao, responsavel (texto),
  responsavel_id (nullable → app_users; só admin/professor), status (`em_andamento`, `aguardando_terceiro`, `concluida`, `cancelada`), precisa_atencao bool +
  motivo_atencao, prazo date, prazo_motivo, proxima_checagem date, proposta_id, criada_por/em,
  atualizada_em, concluida_por/em.
- `tarefa_passos`: id, tarefa_id, ordem, descricao, quem, evidencia jsonb (regra que o vigia sabe avaliar),
  estado (`pendente`, `sugerido`, `confirmado`, `dispensado`), evento_id, confirmado_por/em.
- `tarefa_chaves`: tarefa_id, tipo (`thread`, `centro_custo`, `pessoa`, `termo`, `numero`), valor; unique.
- `tarefa_eventos`: **só acrescenta** (gatilho recusa update/delete, inclusive para admin). id, tarefa_id,
  tipo (`criada`, `mensagem`, `sugestao`, `confirmacao`, `nota`, `alerta_prazo`, `status`, `vinculo`),
  origem (`vigia`, `buriti`, `humano`, `sistema`), resumo, detalhe jsonb, gmail_message_id,
  gmail_thread_id, ocorrido_em (data do fato), criado_em, criado_por.
- `vigia_mensagens`: gmail_message_id pk, gmail_thread_id, recebida_em, remetente, remetente_dominio,
  assunto (mascarado), trecho (mascarado, ≤ 300), fila (`tarefa`, `esclarecer`, `rotina`), motivo,
  tarefa_id, vinculo_estado (`nenhum`, `sugerido`, `confirmado`, `rejeitado`), classificacao
  (`concluido`, `exigencia`, `duvida`, `informativo`, `sem_acao`), confianca, modelo, encaminhada bool,
  anexos int, revisada_por/em, criada_em. **Só admin lê** (o agente não lê remetentes).
- `vigia_execucoes`: id, iniciada_em, terminada_em, mensagens_novas, chamadas_modelo, alertas, erros
  jsonb, versao.
- Toda tabela nova: RLS ligado, `revoke` de anon, `trg_bloqueia_agente`, grants explícitos.

## RPCs (todas `security definer`, `set search_path = public, pg_temp`, guard explícito)
Vigia (`is_automacao('vigia')`):
- `vigia_contexto()` → jsonb: tarefas abertas (id, título, centro, prazo, chaves, passos pendentes com
  `evidencia`), `ultima_recebida_em` (marca d'água), versão do esquema.
- `vigia_registrar(p jsonb)` → idempotente por `gmail_message_id`: grava execução, mensagens, eventos;
  passos só vão a `sugerido`; liga `precisa_atencao` quando a classificação é `exigencia`/`duvida` ou o
  prazo está perto; nunca altera status para concluída.
Agente (`is_agente()`):
- `propor_tarefa(p jsonb)` → valida forma (título, passos ≥ 1, prazo opcional, chaves) e insere em
  `propostas_agente`.
Admin (`is_admin()`, recusando agente/automação):
- `aplicar_proposta_tarefa(p_id,p_responsavel default null)`, `confirmar_passo(p_passo, p_nota)`, `dispensar_passo(p_passo, p_nota)`,
  `vincular_mensagem(p_msg, p_tarefa, p_aceitar)` (aceitar acrescenta a thread em `tarefa_chaves`, para a
  próxima mensagem ligar por regra), `revisar_mensagem(p_msg, p_fila)`, `registrar_nota(p_tarefa, p_texto)`,
  `concluir_tarefa(p_tarefa, p_nota)`, `reabrir_tarefa`, `cancelar_tarefa`, `atualizar_prazo`.

## Vigia (tools/vigia/)
Núcleo puro em JS que roda igual no Apps Script e no Node (testes): `mascarar`, `triagem`, `ligacao`,
`evidencia`, `prazos`, `modelo` (prompt + validação da resposta), `resumo`. Adaptadores finos: Gmail,
Supabase (login por senha, chamadas RPC), Ollama Cloud, ntfy/e-mail. `build.js` gera `dist/Vigia.gs` para
colar no editor do Apps Script.

Fluxo de `checar()`:
1. `vigia_contexto()`; busca mensagens desde a marca d'água (menos uma folga), em todas as pastas exceto
   lixeira, mais uma passada leve no spam.
2. Para cada mensagem nova (dedupe por id): sinais técnicos (`Auto-Submitted`, `List-Id`,
   `List-Unsubscribe`, convite de agenda, remetentes automáticos conhecidos) → candidata a `rotina`, nunca
   descarte. Resposta automática de ausência vira `informativo` (pode trazer quem procurar).
3. Ligação por regra: thread conhecida (forte) → referência explícita (nº de pedido/ofício/processo da
   tarefa) → candidatos por centro de custo + pessoas + termos (fracos, só geram candidatos).
4. Modelo (GLM 5.3 Flash, Ollama Cloud) só para mensagens que não são rotina: recebe o texto mascarado,
   sem citações anteriores, e até 5 fichas de candidatos; devolve JSON estrito
   `{tarefa_id|null, varias, demanda_nova, classificacao, resumo, trecho_evidencia, confianca}`.
   Resposta inválida, `baixa` ou sem trecho que exista no texto → fila `esclarecer`.
5. Regras de evidência dos passos (ex.: `{tipo:'email', de:'arthur…', para_dominio:'funape.org.br',
   cc_inclui:'victoramaral…', contem_algum:['30.068','Otávio']}`) → passo `sugerido` + evento.
6. Prazos: alerta em D-5, D-2, D-0 e vencido, uma vez cada (evento `alerta_prazo`).
7. `vigia_registrar(...)`; notifica o que precisa do Victor.
`resumoDiario()` às 8h: abertas, o que precisa do Victor, fila `esclarecer`, contagem de `rotina` com os
assuntos (auditoria semanal às segundas), saúde do vigia.

Configuração (Propriedades do script): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VIGIA_EMAIL`, `VIGIA_SENHA`,
`OLLAMA_API_KEY`, `OLLAMA_MODEL` (padrão `glm-5.3-flash`), `NTFY_TOPICO`, `SITE_URL`, `EMAIL_AVISO`.

## Página Buriti
Abas: Propostas (como hoje; a proposta `tarefa` aparece com "Aplicar") · **Tarefas** (cartão por tarefa:
prazo, passos com estado, últimos eventos, botões Confirmar/Dispensar passo, Nota, Concluir) · **Triagem**
(fila `esclarecer` e vínculos sugeridos: Aceitar / Não é desta tarefa / É rotina; revisão de `rotina`).
Barra de saúde: "última checagem do vigia: há 12 min".

## MCP
`propor_tarefa` (agente) e `tarefas` (lista abertas com passos e eventos recentes). Sem números calculados.

## Revisão do GPT-6 Astra (06/10/2026) — decisões que valem sobre o texto acima
1. **Identidade do vigia:** papel novo `automacao` em `app_users` (o CHECK de `role` ganha o valor), **sem
   nenhum centro em `user_projects`**. Com escopo vazio, as policies da 033 não lhe dão leitura nem escrita
   de dado de projeto (nem bolsistas/CPF). Ele só age pelas RPCs `vigia_*` (definer), que conferem
   `is_automacao('vigia')` e só tocam tarefas **com projeto**. A tabela `automacoes` registra o login; só
   admin cadastra/revoga (`set_automacao`).
2. **Operações humanas recusam agente E automação:** guard `not is_agente() and not is_automacao(null)`.
   Decisões exigem `is_admin()`. Professor no escopo pode anotar; responsável pode ler e anotar a própria
   tarefa mesmo fora do escopo e registrar feito. Ver seção Responsável.
3. **Tarefa sempre tem projeto** no protótipo. `propor_tarefa` exige `project_id`, roda `contem_cpf` no
   payload inteiro (a mesma proteção da 052) e insere a proposta. `aplicar_proposta_tarefa` é atômica: trava
   a proposta, recusa se não estiver pendente, cria a tarefa uma vez só (`tarefas.proposta_id` unique) e
   marca a proposta aplicada.
4. **Máquina de estados dos passos:** `pendente → sugerido → confirmado|dispensado`; `confirmado` e
   `dispensado` só por admin e nunca regridem; o vigia só leva `pendente → sugerido`.
5. **Vínculo mensagem–tarefa é N:N:** `vigia_vinculos(gmail_message_id, tarefa_id, estado sugerido|
   confirmado|rejeitado, origem, criado_em)`, PK composta. Rejeição fica lembrada (o vigia não volta a
   sugerir o mesmo par). `vigia_mensagens` perde a coluna `tarefa_id`.
6. **Captura separada do processamento:** `vigia_mensagens.estado` (`capturada`, `processada`, `erro`,
   `tentativas`). O vigia primeiro grava a captura (idempotente por id), depois processa; o que falhou fica
   `capturada`/`erro` e volta na próxima execução. Cursor = `vigia_cursor` (uma linha): só avança até o
   limite da última janela inteiramente capturada; a busca sempre sobrepõe 1 dia e deduplica por id.
7. **Idempotência por efeito:** `tarefa_eventos.chave` unique (ex.: `msg:<id>:passo:<id>`,
   `prazo:<tarefa>:<prazo>:D-2`). Avisos em `vigia_avisos` (pendente/enviado/falhou, tentativas) — reenviáveis.
8. **Evidência exige combinação:** regra `email` passa a ter `contem_todos` (ex.: `['30.068']`) além de
   `contem_algum` (ex.: `['Otávio','bolsa']`), e só vale para mensagem posterior à criação da tarefa e na
   direção certa. Resposta automática nunca é evidência. Trecho existir não prova conclusão: por isso o
   passo fica só `sugerido`.
9. **Prazos:** chave do alerta inclui o valor do prazo (mudou o prazo, alertas recomeçam); alerta perdido é
   recuperado (limiar já passado e ainda não emitido → emite uma vez, o mais grave).
10. **Saúde:** `vigia_execucoes` grava início (`iniciada_em`) e fim; a página e o sino mostram "vigia
    atrasado" se a última execução concluída tem mais de 2 h (monitor fora do executor).
11. **LGPD:** fichas de candidatos, resumos, eventos e avisos levam só pseudônimos/títulos — nunca
    endereço de pessoa física; `vigia_mensagens.trecho` e `assunto` expiram (`vigia_expurgar`, 90 dias,
    chamado pelo vigia). Eventos são imutáveis, então não recebem dado pessoal. O MCP não lê
    `vigia_mensagens` nem remetentes.
12. **Corte do protótipo:** sem anexos, sem tarefa sem projeto, sem campo "Novo pedido". Modelo e ntfy
    entram, mas desligados por padrão (o vigia funciona só com regras se `OLLAMA_API_KEY` ou `NTFY_TOPICO`
    faltarem; nesse caso mensagens não decididas vão para `esclarecer`).

## Fora do protótipo
Ler anexos (marca `anexos > 0` e "anexo não conferido"); campo "Novo pedido" no site; executor em nuvem;
bot de conversa.

## Responsável

A 054 continua inédita em produção e foi alterada diretamente. O admin atribui um login humano já
existente por `atribuir_tarefa(p_tarefa,p_user)` (null desatribui) ou ao aplicar a proposta com
`p_responsavel`. O rótulo `responsavel` passa a guardar o nome na atribuição, sem e-mail. O agente
propõe apenas texto; não escolhe usuário nem consulta app_users. Atribuição e mudança de papel têm
validação no banco para impedir agente/automação como responsável.

O RLS permite ler a tarefa atribuída, seus passos, chaves e eventos fora do escopo; **não amplia
user_projects nem libera projetos, saldos ou bolsistas**. A RPC `centros_das_tarefas(p_ids)` confere a
mesma autorização e retorna só o código do centro necessário ao cartão. Regras de e-mail continuam
restritas a admin/vigia; eventos públicos continuam recusando CPF/endereço eletrônico.

O responsável ou admin chama `registrar_feito(p_passo,p_nota,p_link)`: nota obrigatória até 2000 caracteres,
link opcional HTTPS até 500; passo pendente vira sugerido, ou acrescenta novo registro se já sugerido.
O evento humano guarda nota/link/nome e autoria (criado_por); o resumo comporta a nota completa mais o
nome. A tarefa pede confirmação ao Victor. `ultimo_feito_id` preserva o último registro por passo mesmo
após confirmação e depois de dez outros eventos. Tarefas encerradas e passos decididos recusam feito.
Todas as decisões e atribuições exigem admin; professor no escopo e responsável podem registrar nota.

**Minhas tarefas** filtra pelo login, ordena por prazo e oferece Registrar que fiz e Nota. O menu some
somente após consulta bem-sucedida sem atribuições; falhas têm banner. A aba Tarefas permite ao admin
escolher o responsável e destaca nome, nota e link para confirmação. O MCP devolve o rótulo e `feito`
(nota/link/por) por passo, sem ler perfis ou regras.

Validação: `npm test`, `npm run lint` e `bash tools/replica-local/rodar-054.sh`.
Sem Docker, `node tools/replica-local/rodar-054-pglite.mjs` executa o mesmo SQL sintético e asserções de
RLS/ACL; instalação temporária e limites descritos em `tools/replica-local/README.md`.

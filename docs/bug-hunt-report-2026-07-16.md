# Relatório de Bug Hunt — ControleFinanceiro

**Data:** 2026-07-16  
**Metodologia:** Fan-out com 21 subagentes paralelos + verificação adversarial (2 vias) dos achados críticos/alto.  
**Artefatos gerados:** `docs/bug-hunt-report-2026-07-16.md` (este arquivo).  
**Resultado bruto (JSON):** `C:\Users\amara\AppData\Local\Temp\claude\...\tasks\wq98n1vuf.output`

---

## Resumo

| Métrica | Valor |
| --- | --- |
| Agents | 21 |
| Achados brutos | 62 |
| Após deduplicação | 62 |
| Críticos verificados | 4 |
| Alto verificados | 4 |
| Médios | 15 |
| Baixos | 2 |
| Tokens usados | ~966k |

---

## Situação dos críticos (revisado em 2026-08-12)

| # | Achado | Situação |
| --- | --- | --- |
| 1 | `isAtivoFunape` tratava "Inativo" como ativo | ✅ **corrigido** — `bolsa-parser.js:109` usa `ACTIVE_STATUSES.includes(s)` (match exato), com comentário explicando a armadilha da substring |
| 2 | `get_project_alerts()` lê a tabela `expenses` removida | ✅ **corrigido na migração 040** (2026-08-12) — ver abaixo |
| 3 | `inferBalanceStatus` ignorava a data do saldo | ✅ **corrigido** — `pure-fns.js:91` checa ano e mês antes da regra do dia 7 |
| 4 | `parseBRL` interpreta ponto único como decimal | ⚖️ **não é bug em aberto: é trade-off deliberado e testado.** `tests/utils.test.js:44` fixa `parseBRL('1500.75') === 1500.75`. As duas leituras de `1.500` (mil e quinhentos vs. um e meio) são mutuamente exclusivas e o projeto escolheu a decimal. A consequência (`R$ 1.500` → `1.5`) é real, mas é o preço da escolha, não um descuido. Falta um comentário no código dizendo isso. |

**Sobre o #2 — por que levou um mês.** O diagnóstico deste relatório estava
correto e completo desde 2026-07-16, e ainda assim o bug sobreviveu à
publicação. O que finalmente o pegou não foi releitura: foi **execução**. A
migração 040 acrescentou `get_panorama`, que chama `get_project_alerts` em
laço; na primeira rodada contra a réplica do banco real ela explodiu com
`relation "public.expenses" does not exist`, e daí não havia como não
consertar.

A lição é sobre a natureza do bug, não sobre disciplina: plpgsql resolve nome
de tabela apenas em **tempo de execução**, então a função continuou existindo,
respondendo ao linter e passando em qualquer inspeção estática — só quebrava
quando alguém pedia um alerta. Achado que só aparece rodando precisa de um
teste que rode, e é por isso que o roteiro `tests/sql/test_panorama.sql` abre
com um bloco de diagnóstico de uma linha em vez de uma descrição em prosa.

---

## 🚨 Críticos

### 1. Status "Inativo" tratado como ativo no parser de bolsas
- **Arquivo:** `frontend/js/parsers/bolsa-parser.js:103`
- **Descrição:** `isAtivoFunape()` usa `ACTIVE_STATUSES.some(a => s.includes(a))`. Como `"Inativo"` contém a substring `"ativo"`, bolsistas inativos são importados como ativos na reconciliação.
- **Repro:** Planilha FUNAPE com Status `Inativo` → incluída como ativa.
- **Sugestão:** comparar status de forma exata ou prefixada e rejeitar negativos (`inativo`, `cancelado`, `encerrado`).

### 2. `get_project_alerts()` consulta tabela `expenses` já removida — ✅ CORRIGIDO (mig. 040, 2026-08-12)
- **Arquivo:** `database/003_views_functions.sql:321`
- **Descrição:** A função possui o alerta `expense_no_description` fazendo `FROM public.expenses`. A migração 032 dropa `expenses`, então a função quebra em runtime. Também afeta `get_alerts_for_projects()` (`013_portuguese_months_batch_alerts_stats.sql:248`) e as páginas Projetos/Dashboard.
- **Repro:** Rodar migração 032 e chamar `get_project_alerts('<uuid>')`.
- **Sugestão:** atualizar/recadastrar `get_project_alerts()` na migração 032 (ou 033), removendo ou convertendo a consulta para `monitoramento.observacao`.
- **Correção:** a migração 032 **já continha** a recriação correta (seção 4.5, sem o alerta 4) — ela simplesmente não chegou ao banco, provavelmente por o script ter sido rodado em pedaços no SQL Editor. Varredura do schema em 2026-08-12 confirmou que essa foi a **única** seção da 032 que ficou para trás: `monitoramento` existe, `expenses` está dropada, `v_project_summary` está sem `total_expenses`, `save_project` está sem `p_funape_managed` e `projects` sem a coluna `funape_managed`. A 040 reaplica a versão da 032 textualmente e fecha com asserção reexecutável (`prosrc ~ 'expense_no_description'` tem que ser false), para a regressão não passar despercebida de novo.
- **Diagnóstico em uma linha**, em qualquer banco:
  ```sql
  select prosrc ~ 'expense_no_description' as quebrada
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_project_alerts';
  ```

### 3. `inferBalanceStatus` ignora a data do saldo
- **Arquivo:** `frontend/js/pure-fns.js:64`
- **Descrição:** A função retorna `paid_current` somente porque hoje é depois do dia 7, sem verificar se `balanceDate` pertence ao mês corrente. Saldos antigos são tratados como se o desconto do mês atual já tivesse ocorrido.
- **Repro:** `inferBalanceStatus('2026-01-01')` em qualquer dia após o 7 → retorna `paid_current`.
- **Sugestão:** verificar `bd.getFullYear() === now.getFullYear() && bd.getMonth() === now.getMonth()` antes de aplicar a regra do dia 7.

### 4. `parseBRL` interpreta ponto como decimal em valores brasileiros
- **Arquivo:** `frontend/js/pure-fns.js:20-24`
- **Descrição:** Quando não há vírgula e há apenas um ponto, `parseBRL` interpreta o ponto como decimal US. `parseBRL('R$ 1.500')` vira `1.5` em vez de `1500`.
- **Repro:** `parseBRL('R$ 1.500') === 1.5`.
- **Sugestão:** sem vírgula, tratar pontos como separadores de milhar; ou usar heurística explícita e documentar.

---

## ⚠️ Alto

### 5. Extração de texto PDF não ordena itens horizontalmente
- **Arquivo:** `frontend/js/pages/plano-trabalho.js:1004`
- **Descrição:** `extractPdfText()` agrupa itens apenas por Y (linha), sem ordenar por X dentro de cada linha. Em PDFs reais os itens vêm na ordem do content stream, podendo embaralhar colunas e quebrar as regexes do `balancete-parser`.
- **Repro:** Importar balancete cujas colunas saiam fora de ordem.
- **Sugestão:** agrupar por Y com threshold e ordenar por `transform[4]` (X) antes de concatenar cada linha.

### 6. Mapeamento de headers de planilha de bolsas por substring confunde "Valor Total"
- **Arquivo:** `frontend/js/parsers/bolsa-parser.js:140`
- **Descrição:** O loop usa `norm.includes(aliases[0])`, então header `"Valor Total"` é mapeado para a chave canônica `"valor"`, podendo sobrescrever o valor mensal com o total acumulado.
- **Repro:** Planilha com colunas "Valor" e "Valor Total".
- **Sugestão:** dar prioridade a match exato (`aliases.includes(norm)`) e usar substring só para aliases compostos/não genéricos.

### 7. Reconciliação de bolsas não-atômica: aplica antes de arquivar
- **Arquivo:** `frontend/js/pages/holders.js:1407-1445`
- **Descrição:** O handler chama `apply_reconciliation` primeiro e só depois faz upload do XLSX para Storage e insert em `reconciliacoes`. Se o upload/insert falhar, as mudanças de bolsas já estão persistidas, mas não há registro histórico, deixando o checklist do Fechamento Mensal inconsistente.
- **Repro:** Importar planilha de bolsas e simular falha no Storage/`reconciliacoes`.
- **Sugestão:** mover registro de reconciliação para dentro da RPC `apply_reconciliation` (recebendo `arquivo_storage_path`) ou, no mínimo, garantir insert antes de reportar sucesso e reverter em caso de falha.

### 8. Cálculos mensais sem arredondamento de ponto flutuante
- **Arquivo:** `frontend/js/pure-fns.js:94-165`
- **Descrição:** `calcProjectMonthly` usa `Number` diretamente. Somas acumulam erros de ponto flutuante (ex.: `0.1 + 0.2 = 0.30000000000000004`).
- **Repro:** `calcProjectMonthly({initial_balance:0.3}, [{status:'active',amount:0.1},{status:'active',amount:0.2}], [])`.
- **Sugestão:** arredondar valores intermediários/finais para 2 casas decimais (`Number(v.toFixed(2))` ou função `roundBRL` centralizada).

---

## 📋 Médios

### 9. Modal da fila de importação pode ser fechado durante salvamento
- **Arquivo:** `frontend/js/import-queue.js:258-331` / `frontend/js/supabase-config.js:96-114`
- **Descrição:** Apenas o botão "Salvar" é desabilitado durante `handler.save()`. O botão X e clique fora do modal continuam ativos; fechar enquanto salva chama `finalize()/onFinished()` antes da Promise terminar.
- **Sugestão:** adicionar flag `pendingSave`, bloquear todos os controles de fechamento e fazer `finalize()` aguardar o salvamento.

### 10. Busca do CrudPage perde foco a cada digitação
- **Arquivo:** `frontend/js/pages/crud-page.js:181-186` (root cause em `refresh()`)
- **Descrição:** `onSearch()` dispara `refresh()` debounced em 300ms. `refresh()` substitui o `innerHTML` do container inteiro, recriando o input de busca e perdendo o foco.
- **Sugestão:** renderizar apenas a área de resultados ou restaurar foco no input após o refresh.

### 11. `apply_reconciliation` incrementa contador mesmo sem alterações
- **Arquivo:** `database/029_holder_merge_reconciliacao_global.sql:122, 134, 96`
- **Descrição:** `v_total` é incrementado incondicionalmente para cada item de `updates`/`ends`. Se o ID não existir ou pertencer a outro projeto, `scholarship_audit` registra `changes_count` falso.
- **Sugestão:** usar `GET DIAGNOSTICS row_count` e incrementar só quando `row_count > 0`.

### 12. `diffProjections` compara projeções por índice, não por mês
- **Arquivo:** `frontend/js/pure-fns.js:167-181`
- **Descrição:** Compara `simulated[i]` com `original[i]`. Se os arrays tiverem meses diferentes, meses distintos são comparados entre si, gerando diffs falsos.
- **Sugestão:** indexar por `month_start`/`month_label` e comparar apenas meses coincidentes; reportar adições/remoções separadamente.

### 13. Router não tem fallback 404
- **Arquivo:** `frontend/js/router.js:40-47`
- **Descrição:** Rota inexistente apenas loga warn e retorna; a página anterior continua visível e a sidebar fica inconsistente.
- **Sugestão:** adicionar rota `not-found` interna que renderiza "Página não encontrada".

### 14. Regex do código do projeto restrita a subcontas específicas
- **Arquivo:** `frontend/js/parsers/balancete-parser.js:29`
- **Descrição:** `RE_PROJECT_CODE` só reconhece `1.1.1.02.0[2-4]`. Outras subcontas de banco da FUNAPE fazem `project_code` ficar null.
- **Sugestão:** ampliar regex para capturar qualquer subcódigo de conta `1.1.1.02.0d.ddddd`.

### 15. Regex de lançamento exige layout rígido de 8 colunas
- **Arquivo:** `frontend/js/parsers/balancete-parser.js:38`
- **Descrição:** `RE_LANCAMENTO` exige conta + código reduzido + descrição + exatamente 5 campos numéricos. Linhas com descrição flexível ou coluna "Anterior" omitida são ignoradas.
- **Sugestão:** separar por whitespace e consumir valores numéricos pela direita, permitindo descrição flexível.

### 16. Filtro de folha de gasto exige 6 níveis
- **Arquivo:** `frontend/js/parsers/balancete-parser.js:45`
- **Descrição:** `RE_FOLHA_GASTO` exige 6+ níveis. Balancetes reais podem usar 5 níveis para despesas reais, que são descartadas silenciosamente.
- **Sugestão:** aceitar 5+ níveis e manter lista de prefixos agregadores a ignorar.

### 17. Detecção de rubrica top-level não aceita marcadores com `)` ou `.`
- **Arquivo:** `frontend/js/parsers/pt-parser.js:37`
- **Descrição:** `RE_TOPLEVEL` só reconhece letra seguida de hífen/en-dash/em-dash. Modelos UFG/FUNAPE usam `a) Pessoal` ou `a. Pessoal`, que não são reconhecidos.
- **Sugestão:** expandir regex para `/^\s*([a-h])\s*[-–—).]/i`.

### 18. CPF com leading zero perdido no Excel gera dígitos a menos
- **Arquivo:** `frontend/js/parsers/bolsa-parser.js:45`
- **Descrição:** `normalizeCPF` exige exatamente 11 dígitos. Se a célula estiver como número, Excel pode remover o zero à esquerda (10 dígitos) e o parser retorna `null`.
- **Sugestão:** se `digits.length` estiver entre 9 e 10, left-pad até 11; também aceitar CPF formatado.

### 19. Simulação avisa de alterações não salvas mesmo após reverter ao original
- **Arquivo:** `frontend/js/pages/projetos.js:554-558`
- **Descrição:** `updateDraftField()` marca `_modified = true` sempre que um campo é alterado, sem comparar com o valor original.
- **Sugestão:** comparar com `originalScholarships` e só marcar `_modified` quando houver diferença real.

### 20. Dashboard ignora erros nas queries de bolsistas e alertas
- **Arquivo:** `frontend/js/pages/dashboard.js:182-211`
- **Descrição:** `renderFull()` executa RPCs de scholarships/alertas mas ignora `res.error`. Em caso de falha, os painéis aparecem vazios sem mensagem.
- **Sugestão:** verificar `res.error` e exibir `showToast`/banner.

### 21. Hub ignora erro na contagem de observações
- **Arquivo:** `frontend/js/pages/hub.js:114-126`
- **Descrição:** `obsRes` é desempacotado sem verificar `obsRes.error`; falha na tabela `monitoramento` mostra "0 registros".
- **Sugestão:** verificar `obsRes.error` e mostrar indicador de erro no KPI.

### 22. Revisão de plano/balancete não valida campos obrigatórios antes do upload
- **Arquivo:** `frontend/js/pages/plano-trabalho.js:896-925 / 962-989`
- **Descrição:** Upload para Storage ocorre antes da validação da RPC. Campos obrigatórios só falham depois que o arquivo já foi enviado.
- **Sugestão:** adicionar validação client-side antes de iniciar o upload.

### 23. Saldos pode enviar NaN para o banco
- **Arquivo:** `frontend/js/pages/saldos.js:303-305`
- **Descrição:** `saveAllChanges()` usa `parseFloat()` sem validar `Number.isFinite()`. Valores inválidos podem ser enviados na RPC.
- **Sugestão:** verificar `isFinite` após parse; se inválido, toast e skip.

---

## 🔽 Baixos

### 24. Índices de `reconciliacoes` sem `IF NOT EXISTS`
- **Arquivo:** `database/031_reconciliacoes.sql:40`
- **Descrição:** `create index` simples impede re-execução da migração.
- **Sugestão:** usar `create index if not exists`.

### 25. Migração `expenses → monitoramento` não é idempotente e descarta dados financeiros
- **Arquivo:** `database/032_remove_funape_repurpose_expenses.sql:79-90`
- **Descrição:** O insert sempre roda quando `expenses` existe, podendo duplicar observações em re-execução. Também descarta `amount` e `category` (embora isso seja intencional).
- **Sugestão:** tornar idempotente com `WHERE NOT EXISTS` e, se necessário, arquivar `amount/category` em JSON/audit antes do drop.

---

## Observação de segurança

O agente da área `find:fechamento-import` levantou um aviso do modo automático: "Auto mode could not evaluate this action and is blocking it for safety". Recomendo revisar as ações daquele subagente no `journal.jsonl` antes de agir nos achados dessa área.

---

## Próximos passos sugeridos

1. Corrigir os 4 críticos primeiro — impactam dados financeiros e runtime.
2. Em seguida os 4 de severidade alta — impactam importação de documentos e cálculos.
3. Revisar a migração 032/criar 033 para resolver a referência à tabela `expenses`.
4. Rodar `npm test` e `npm run lint` após correções para garantir que nada quebrou.

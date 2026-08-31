# Servidor MCP — ControleFinanceiro

Dá a um assistente de IA acesso estruturado aos dados do sistema: quanto sobra
num centro de custo, onde cabe uma bolsa nova, quanto um bolsista recebe e até
quando.

É a **fase 2** da camada de IA. A fase 1 são as RPCs de decisão no Postgres
(migrações 038 e 039); a fase 3 é a aba **Assistente** no próprio site
(`frontend/js/ai/`), já pronta. Este servidor é um adaptador fino sobre as
mesmas RPCs — **não** tem lógica financeira, e não deveria ganhar nenhuma: a aba
do site consome as mesmas funções, e inteligência duplicada no adaptador viraria
duas versões divergentes da mesma conta. Se um número está errado, o conserto é
na migração.

Os dois adaptadores não podem derivar um do outro em silêncio, e o que impede
isso é um teste: `tests/ai-tools.test.js` (na raiz do repo) lê **este** fonte
como texto e trava contra o do site a lista de tools e o bloco das quatro regras
transversais, palavra por palavra. Acrescentar tool aqui sem acrescentar lá — ou
reescrever uma das regras num só lado — quebra o `npm test` da raiz.

As RPCs estão aplicadas na produção: `get_saldo_livre` (038) e
`simular_alocacao` (039) desde 2026-08-11, `get_panorama` (040) desde
2026-08-12. Para conferir em qualquer banco antes de apontar:

```sql
select proname, prosecdef as definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and proname in ('get_saldo_livre', 'simular_alocacao', 'get_panorama');
```

Três linhas = pronto (`get_saldo_livre` é a única com `definer = true`). Se
faltar alguma, rode a migração correspondente em `database/`.

A 040 também reparou `get_project_alerts`, que estava quebrada em runtime
desde a 032 e é chamada pelo `panorama`. Se a tool responder erro de tabela
inexistente, é isso — confira com:

```sql
select prosrc ~ 'expense_no_description' as quebrada
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and proname = 'get_project_alerts';
```

## Autenticação: por usuário

Cada pessoa configura o próprio e-mail e senha do Supabase. O servidor faz login
de verdade e todas as chamadas viajam com o JWT daquele usuário — então o RLS
das migrações 033/034 decide o que aparece. Um professor enxerga aqui os mesmos
centros de custo que enxerga no site, e o servidor não tem uma linha de lógica
de permissão própria.

Consequência prática: não existe "modo servidor" com token compartilhado. Duas
pessoas usando o mesmo MCP com logins diferentes veem coisas diferentes, como
deve ser.

## Instalação

```bash
cd mcp && npm install
```

## Configuração

No `claude_desktop_config.json` do Claude Desktop (ou via `claude mcp add` no
Claude Code):

```json
{
  "mcpServers": {
    "controle-financeiro": {
      "command": "node",
      "args": ["C:/caminho/para/ControleFinanceiro/mcp/src/index.js"],
      "env": {
        "CF_SUPABASE_URL": "https://SEU-PROJETO.supabase.co",
        "CF_SUPABASE_ANON_KEY": "a anon key (é pública, pode ficar aqui)",
        "CF_EMAIL": "voce@ufg.br",
        "CF_PASSWORD": "sua senha"
      }
    }
  }
}
```

A anon key é pública por desenho — a barreira é o RLS, não ela. A **senha**, não:
esse arquivo fica fora do repositório e é pessoal.

Para apontar à stack local em vez da produção, troque `CF_SUPABASE_URL` por
`http://127.0.0.1:54321` e use as credenciais de teste (ver
`tools/replica-local/README.md`).

No **Claude Code** o registro é por linha de comando:

```bash
claude mcp add controle-financeiro -s local \
  -e CF_SUPABASE_URL=... -e CF_SUPABASE_ANON_KEY=... \
  -e CF_EMAIL=... -e CF_PASSWORD=... \
  -- node "<caminho absoluto>/mcp/src/index.js"
```

Use `-s local` (grava em `~/.claude.json`, privado). **Não** use `-s project`:
isso escreveria um `.mcp.json` dentro do repositório, que é público — a senha
iria junto. Servidor recém-adicionado só aparece depois de reiniciar a sessão;
`claude mcp get controle-financeiro` mostra se conectou.

No **Codex** o arquivo é o `~/.codex/config.toml`:

```toml
[mcp_servers.controle-financeiro]
command = "node"
args = ["C:/caminho/para/ControleFinanceiro/mcp/src/index.js"]

[mcp_servers.controle-financeiro.env]
CF_SUPABASE_URL = "https://SEU-PROJETO.supabase.co"
CF_SUPABASE_ANON_KEY = "a anon key"
CF_EMAIL = "voce@ufg.br"
CF_PASSWORD = "sua senha"
```

Ou por linha de comando:

```bash
codex mcp add controle-financeiro   --env CF_SUPABASE_URL=... --env CF_EMAIL=...   -- node "<caminho absoluto>/mcp/src/index.js"
```

Vale a mesma regra do Claude Code, e pelo mesmo motivo: o Codex também aceita um
`.codex/config.toml` **de projeto**, e é justamente esse que não serve aqui — ele
ficaria versionado, com a senha dentro. Use o de usuário. O servidor só aparece
depois de reiniciar o cliente.

## Tools

| Tool | Para quê |
|---|---|
| `listar_centros_de_custo` | Descobrir os nomes aceitos pelas outras tools; já vem escopada |
| `panorama` | Como estão **todos** os centros de custo: saldo livre, caixa, bolsas, vigência e alertas |
| `saldo_livre` | Quanto sobra num centro de custo, por grupo de rubrica, descontados os compromissos |
| `simular_alocacao` | Onde cabe uma bolsa ou uma compra, ranqueado por risco de devolução |
| `consultar_bolsas` | Valor, início e fim das bolsas; com `encerrando_em_meses`, o que vence |
| `previsto_vs_realizado` | Execução por rubrica: quanto foi orçado × quanto saiu |
| `projecao_de_caixa` | Saldo mês a mês até o fim da vigência |
| `plano_de_trabalho` | O que foi aprovado: rubricas orçadas e cronograma de desembolso |
| `quem_sou_eu` | Com qual login e papel a sessão está rodando |

As três primeiras respondem em ordem de zoom: `panorama` (todos), `saldo_livre`
(um) e `simular_alocacao` (onde colocar). `panorama` é o ponto de partida
natural — inclusive porque `resumo.sem_balancete` e `resumo.balancete_defasado`
dizem quais centros estão com o dado atrasado, o que nenhuma outra consulta
mostrava.

### Onde mora o enquadramento

O que o modelo lê está em dois lugares, e a divisão é proposital.

O **`instructions` do handshake** (`INSTRUCOES`, em `src/index.js`) carrega as
quatro regras que valem para todas as tools: não calcular (todo número sai de
RPC), não recomendar (shortlist com justificativa — a ordem mede urgência, e
urgência não é mérito), declarar o que o número cobre, e **`panorama` descreve /
`simular_alocacao` ranqueia**. Ficam ali porque o cliente lê o handshake **uma
vez, antes de escolher a tool** — que é quando essas regras ainda podem mudar a
escolha — e porque repeti-las em nove descrições custava contexto em toda
listagem.

A **descrição de cada tool** ficou com o que é só dela: o que aquele número não
cobre. `previsto_vs_realizado` só olha para trás; `projecao_de_caixa` só sabe
prever bolsa e parte do saldo cadastrado, não do balancete; `plano_de_trabalho` é
o orçado, não o executado; `compromissos_cobertura`, `situacao_dado` e
`truncado` dizem quando o número não é o que parece. A versão curta da regra
transversal sobrevive nas duas descrições em que a leitura errada é mais
provável (`panorama` e `simular_alocacao`), para um cliente que ignore
`instructions` ainda não ler descrição como ranking.

As nove tools declaram `readOnlyHint` — nenhuma escreve. É dica para o cliente
poder dispensar confirmação, **não** barreira: a barreira é o RLS.

CPF e e-mail de bolsista não saem daqui: as consultas selecionam colunas
explícitas, e `plano_de_trabalho` projeta os campos em vez de devolver a linha
da tabela (o `to_jsonb(pt.*)` da RPC traz `raw_extraction`, que é uma segunda
cópia das rubricas e desembolsos já estruturados). Nome de bolsista sai —
aparece nas bolsas e dentro das mensagens de alerta do panorama, que é o
conteúdo do alerta.

`panorama` exige a **migração 040**; as demais, as 038/039. Se ela responder
erro de função inexistente, falta rodar `database/040_panorama.sql`.

### Segunda rodada: enxugar as respostas (pendente)

Em uso real, as respostas do modelo saem **prolixas e carregadas** — despejam
ressalva que não muda decisão nenhuma. Mover o enquadramento transversal para o
`instructions` foi o primeiro corte (nove cópias viraram uma, lida antes da
escolha da tool) e veio junto com um parágrafo "como responder": o número pedido
e a ressalva que muda a leitura dele, não o JSON inteiro. Não é o suficiente, e
vale registrar por que antes de a próxima pessoa mexer no lugar errado.

**A pista é que o texto provavelmente não nasce aqui.** Toda RPC de decisão
devolve `nota`, e a 039 devolve também `avisos` e `resumo.observacao` — campos
escritos em tom de "repasse isto", que chegam ao modelo **em toda chamada**,
dentro do payload, e não só quando ele escolhe a tool. É texto que compete com o
próprio dado. Contá-los é o primeiro passo de qualquer medição.

Onde isso complica: esses campos moram nas migrações **038/039/040**, não no
adaptador. Enxugá-los é mexer na camada que a regra do "zero lógica financeira
no adaptador" existe para proteger — e a aba do site (fase 3) já está de pé,
recebendo a mesma nota pelo mesmo payload, de modo que agora qualquer corte
muda **dois** consumidores de uma vez. Portanto:

- **Não** resolva o problema podando o texto no `tools.js`. Isso faz o MCP e o
  site passarem a dizer coisas diferentes sobre o mesmo número, que é exatamente
  a divergência que a arquitetura evita.
- O ajuste, se for feito, é **na migração**, com a consciência de que muda os
  dois consumidores de uma vez. É decisão deliberada, não tweak.
- Distinga as duas coisas que a nota faz hoje: **declarar cobertura** (o que o
  número não cobre — isso precisa continuar chegando, é requisito das 038/039) e
  **instruir o leitor** ("repasse", "não omita", "exponha as opções"). A segunda
  metade é enquadramento e já vive no `instructions`; a primeira é dado.

**Antes de mexer, fixe a medição.** Hoje não há como dizer se uma mudança
ajudou: as respostas variam por pergunta. Comece por duas ou três perguntas de
referência ("como estão os projetos?", "onde coloco uma bolsa de R$ 2.000?",
"quanto sobra em X?"), guarde as respostas atuais, e compare depois. Sem isso a
segunda rodada vira troca de opinião sobre redação. A aba Assistente do site já
oferece essas mesmas três como sugestões na tela de boas-vindas, justamente para
a comparação ficar barata o bastante para alguém de fato fazer — e ali há um
seletor de modelo, então a mesma pergunta pode ser comparada entre modelos sem
redeploy.

## Conferência

São duas, e a divisão é por precisar ou não de banco.

```bash
npm test        # contrato, sem credencial nenhuma  (roda no CI)
npm run smoke   # ponta a ponta, com login de verdade
```

**Node 22+.** Não é prejuízo de estilo: o `@supabase/supabase-js` 2.112 usa
WebSocket nativo, que só existe a partir do 22 — em Node 20 o `createClient()`
lança *"native WebSocket not found"* na primeira chamada de tool. O CI rodava
Node 20 e não via isso porque o teste offline nunca chega a `createClient` (o
login é preguiçoso e a falta das `CF_*` interrompe antes); quem revelou foi o
`login-concorrente.js`, que loga de verdade contra o dublê. Declarado em
`engines` do `package.json`.

O `npm test` sobe o servidor como cliente MCP real e confere o que não depende de
dado: as 9 tools, as regras transversais no `instructions` do handshake, o
`readOnlyHint`, os campos obrigatórios do schema e a mensagem de erro de quem
esquece as `CF_*`. Ele funciona sem segredo porque o login é **preguiçoso** —
`config()` só é lida na primeira chamada de tool, então handshake e `listTools`
não tocam no Supabase. É o que o CI roda (job `mcp` em `.github/workflows/ci.yml`).

Junto dele roda o `scripts/login-concorrente.js`, que cobre uma regressão de
protocolo e não de contrato: o cliente MCP chama tools **em paralelo**, e
`entrar()` publicava o cliente em `cliente` antes de autenticar — a segunda
chamada pegava esse cliente ainda anônimo e seguia com ele. O efeito não era
erro: policy `to authenticated` devolve **zero linha** para anon, então
`listar_centros_de_custo` respondia `total: 0` para um admin que enxerga 17
centros, indistinguível de "esse login não vê nada". Hoje o login é
*single-flight*: quem chega durante um login em voo espera a mesma promessa.
O teste não usa mock — sobe um GoTrue/PostgREST dublê que **atrasa** o login e
devolve `[]` a quem chega com a anon key, porque sem esse atraso a corrida não
acontece. Rodado contra o código antigo, ele falha; é o que o torna útil.

O `npm run smoke` é o que exige banco:

Sobe o servidor como um cliente MCP de verdade (subprocesso via stdio) e
exercita as tools pelo mesmo caminho do Claude Desktop: protocolo, login no
GoTrue, PostgREST e RLS. Contra a stack local:

```bash
CF_SUPABASE_URL=http://127.0.0.1:54321 \
CF_SUPABASE_ANON_KEY=<anon key local, de `npx supabase status`> \
CF_EMAIL=professor@local.test CF_PASSWORD=local-dev-123456 \
npm run smoke
```

Rode com os **dois** logins, professor e admin — não é zelo, é o desenho do
teste: as conferências de escopo têm expectativas **opostas** conforme o papel, e
é a rodada de professor que prova a barreira. A de admin é o controle (se ele
fosse barrado, o erro estaria do outro lado).

O escopo é conferido por dois caminhos, porque são dois mecanismos:

- **RPC `security definer` com guard** (`saldo_livre`): o escopo aparece como
  **erro** — o professor recebe `Acesso negado ao projeto …`, de
  `assert_project_allowed`.
- **RPC `security invoker`** (`panorama`): o escopo não levanta exceção, ele
  **omite a linha**. Um vazamento aqui passaria despercebido pelo teste do guard.

O uuid é passado direto porque o resolvedor por nome nem enxerga o que está fora
do escopo — quem está sendo testado é o banco, não o adaptador. Sem configuração,
o teste usa um uuid inexistente, que percorre o mesmo caminho (não-admin só passa
pelo que está em `allowed_project_ids()`). Para a versão forte, aponte um centro
de custo real de outra pessoa:

```bash
CF_SMOKE_PROJETO_ALHEIO=<uuid de um centro de custo fora deste login> npm run smoke
```

Conferência marcada **`ok~`** passou sem dado nenhum para exercitar — não é
falha, pode ser o estado correto daquela base, mas também não é garantia: no
ambiente local, por exemplo, os 7 centros de custo do professor não têm bolsa
nenhuma, então "não devolve CPF" ali é verdade vazia e só a rodada de admin
exercita `consultar_bolsas` com dado real. O rodapé lista quais foram.

## Nota sobre stdio

O transporte é stdio: **nada** pode ser escrito em stdout além do protocolo, ou a
sessão corrompe. Log vai para stderr (`console.error`).

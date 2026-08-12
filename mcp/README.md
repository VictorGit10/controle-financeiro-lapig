# Servidor MCP — ControleFinanceiro

Dá a um assistente de IA acesso estruturado aos dados do sistema: quanto sobra
num centro de custo, onde cabe uma bolsa nova, quanto um bolsista recebe e até
quando.

É a **fase 2** da camada de IA. A fase 1 são as RPCs de decisão no Postgres
(migrações 038 e 039); a fase 3 será uma aba no próprio site. Este servidor é um
adaptador fino sobre as mesmas RPCs — **não** tem lógica financeira, e não
deveria ganhar nenhuma: a aba do site vai consumir as mesmas funções, e
inteligência duplicada no adaptador viraria duas versões divergentes da mesma
conta. Se um número está errado, o conserto é na migração.

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

Uma divisão que as descrições insistem: **`panorama` descreve, `simular_alocacao`
ranqueia.** A ordem do panorama é alfabética e não significa prioridade. Dois
rankings com critérios diferentes produziriam listas que discordam, e quem
lesse as duas não teria como saber qual vale.

As descrições das tools carregam o enquadramento das migrações, porque é o que o
modelo lê: `simular_alocacao` devolve **shortlist com justificativa, não
recomendação** (ordena por urgência de gasto, e urgência não é mérito), e
`saldo_livre` exige declarar o que o número cobre antes de afirmar qualquer
coisa. As de leitura declaram o que **não** cobrem: `previsto_vs_realizado` só
olha para trás, `projecao_de_caixa` só sabe prever bolsa, `plano_de_trabalho` é
o orçado e não o executado. O modelo conversa; **cálculo nunca** — todo número
sai de RPC.

CPF e e-mail de bolsista não saem daqui: as consultas selecionam colunas
explícitas. Nome de bolsista sai — aparece nas bolsas e dentro das mensagens de
alerta do panorama, que é o conteúdo do alerta.

`panorama` exige a **migração 040**; as demais, as 038/039. Se ela responder
erro de função inexistente, falta rodar `database/040_panorama.sql`.

## Conferência

```bash
npm run smoke
```

Sobe o servidor como um cliente MCP de verdade (subprocesso via stdio) e
exercita as tools pelo mesmo caminho do Claude Desktop: protocolo, login no
GoTrue, PostgREST e RLS. Contra a stack local:

```bash
CF_SUPABASE_URL=http://127.0.0.1:54321 \
CF_SUPABASE_ANON_KEY=<anon key local, de `npx supabase status`> \
CF_EMAIL=professor@local.test CF_PASSWORD=local-dev-123456 \
npm run smoke
```

Vale rodar com os **dois** logins: como professor e como admin. Um resultado
vazio pode ser correto e ainda assim esconder que a conferência passou a vazio —
no ambiente local, por exemplo, os 7 centros de custo do professor não têm bolsa
nenhuma, então só o login de admin exercita `consultar_bolsas` com dado real.

O escopo entre usuários se verifica passando o **uuid** de um centro de custo
alheio (o resolvedor por nome nem enxerga o que está fora do escopo): o professor
recebe `Acesso negado ao projeto …`, vindo do guard `assert_project_allowed`, e o
admin passa.

## Nota sobre stdio

O transporte é stdio: **nada** pode ser escrito em stdout além do protocolo, ou a
sessão corrompe. Log vai para stderr (`console.error`).

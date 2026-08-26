# assistente

Proxy entre a aba **Assistente** do site e o Ollama Cloud. É a única peça
servidor da fase 3 da camada de IA, e existe por um motivo só: a
`OLLAMA_API_KEY` não pode ir no browser — o bundle do frontend é público.

Ao contrário das duas Edge Functions de extração (deprecated), esta **não
processa nada**: não executa tool, não chama RPC, não guarda conversa e não tem
uma linha de lógica financeira. O laço de tool calling roda no browser
(`frontend/js/ai/agent.js`), e as tools consultam as RPCs pelo `supabaseClient`
já logado — mesmo JWT, mesmo RLS que o resto do site.

## Deploy

```bash
# da raiz do repositório
npx supabase functions deploy assistente --project-ref <ref-do-projeto>
```

Três coisas que não são óbvias e custaram uma sessão:

- **Não precisa de CLI instalada globalmente nem de Docker.** O `npx supabase`
  baixa a CLI na hora e, desde a v2, o bundle é feito pela API — o aviso
  `WARNING: Docker is not running` aparece e o deploy vai assim mesmo.
- **Precisa estar autenticado** (`npx supabase login`, ou a variável de
  ambiente `SUPABASE_ACCESS_TOKEN`). `npx supabase projects list` responde se já
  está: se listar o projeto, está.
- **O `--project-ref` é obrigatório aqui** porque o repositório não está linkado
  (`supabase link` nunca foi rodado). O ref sai do `projects list` ou do
  subdomínio de `SUPABASE_URL` em `frontend/js/supabase-config.js`.

Conferir se subiu, sem precisar de login de usuário nenhum:

```bash
curl -s -o /dev/null -w "%{http_code}
" -X POST   https://<ref-do-projeto>.supabase.co/functions/v1/assistente -d '{}'
```

`401` é o esperado — a função está lá e o gateway exige JWT. `404` significa que
**não** existe, e é esse 404 que a aba mostra como *"Failed to send a request to
the Edge Function"*: o preflight CORS morre antes de haver resposta para ler, e
o supabase-js não tem como distinguir isso de queda de rede. Comparar com uma
função que você sabe que existe (`extract-balancete` → 401) separa os dois casos
em dez segundos.

Secrets:

```bash
npx supabase secrets list --project-ref <ref-do-projeto>
npx supabase secrets set OLLAMA_API_KEY=<chave> --project-ref <ref-do-projeto>
```

A `OLLAMA_API_KEY` já estava configurada no projeto (era usada pelas funções de
extração antes de 2026-05). O `secrets list` mostra digest, não o valor.

## Modelos

A allowlist do seletor da tela vive na constante `MODELOS_PADRAO` e pode ser
trocada **sem redeploy** por um secret:

```bash
npx supabase secrets set ASSISTENTE_MODELOS="glm-5.2:cloud,kimi-k2.6:cloud" --project-ref <ref-do-projeto>
```

O primeiro da lista é o padrão — hoje `glm-5.2:cloud`. Um modelo só serve
aqui se suportar **tool calling** — sem isso o assistente não consulta RPC nenhuma e passa a inventar
número, que é o contrário do que a camada existe para fazer. Se um modelo
responder sem nunca chamar tool, é esse o sintoma.

Dá para conferir antes de pôr um modelo na lista: a página dele em
`ollama.com/library/<modelo>` declara as capacidades, e `tools` precisa estar
entre elas.

## Uso

Listar os modelos liberados:

```http
POST /functions/v1/assistente
Authorization: Bearer <sb-access-token>

{ "acao": "modelos" }
```
```json
{ "modelos": ["glm-5.2:cloud", "kimi-k2.6:cloud", "gemma4:31b-cloud"], "padrao": "glm-5.2:cloud" }
```

Uma rodada de conversa (o cliente repete isto a cada volta do laço, com as
mensagens `tool` já acrescentadas):

```http
POST /functions/v1/assistente
Authorization: Bearer <sb-access-token>

{
  "model": "glm-5.2:cloud",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "como estão os projetos?" }
  ],
  "tools": [ { "type": "function", "function": { "name": "panorama", "...": "..." } } ]
}
```
```json
{
  "message": {
    "role": "assistant",
    "content": "",
    "tool_calls": [{ "function": { "name": "panorama", "arguments": {} } }]
  },
  "model": "glm-5.2:cloud",
  "done_reason": "stop",
  "eval_count": 412
}
```

`stream` é sempre `false`: o que a tela mostra ao vivo são os **passos** (qual
RPC está sendo consultada), não os tokens — e isso o laço no browser já dá de
graça, sem o custo de tratar SSE em cada volta.

## Auth e limites

Exige JWT válido do Supabase; anônimo recebe 401. Não bypassa RLS — nem teria o
que bypassar, já que não toca no banco.

A função é, por desenho, um gateway de LLM para quem tem login no sistema. O
limite é honesto: quem tem login já enxerga (pelo RLS) o dado que o assistente
consulta; o que a função impede é a chave vazar e o anônimo usá-la. Os tetos —
80 mensagens, 30 tools, 400 mil chars de payload, 120 s de espera — são freio
contra laço infinito no cliente, não barreira de segurança.

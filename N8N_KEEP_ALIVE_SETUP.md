# LAPIG — Keep-alive no Supabase via n8n

Workflow pronto para importar no n8n e evitar que o projeto gratuito do Supabase entre em modo de pausa por inatividade.

---

## 1. O que esse workflow faz

A cada **2 dias**, ele faz uma requisição de **leitura** ao Supabase listando os projetos ativos do sistema.

Essa query é a mesma que a landing page do app executa ao abrir (`frontend/js/pages/hub.js` e `frontend/js/pages/projetos.js`), então ela:

- É **natural** — não cria registros, logs ou eventos falsos.
- É **barata** — lê apenas 10 linhas com 3 colunas.
- É **segura** — não altera dados.

Isso é suficiente para manter o banco ativo no plano gratuito do Supabase, que pausa após **7 dias sem atividade**.

---

## 2. Arquivos entregues

| Arquivo | Descrição |
| --- | --- |
| `n8n-keep-alive-lapig.json` | Workflow do n8n pronto para importação. |
| `N8N_KEEP_ALIVE_SETUP.md` | Este guia. |

---

## 3. Como importar no n8n

1. Acesse seu n8n (local ou cloud).
2. Vá em **Workflows** → **Add workflow**.
3. Clique nos **três pontos** (⋮) no canto superior direito → **Import from file**.
4. Selecione `n8n-keep-alive-lapig.json`.
5. Salve o workflow.

---

## 4. Credenciais já embutidas

O workflow já vem com os valores do projeto:

| Dado | Valor |
| --- | --- |
| Supabase URL | `https://skxiivmkhpegefafdlty.supabase.co` |
| Anon Key | `sb_publishable_cWm8BfwIb2JQ-WIOOjkQfA_jvTt7OmG` |

> ⚠️ **Aviso de segurança:** a *anon key* está visível no arquivo JSON. Ela já está exposta em `frontend/js/supabase-config.js`, então isso não piora o cenário atual. Mesmo assim, recomendamos migrar para uma **Edge Function** com autenticação por service role key no futuro (ver seção 7).

---

## 5. Frequência

- **Agendamento:** a cada 2 dias, às **08:00**.
- **Expressão cron:** `0 8 */2 * *`
- Isso dá margem caso uma execução falhe, já que o limite de pausa do Supabase é 7 dias.

Se quiser ser mais conservador, altere o cron para diário:
- Diariamente às 08:00: `0 8 * * *`

---

## 6. Como testar

1. Após importar, clique em **Execute workflow** (botão de play).
2. Verifique se o node **Listar projetos** retorna status `200`.
3. Confira os dados de saída: deve aparecer uma lista de objetos com `id`, `name` e `active`.
4. Ative o workflow com o toggle **Active**.
5. Acompanhe as execuções em **Executions** para garantir que roda conforme o agendamento.

---

## 7. Alternativa mais segura (recomendada no médio prazo)

Para não depender da anon key exposta, crie uma Edge Function no Supabase:

```ts
// supabase/functions/keep-alive/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data, error } = await supabase
    .from("projects")
    .select("id,name,active")
    .order("active", { ascending: false })
    .order("name")
    .limit(10);

  return new Response(JSON.stringify({ data, error }), {
    status: error ? 500 : 200,
    headers: { "Content-Type": "application/json" },
  });
});
```

E no n8n, substitua o node HTTP por uma chamada para:

```
GET https://skxiivmkhpegefafdlty.supabase.co/functions/v1/keep-alive
Authorization: Bearer <anon-key>
```

Dessa forma, a lógica fica no servidor e a service role key não fica no n8n.

---

## 8. Resumo da estratégia

- ✅ Requisição de leitura (não altera dados).
- ✅ Replica comportamento real do app ao abrir.
- ✅ Intervalo seguro (2 dias < 7 dias de pausa).
- ✅ Pronto para importar.
- ⚠️ Considere migrar para Edge Function para esconder a chave de acesso.

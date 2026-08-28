# vendor/ — fallback local das bibliotecas de CDN

Cópias das bibliotecas que `index.html` carrega do CDN. Cada `<script>` do CDN é
seguido de uma linha que testa se o global apareceu e, se não apareceu, injeta a
cópia daqui:

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.js" integrity="sha384-..." crossorigin="anonymous"></script>
<script>if(typeof Chart==="undefined")document.write('<script src="vendor/chart.umd.js"><\/script>');</script>
```

## O que está aqui

| Arquivo | Pacote e versão | Usado por |
|---|---|---|
| `lucide.js` | `lucide@0.475.0` (unpkg) | ícones, toda a interface |
| `supabase.js` | `@supabase/supabase-js@2.49.8` | tudo — sem ele não há backend |
| `chart.umd.js` | `chart.js@4.4.8` | gráficos (Dashboard, Projetos, Bolsistas) |
| `mammoth.browser.min.js` | `mammoth@1.8.0` | DOCX → HTML, Plano de Trabalho |
| `xlsx.full.min.js` | `xlsx@0.18.5` (SheetJS) | planilha de bolsas, Reconciliação |
| `pdf.min.js` | `pdfjs-dist@3.11.174` | PDF → texto, balancete e plano em PDF |
| `pdf.worker.min.js` | `pdfjs-dist@3.11.174` | worker do pdf.js — **tem que ser da mesma versão** |

O worker do pdf.js é escolhido em tempo de execução: `index.html` aponta
`workerSrc` para a cópia local **somente** quando o próprio `pdf.min.js` veio
daqui. Apontar para o CDN nesse caso derrubaria o worker junto, e o pdf.js cairia
no "fake worker" (parse na thread principal), travando a tela na importação de
balancete.

O CSP permite as duas origens: `worker-src 'self' https://cdn.jsdelivr.net blob:`.

## Como atualizar ou repor um arquivo

1. Baixe a versão **exata** que está no `<script>` do CDN em `index.html`:

   ```bash
   curl -fsSL -o frontend/vendor/pdf.min.js \
     https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js
   ```

2. Confira que o arquivo é o mesmo que o CDN serve, comparando com o
   `integrity` da tag:

   ```bash
   printf 'sha384-'; openssl dgst -sha384 -binary frontend/vendor/pdf.min.js | openssl base64 -A
   ```

   O resultado tem que bater **caractere por caractere** com o atributo
   `integrity` do `<script>` correspondente. Se não bater, não commite: ou a
   versão é outra, ou o arquivo foi alterado no caminho.

Ao subir de versão, mude nos **três** lugares: a URL do CDN, o `integrity` e (no
caso do pdf.js) a URL do worker. As tags de fallback não têm `integrity` — o
browser não valida SRI em same-origin —, então a conferência acima é a única
verificação que existe para estes arquivos.

`.gitattributes` marca `frontend/vendor/*.js` como `-text -diff`: sem isso o Git
converteria LF → CRLF no checkout em Windows, o arquivo deixaria de bater com o
upstream e a conferência do passo 2 passaria a falhar sempre.

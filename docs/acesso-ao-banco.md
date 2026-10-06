# Acesso ao banco por pessoas e por IA

> Regras para qualquer agente (Claude Code, Antigravity, Cursor, script próprio) que vá **escrever** no
> banco de produção. Complementa [`seguranca-publicacao.md`](./seguranca-publicacao.md), que trata do
> acesso de fora (role `anon`, RLS, publicação). Aqui o assunto é o acesso de dentro, com credencial
> válida — o caso em que o RLS **já foi satisfeito** e a única coisa entre um comando e um estrago é a
> disciplina de quem o escreveu.

---

## 1. As quatro credenciais, e o que cada uma alcança

Nem toda credencial deste projeto tem o mesmo poder. A confusão entre elas é a causa mais provável de
um acidente grave.

| Credencial | Onde vive | Alcance | RLS aplica? |
|---|---|---|---|
| **anon key** (`sb_publishable_…`) | `frontend/js/supabase-config.js`, repo público | o que o RLS permitir ao papel do JWT | **sim** |
| **login de usuário** (e-mail + senha) | `~/.claude.json` (bloco `env` do MCP), painel do Supabase | o que as policies derem àquele papel | **sim** |
| **senha do banco** (usada pela Supabase CLI em `--db-url`) | **só** no secret `SUPABASE_DB_URL` do cofre (`CofreIA/cofre-lapig`); trocada em 06/10/2026, ninguém no PC a tem | `DROP`, `TRUNCATE`, `ALTER` — schema inteiro | **não** |
| **service_role key** | painel do Supabase | leitura e escrita em tudo | **não** |
| **chave do cofre** (`C:\Users\amara\cofre-token.txt`) | PC | dispara e lê execuções do cofre (ensaiar/aplicar migração); não lê código nem segredos | — |

Duas leituras contraintuitivas que valem registrar:

- **A anon key não é segredo.** Ela se chama `publishable`, vai no frontend público e está no repo de
  propósito. A barreira dela é o RLS. Tratar a anon key como segredo e a senha do usuário como detalhe
  de configuração é exatamente o inverso do certo.
- **A Supabase CLI é a credencial mais perigosa, não a mais segura.** É intuitivo achar que uma
  ferramenta oficial traz proteção embutida. Ela traz *disciplina de migração* (SQL versionado, ordenado,
  revisável) — que é uma proteção real, e é a mesma que `database/001…040` já pratica. Mas a conexão
  dela é pelo `--db-url`, que **ignora o RLS por completo**. Um `db push` errado derruba tabela; nenhum
  guard `assert_project_allowed` roda ali. A CLI não substitui as regras abaixo: ela precisa mais delas.

**Desde 06/10/2026 a CLI com a senha do banco só roda dentro do cofre** (backup e aplicação de migração),
nunca no PC. Ver [`aplicar-migracao.md`](./aplicar-migracao.md).

### O papel `admin` não é contido pelo RLS

As migrações 033/034/035 escopam tudo por centro de custo — mas o desenho é para conter **professor**.
Para `admin`, `is_admin()` é true, as policies liberam todas as linhas e os guards
`assert_project_allowed` das RPCs `security definer` passam direto. Ou seja: **o RLS que este projeto
construiu não é proteção nenhuma contra um erro cometido com o login de admin.** Quem escreve com essa
credencial está sem rede.

---

## 2. Regras duras

Valem para pessoa e para IA. Não são preferências.

1. **Nunca imprimir o valor de uma credencial.** Só nomes de chave (`Object.keys(env)`). Vale para log,
   mensagem de erro e `catch` — o corpo de uma resposta de erro de login contém o que foi enviado.
   Tudo que é impresso entra no transcript da conversa e sai da máquina.
2. **`PATCH` ou `DELETE` sem filtro é proibido.** No PostgREST, `DELETE /rest/v1/projects` sem
   `?id=eq.<uuid>` apaga toda linha que a policy permitir. Esta é a única regra que separa um erro
   pequeno de um irrecuperável.
3. **Simulação e aplicação em turnos separados.** O script roda primeiro em modo seco e imprime o que
   *faria*; a pessoa lê; só então roda com `--apply`. Simular e aplicar no mesmo turno mostra o
   resultado, não a proposta — não conta.
4. **Escrever o mínimo de colunas.** `PATCH` com um único campo no corpo, nunca um objeto inteiro
   relido e devolvido. Cuidado especial com RPCs de upsert: `save_project` sobrescreve **todas** as
   colunas que nomeia, então chamá-la para mudar um campo zera vigência, notas e `active`.
5. **Trava de estado esperado.** O script confere que a linha está como se espera antes de escrever
   (id **e** nome batem, coluna alvo ainda nula) e pula a linha em vez de gravar na dúvida.
6. **`drop`, `truncate` e `delete` exigem confirmação nominal** da pessoa, na mesma conversa, dizendo
   qual objeto. "Pode limpar" não autoriza.
7. **Mudança de schema só por migração numerada** em `database/`, aplicada **pelo cofre** com o "ok" do
   Victor no chat ([`aplicar-migracao.md`](./aplicar-migracao.md)); nunca SQL avulso nem colado no SQL
   Editor. Ver a lição da migração 036: `create or replace` reescreve os atributos da função junto com o corpo.
8. **Backup antes de migração ou escrita em lote.** Na migração, o cofre faz sozinho a cada execução.
9. **Automação nunca usa o login de admin.** Ver seção 4.

---

## 3. O protocolo de escrita

Sequência mínima para qualquer escrita fora da interface do site:

```
1. ler o estado atual e mostrá-lo
2. rodar em simulação — imprimir linha a linha o que mudaria
3. [ a pessoa confere ]
4. aplicar, com filtro por id e corpo de uma coluna
5. reler e comparar: a coluna alvo mudou, as demais não
6. conferir o registro em audit_logs
```

Os passos 5 e 6 não são zelo excessivo: são o que distingue "o comando não deu erro" de "o efeito foi o
pretendido". Um `UPDATE` que zera três colunas retorna `200 OK`.

---

## 4. Login de automação

Uma rotina que escreve no banco **não** deve usar o login de admin, pelo motivo da seção 1: com ele o
RLS não contém nada, e o alcance de um erro é o banco inteiro.

O desenho correto tem duas peças, e a segunda é a que importa:

- **Login `professor`** em `app_users`, escopado em `user_projects` só aos centros de custo que a rotina
  toca. Limita o alcance a esses projetos.
- **RPC estreita** para cada coisa que a rotina escreve — `security definer`, guard
  `assert_project_allowed`, tocando uma coluna. É o padrão que `save_project` e `apply_reconciliation`
  já usam.

A segunda peça é a que muda a natureza da garantia. Com ela, o limite passa a ser **imposto pelo banco**:
não importa o que o script diga ou o que a IA erre, aquele login só consegue escrever aquela coluna.
Sem ela, o limite é a disciplina de quem escreveu o script — que é justamente o que estas regras tentam
suprir, e que nenhum documento garante.

> Ressalva honesta: `professor` é o menor privilégio **disponível hoje**, não o mínimo absoluto — ele
> ainda pode chamar `save_project` e `apply_reconciliation` nos projetos dele. Um papel `leitor` de
> verdade exigiria mexer no check constraint de `app_users` e em todas as policies.

---

## 5. Recuperação

O plano é o **free**, então não há point-in-time recovery. O que existe:

- **`audit_logs`** (migração 023) guarda `old_data` e `new_data` completos a cada INSERT/UPDATE/DELETE.
  Um valor sobrescrito é recuperável linha a linha. Mas cobre só **quatro** tabelas: `projects`,
  `scholarship_holders`, `scholarships` e `funding`. Estender às demais é um `create trigger` por tabela
  — a função `audit_trigger_function` já existe.
- **Backups do cofre** (desde 06/10/2026): toda segunda às 06:00 e a cada execução de Migração, cifrados,
  conferidos por restauração (contagens, estrutura e acesso), guardados 90 dias. Uma tarefa agendada no app do
  Claude (segunda 10h) avisa se o semanal falhar. Como restaurar: `..\cofre-lapig\README.md` (num Supabase
  novo, rodar `limpar-privilegios-padrao.sql` antes do schema). Detalhes em [`aplicar-migracao.md`](./aplicar-migracao.md).

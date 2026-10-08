# Aplicar uma migração na produção (pelo cofre)

> Leia inteiro antes de mexer no banco de produção. Vale para o Claude Code (ou outro agente) trabalhando
> nesta pasta. **O Buriti nunca faz isto**: ele só propõe (051).
>
> Desde 06/10/2026 nenhuma migração é colada no SQL Editor do Supabase. O caminho é o **cofre**:
> `CofreIA/cofre-lapig`, um repositório privado no GitHub cuja única dona é a conta pessoal do Victor
> (`v-lapig-ufg`). Ele guarda a senha do banco, faz backup e aplica migrações. Daqui do PC não se lê
> nem se altera o código dele (dá 404 ou 403); só se **disparam e leem execuções**, com uma chave
> restrita a isso.

## O que o Victor faz e o que o agente faz

O Victor não lê SQL nem código e não entra no GitHub. Ele só dá **"ok" no chat**. Tudo o mais é do agente:

1. **Escrever** a migração em `database/NNN_x.sql` seguindo as regras de "Para passar no cofre" (abaixo e
   no `CLAUDE.md`), com o roteiro de teste em `tests/sql/` e a linha em `docs/migracoes.md`.
2. **Testar localmente**, quando der, em `tools/replica-local/`.
3. **Publicar** o commit no `master` (pedir o ok do Victor para publicar; publicar não aplica nada).
4. **Revisão por outra IA** do SQL daquele commit (Codex, só leitura, pasta sem dados pessoais). Conferir o
   que ela afirmar antes de repassar.
5. **Ensaiar** no cofre (seção "Comandos").
6. **Mandar ao Victor** um resumo em português: o que muda, o que o relatório do cofre mediu (dados e
   estrutura), o que a outra IA achou e, com todas as letras, **se muda quem vê o quê**. Pedir que ninguém
   use o sistema durante a aplicação (uns 10 minutos).
6b. **Manutenção — SEMPRE, em toda aplicação (regra do Victor, 08/10/2026).** Não importa se o código
   depende ou não da migração: depois do "ok" e ANTES de disparar o `aplicar`:
   - `frontend/manutencao.json` com `{"ativo": true, "mensagem": "O Controle Financeiro está em atualização
     (<o que muda>). Volte em alguns minutos — não é preciso fazer nada."}`; commit
     `chore(site): manutenção LIGADA para aplicar a NNN` e push no `master`;
   - esperar o `deploy.yml` daquele commit terminar e conferir no ar
     (`curl -s "https://victorgit10.github.io/controle-financeiro-lapig/manutencao.json?x=$RANDOM"` → `"ativo": true`);
     o site bloqueia inclusive quem está com ele aberto em até 1 min — esperar esse minuto;
   - só então disparar o `aplicar`. Depois de aplicar **e conferir**, voltar a `{"ativo": false, "mensagem": ""}`
     no commit `chore(site): manutenção DESLIGADA — NNN aplicada em produção (dd/mm/aaaa)`, junto com o registro
     em `docs/migracoes.md`, e conferir no ar que voltou a `false`.
   - Se o aplicar falhar ou ficar INCERTO, a manutenção continua LIGADA até o Victor decidir.
7. Com o **"ok"** dele no chat (vale só para aquela migração e aquele código de aprovação): ligar a manutenção
   (6b) e **aplicar**.
8. **Conferir** o fim do log e confirmar ao Victor. Registrar a aplicação em `docs/migracoes.md` e desligar a
   manutenção (6b).

O "ok" é regra, não trava: a chave permite disparar sem ele. Nunca aplicar sem o "ok" explícito.

## Comandos

No Git Bash. A chave fica em `C:\Users\amara\cofre-token.txt` (fine-grained token da `v-lapig-ufg`, só
"Actions: read/write" no `cofre-lapig`, vence em 10/2027). **Nunca imprimir o conteúdo dela.**

```bash
export GH_TOKEN=$(tr -d '\r\n\357\273\277 ' < /c/Users/amara/cofre-token.txt)
R=CofreIA/cofre-lapig

# ensaiar (só a cópia; a produção não é tocada)
gh workflow run migracao.yml -R $R --ref main -f modo=ensaiar \
  -f commit=<sha de 40 caracteres no master> -f arquivo=database/NNN_x.sql

# achar a execução e esperar (uns 6 min ensaiar, 10 aplicar) — em segundo plano
gh run list -R $R --workflow migracao.yml --limit 1 --json databaseId,status,createdAt
gh run watch <id> -R $R --exit-status --interval 30

# ler o relatório
gh run view <id> -R $R --log | sed -n '/=== RELATORIO ===/,/=== FIM DO RELATORIO ===/p'

# aplicar (só depois do ok do Victor), com o código de aprovação do relatório
gh workflow run migracao.yml -R $R --ref main -f modo=aplicar \
  -f commit=<o mesmo> -f arquivo=<o mesmo> -f aprovacao=<código>
```

- `--ref main` é obrigatório: a chave não consegue ler qual é o ramo padrão.
- Nunca deixar um laço de espera sem saída; usar `gh run watch` em segundo plano.
- **Versão do cofre:** o passo "Buscar e ler a migração" lista `<8 hex> <caminho>` de cada arquivo do cofre.
  Ela tem de bater com `git ls-tree -r HEAD | awk '{ print substr($3, 1, 8), $4 }'` do clone local
  `..\cofre-lapig\` (ordenar as duas listas antes do `diff`). Se não bater, alguém mudou o cofre: parar e avisar.

## Como ler o relatório

- **Dados:** por tabela, quantas linhas entraram e saíram (alteração conta nos dois). ⚠️ em tabela apagada ou
  linhas que sumiram.
- **Estrutura e acesso:** o que entrou, mudou ou saiu (tabelas, funções, policies, views, gatilhos, permissões).
- **"Pede revisão técnica":** aparece quando muda policy, view, permissão de usuário logado, função
  SECURITY DEFINER, ou há DO/EXECUTE. É o sinal de que a migração mexe em quem vê o quê ou tem código cujo
  efeito o relatório não explica: a revisão da outra IA é obrigatória e o resumo ao Victor diz isso.
- **Código de aprovação:** resume o arquivo e o efeito exato. O aplicar refaz o ensaio e só segue se o código
  for o mesmo. Se o banco mudar entre o ensaio e o aplicar (alguém usou o sistema), ele para sem aplicar:
  ensaiar de novo.

## Quando dá erro

- **Recusado na leitura:** o arquivo usa algo proibido (lista abaixo). Corrigir a migração, novo commit, ensaiar de novo.
- **Ensaio falhou com "COFRE: ..."**: a migração piora a segurança (acesso sem login, tabela sem RLS ou sem a
  barreira do agente, função de segurança alterada, papel/extensão/gatilho de evento novo...). Corrigir.
- **Ensaio falhou com outro ERROR:** erro de SQL ou asserção da própria migração; nada foi aplicado.
- **"A produção recusou e desfez tudo"**: nada mudou. Ler a mensagem.
- **"Resultado INCERTO"** (conexão caiu): parar, avisar o Victor, não reaplicar sem entender. O backup de
  antes daquela execução está nos Artifacts do cofre.
- **"Aplicada, mas o efeito foi diferente do ensaio"**: avisar o Victor na hora; o backup está nos Artifacts.

## Para passar no cofre

- `BEGIN` só como primeiro comando e `COMMIT` só como último (o cofre os retira e controla a transação);
  nada de COMMIT/SAVEPOINT no meio, `CREATE INDEX CONCURRENTLY`, VACUUM, gatilho adiável.
- Nada de papéis, extensões, `ALTER DEFAULT PRIVILEGES`, COPY, `set role`/`search_path` de sessão; nem as
  palavras `net.`, `http(`, `dblink`, `cron.`, `vault.`, `password`, `service_role`, `event trigger`,
  `deferr` no texto.
- Tabela nova: RLS ligado; `revoke ... from anon` (tabela e função); o gatilho `trg_bloqueia_agente`
  **BEFORE INSERT OR UPDATE OR DELETE FOR EACH STATEMENT**, sem WHEN, chamando
  `public.bloqueia_escrita_do_agente()`. SECURITY DEFINER sempre com `set search_path`.
- Não tocar `is_agente`, `is_admin`, `allowed_project_ids`, `assert_project_allowed`, `contem_cpf`,
  `bloqueia_escrita_do_agente` (o cofre recusa).
- Até 90 KB.

## Quando o próprio cofre precisa mudar

O agente não consegue alterar o cofre (é o que o protege). Mudança no cofre = editar o clone local
`..\cofre-lapig\`, testar com `..\Projeto Regente\cofre-testes\`, commit local e entregar ao Victor os
arquivos para ele colar no GitHub pela `v-lapig-ufg`, com os links de edição. Evitar: cada mudança custa
atenção dele. Depois, conferir a versão pela lista de arquivos no log.

## Backup e recuperação

- Backup semanal (segunda 06:00) e um backup a cada execução de Migração, cifrados, guardados 90 dias nos
  Artifacts do cofre. A senha de decifrar está só com o Victor, fora do PC.
- Uma tarefa agendada no app do Claude (segunda 10h) confere se o backup rodou e avisa se falhou.
- Restaurar: README do cofre (`..\cofre-lapig\README.md`). Num Supabase novo, rodar
  `scripts/limpar-privilegios-padrao.sql` antes do `schema.sql`, senão as funções ficam abertas a anon.

# Roteiros SQL de conferência

Scripts para validar as RPCs e funções do banco **rodando**, não lendo. Não são
testes automatizados: rodam à mão no SQL Editor do Supabase (ou contra a réplica
local) e a saída é lida por uma pessoa.

Existem porque parte dos defeitos deste banco só aparece em execução. O caso que
justificou a prática: `get_project_alerts` ficou quebrada por quase um mês
depois da migração 032 — plpgsql resolve nome de tabela só em **runtime**, então
a função continuou existindo, passando no linter e sobrevivendo a qualquer
inspeção estática; só falhava quando alguém pedia um alerta. Ver
[`../../docs/historico/bug-hunt-2026-07-16.md`](../../docs/historico/bug-hunt-2026-07-16.md).

| Roteiro | Cobre | Pré-requisito |
|---|---|---|
| [`test_rpcs.sql`](test_rpcs.sql) | `calc_project_monthly`, `save_editor_changes`, `get_alerts_for_projects` | usa IDs reais do banco |
| [`test_saldo_livre.sql`](test_saldo_livre.sql) | `get_saldo_livre` — o saldo livre por grupo bate com o cálculo no papel | migração 038 |
| [`test_simular_alocacao.sql`](test_simular_alocacao.sql) | `simular_alocacao` — as três restrições e os vereditos | migrações 038 + 039 |
| [`test_panorama.sql`](test_panorama.sql) | reparo de `get_project_alerts` + `get_panorama` | migração 040 |
| [`test_041_drive_folder.sql`](test_041_drive_folder.sql) | `set_project_drive_folder`, `set_project_code`, auditoria estendida | migração 041 |

## Como rodar

**Cada bloco é autossuficiente.** O SQL Editor do Supabase não preserva
`set_config` entre execuções, então um roteiro escrito como um script contínuo
falharia a partir do segundo bloco — cada um refaz o próprio contexto.

Os roteiros que trocam de identidade (para conferir o escopo do RLS) precisam de
UUIDs reais de usuário e de projeto. Substitua os placeholders **no editor**,
nunca no arquivo versionado: o repositório é público e esses identificadores não
entram nele.

> ⚠️ `test_041_drive_folder.sql` **escreve e apaga dados**. Rode só no container
> descartável do nível sintético
> ([`tools/replica-local/README.md`](../../tools/replica-local/README.md)),
> nunca contra produção. Os demais são de leitura.

Para os ambientes de teste local (sintético, réplica raspada de PII e stack
Supabase completa), ver
[`tools/replica-local/README.md`](../../tools/replica-local/README.md).

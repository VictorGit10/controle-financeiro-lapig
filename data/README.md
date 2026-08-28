# Dados de referência (não versionados)

Fonte original dos dados legados, usada uma única vez para popular o banco.

## `DadosDoDashBoardAtual.xlsx`

Planilha do dashboard LAPIG anterior à migração — projetos, bolsistas,
desembolsos e gastos. Alimenta `database/utils/generate_import_sql.py`, que
gerou `database/005_import_real_data.sql`.

**O arquivo não está no repositório.** O `.gitignore` exclui `*.xlsx`, e por dois
motivos independentes: a planilha traz nomes de bolsistas (o repositório é
público) e é um binário grande que não ganha nada com versionamento. Quem
precisar reexecutar o gerador tem que colocar a planilha aqui manualmente.

O resultado da importação — o SQL gerado — está versionado e é o que importa:
o `005` já foi expurgado de nomes reais (ver o histórico do repositório).

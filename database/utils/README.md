# Utilitários do Banco de Dados

Scripts auxiliares para geração e validação de dados SQL. Não são migrations — devem ser executados manualmente quando necessário.

## check_dupes.py

Verifica duplicatas de UUID na primeira coluna dos INSERTs do script `005_import_real_data.sql`.

```bash
python database/utils/check_dupes.py
```

Dependências: Python 3 (stdlib apenas).

## generate_import_sql.py

Gera o script `database/005_import_real_data.sql` a partir da planilha `data/DadosDoDashBoardAtual.xlsx`.

```bash
pip install openpyxl
python database/utils/generate_import_sql.py
```

Dependências: Python 3, `openpyxl`.
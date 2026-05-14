# extract-plano-trabalho (DEPRECATED)

> **⚠️ Deprecated desde 2026-05.** O frontend deixou de chamar esta função. A extração agora é feita 100% no browser por `frontend/js/parsers/pt-parser.js` (DOCX → mammoth → HTML → parser determinístico, sem IA). A tabela canônica "Plano de Aplicação dos Recursos Financeiros" precisa estar presente no DOCX (modelo UFG/FUNAPE), caso contrário o upload é abortado com erro claro — sem fallback automático.

Edge Function que extrai dados estruturados de um Plano de Trabalho UFG/FUNAPE usando o Ollama Cloud (`kimi-k2.6:cloud`).

## Deploy

```bash
# 1. Definir a API key do Ollama Cloud (uma vez por ambiente)
supabase secrets set OLLAMA_API_KEY=<sua-chave>

# 2. Deploy
supabase functions deploy extract-plano-trabalho

# (As variáveis SUPABASE_URL e SUPABASE_ANON_KEY são injetadas
# automaticamente pelo runtime do Supabase.)
```

## Uso

```http
POST /functions/v1/extract-plano-trabalho
Authorization: Bearer <sb-access-token>
Content-Type: application/json

{ "text": "<conteúdo bruto do DOCX>" }
```

Resposta `200`:

```json
{
  "data": {
    "titulo": "...",
    "coordenador": "...",
    "prazo_inicio": "2025-07-01",
    "prazo_fim": "2026-07-01",
    "valor_total_plano": 693000.00,
    "valor_despesas_projeto": 512820.00,
    "valor_cip": 110880.00,
    "valor_dao": 69300.00,
    "receita_origem": "...",
    "rubricas": [
      { "rubrica_code": "a.bolsas", "descricao_livre": null, "valor_previsto": 396000.00 }
    ],
    "desembolsos": [
      { "parcela": 1, "data_prevista": "2025-07-01", "data_texto": "Julho/25", "valor": 138600.00, "valor_texto": "R$ 138.600,00" }
    ]
  },
  "warnings": [],
  "raw_extraction": { ... }
}
```

## Auth

Exige JWT válido do Supabase (qualquer usuário autenticado). A função NÃO bypassa RLS.

# extract-balancete (DEPRECATED)

> **⚠️ Deprecated desde 2026-05.** O frontend deixou de chamar esta função. A extração agora é feita 100% no browser por `frontend/js/parsers/balancete-parser.js` (regex puro, sem IA, sem latência). Esta função permanece deployada como fallback histórico, mas não é invocada pela UI.

Edge Function que extrai dados estruturados de um Balancete Contábil Analítico da FUNAPE (PDF) usando o Ollama Cloud (`kimi-k2.6:cloud`).

## Deploy

```bash
# A mesma OLLAMA_API_KEY usada pela extract-plano-trabalho:
supabase functions deploy extract-balancete
```

## Uso

```http
POST /functions/v1/extract-balancete
Authorization: Bearer <sb-access-token>
Content-Type: application/json

{ "text": "<texto extraído do PDF via pdf.js no browser>" }
```

Resposta:
```json
{
  "data": {
    "project_code": "30.099",
    "data_referencia": "2026-05-07",
    "data_emissao": "2026-05-08",
    "saldo_disponivel": 318179.67,
    "rendimento_liquido": 13704.23,
    "total_debitos": 2755379.63,
    "total_creditos": 2755379.63,
    "lancamentos": [
      { "conta_codigo": "7.1.3.02", "conta_descricao": "DIÁRIAS", "valor_debito": 21496.58, "valor_credito": 0, "saldo_atual": 21496.58 }
    ]
  },
  "warnings": [],
  "raw_extraction": { ... }
}
```

## Auth

Exige JWT válido do Supabase. Não bypassa RLS.

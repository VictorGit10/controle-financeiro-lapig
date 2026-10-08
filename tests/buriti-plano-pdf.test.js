import { describe, it, expect, vi } from 'vitest';
vi.mock('../mcp/src/buriti-proposta.js', () => ({ textoDoPdf: vi.fn() }));
import { textoDoPdf } from '../mcp/src/buriti-proposta.js';
import { lerPlano } from '../mcp/src/buriti-plano-leitura.js';
import { parsePtFromPdfText } from '../frontend/js/parsers/pt-pdf-parser.js';
const texto = `Plano de trabalho sintético PROAD/UFG
Data do documento: 08/10/2026
Plano de Aplicação dos Recursos Financeiros
1 - Receita Total 1.200,00
2 - Previsão de Despesas Total 1.200,00
a- Pessoal Total 800,00
Bolsas 800,00
b- Serviços de Terceiros P. Jurídica Total 400,00
Serviço sintético 400,00
III - Equipe executora
Pessoa sintética 123.456.789-09`;
describe('Leitura de PDF assinado', () => {
  it('entrega o texto do pdf.js ao mesmo parser do site, sem roster', async () => {
    textoDoPdf.mockResolvedValue(texto);
    const bytes = Buffer.from('PDF sintético (extração de texto dublê)');
    const ex = await lerPlano(bytes, 'assinado.PDF');
    expect(textoDoPdf).toHaveBeenCalledWith(bytes);
    expect(ex).toEqual(parsePtFromPdfText(texto));
    expect(ex.data.valor_total_plano).toBe(1200);
    expect(ex.data.data_documento).toBe('2026-10-08');
    expect(JSON.stringify(ex)).not.toContain('123.456.789-09');
  });
});

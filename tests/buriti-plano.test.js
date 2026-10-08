import { describe, it, expect } from 'vitest';
import mammoth from 'mammoth';
import { Window } from 'happy-dom';
const DOMParser = new Window().DOMParser;
import { montarPropostaPlano } from '../mcp/src/buriti-proposta.js';
import { lerPlano } from '../mcp/src/buriti-plano-leitura.js';
import { parsePtFromHtml, PtFormatError, extractDataDocumento } from '../frontend/js/parsers/pt-parser.js';
import { docxSintetico } from './helpers/plano-sintetico.js';

const extraido = () => ({ data: {
  data_documento: '2026-10-08', valor_total_plano: 1200,
  rubricas: [{ rubrica_code: 'e', descricao_livre: 'Material sintético', valor_previsto: 1200 }],
  desembolsos: [],
}, warnings: [] });
const montar = (op = {}) => montarPropostaPlano({
  extraido: extraido(), arquivoNome: 'sintetico.docx', tipo: 'remanejamento', ...op,
});
function browserParse(html) {
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
  Object.defineProperty(globalThis, 'DOMParser', { value: DOMParser, configurable: true, writable: true });
  try { return parsePtFromHtml(html); }
  finally {
    if (anterior) Object.defineProperty(globalThis, 'DOMParser', anterior);
    else delete globalThis.DOMParser;
  }
}

describe('montarPropostaPlano (dados sintéticos)', () => {
  it('preserva números do parser, usa chave estável e não muta entrada', () => {
    const ex = extraido(), original = structuredClone(ex);
    const p = montar({ extraido: ex });
    expect(p.ok).toBe(true);
    expect(p.payload).toMatchObject({ versao: 1, tipo: 'remanejamento', arquivo_nome: 'sintetico.docx' });
    expect(p.payload.extraido).toEqual(ex);
    expect(ex).toEqual(original);
    expect(p.chave).toBe('remanejamento:2026-10-08');
    delete ex.data.data_documento;
    expect(montar({ extraido: ex }).chave).toBe('remanejamento:sintetico.docx');
  });
  it('total diferente é aviso com os dois valores, nunca bloqueio ou recálculo', () => {
    const p = montar({ planoAtivo: { valor_total_plano: 1000 } });
    expect(p.ok).toBe(true);
    expect(p.payload.avisos.join(' ')).toMatch(/1.000,00.*1.200,00/);
    expect(p.payload.extraido.data.valor_total_plano).toBe(1200);
    expect(p.payload.conferencias.total_remanejamento_diverge).toBe(true);
    expect(montar({ planoAtivo: { valor_total_plano: 1200 } }).payload.avisos).toEqual([]);
    expect(montar({ planoAtivo: { valor_total_plano: null } }).payload.conferencias.total_remanejamento_diverge).toBeNull();
    expect(montar().payload.conferencias.total_remanejamento_diverge).toBeNull();
  });
  it('original com plano e documento anterior geram avisos independentes', () => {
    const p = montar({ tipo: 'original', planoAtivo: {
      valor_total_plano: 1000, data_documento: '2026-10-09',
    } });
    expect(p.ok).toBe(true);
    expect(p.payload.avisos).toHaveLength(2);
    expect(p.payload.avisos.join(' ')).toContain('original');
    expect(p.payload.avisos.join(' ')).toMatch(/08\/10\/2026.*09\/10\/2026/);
    expect(p.payload.conferencias.data_anterior_ao_plano_ativo).toBe(true);
    expect(montar({ planoAtivo: { data_documento: '2026-10-08' } }).payload.conferencias.data_anterior_ao_plano_ativo).toBe(false);
  });
  it('leva conferência de soma já feita pelo parser', () => {
    const ex = extraido();
    ex.warnings.push('A soma das rubricas (1200.00) não bate com o total declarado no plano (1300.00). Confira antes de salvar.');
    const p = montar({ extraido: ex });
    expect(p.ok).toBe(true);
    expect(p.payload.avisos).toEqual(ex.warnings);
    expect(p.payload.conferencias.soma_rubricas_diverge).toBe(true);
  });
  it.each(['123.456.789-09', '12345678909'])('recusa CPF sintético em campo financeiro (%s), sem ecoá-lo', cpf => {
    const ex = extraido();
    ex.data.rubricas[0].descricao_livre = 'Material ' + cpf;
    const p = montar({ extraido: ex });
    expect(p.ok).toBe(false);
    expect(p.problemas.join(' ')).toContain('CPF');
    expect(p.payload).toBeUndefined();
    expect(JSON.stringify(p)).not.toContain(cpf);
  });
  it('CPF em aviso ou nome de arquivo também falha antes de criar payload', () => {
    const ex = extraido(); ex.warnings.push('Aviso 123.456.789-09');
    expect(montar({ extraido: ex }).ok).toBe(false);
    expect(montar({ arquivoNome: '12345678909.docx' }).ok).toBe(false);
    expect(montar({ arquivoNome: '123456789090.docx' }).ok).toBe(true);
  });
  it('nenhuma lista de equipe/participantes/HTML vai para o payload', () => {
    const ex = extraido();
    ex.data.equipe = [{ nome: 'Pessoa sintética' }]; ex.data.participantes = ex.data.equipe;
    ex._html = '<p>Equipe</p>';
    const p = montar({ extraido: ex });
    expect(p.payload.extraido.data.equipe).toBeUndefined();
    expect(p.payload.extraido.data.participantes).toBeUndefined();
    expect(p.payload.extraido._html).toBeUndefined();
    expect(JSON.stringify(p.payload)).not.toContain('Pessoa sintética');
  });
  it('recusa tipo inválido e documento sem rubricas', () => {
    expect(montar({ tipo: 'aporte' }).ok).toBe(false);
    expect(montar({ extraido: { data: { rubricas: [] }, warnings: [] } }).ok).toBe(false);
  });
});

describe('DOCX PROAD sintético no Node', () => {
  it('extrai o mesmo que o site sobre o HTML real do mammoth, sem a equipe', async () => {
    const bytes = docxSintetico();
    const { value: html } = await mammoth.convertToHtml({ buffer: bytes });
    const ex = await lerPlano(bytes, 'sintetico.DOCX');
    expect(ex).toEqual(browserParse(html));
    expect(ex.data.valor_total_plano).toBe(1200);
    expect(ex.data.data_documento).toBe('2026-10-08');
    expect(ex.data.prazo_inicio).toBe('2026-01-01');
    expect(ex.data.prazo_fim).toBe('2026-12-31');
    expect(ex.data.valor_cip).toBe(100);
    expect(ex.data.valor_dao).toBe(60);
    expect(ex.data.rubricas.map(r => r.valor_previsto)).toEqual([800, 400]);
    const p = montar({ extraido: ex });
    expect(p.ok).toBe(true);
    expect(JSON.stringify(p.payload)).not.toMatch(/123.456.789|equipe|participantes/i);
  });
  it.each(['Total', '2 - Previsão de Despesas Total'])('soma diferente do total declarado gera warning nos dois consumidores (%s)', async totalLabel => {
    const bytes = docxSintetico({ total: '1.300,00', totalLabel });
    const ex = await lerPlano(bytes, 'sintetico.docx');
    expect(ex.warnings.join(' ')).toMatch(/soma das rubricas \(1200.00\).*\(1300.00\)/);
    expect(montar({ extraido: ex }).payload.conferencias.soma_rubricas_diverge).toBe(true);
    expect(ex.data.valor_total_plano).toBe(1200); // não troca a semântica vigente
  });
  it('restaura DOMParser também após PtFormatError e chamadas concorrentes', async () => {
    const anterior = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
    await Promise.all([lerPlano(docxSintetico(), 'a.docx'), lerPlano(docxSintetico(), 'b.docx')]);
    expect(Object.getOwnPropertyDescriptor(globalThis, 'DOMParser')).toEqual(anterior);
    await expect(lerPlano(docxSintetico({ modelo: 'prefeitura' }), 'fora.docx')).rejects.toBeInstanceOf(PtFormatError);
    expect(Object.getOwnPropertyDescriptor(globalThis, 'DOMParser')).toEqual(anterior);
  });
  it('recusa formato sem leitor, sem conversão', async () => {
    await expect(lerPlano(Buffer.from('sintético'), 'x.xlsx')).rejects.toThrow('Não há leitor automático');
  });
});

describe('Data do documento explicitamente rotulada', () => {
  it.each([
    ['Data do documento: 08/10/2026', '2026-10-08'],
    ['Data documento: 29/02/2024', '2024-02-29'],
    ['Data do documento: 31/02/2026', null],
    ['Vigência 01/01/2026 a 31/12/2026. Assinado em 08/10/2026.', null],
  ])('não confunde vigência/assinatura ou data inválida (%s)', (texto, esperado) => {
    expect(extractDataDocumento(texto)).toBe(esperado);
  });
});

describe('Conferência do resumo PROAD com despesas, CIP e DAO (sintético)', () => {
  const linha = (rotulo, valor, forte = false) =>
    `<tr><td>${forte ? '<strong>' + rotulo + '</strong>' : rotulo}</td><td></td><td>${valor}</td></tr>`;
  function layout({ despesas = '512.820,00', rotulo = 'Previsão de despesas do projeto',
    total = '693.000,00', cip = '110.880,00', dao = '69.300,00' } = {}) {
    return `<table>${linha('Plano de Aplicação dos Recursos Financeiros', 'Valor (R$)')}
      ${linha('a-Pessoal', '396.000,00', true)}${linha('Bolsas', '396.000,00')}
      ${linha('b-Serviços de Terceiros P. Jurídica', '10.000,00', true)}
      ${linha('c-Passagens', '20.000,00', true)}${linha('d-Diárias', '26.820,00', true)}
      ${linha('e-Material de Consumo', '20.000,00', true)}${linha('f-Investimento', '40.000,00', true)}
      ${linha('Total', total)}</table>
      <table>${linha('Custos indiretos para a UFG', '55.440,00')}
      ${linha('Custos indiretos para a UA/Órgão', '55.440,00')}
      ${linha('Total', '110.880,00')}</table>
      <table>${despesas != null ? linha(rotulo, despesas) : ''}
      ${cip != null ? linha('Previsão de custos indiretos', cip) : ''}
      ${dao != null ? linha('D.A.O da Fundação', dao) : ''}
      ${linha('Total do plano', total)}</table>`;
  }
  const avisosDeSoma = ex => ex.warnings.filter(w => w.startsWith('A soma das rubricas'));

  it.each(['Previsão de despesas do projeto', '1 - Previsão de despesas',
    '2 - Previsão de despesas do projeto'])('prioriza despesas sem confundir total geral/subtotal CIP (%s)', rotulo => {
    const ex = browserParse(layout({ rotulo }));
    expect(ex.data.valor_total_plano).toBe(512820);
    expect(ex.data.rubricas.map(r => r.valor_previsto)).toEqual([396000, 10000, 20000, 26820, 20000, 40000]);
    expect(avisosDeSoma(ex)).toEqual([]);
    expect(montar({ extraido: ex }).payload.conferencias.soma_rubricas_diverge).toBe(false);
  });
  it('avisa divergência real de despesas mesmo que rubricas + CIP + DAO fechem o total geral', () => {
    const ex = browserParse(layout({ despesas: '512.821,00' }));
    expect(avisosDeSoma(ex)).toHaveLength(1);
    expect(avisosDeSoma(ex)[0]).toMatch(/512820.00.*512821.00/);
    expect(ex.data.valor_total_plano).toBe(512820);
  });
  it('só com total geral aceita rubricas + CIP + DAO declarados', () => {
    const ex = browserParse(layout({ despesas: null }));
    expect(ex.data.valor_total_plano).toBe(512820);
    expect(avisosDeSoma(ex)).toEqual([]);
  });
  it('avisa divergência real do total geral também após incluir CIP e DAO', () => {
    const ex = browserParse(layout({ despesas: null, total: '694.000,00' }));
    expect(avisosDeSoma(ex)).toHaveLength(1);
    expect(avisosDeSoma(ex)[0]).toMatch(/512820.00.*694000.00.*693000.00/);
  });
  it.each(['cip', 'dao'])('não supõe zero quando %s não foi lido', campo => {
    const ex = browserParse(layout({ despesas: null, [campo]: null }));
    expect(avisosDeSoma(ex)).toHaveLength(1);
    expect(avisosDeSoma(ex)[0]).not.toContain('Com CIP e DAO declarados');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
vi.mock('../mcp/src/client.js', () => ({ rpc: vi.fn(), consultar: vi.fn(), armazenar: vi.fn() }));
vi.mock('../mcp/src/operador.js', () => ({ rpcOperador: vi.fn() }));
vi.mock('../mcp/src/buriti-plano-leitura.js', () => ({ lerPlano: vi.fn() }));
import { rpc, consultar, armazenar } from '../mcp/src/client.js';
import { lerPlano } from '../mcp/src/buriti-plano-leitura.js';
import { proporPlano } from '../mcp/src/buriti.js';
import { PtFormatError } from '../frontend/js/parsers/pt-parser.js';
let pasta, caminho;
const ex = () => ({ data: { valor_total_plano: 1200,
  rubricas: [{ rubrica_code: 'e', descricao_livre: 'Material sintético', valor_previsto: 1200 }],
  desembolsos: [] }, warnings: [] });
beforeEach(async () => {
  vi.resetAllMocks();
  await mkdir(resolve('.cache'), { recursive: true });
  pasta = await mkdtemp(resolve('.cache/test-plano-'));
  caminho = join(pasta, 'sintetico.docx'); await writeFile(caminho, 'bytes sintéticos');
  lerPlano.mockResolvedValue(ex());
  consultar.mockImplementation(async (_nome, buscar) => {
    const q = { select: vi.fn(() => q), eq: vi.fn(() => q) };
    buscar({ from: () => q });
    expect(q.eq).toHaveBeenCalledWith('code', '56.X');
    return [{ id: 'projeto-x', name: 'Projeto sintético' }];
  });
  rpc.mockImplementation(async nome => nome === 'get_plano_ativo'
    ? { valor_total_plano: 1000 } : 'proposta-x');
  armazenar.mockImplementation(async (_bucket, path) => path);
});
afterEach(async () => { await rm(pasta, { recursive: true, force: true }); });
const entrada = () => ({ caminho, centro_de_custo: '56.X', tipo: 'remanejamento' });
describe('proporPlano (banco e storage dublês, arquivo sintético)', () => {
  it('simula sem upload nem criar_proposta, com avisos do plano ativo', async () => {
    const p = await proporPlano({ ...entrada(), simular: true });
    expect(p).toMatchObject({ criada: false, simulacao: true, centro: 'Projeto sintético' });
    expect(p.avisos.join(' ')).toMatch(/1.000,00.*1.200,00/);
    expect(armazenar).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map(c => c[0])).toEqual(['get_plano_ativo']);
  });
  it.each(['docx', 'pdf'])('anexa %s na pasta do centro e envia chave e payload corretos', async ext => {
    caminho = join(pasta, 'sintetico.' + ext); await writeFile(caminho, 'bytes sintéticos');
    const p = await proporPlano(entrada());
    expect(p).toMatchObject({ criada: true, proposta_id: 'proposta-x' });
    expect(armazenar).toHaveBeenCalledWith('propostas-agente', expect.stringMatching(/^projeto-x\//),
      expect.any(Buffer), ext === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(rpc).toHaveBeenLastCalledWith('criar_proposta', expect.objectContaining({
      p_tipo: 'plano', p_project_id: 'projeto-x', p_chave: 'remanejamento:sintetico.' + ext,
      p_arquivo_path: armazenar.mock.calls[0][1],
      p_payload: expect.objectContaining({ tipo: 'remanejamento', extraido: ex() }),
    }));
  });
  it('recusa PtFormatError com a mensagem do modelo e não consulta/grava', async () => {
    lerPlano.mockRejectedValue(new PtFormatError('Modelo Prefeitura: sem tabela PROAD.', 'prefeitura-fomento'));
    expect(await proporPlano(entrada())).toEqual({ criada: false, motivo: 'Modelo Prefeitura: sem tabela PROAD.' });
    expect(consultar).not.toHaveBeenCalled(); expect(armazenar).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it('recusa outro formato antes de abrir ou converter o arquivo', async () => {
    expect(await proporPlano({ ...entrada(), caminho: join(pasta, 'nao-existe.xlsx') }))
      .toMatchObject({ criada: false, motivo: expect.stringContaining('Não há leitor automático') });
    expect(lerPlano).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it('CPF extraído falha antes de upload ou consulta; não ecoa o dado', async () => {
    const e = ex(); e.warnings = ['CPF sintético 123.456.789-09']; lerPlano.mockResolvedValue(e);
    const p = await proporPlano(entrada());
    expect(p).toMatchObject({ criada: false, motivo: expect.stringContaining('CPF') });
    expect(JSON.stringify(p)).not.toContain('123.456.789-09');
    expect(consultar).not.toHaveBeenCalled(); expect(armazenar).not.toHaveBeenCalled();
  });
  it('falha ao ler plano ativo não vira ausência nem aviso de zero', async () => {
    rpc.mockRejectedValue(new Error('Consulta indisponível'));
    await expect(proporPlano(entrada())).rejects.toThrow('Consulta indisponível');
    expect(armazenar).not.toHaveBeenCalled();
  });
  it('código é obrigatório, tipo explícito; falhas de arquivo propagam', async () => {
    await expect(proporPlano({ ...entrada(), centro_de_custo: '' })).rejects.toThrow('centro de custo');
    await expect(proporPlano({ ...entrada(), tipo: 'outro' })).rejects.toThrow('Tipo do plano');
    await expect(proporPlano({ ...entrada(), caminho: join(pasta, 'nao-existe.docx') })).rejects.toThrow('ENOENT');
    expect(armazenar).not.toHaveBeenCalled();
  });
});

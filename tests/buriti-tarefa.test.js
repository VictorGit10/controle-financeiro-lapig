import { describe, it, expect, vi } from 'vitest';
import { criarToolsTarefas, montarPayloadTarefa } from '../mcp/src/buriti-tarefa.js';
import { seloPrazo, ordenarTarefas, saudeVigia, gmailLink } from '../frontend/js/components/buriti-tarefas.js';

describe('selos e ordenação do Buriti', () => {
  const hoje = new Date(2026, 9, 6, 23, 59);
  it('conta dias de calendário, inclusive virada de mês/ano e ano bissexto', () => {
    expect(seloPrazo('2026-10-18', hoje).texto).toBe('faltam 12 dias');
    expect(seloPrazo('2026-10-07', hoje).texto).toBe('faltam 1 dia');
    expect(seloPrazo('2026-10-06', hoje).texto).toBe('vence hoje');
    expect(seloPrazo('2026-10-04', hoje).texto).toBe('vencida há 2 dias');
    expect(seloPrazo('2026-10-05', hoje).texto).toBe('vencida há 1 dia');
    expect(seloPrazo('2027-01-01', new Date(2026, 11, 31)).texto).toBe('faltam 1 dia');
    expect(seloPrazo('2024-03-01', new Date(2024, 1, 28)).texto).toBe('faltam 2 dias');
    expect(seloPrazo(null).texto).toBe('Sem prazo');
  });
  it('ordena vencidas primeiro e sem prazo por último sem alterar a entrada', () => {
    const tarefas = [{ id: 'c', prazo: null }, { id: 'b', prazo: '2026-10-08' }, { id: 'a', prazo: '2026-10-01' }];
    expect(ordenarTarefas(tarefas).map(t => t.id)).toEqual(['a', 'b', 'c']);
    expect(tarefas[0].id).toBe('c');
  });
  it('mede saúde pela última execução concluída e alerta só após duas horas', () => {
    const agora = new Date('2026-10-06T12:00:00Z');
    expect(saudeVigia(null, agora)).toEqual({ texto: 'vigia nunca rodou', atrasado: true });
    expect(saudeVigia({ terminada_em: '2026-10-06T11:48:00Z' }, agora).texto).toBe('Vigia: última checagem há 12 min');
    expect(saudeVigia({ terminada_em: '2026-10-06T10:00:00Z' }, agora).atrasado).toBe(false);
    expect(saudeVigia({ terminada_em: '2026-10-06T09:59:59Z' }, agora).atrasado).toBe(true);
    expect(saudeVigia({ terminada_em: '2026-10-06T09:00:00Z' }, agora).texto).toContain('vigia atrasado');
  });
  it('links Gmail codificam o identificador como parte do caminho', () => {
    expect(gmailLink(null)).toBeNull();
    expect(gmailLink('a/"#b')).toBe('https://mail.google.com/mail/u/0/#all/a%2F%22%23b');
  });
});

const ID = '12345678-1234-1234-1234-123456789012';
const entrada = { titulo: ' Implantar bolsas ', passos: [{ descricao: ' Atualizar quadro ', quem: '[P1]', evidencia: { tipo: 'email', contem_todos: ['30.068'] } }],
  prazo: '2026-10-30', chaves: [{ tipo: 'centro_custo', valor: '30.068' }] };

describe('tools de tarefas sem rede', () => {
  it('monta o contrato p da 054, sem campos externos ao payload', () => {
    const payload = montarPayloadTarefa({ ...entrada, centro_de_custo: '30.068', status: 'concluida' }, ID);
    expect(payload).toEqual({ project_id: ID, titulo: 'Implantar bolsas', passos: [{ ...entrada.passos[0], descricao: 'Atualizar quadro' }], prazo: entrada.prazo, chaves: entrada.chaves });
  });
  it('exige projeto, título e de 1 a 50 passos', () => {
    expect(() => montarPayloadTarefa(entrada, null)).toThrow('project_id');
    expect(() => montarPayloadTarefa({ ...entrada, titulo: ' ' }, ID)).toThrow('Título');
    expect(() => montarPayloadTarefa({ ...entrada, passos: [] }, ID)).toThrow('passos');
    expect(() => montarPayloadTarefa({ ...entrada, passos: [{ descricao: '' }] }, ID)).toThrow('Descrição');
    expect(() => montarPayloadTarefa({ ...entrada, passos: Array(51).fill(entrada.passos[0]) }, ID)).toThrow('50');
  });
  it('resolve código e só cria uma proposta; UUID não exige consulta de centros', async () => {
    const rpc = vi.fn().mockResolvedValue('proposta');
    const centroPorCodigo = vi.fn().mockResolvedValue({ id: ID });
    const tools = criarToolsTarefas({ rpc, centroPorCodigo });
    const resultado = await tools.proporTarefa({ ...entrada, centro_de_custo: '30.068' });
    expect(centroPorCodigo).toHaveBeenCalledWith('30.068');
    expect(rpc).toHaveBeenCalledWith('propor_tarefa', { p: montarPayloadTarefa(entrada, ID) });
    expect(resultado.proximo_passo).toContain('Victor aplica');
    centroPorCodigo.mockClear();
    await tools.proporTarefa({ ...entrada, project_id: ID });
    expect(centroPorCodigo).not.toHaveBeenCalled();
  });
  it('propaga falhas de RPC ou de escopo', async () => {
    const tools = criarToolsTarefas({ rpc: vi.fn().mockRejectedValue(new Error('CPF recusado')), centroPorCodigo: vi.fn().mockRejectedValue(new Error('fora do escopo')) });
    await expect(tools.proporTarefa({ ...entrada, project_id: ID })).rejects.toThrow('CPF recusado');
    await expect(tools.proporTarefa({ ...entrada, centro_de_custo: '30.068' })).rejects.toThrow('escopo');
  });
  it('lista pelo banco com filtro antes do limite e eventos limitados por tarefa, sem remetentes ou regras técnicas', async () => {
    const chamadas = [];
    const rows = [{ id: ID, tarefa_passos: [], eventos: [{ resumo: 'Passo sugerido' }] }];
    const q = { then: resolve => resolve(rows) };
    for (const m of ['select', 'order', 'limit', 'eq', 'in']) q[m] = (...args) => { chamadas.push([m, ...args]); return q; };
    const from = vi.fn().mockReturnValue(q);
    const consultar = async (nome, fn) => fn({ from });
    const tools = criarToolsTarefas({ consultar, centroPorCodigo: async () => ({ id: ID }) });
    const result = await tools.listarTarefas({ centro_de_custo: '30.068' });
    expect(result.tarefas).toBe(rows);
    expect(from).toHaveBeenCalledWith('tarefas');
    expect(chamadas).toContainEqual(['in', 'status', ['em_andamento', 'aguardando_terceiro']]);
    expect(chamadas).toContainEqual(['eq', 'project_id', ID]);
    expect(chamadas).toContainEqual(['limit', 10, { referencedTable: 'eventos' }]);
    const select = chamadas.find(c => c[0] === 'select')[1];
    expect(select).not.toMatch(/vigia_mensagens|remetente|evidencia|\*/);
    chamadas.length = 0;
    expect((await tools.listarTarefas({ status: 'concluidas', limite: 1 })).truncado).toBe(true);
    expect(chamadas).toContainEqual(['eq', 'status', 'concluida']);
  });
});

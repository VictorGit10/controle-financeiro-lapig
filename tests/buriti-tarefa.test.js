import { describe, it, expect, vi } from 'vitest';
import { criarToolsTarefas, montarPayloadTarefa } from '../mcp/src/buriti-tarefa.js';
import { seloPrazo, ordenarTarefas, saudeVigia, gmailLink, textoComLinks, validarFeito, registroFeito, podeRegistrarFeito } from '../frontend/js/components/buriti-tarefas.js';

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
    const payload = montarPayloadTarefa({ ...entrada, centro_de_custo: '30.068', status: 'concluida', responsavel_id: 'proibido' }, ID);
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
    expect(result.tarefas).toEqual(rows);
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


describe('responsável: funções puras e contrato MCP', () => {
  it('linkifica texto escapado, sem transformar HTML ou javascript em execução', () => {
    const html = textoComLinks('<img src=x onerror=alert(1)> Veja https://exemplo.invalid/doc?a=1&b=2. javascript:alert(1)');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('href="https://exemplo.invalid/doc?a=1&amp;b=2"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('href="javascript:');
    expect(textoComLinks('https://pessoa:senha@exemplo.invalid')).not.toContain('<a');
  });
  it('exige nota e restringe link opcional ao HTTPS e aos limites', () => {
    expect(validarFeito(' Feito ', ' ')).toEqual({ p_nota: 'Feito', p_link: null });
    expect(validarFeito('a'.repeat(2000), 'https://exemplo.invalid')).toHaveProperty('p_link', 'https://exemplo.invalid');
    for (const nota of ['', '   ', 'a'.repeat(2001)]) expect(() => validarFeito(nota)).toThrow('nota');
    for (const link of ['javascript:alert(1)', 'http://exemplo.invalid', 'https://', 'https://host/ espaço', 'https://host/' + 'a'.repeat(500)]) {
      expect(() => validarFeito('Feito', link)).toThrow('https://');
    }
  });
  it('só responsável ou admin podem registrar em tarefa aberta', () => {
    expect(podeRegistrarFeito({ status: 'em_andamento', responsavel_id: 'eu' }, 'eu')).toBe(true);
    expect(podeRegistrarFeito({ status: 'aguardando_terceiro' }, 'admin', true)).toBe(true);
    expect(podeRegistrarFeito({ status: 'em_andamento', responsavel_id: 'outro' }, 'eu')).toBe(false);
    expect(podeRegistrarFeito({ status: 'em_andamento' }, undefined)).toBe(false);
    for (const status of ['cancelada', 'concluida']) expect(podeRegistrarFeito({ status, responsavel_id: 'eu' }, 'eu', true)).toBe(false);
  });
  it('MCP devolve nome e último feito por FK mesmo que esteja fora dos eventos recentes', async () => {
    const feito = { tipo: 'sugestao', origem: 'humano', detalhe: { nota: 'Enviei', link: 'https://exemplo.invalid/doc', por: 'Arthur Pietro', email: 'não sai' } };
    const rows = [{ id: ID, responsavel: 'Arthur Pietro', tarefa_passos: [{ id: 'passo', estado: 'confirmado', feito }], eventos: Array(10).fill({ tipo: 'nota' }) }];
    let campos;
    const q = { then: resolve => resolve(rows) };
    for (const m of ['order', 'limit', 'in']) q[m] = () => q;
    q.select = v => { campos = v; return q; };
    const from = vi.fn().mockReturnValue(q);
    const tools = criarToolsTarefas({ consultar: async (_, fn) => fn({ from }) });
    const result = await tools.listarTarefas();
    expect(result.tarefas[0].responsavel).toBe('Arthur Pietro');
    expect(result.tarefas[0].tarefa_passos[0].feito).toEqual({ nota: 'Enviei', link: 'https://exemplo.invalid/doc', por: 'Arthur Pietro' });
    expect(campos).toContain('feito:tarefa_eventos!ultimo_feito_id');
    expect(campos).not.toContain('app_users');
    expect(from).toHaveBeenCalledTimes(1);
    expect(rows[0].tarefa_passos[0].feito).toBe(feito);
  });
  it('não projeta endereços pessoais nem confunde sugestão do vigia com feito', () => {
    expect(registroFeito({ feito: { tipo: 'sugestao', origem: 'vigia', detalhe: { por: 'Vigia' } } })).toBeNull();
    expect(registroFeito({ feito: { tipo: 'sugestao', origem: 'humano', detalhe: {
      por: 'pessoa@exemplo.invalid', nota: 'Escrevi para pessoa@exemplo.invalid', link: 'https://exemplo.invalid/pessoa@exemplo.invalid',
    } } })).toEqual({ por: '[Retido]', nota: '[Retido]', link: null });
  });
});

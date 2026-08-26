/* ============================================================
   Laço de tool calling — o miolo da fase 3
   ============================================================
   O laço é a peça que só falha em produção: prompt e schema dão
   para ler, mas "o modelo pediu uma tool, o resultado voltou no
   formato certo, ele respondeu" só se verifica executando. Aqui
   o modelo e o banco são dublês — o que está sob teste é a
   mecânica do protocolo, não a qualidade da resposta.

   Os quatro casos que importam, e por quê:

   - ida e volta de tool: se a mensagem de resultado sair com o
     papel ou o nome errado, o modelo não casa a resposta com a
     chamada e responde no vazio;
   - erro de tool VOLTA como resultado, não como exceção: nome
     ambíguo ("cerrado" batendo em três centros) é recuperável, e
     estourar aqui jogaria no usuário um trabalho que a máquina
     resolve;
   - `arguments` como string: a API nativa do Ollama manda
     objeto, mas modelo treinado no formato da OpenAI manda
     string, e quem só testa com um dos dois quebra com o outro;
   - teto de rodadas: sem ele, modelo em laço queima crédito em
     silêncio.
   ============================================================ */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { conversar, conversaNova } from '../frontend/js/ai/agent.js';

/** Fila de respostas do "modelo": cada invoke consome a próxima. */
let respostas = [];
let enviados = [];
let rpcChamadas = [];

function fakeSupabase() {
  return {
    functions: {
      invoke(_nome, { body }) {
        if (body.acao === 'modelos') {
          return Promise.resolve({ data: { modelos: ['m1'], padrao: 'm1' }, error: null });
        }
        // Cópia, não referência: o laço continua acrescentando no MESMO array
        // de mensagens depois desta chamada, e guardar a referência faria toda
        // asserção sobre "o que foi enviado na rodada N" enxergar o estado
        // final. (Em produção não há esse risco: `functions.invoke` serializa o
        // corpo antes de o laço voltar a mexer no array.)
        enviados.push(structuredClone(body));
        const proxima = respostas.shift();
        if (!proxima) throw new Error('dublê sem resposta na fila');
        return Promise.resolve({ data: proxima, error: null });
      },
    },
    rpc(fn, args) {
      rpcChamadas.push({ fn, args });
      return Promise.resolve({ data: { centros: [], resumo: { centros: 0 } }, error: null });
    },
    from() {
      throw new Error('não deveria consultar tabela neste teste');
    },
  };
}

beforeEach(() => {
  respostas = [];
  enviados = [];
  rpcChamadas = [];
  globalThis.window = { supabaseClient: fakeSupabase() };
});

afterEach(() => {
  delete globalThis.window;
});

const perguntar = (texto) => [...conversaNova(), { role: 'user', content: texto }];

describe('ida e volta de uma tool', () => {
  it('executa a RPC e devolve a resposta em texto', async () => {
    respostas = [
      { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'panorama', arguments: {} } }] } },
      { message: { role: 'assistant', content: 'Quatro centros de custo ativos.' } },
    ];

    const eventos = [];
    const r = await conversar({
      mensagens: perguntar('como estão os projetos?'),
      modelo: 'm1',
      onEvento: (ev) => eventos.push(ev.tipo),
    });

    expect(r.conteudo).toBe('Quatro centros de custo ativos.');
    expect(rpcChamadas).toEqual([
      { fn: 'get_panorama', args: { p_project_ids: null, p_incluir_inativos: false } },
    ]);
    expect(eventos).toEqual(['pensando', 'tool', 'tool_ok', 'pensando']);
  });

  it('acrescenta o resultado como mensagem de papel "tool" com o nome da tool', async () => {
    respostas = [
      { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'panorama', arguments: {} } }] } },
      { message: { role: 'assistant', content: 'pronto' } },
    ];

    await conversar({ mensagens: perguntar('e aí?'), modelo: 'm1' });

    // Segunda ida ao modelo: já leva a mensagem de resultado.
    const segunda = enviados[1].messages;
    const msgTool = segunda[segunda.length - 1];
    expect(msgTool.role).toBe('tool');
    expect(msgTool.tool_name).toBe('panorama');
    expect(JSON.parse(msgTool.content)).toHaveProperty('resumo');
  });

  it('registra o passo com o resultado, para a tela poder mostrar o JSON', async () => {
    respostas = [
      { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'panorama', arguments: {} } }] } },
      { message: { role: 'assistant', content: 'ok' } },
    ];

    const r = await conversar({ mensagens: perguntar('x'), modelo: 'm1' });
    expect(r.passos).toHaveLength(1);
    expect(r.passos[0].nome).toBe('panorama');
    expect(r.passos[0].ok).toBe(true);
    expect(r.passos[0].resultado).toHaveProperty('resumo');
  });
});

describe('argumentos', () => {
  it('aceita objeto (formato nativo do Ollama)', async () => {
    respostas = [
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'panorama', arguments: { incluir_inativos: true } } }],
        },
      },
      { message: { role: 'assistant', content: 'ok' } },
    ];

    await conversar({ mensagens: perguntar('x'), modelo: 'm1' });
    expect(rpcChamadas[0].args.p_incluir_inativos).toBe(true);
  });

  it('aceita string JSON (formato da OpenAI) e devolve o tool_call_id quando existe', async () => {
    respostas = [
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_1', function: { name: 'panorama', arguments: '{"incluir_inativos":true}' } },
          ],
        },
      },
      { message: { role: 'assistant', content: 'ok' } },
    ];

    await conversar({ mensagens: perguntar('x'), modelo: 'm1' });
    expect(rpcChamadas[0].args.p_incluir_inativos).toBe(true);

    const segunda = enviados[1].messages;
    expect(segunda[segunda.length - 1].tool_call_id).toBe('call_1');
  });
});

describe('erro de tool', () => {
  it('volta ao modelo como resultado, sem derrubar a conversa', async () => {
    respostas = [
      { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'inventada', arguments: {} } }] } },
      { message: { role: 'assistant', content: 'Não consegui — essa consulta não existe.' } },
    ];

    const r = await conversar({ mensagens: perguntar('x'), modelo: 'm1' });

    expect(r.conteudo).toContain('Não consegui');
    expect(r.passos[0].ok).toBe(false);
    expect(r.passos[0].erro).toContain('Tool desconhecida');

    const segunda = enviados[1].messages;
    const msgTool = segunda[segunda.length - 1];
    expect(msgTool.role).toBe('tool');
    expect(JSON.parse(msgTool.content).erro).toContain('Tool desconhecida');
  });
});

describe('limites', () => {
  it('para no teto de rodadas e diz que parou', async () => {
    const pedindoTool = {
      message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'panorama', arguments: {} } }] },
    };
    respostas = Array.from({ length: 10 }, () => structuredClone(pedindoTool));

    const r = await conversar({ mensagens: perguntar('x'), modelo: 'm1' });

    expect(r.estourou).toBe(true);
    expect(r.conteudo).toContain('Parei após');
    expect(enviados).toHaveLength(6);
  });

  it('avisa quando a resposta foi cortada no limite de contexto', async () => {
    respostas = [{ message: { role: 'assistant', content: 'O saldo é' }, done_reason: 'length' }];

    const r = await conversar({ mensagens: perguntar('x'), modelo: 'm1' });
    expect(r.conteudo).toContain('Resposta interrompida no limite de contexto');
  });
});

describe('erro de transporte', () => {
  it('desembrulha a mensagem que a Edge Function devolveu no corpo', async () => {
    globalThis.window.supabaseClient.functions.invoke = () =>
      Promise.resolve({
        data: null,
        error: {
          message: 'Edge Function returned a non-2xx status code',
          context: { status: 400, json: async () => ({ error: 'Modelo "x" não está liberado.' }) },
        },
      });

    await expect(conversar({ mensagens: perguntar('x'), modelo: 'x' })).rejects.toThrow(
      'Modelo "x" não está liberado.'
    );
  });

  it('explica o 404 como falta de deploy', async () => {
    globalThis.window.supabaseClient.functions.invoke = () =>
      Promise.resolve({
        data: null,
        error: {
          message: 'Edge Function returned a non-2xx status code',
          context: { status: 404, json: async () => { throw new Error('não é JSON'); } },
        },
      });

    await expect(conversar({ mensagens: perguntar('x'), modelo: 'm1' })).rejects.toThrow(
      /supabase functions deploy assistente/
    );
  });
});

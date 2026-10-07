// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { escapeAttr, escapeAttrJs } from '../frontend/js/pure-fns.js';
import * as f from '../frontend/js/components/buriti-tarefas.js';

const controlador = readFileSync(resolve('frontend/js/pages/buriti-tarefas.js'), 'utf8');
const pagina = readFileSync(resolve('frontend/js/pages/buriti.js'), 'utf8');
let db, erros, chamadas, root, page, admin, modal;
const tarefa = (id = 't1') => ({ id, titulo: `Tarefa ${id}`, status: 'em_andamento', prazo: '2026-10-30',
  precisa_atencao: true, motivo_atencao: 'Revisar sugestão', projects: { code: '30.068' },
  tarefa_passos: [{ id: `p-${id}`, ordem: 1, descricao: 'Enviar documento', estado: 'sugerido',
    evento: { resumo: '<img src=x onerror=alert(1)>', gmail_thread_id: 'thread1' } }],
  eventos: [{ resumo: 'Documento recebido', origem: 'vigia', ocorrido_em: '2026-10-06T12:00:00Z', gmail_thread_id: 'thread1' }] });

function from(tabela) {
  const filtros = [], log = [tabela]; chamadas.push(log);
  let single = false, inicio = 0, fim = Infinity;
  const q = {};
  for (const nome of ['select', 'order', 'limit', 'eq', 'neq', 'in', 'gte', 'not', 'range', 'single']) {
    q[nome] = (...args) => {
      log.push([nome, ...args]);
      if (['eq', 'neq', 'in', 'gte', 'not'].includes(nome)) filtros.push([nome, ...args]);
      if (nome === 'single') single = true;
      if (nome === 'range') [inicio, fim] = args;
      return q;
    };
  }
  q.then = (resolve, reject) => {
    let rows = db[tabela] || [];
    for (const [op, campo, valor] of filtros) {
      if (op === 'eq') rows = rows.filter(r => r[campo] === valor);
      if (op === 'neq') rows = rows.filter(r => r[campo] !== valor);
      if (op === 'in') rows = rows.filter(r => valor.includes(r[campo]));
      if (op === 'gte') rows = rows.filter(r => r[campo] >= valor);
      if (op === 'not') rows = rows.filter(r => r[campo] != null);
    }
    return Promise.resolve({ data: single ? rows[0] : rows.slice(inicio, fim + 1), error: erros[tabela] || null }).then(resolve, reject);
  };
  return q;
}

beforeEach(() => {
  db = { tarefas: [tarefa(), tarefa('t2')], propostas_agente: [], vigia_execucoes: [], vigia_mensagens: [], vigia_vinculos: [] };
  erros = {}; chamadas = []; admin = true;
  root = document.createElement('div'); document.body.append(root);
  window.BuritiTarefas = f;
  vi.stubGlobal('escapeAttr', escapeAttr); vi.stubGlobal('escapeAttrJs', escapeAttrJs);
  vi.stubGlobal('Auth', { isAdmin: () => admin }); vi.stubGlobal('Router', { register: vi.fn() });
  vi.stubGlobal('lucide', { createIcons: vi.fn() }); vi.stubGlobal('showToast', vi.fn());
  vi.stubGlobal('detalheTecnico', html => admin ? html : '');
  vi.stubGlobal('confirmAction', vi.fn().mockResolvedValue(true));
  vi.stubGlobal('createModal', opts => { modal = opts; root.insertAdjacentHTML('beforeend', opts.bodyHTML); });
  vi.stubGlobal('supabaseClient', { from, rpc: vi.fn().mockResolvedValue({ data: null, error: null }) });
  new Function(controlador)();
  page = new Function(`${pagina}\nreturn BuritiPage;`)();
});
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

describe('Tarefas no DOM', () => {
  it('renderiza estados e evidências com escape e recolhe a linha do tempo', async () => {
    db.tarefas[0].tarefa_passos.push(...['pendente', 'confirmado', 'dispensado'].map((estado, i) => ({ id: `x${i}`, ordem: i + 2, descricao: estado, estado })));
    await window.BuritiTarefasUI.tarefas(root);
    expect(root.textContent).toContain('precisa de você');
    expect(root.textContent).toContain('<img src=x');
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('a').href).toBe('https://mail.google.com/mail/u/0/#all/thread1');
    expect(root.querySelector('[data-linha-tempo]').open).toBe(false);
    expect(root.querySelector('[data-tarefa="t1"]').querySelectorAll('[data-acao="confirmar"]')).toHaveLength(2);
  });
  it('confirma e recarrega só o cartão alvo, preservando a linha do tempo', async () => {
    await window.BuritiTarefasUI.tarefas(root);
    const outro = root.querySelector('[data-tarefa="t2"]');
    root.querySelector('[data-linha-tempo]').open = true;
    supabaseClient.rpc.mockImplementation(async () => { db.tarefas[0].tarefa_passos[0].estado = 'confirmado'; return { error: null }; });
    root.querySelector('[data-acao="confirmar"]').click();
    await vi.waitFor(() => expect(root.querySelector('[data-tarefa="t1"]').textContent).toContain('Confirmado'));
    expect(supabaseClient.rpc).toHaveBeenCalledWith('confirmar_passo', { p_passo: 'p-t1', p_nota: null });
    expect(root.querySelector('[data-tarefa="t2"]')).toBe(outro);
    expect(root.querySelector('[data-linha-tempo]').open).toBe(true);
  });
  it('erro de ação fica no cartão, sem remover os demais', async () => {
    await window.BuritiTarefasUI.tarefas(root);
    supabaseClient.rpc.mockResolvedValue({ error: { message: 'Passo encerrado.' } });
    root.querySelector('[data-acao="dispensar"]').click();
    await vi.waitFor(() => expect(root.textContent).toContain('Passo encerrado.'));
    expect(root.querySelectorAll('[data-tarefa]')).toHaveLength(2);
  });
  it('concluir pede confirmação e remove a tarefa do filtro aberto', async () => {
    await window.BuritiTarefasUI.tarefas(root);
    confirmAction.mockResolvedValueOnce(false);
    root.querySelector('[data-acao="concluir"]').click();
    await vi.waitFor(() => expect(confirmAction).toHaveBeenCalled());
    expect(supabaseClient.rpc).not.toHaveBeenCalled();
    supabaseClient.rpc.mockImplementation(async () => { db.tarefas[0].status = 'concluida'; return { error: null }; });
    root.querySelector('[data-acao="concluir"]').click();
    await vi.waitFor(() => expect(root.querySelectorAll('[data-tarefa]')).toHaveLength(1));
    expect(supabaseClient.rpc).toHaveBeenCalledWith('concluir_tarefa', { p_tarefa: 't1', p_nota: null });
    await window.BuritiTarefasUI.tarefas(root, 'concluidas');
    expect(root.textContent).toContain('Concluída');
    expect(root.querySelector('[data-acao="concluir"]')).toBeNull();
  });
  it('registra nota com o contrato exato e valida texto vazio', async () => {
    await window.BuritiTarefasUI.tarefas(root);
    root.querySelector('[data-acao="nota"]').click();
    await expect(modal.onSave()).rejects.toThrow('Escreva');
    document.getElementById('buriti-nota').value = 'Revisar amanhã';
    await modal.onSave();
    expect(supabaseClient.rpc).toHaveBeenCalledWith('registrar_nota', { p_tarefa: 't1', p_texto: 'Revisar amanhã' });
  });
  it('falha de leitura tem banner e nunca se apresenta como ausência de tarefas', async () => {
    erros.tarefas = { message: 'rede indisponível' };
    await window.BuritiTarefasUI.tarefas(root);
    expect(root.textContent).toContain('Não foi possível consultar as tarefas');
    expect(root.textContent).not.toContain('Nenhuma tarefa');
  });
  it('pagina sem omitir a tarefa que ultrapassa o primeiro lote', async () => {
    db.tarefas = Array.from({ length: 201 }, (_, i) => tarefa(`t${i}`));
    await window.BuritiTarefasUI.tarefas(root);
    expect(root.querySelectorAll('[data-tarefa]')).toHaveLength(201);
    expect(chamadas.filter(c => c[0] === 'tarefas')).toHaveLength(2);
  });
});

describe('Triagem, saúde e propostas', () => {
  const mensagem = (id, fila, vinculos = []) => ({ gmail_message_id: id, gmail_thread_id: `thread-${id}`, fila,
    recebida_em: new Date().toISOString(), assunto: `Assunto ${id}`, trecho: 'Trecho mascarado', motivo: 'duvida', estado: 'processada', vigia_vinculos: vinculos });
  it('mantém múltiplos vínculos independentes e rotina recolhida; RPC rejeita só o par escolhido', async () => {
    db.vigia_mensagens = [mensagem('m1', 'tarefa', [
      { tarefa_id: 't1', estado: 'sugerido', tarefas: { titulo: 'Primeira' } },
      { tarefa_id: 't2', estado: 'sugerido', tarefas: { titulo: 'Segunda' } },
    ]), mensagem('m2', 'rotina'), mensagem('m3', 'esclarecer')];
    db.vigia_vinculos = [{ gmail_message_id: 'm1', tarefa_id: 't1', estado: 'sugerido' }];
    await window.BuritiTarefasUI.triagem(root);
    expect(root.querySelectorAll('[data-pendentes] [data-msg]')).toHaveLength(2);
    expect(root.querySelector('.buriti-rotina').open).toBe(false);
    expect(root.querySelectorAll('[data-msg="m1"] [data-acao="aceitar"]')).toHaveLength(2);
    supabaseClient.rpc.mockImplementation(async () => { db.vigia_mensagens[0].vigia_vinculos[0].estado = 'rejeitado'; return { error: null }; });
    root.querySelector('[data-msg="m1"] [data-acao="rejeitar"]').click();
    await vi.waitFor(() => expect(root.querySelectorAll('[data-msg="m1"] [data-acao="aceitar"]')).toHaveLength(1));
    expect(supabaseClient.rpc).toHaveBeenCalledWith('vincular_mensagem', { p_msg: 'm1', p_tarefa: 't1', p_aceitar: false });
  });
  it('marca rotina por RPC e move só aquela mensagem para auditoria', async () => {
    db.vigia_mensagens = [mensagem('m1', 'esclarecer')];
    await window.BuritiTarefasUI.triagem(root);
    supabaseClient.rpc.mockImplementation(async () => { db.vigia_mensagens[0].fila = 'rotina'; return { error: null }; });
    root.querySelector('[data-acao="rotina"]').click();
    await vi.waitFor(() => expect(root.querySelector('[data-rotina] [data-msg]')).not.toBeNull());
    expect(supabaseClient.rpc).toHaveBeenCalledWith('revisar_mensagem', { p_msg: 'm1', p_fila: 'rotina' });
    expect(root.querySelector('.buriti-rotina > summary').textContent).toContain('(1)');
  });
  it('aceita vínculo, revisa fila e retira a mensagem do grupo pendente', async () => {
    db.vigia_mensagens = [mensagem('m1', 'esclarecer', [{ tarefa_id: 't1', estado: 'sugerido', tarefas: { titulo: 'Primeira' } }])];
    await window.BuritiTarefasUI.triagem(root);
    supabaseClient.rpc.mockImplementation(async (nome, args) => {
      if (nome === 'vincular_mensagem') db.vigia_mensagens[0].vigia_vinculos[0].estado = 'confirmado';
      if (nome === 'revisar_mensagem') db.vigia_mensagens[0].fila = args.p_fila;
      return { error: null };
    });
    root.querySelector('[data-acao="aceitar"]').click();
    await vi.waitFor(() => expect(root.querySelector('[data-msg]')).toBeNull());
    expect(supabaseClient.rpc).toHaveBeenNthCalledWith(1, 'vincular_mensagem', { p_msg: 'm1', p_tarefa: 't1', p_aceitar: true });
    expect(supabaseClient.rpc).toHaveBeenNthCalledWith(2, 'revisar_mensagem', { p_msg: 'm1', p_fila: 'tarefa' });
  });
  it('rotina rejeita cada sugestão N:N antes de revisar a fila', async () => {
    db.vigia_mensagens = [mensagem('m1', 'esclarecer', [
      { tarefa_id: 't1', estado: 'sugerido', tarefas: { titulo: 'Primeira' } },
      { tarefa_id: 't2', estado: 'sugerido', tarefas: { titulo: 'Segunda' } },
    ])];
    await window.BuritiTarefasUI.triagem(root);
    supabaseClient.rpc.mockImplementation(async (nome, args) => {
      if (nome === 'vincular_mensagem') db.vigia_mensagens[0].vigia_vinculos.find(v => v.tarefa_id === args.p_tarefa).estado = 'rejeitado';
      else db.vigia_mensagens[0].fila = args.p_fila;
      return { error: null };
    });
    root.querySelector('[data-acao="rotina"]').click();
    await vi.waitFor(() => expect(root.querySelector('[data-rotina] [data-msg]')).not.toBeNull());
    expect(supabaseClient.rpc).toHaveBeenNthCalledWith(1, 'vincular_mensagem', { p_msg: 'm1', p_tarefa: 't1', p_aceitar: false });
    expect(supabaseClient.rpc).toHaveBeenNthCalledWith(2, 'vincular_mensagem', { p_msg: 'm1', p_tarefa: 't2', p_aceitar: false });
    expect(supabaseClient.rpc).toHaveBeenNthCalledWith(3, 'revisar_mensagem', { p_msg: 'm1', p_fila: 'rotina' });
  });
  it('releitura preserva vínculo aceito quando a segunda RPC falha e mantém erro no cartão', async () => {
    db.vigia_mensagens = [mensagem('m1', 'esclarecer', [{ tarefa_id: 't1', estado: 'sugerido', tarefas: { titulo: 'Primeira' } }])];
    await window.BuritiTarefasUI.triagem(root);
    supabaseClient.rpc.mockImplementation(async nome => {
      if (nome === 'vincular_mensagem') { db.vigia_mensagens[0].vigia_vinculos[0].estado = 'confirmado'; return { error: null }; }
      return { error: { message: 'falha de revisão da fila' } };
    });
    root.querySelector('[data-acao="aceitar"]').click();
    await vi.waitFor(() => expect(root.querySelector('[data-msg]').textContent).toContain('falha de revisão da fila'));
    expect(root.querySelector('[data-acao="aceitar"]')).toBeNull();
  });
  it('falha parcial da triagem avisa e preserva o grupo que carregou', async () => {
    db.vigia_mensagens = [mensagem('m1', 'esclarecer')]; erros.vigia_vinculos = { message: 'falha vínculos' };
    await window.BuritiTarefasUI.triagem(root);
    expect(root.textContent).toContain('Não foi possível consultar vínculos sugeridos');
    expect(root.textContent).toContain('Assunto m1');
  });
  it('professor não consulta triagem nem saúde e não vê a aba', async () => {
    admin = false;
    await page.load(root);
    expect(root.querySelector('[role="tablist"]').textContent).not.toContain('Triagem');
    expect(root.textContent).toContain('saúde indisponível');
    expect(chamadas.some(c => c[0] === 'vigia_execucoes')).toBe(false);
    await page.trocarSecao('triagem');
    await window.BuritiTarefasUI.triagem(root);
    expect(chamadas.some(c => c[0] === 'vigia_mensagens')).toBe(false);
  });
  it('saúde distingue nunca rodou de consulta com falha e filtra checagens concluídas', async () => {
    await window.BuritiTarefasUI.saude(root);
    expect(root.textContent).toContain('vigia nunca rodou');
    expect(chamadas[0]).toContainEqual(['eq', 'tipo', 'checagem']);
    expect(chamadas[0]).toContainEqual(['not', 'terminada_em', 'is', null]);
    erros.vigia_execucoes = { message: 'sem rede' };
    await window.BuritiTarefasUI.saude(root);
    expect(root.textContent).toContain('Não foi possível consultar a saúde');
    expect(root.textContent).not.toContain('nunca rodou');
  });
  it('proposta de tarefa exibe passos e aplica pela RPC 054', async () => {
    db.propostas_agente = [{ id: 'prop', tipo: 'tarefa', status: 'pendente', resumo: 'Implantar bolsa', payload: { passos: [{ descricao: 'Cadastrar no Conecta' }] } }];
    await page.load(root);
    expect(root.textContent).toContain('Cadastrar no Conecta');
    expect(root.textContent).toContain('Criar tarefa');
    supabaseClient.rpc.mockImplementation(async () => { db.propostas_agente[0].status = 'aplicada'; return { error: null }; });
    await page.criarTarefa('prop');
    expect(supabaseClient.rpc).toHaveBeenCalledWith('aplicar_proposta_tarefa', { p_id: 'prop' });
    expect(root.querySelector('[data-proposta]')).toBeNull();
  });
});

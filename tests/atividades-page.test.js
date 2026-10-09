// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { escapeAttr, escapeAttrJs } from '../frontend/js/pure-fns.js';
import * as f from '../frontend/js/components/buriti-tarefas.js';

const controlador = readFileSync(resolve('frontend/js/pages/buriti-tarefas.js'), 'utf8');
const pagina = readFileSync(resolve('frontend/js/pages/atividades.js'), 'utf8');
let db, erros, chamadas, root, admin, eu;
const hoje = new Date();
const dia = n => { const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const passo = (id, estado = 'pendente', descricao = 'Fazer') => ({ id: 'p-' + id, ordem: 1, descricao, quem: null, executor: 'pessoa', estado });
const tarefa = (id, extra = {}) => ({ id, titulo: 'Tarefa ' + id, status: 'em_andamento', prazo: null, situacao: null,
  precisa_atencao: false, aviso_responsavel: null, responsavel: 'Victor Amaral', responsavel_id: 'victor',
  projects: { code: '30.068', name: 'CEMPA FAPEG' }, tarefa_passos: [passo(id)], eventos: [], criada_em: '2026-10-01', ...extra });

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
  db = {
    tarefas: [
      tarefa('vencida', { prazo: dia(-2), titulo: 'Prorrogação', responsavel: 'arthurpietro.lapig', responsavel_id: 'arthur' }),
      tarefa('minha', { titulo: 'Remanejamento de rubricas', tarefa_passos: [passo('minha', 'pendente', 'Remanejar rubricas')] }),
      tarefa('fora', { status: 'aguardando_terceiro', titulo: 'Ofício da FAPEG', projects: { code: '30.110', name: 'CEMPA SECTI' } }),
    ],
    projects: [{ id: 'p106', code: '30.106', name: 'Parques Urbanos' }, { id: 'p68', code: '30.068', name: 'CEMPA FAPEG' }],
    app_users: [{ user_id: 'victor', display_name: 'Victor Amaral', role: 'admin' }, { user_id: 'arthur', display_name: 'arthurpietro.lapig', role: 'professor' }],
  };
  erros = {}; chamadas = []; admin = true; eu = 'victor';
  document.body.innerHTML = '<li data-minhas-tarefas hidden></li><li data-minhas-status hidden></li>';
  root = document.createElement('div'); document.body.append(root);
  window.BuritiTarefas = f;
  vi.stubGlobal('escapeAttr', escapeAttr); vi.stubGlobal('escapeAttrJs', escapeAttrJs);
  vi.stubGlobal('Auth', { isAdmin: () => admin, getUser: () => ({ id: eu }) });
  vi.stubGlobal('Router', { register: vi.fn() });
  vi.stubGlobal('lucide', { createIcons: vi.fn() }); vi.stubGlobal('showToast', vi.fn());
  vi.stubGlobal('detalheTecnico', html => html);
  vi.stubGlobal('confirmAction', vi.fn().mockResolvedValue(true));
  vi.stubGlobal('createModal', vi.fn());
  vi.stubGlobal('supabaseClient', { from, rpc: vi.fn(async (nome, args) => {
    if (nome === 'concluir_tarefa') db.tarefas.find(t => t.id === args.p_tarefa).status = 'concluida';
    if (nome === 'confirmar_passo') db.tarefas.flatMap(t => t.tarefa_passos).find(s => s.id === args.p_passo).estado = 'confirmado';
    if (nome === 'criar_tarefa_na_tela') {
      db.tarefas.push(tarefa('nova', { titulo: args.p.titulo, prazo: args.p.prazo, responsavel_id: args.p_responsavel }));
      return { data: 'nova', error: null };
    }
    return { data: null, error: null };
  }) });
  new Function(controlador)();
  new Function(pagina)();
});
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

const grupos = () => [...root.querySelectorAll('.ativ__grupo')].map(g => [g.querySelector('.ativ__cabeca').firstChild.textContent.trim(),
  [...g.querySelectorAll('.ativ__titulo')].map(t => t.firstChild.textContent.trim())]);

describe('tela de Atividades', () => {
  it('agrupa por urgência, mostra próximo passo, prazo e responsável', async () => {
    await window.AtividadesPage.render(root);
    expect(grupos()).toEqual([['Precisa de atenção', ['Prorrogação']], ['Em andamento', ['Remanejamento de rubricas']],
      ['Esperando alguém', ['Ofício da FAPEG']]]);
    const minha = root.querySelector('[data-id="minha"]');
    expect(minha.querySelector('.ativ__proximo').textContent).toContain('Remanejar rubricas');
    expect(minha.querySelector('.ativ__quem').textContent).toBe('Você');
    expect(root.querySelector('[data-id="vencida"] .ativ__prazo').textContent).toBe('venceu há 2 dias');
    expect(root.querySelector('[data-id="vencida"] .ativ__quem').textContent).toBe('Arthurpietro.lapig');
    expect([...root.querySelectorAll('[data-filtro]')].map(b => b.textContent.replace(/\s+/g, ' ').trim()))
      .toEqual(['Tudo 3', 'Comigo 2', 'Com Arthurpietro.lapig 1']);
  });
  it('filtra por responsável e agrupa por projeto', async () => {
    await window.AtividadesPage.render(root);
    root.querySelector('[data-filtro="arthur"]').click();
    expect(root.querySelectorAll('.ativ__item')).toHaveLength(1);
    root.querySelector('[data-filtro="todos"]').click();
    root.querySelector('[data-vista="projeto"]').click();
    await vi.waitFor(() => expect(grupos().map(g => g[0])).toEqual(['30.068', '30.110']));
  });
  it('abre o cartão completo e concluir confirma o passo em aberto e tira da lista', async () => {
    await window.AtividadesPage.render(root);
    root.querySelector('[data-id="minha"] [data-abrir]').click();
    const detalhe = root.querySelector('[data-id="minha"] .ativ__detalhe');
    expect(detalhe.hidden).toBe(false);
    expect(detalhe.querySelector('.buriti-cartao__topo')).toBeNull();
    detalhe.querySelector('[data-acao="concluir"]').click();
    await vi.waitFor(() => expect(root.querySelector('[data-id="minha"]')).toBeNull());
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining('O passo em aberto será confirmado'));
    const nomes = supabaseClient.rpc.mock.calls.map(c => c[0]).filter(n => n !== 'centros_das_tarefas');
    expect(nomes).toEqual(['confirmar_passo', 'concluir_tarefa']);
  });
  it('anota como no caderno e mostra a prévia antes', async () => {
    await window.AtividadesPage.render(root);
    const campo = root.querySelector('[data-anotar-texto]');
    campo.value = '30.106 pedido de salgados até 31/10 @Arthur';
    campo.dispatchEvent(new Event('input'));
    expect(root.querySelector('[data-anotar-previa]').textContent).toBe('30.106 · Pedido de salgados · até 31/10 · com arthurpietro.lapig');
    root.querySelector('[data-anotar]').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(root.querySelector('[data-id="nova"]')).not.toBeNull());
    const [, args] = supabaseClient.rpc.mock.calls.find(c => c[0] === 'criar_tarefa_na_tela');
    expect(args.p).toMatchObject({ project_id: 'p106', titulo: 'Pedido de salgados', passos: [{ descricao: 'Pedido de salgados', quem: 'arthurpietro.lapig' }] });
    expect(args.p.prazo).toMatch(/-10-31$/);
    expect(args.p_responsavel).toBe('arthur');
    expect(campo.value).toBe('');
  });
  it('entrada inválida não chama o banco', async () => {
    await window.AtividadesPage.render(root);
    root.querySelector('[data-anotar-texto]').value = 'remanejar sem centro';
    root.querySelector('[data-anotar]').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(root.querySelector('[data-anotar-previa]').classList.contains('ativ__previa--erro')).toBe(true);
    expect(supabaseClient.rpc.mock.calls.some(c => c[0] === 'criar_tarefa_na_tela')).toBe(false);
  });
  it('quem não é admin não anota e vê só a própria lista, sem filtros', async () => {
    admin = false; eu = 'arthur';
    db.tarefas = db.tarefas.filter(t => t.responsavel_id === 'arthur');
    await window.AtividadesPage.render(root);
    expect(root.querySelector('[data-anotar]')).toBeNull();
    expect(root.querySelectorAll('[data-filtro]')).toHaveLength(0);
    expect(root.querySelector('[data-id="vencida"] .ativ__quem').textContent).toBe('Você');
  });
  it('falha na consulta vira aviso, não lista vazia', async () => {
    erros.tarefas = { message: 'rede' };
    await window.AtividadesPage.render(root);
    expect(root.textContent).toContain('Não foi possível consultar as atividades');
    expect(root.textContent).not.toContain('Nenhuma atividade');
  });
});

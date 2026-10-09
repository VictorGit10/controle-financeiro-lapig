// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { escapeAttr, escapeAttrJs } from '../frontend/js/pure-fns.js';
import * as f from '../frontend/js/components/buriti-tarefas.js';

const controlador = readFileSync(resolve('frontend/js/pages/buriti-tarefas.js'), 'utf8');
const atividades = readFileSync(resolve('frontend/js/pages/atividades.js'), 'utf8');
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
  vi.stubGlobal('Auth', { isAdmin: () => admin, getUser: () => ({ id: 'arthur' }) }); vi.stubGlobal('Router', { register: vi.fn() });
  vi.stubGlobal('lucide', { createIcons: vi.fn() }); vi.stubGlobal('showToast', vi.fn());
  vi.stubGlobal('detalheTecnico', html => admin ? html : '');
  vi.stubGlobal('confirmAction', vi.fn().mockResolvedValue(true));
  vi.stubGlobal('createModal', opts => { modal = opts; root.insertAdjacentHTML('beforeend', opts.bodyHTML); });
  vi.stubGlobal('supabaseClient', { from, rpc: vi.fn().mockResolvedValue({ data: null, error: null }) });
  new Function(controlador)();
  new Function(atividades)();
  page = new Function(`${pagina}\nreturn BuritiPage;`)();
});
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

// A lista antiga (BuritiTarefasUI.tarefas) virou a tela de Atividades: a garantia de cada teste
// passa pela linha ([data-abrir] abre o cartão) mais as ações do cartão, ou pelo cartão direto.
const abrir = id => {
  root.querySelector(`[data-id="${id}"] [data-abrir]`).click();
  return root.querySelector(`[data-id="${id}"] .ativ__detalhe`);
};
const detalheDe = id => root.querySelector(`[data-id="${id}"] .ativ__detalhe`);

describe('Cartões de tarefa na tela de Atividades', () => {
  it('renderiza estados e evidências com escape e recolhe a linha do tempo', async () => {
    db.tarefas[0].tarefa_passos.push(...['pendente', 'confirmado', 'dispensado'].map((estado, i) => ({ id: `x${i}`, ordem: i + 2, descricao: estado, estado })));
    await window.AtividadesPage.render(root);
    const detalhe = abrir('t1');
    expect(detalhe.textContent).toContain('precisa de você');
    expect(detalhe.textContent).toContain('<img src=x');
    expect(detalhe.querySelector('img')).toBeNull();
    expect(detalhe.querySelector('a').href).toBe('https://mail.google.com/mail/u/0/#all/thread1');
    expect(detalhe.querySelector('[data-linha-tempo]').open).toBe(false);
    expect(detalhe.querySelectorAll('[data-acao="confirmar"]')).toHaveLength(2);
  });
  it('confirma o passo pelo cartão aberto e a tela relê a tarefa', async () => {
    await window.AtividadesPage.render(root);
    abrir('t1');
    supabaseClient.rpc.mockImplementation(async () => { db.tarefas[0].tarefa_passos[0].estado = 'confirmado'; return { error: null }; });
    detalheDe('t1').querySelector('[data-acao="confirmar"]').click();
    await vi.waitFor(() => expect(detalheDe('t1').textContent).toContain('Confirmado'));
    expect(supabaseClient.rpc).toHaveBeenCalledWith('confirmar_passo', { p_passo: 'p-t1', p_nota: null });
    // A tela nova redesenha a lista inteira depois da ação (a tarefa pode mudar de grupo), então a
    // identidade dos demais nós e o estado aberto do histórico deixaram de ser garantidos.
  });
  it('erro de ação fica no cartão, sem remover os demais', async () => {
    await window.AtividadesPage.render(root);
    abrir('t1');
    supabaseClient.rpc.mockResolvedValue({ error: { message: 'Passo encerrado.' } });
    detalheDe('t1').querySelector('[data-acao="dispensar"]').click();
    await vi.waitFor(() => expect(detalheDe('t1').textContent).toContain('Passo encerrado.'));
    expect(root.querySelectorAll('.ativ__item')).toHaveLength(2);
  });
  it('concluir pede confirmação, tira a tarefa das abertas e a concluída abre sem Concluir', async () => {
    await window.AtividadesPage.render(root);
    abrir('t1');
    confirmAction.mockResolvedValueOnce(false);
    detalheDe('t1').querySelector('[data-acao="concluir"]').click();
    await vi.waitFor(() => expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining('passo em aberto')));
    expect(supabaseClient.rpc).not.toHaveBeenCalled();
    supabaseClient.rpc.mockImplementation(async (nome, args) => {
      if (nome === 'concluir_tarefa') { const t = db.tarefas.find(x => x.id === args.p_tarefa); t.status = 'concluida'; t.concluida_em = new Date().toISOString(); }
      if (nome === 'confirmar_passo') db.tarefas.flatMap(t => t.tarefa_passos).find(s => s.id === args.p_passo).estado = 'confirmado';
      return { error: null };
    });
    detalheDe('t1').querySelector('[data-acao="concluir"]').click();
    await vi.waitFor(() => expect(root.querySelectorAll('.ativ__item')).toHaveLength(1));
    expect(supabaseClient.rpc).toHaveBeenCalledWith('confirmar_passo', { p_passo: 'p-t1', p_nota: null });
    expect(supabaseClient.rpc).toHaveBeenCalledWith('concluir_tarefa', { p_tarefa: 't1', p_nota: null });
    root.querySelector('[data-encerradas]').click();
    await vi.waitFor(() => expect(root.querySelector('[data-id="t1"]').textContent).toContain('Concluída'));
    expect(abrir('t1').querySelector('[data-acao="concluir"]')).toBeNull();
  });
  it('registra nota com o contrato exato e valida texto vazio', async () => {
    await window.AtividadesPage.render(root);
    abrir('t1');
    detalheDe('t1').querySelector('[data-acao="nota"]').click();
    await expect(modal.onSave()).rejects.toThrow('Escreva');
    document.getElementById('buriti-nota').value = 'Revisar amanhã';
    await modal.onSave();
    expect(supabaseClient.rpc).toHaveBeenCalledWith('registrar_nota', { p_tarefa: 't1', p_texto: 'Revisar amanhã' });
  });
  it('falha de leitura tem banner e nunca se apresenta como ausência de tarefas', async () => {
    erros.tarefas = { message: 'rede indisponível' };
    await window.AtividadesPage.render(root);
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    expect(root.textContent).toContain('Não foi possível consultar as atividades');
    expect(root.textContent).not.toContain('Nenhuma atividade');
  });
  it('pagina sem omitir a tarefa que ultrapassa o primeiro lote', async () => {
    db.tarefas = Array.from({ length: 201 }, (_, i) => tarefa(`t${i}`));
    await window.AtividadesPage.render(root);
    expect(root.querySelectorAll('.ativ__item')).toHaveLength(201);
    // Só a leitura paginada usa range; o menu consulta tarefas sem paginar.
    expect(chamadas.filter(c => c[0] === 'tarefas' && c.some(p => p[0] === 'range'))).toHaveLength(2);
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
    await modal.onSave();
    expect(supabaseClient.rpc).toHaveBeenCalledWith('aplicar_proposta_tarefa', { p_id: 'prop', p_responsavel: null });
    expect(root.querySelector('[data-proposta]')).toBeNull();
  });
});

describe('triagem: rótulos e ligadas automaticamente', () => {
  it('classificação vira selo legível; exigência em destaque', () => {
    expect(f.seloClassificacao('exigencia')).toEqual({ texto: 'Exigência', classe: 'badge--warning' });
    expect(f.seloClassificacao('informativo').classe).toBe('badge--info');
    expect(f.seloClassificacao(null)).toBeNull();
  });
  it('motivo técnico vira frase; desconhecido passa como veio', () => {
    expect(f.motivoLegivel('demanda_nova')).toBe('Assunto novo, sem tarefa');
    expect(f.motivoLegivel('algo_novo')).toBe('algo_novo');
    expect(f.motivoLegivel(null)).toBe('');
  });
  it('só vai para "ligadas automaticamente" o que a regra garante e não pede ação', () => {
    const v = [{ estado: 'sugerido', tarefa_id: 't1' }];
    expect(f.ligadaAutomaticamente({ motivo: 'mensagem_propria', classificacao: 'informativo', vigia_vinculos: v })).toBe(true);
    expect(f.ligadaAutomaticamente({ motivo: 'regra', classificacao: 'informativo', vigia_vinculos: v })).toBe(true);
    expect(f.ligadaAutomaticamente({ motivo: 'regra', classificacao: 'exigencia', vigia_vinculos: v })).toBe(false);
    expect(f.ligadaAutomaticamente({ motivo: 'modelo', classificacao: 'informativo', vigia_vinculos: v })).toBe(false);
    expect(f.ligadaAutomaticamente({ motivo: 'regra', classificacao: 'informativo', vigia_vinculos: [] })).toBe(false);
  });
});


describe('Atribuição e permissões no cartão', () => {
  const atribuir = () => { admin = false; db.tarefas[0].responsavel_id = 'arthur'; db.tarefas[0].responsavel = 'Arthur Pietro'; };
  it('professor vê só as próprias tarefas, com links e Atualizar, sem decisões administrativas', async () => {
    atribuir();
    // A tela nova não filtra por responsável na consulta: o RLS devolve só o escopo dele, simulado aqui.
    db.tarefas = [db.tarefas[0]];
    db.tarefas[0].descricao = 'Documento: https://exemplo.invalid/doc';
    db.tarefas[0].tarefa_passos[0].descricao = 'Enviar https://exemplo.invalid/passo';
    await window.AtividadesPage.render(root);
    expect(root.querySelectorAll('.ativ__item')).toHaveLength(1);
    const detalhe = abrir('t1');
    expect(detalhe.querySelector('a[href="https://exemplo.invalid/doc"]')).not.toBeNull();
    expect(detalhe.querySelector('a[href="https://exemplo.invalid/passo"]')).not.toBeNull();
    expect(detalhe.querySelector('[data-acao="atualizar"]')).not.toBeNull();
    expect(detalhe.textContent).toContain('Arthur Pietro ainda não atualizou.');
    expect(detalhe.querySelector('[data-acao="feito"], [data-acao="nota"], [data-acao="confirmar"], [data-acao="dispensar"], [data-acao="concluir"], [data-acao="responsavel"]')).toBeNull();
  });
  it('atualiza pelo formulário: situação, texto, passos e link; mostra a última atualização', async () => {
    atribuir();
    db.tarefas[0].tarefa_passos[0].estado = 'pendente';
    db.tarefas[0].tarefa_passos.push({ id: 'p2', ordem: 2, descricao: 'Ligar para a FUNAPE', estado: 'pendente', executor: 'pessoa' },
      { id: 'pb', ordem: 3, descricao: 'Passo do Buriti', estado: 'pendente', executor: 'buriti' });
    await window.AtividadesPage.render(root);
    abrir('t1');
    detalheDe('t1').querySelector('[data-acao="atualizar"]').click();
    await vi.waitFor(() => expect(document.getElementById('buriti-atualizar-texto')).not.toBeNull());
    expect([...document.querySelectorAll('input[name="buriti-situacao"]')].map(i => i.value)).toEqual(['em_andamento', 'esperando', 'travado', 'feito']);
    expect(document.querySelector('input[name="buriti-situacao"]:checked').value).toBe('em_andamento');
    // Só os passos de pessoa abertos podem ser marcados.
    expect([...document.querySelectorAll('input[name="buriti-passo"]')].map(i => i.value)).toEqual(['p-t1', 'p2']);
    await expect(modal.onSave()).rejects.toThrow('Escreva o que aconteceu');
    document.getElementById('buriti-atualizar-texto').value = 'Falei com fulano@funape.org.br';
    await expect(modal.onSave()).rejects.toThrow('e-mail');
    document.getElementById('buriti-atualizar-texto').value = 'Liguei; a Ranielly retorna amanhã.';
    document.getElementById('buriti-atualizar-link').value = 'javascript:alert(1)';
    await expect(modal.onSave()).rejects.toThrow('https://');
    expect(supabaseClient.rpc).not.toHaveBeenCalled();
    document.getElementById('buriti-atualizar-link').value = 'https://exemplo.invalid/doc';
    // O happy-dom não desmarca o rádio do mesmo grupo fora de <form>; o navegador desmarca.
    document.querySelector('input[name="buriti-situacao"][value="em_andamento"]').checked = false;
    document.querySelector('input[name="buriti-situacao"][value="esperando"]').checked = true;
    document.querySelector('input[name="buriti-passo"][value="p2"]').checked = true;
    supabaseClient.rpc.mockImplementation(async (nome, args) => {
      db.tarefas[0].situacao = args.p_situacao;
      db.tarefas[0].atualizacao = { tipo: 'atualizacao', origem: 'humano', ocorrido_em: '2026-10-08T14:00:00Z',
        detalhe: { situacao: args.p_situacao, texto: args.p_texto, link: args.p_link, por: 'Arthur Pietro' } };
      return { error: null };
    });
    await modal.onSave();
    expect(supabaseClient.rpc).toHaveBeenCalledWith('registrar_atualizacao', { p_tarefa: 't1', p_situacao: 'esperando',
      p_texto: 'Liguei; a Ranielly retorna amanhã.', p_link: 'https://exemplo.invalid/doc', p_passos: ['p2'] });
    await vi.waitFor(() => expect(detalheDe('t1').querySelector('.buriti-ultima').textContent).toContain('Liguei; a Ranielly retorna amanhã.'));
    expect(detalheDe('t1').querySelector('.buriti-ultima').textContent).toContain('Esperando alguém');
    expect(detalheDe('t1').querySelector('.buriti-ultima a').href).toBe('https://exemplo.invalid/doc');
  });
  it('admin vê o aviso do responsável junto do pedido manual, sem um apagar o outro', async () => {
    db.tarefas[0].motivo_atencao = 'Autorizar prorrogação'; db.tarefas[0].aviso_responsavel = 'Arthur: travado';
    db.tarefas[1].precisa_atencao = false; db.tarefas[1].aviso_responsavel = 'Arthur atualizou; confirmar';
    await window.AtividadesPage.render(root);
    const um = abrir('t1').querySelector('.buriti-bloco--aviso').textContent;
    expect(um).toContain('Autorizar prorrogação'); expect(um).toContain('Arthur: travado');
    expect(abrir('t2').querySelector('.buriti-bloco--aviso').textContent).toContain('Arthur atualizou; confirmar');
  });
  it('com um passo só, o formulário não pede para marcar passos', async () => {
    atribuir();
    await window.AtividadesPage.render(root);
    abrir('t1');
    detalheDe('t1').querySelector('[data-acao="atualizar"]').click();
    await vi.waitFor(() => expect(document.getElementById('buriti-atualizar-texto')).not.toBeNull());
    expect(document.querySelector('input[name="buriti-passo"]')).toBeNull();
    document.getElementById('buriti-atualizar-texto').value = 'Pronto.';
    document.querySelector('input[name="buriti-situacao"][value="em_andamento"]').checked = false;
    document.querySelector('input[name="buriti-situacao"][value="feito"]').checked = true;
    await modal.onSave();
    expect(supabaseClient.rpc).toHaveBeenCalledWith('registrar_atualizacao', { p_tarefa: 't1', p_situacao: 'feito',
      p_texto: 'Pronto.', p_link: null, p_passos: null });
  });
  it('formulário Atualizar empilha rótulos e campos no formulário padrão, com largura total', async () => {
    atribuir();
    const style = document.createElement('style');
    style.textContent = readFileSync(resolve('frontend/css/style.css'), 'utf8');
    await window.AtividadesPage.render(root);
    // Modal fica fora de .buriti-pagina no site: precisa do estilo global do formulário.
    document.head.append(style);
    try {
      abrir('t1');
      detalheDe('t1').querySelector('[data-acao="atualizar"]').click();
      await vi.waitFor(() => expect(document.getElementById('buriti-atualizar-texto')).not.toBeNull());
      const texto = document.getElementById('buriti-atualizar-texto');
      const link = document.getElementById('buriti-atualizar-link');
      for (const campo of [texto, link]) {
        const grupo = campo.closest('.form-group');
        expect(grupo.firstElementChild.htmlFor).toBe(campo.id);
        expect(getComputedStyle(grupo).display).toBe('flex');
        expect(getComputedStyle(grupo).flexDirection).toBe('column');
        expect(getComputedStyle(campo).width).toBe('100%');
      }
      expect(texto.closest('.form-group')).not.toBe(link.closest('.form-group'));
    } finally { style.remove(); }
  });
  it.each([true, false])('Atualizar aparece para o responsável; decisões só para o admin (admin=%s)', async perfilAdmin => {
    atribuir(); admin = perfilAdmin;
    await window.AtividadesPage.render(root);
    const detalhe = abrir('t1');
    expect(detalhe.querySelector('[data-acao="atualizar"]')).not.toBeNull();
    expect(Boolean(detalhe.querySelector('[data-acao="confirmar"]'))).toBe(perfilAdmin);
    expect(Boolean(detalhe.querySelector('[data-acao="dispensar"]'))).toBe(perfilAdmin);
    expect(detalhe.querySelector('[data-acao="feito"]')).toBeNull();
  });
  it('professor do escopo que não é responsável apenas lê', async () => {
    admin = false;
    await window.AtividadesPage.render(root);
    expect(root.querySelectorAll('.ativ__item')).toHaveLength(2);
    expect(abrir('t1').querySelector('[data-acao="atualizar"], [data-acao="confirmar"], [data-acao="concluir"], [data-acao="nota"]')).toBeNull();
  });
  it('centro fora do escopo vem só da RPC restrita e falha não vira vazio', async () => {
    atribuir(); db.tarefas[0].projects = null;
    supabaseClient.rpc.mockResolvedValue({ data: [{ tarefa_id: 't1', centro_custo: '30.068' }] });
    await window.AtividadesPage.render(root);
    expect(root.querySelector('[data-id="t1"]').textContent).toContain('30.068');
    expect(supabaseClient.rpc).toHaveBeenCalledWith('centros_das_tarefas', { p_ids: ['t1'] });
    expect(chamadas.some(c => c[0] === 'projects')).toBe(false);
    supabaseClient.rpc.mockResolvedValue({ error: { message: 'rede' } });
    await window.AtividadesPage.render(root);
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    expect(root.textContent).not.toContain('Nenhuma atividade');
  });
  it('responsável em tarefa encerrada não atualiza mais', () => {
    atribuir(); db.tarefas[0].status = 'cancelada';
    // A lista de encerradas da tela nova só consulta concluídas; a garantia ficou no cartão.
    const temp = document.createElement('div');
    temp.innerHTML = window.BuritiTarefasUI.cartao(db.tarefas[0]);
    expect(temp.textContent).toContain('Cancelada');
    expect(temp.querySelector('[data-acao="atualizar"]')).toBeNull();
  });
  it('menu só some com consulta bem-sucedida sem atribuições e expõe falha em banner', async () => {
    root.innerHTML = '<li data-minhas-tarefas hidden></li><li data-minhas-status hidden role="alert"></li>';
    await window.BuritiTarefasUI.atualizarMenu();
    // Admin vê Atividades sempre (é onde ele anota); os demais, só com tarefa atribuída.
    expect(root.querySelector('[data-minhas-tarefas]').hidden).toBe(false);
    admin = false;
    await window.BuritiTarefasUI.atualizarMenu();
    expect(root.querySelector('[data-minhas-tarefas]').hidden).toBe(true);
    atribuir();
    await window.BuritiTarefasUI.atualizarMenu();
    expect(root.querySelector('[data-minhas-tarefas]').hidden).toBe(false);
    erros.tarefas = { message: 'falha' };
    await window.BuritiTarefasUI.atualizarMenu();
    expect(root.querySelector('[data-minhas-tarefas]').hidden).toBe(false);
    expect(root.querySelector('[data-minhas-status]').hidden).toBe(false);
    expect(root.textContent).toContain('Não foi possível consultar suas tarefas');
  });
  it('admin escolhe somente humanos e chama atribuir_tarefa; falha de usuários tem banner', async () => {
    db.app_users = [{ user_id: 'arthur', display_name: 'Arthur Pietro', role: 'professor' }, { user_id: 'agente', display_name: 'Buriti', role: 'agente' }, { user_id: 'vigia', display_name: 'Vigia', role: 'automacao' }];
    await window.AtividadesPage.render(root);
    abrir('t1');
    detalheDe('t1').querySelector('[data-acao="responsavel"]').click();
    await vi.waitFor(() => expect(document.getElementById('buriti-responsavel')).not.toBeNull());
    const select = document.getElementById('buriti-responsavel');
    expect([...select.options].map(o => o.value)).toEqual(['', 'arthur']);
    select.value = 'arthur';
    await modal.onSave();
    expect(supabaseClient.rpc).toHaveBeenCalledWith('atribuir_tarefa', { p_tarefa: 't1', p_user: 'arthur' });
    erros.app_users = { message: 'Falha de usuários' };
    detalheDe('t1').querySelector('[data-acao="responsavel"]').click();
    await vi.waitFor(() => expect(root.textContent).toContain('Falha de usuários'));
  });
  it('admin vê nome, nota e link do feito para confirmar (registro antigo e atualização)', () => {
    // A garantia é do HTML do cartão: chamada direta, sem a lista.
    db.tarefas[0].tarefa_passos[0].feito = { tipo: 'sugestao', origem: 'humano', detalhe: { por: 'Arthur Pietro', nota: 'Enviei', link: 'https://exemplo.invalid/doc' } };
    const temp = document.createElement('div');
    temp.innerHTML = window.BuritiTarefasUI.cartao(db.tarefas[0]);
    expect(temp.textContent).toContain('Feito por Arthur Pietro — falta o Victor confirmar');
    expect(temp.querySelector('.buriti-evidencia').textContent).toContain('Enviei');
    expect(temp.querySelector('.buriti-evidencia a').href).toBe('https://exemplo.invalid/doc');
    // Marcado por uma atualização: o texto já está no destaque, não repete no passo.
    const detalhe = { situacao: 'feito', texto: 'Tudo enviado', por: 'Arthur Pietro' };
    db.tarefas[0].tarefa_passos[0].feito = { tipo: 'atualizacao', origem: 'humano', detalhe };
    db.tarefas[0].atualizacao = { tipo: 'atualizacao', origem: 'humano', detalhe, ocorrido_em: '2026-10-08T14:00:00Z' };
    temp.innerHTML = window.BuritiTarefasUI.cartao(db.tarefas[0]);
    expect(temp.querySelector('.buriti-ultima').textContent).toContain('Tudo enviado');
    expect(temp.querySelector('.buriti-evidencia')).toBeNull();
  });
  it('carrega encaminhamentos além dos dez recentes, com filtro por tarefa', async () => {
    db.tarefa_eventos = Array.from({ length: 205 }, (_, i) => ({ id: String(i), tarefa_id: 't1', resumo: 'Nota ' + i, origem: 'humano' }));
    db.tarefas[0].eventos = db.tarefa_eventos.slice(0, 10);
    await window.AtividadesPage.render(root);
    abrir('t1');
    detalheDe('t1').querySelector('[data-acao="historico"]').click();
    await vi.waitFor(() => expect(root.querySelectorAll('[data-eventos] li')).toHaveLength(205));
    expect(chamadas.filter(c => c[0] === 'tarefa_eventos')).toHaveLength(2);
    expect(chamadas.find(c => c[0] === 'tarefa_eventos')).toContainEqual(['eq', 'tarefa_id', 't1']);
  });
  it('aplicação da proposta envia responsável escolhido; professor não vê nem aciona aplicação', async () => {
    db.app_users = [{ user_id: 'arthur', role: 'professor', display_name: 'Arthur Pietro' }];
    db.propostas_agente = [{ id: 'prop', tipo: 'tarefa', status: 'pendente', resumo: 'Delegar', payload: { passos: [] } }];
    await page.load(root);
    await page.criarTarefa('prop');
    document.getElementById('buriti-responsavel').value = 'arthur';
    await modal.onSave();
    expect(supabaseClient.rpc).toHaveBeenCalledWith('aplicar_proposta_tarefa', { p_id: 'prop', p_responsavel: 'arthur' });
    supabaseClient.rpc.mockClear(); admin = false;
    await page.load(root);
    expect(root.textContent).not.toContain('Criar tarefa');
    await page.criarTarefa('prop');
    expect(supabaseClient.rpc).not.toHaveBeenCalled();
  });
});

describe('Propostas de plano no cartão do Buriti', () => {
  it.each(['original', 'remanejamento'])('mostra tipo %s, avisos e Revisar e aplicar; usa revisão de plano', async tipo => {
    const revisarPropostaPlano = vi.fn().mockResolvedValue(undefined);
    const revisarPropostaBalancete = vi.fn();
    vi.stubGlobal('PlanoTrabalhoPage', { revisarPropostaPlano, revisarPropostaBalancete });
    const p = { id: "plano'\"sintetico", tipo: 'plano', status: 'pendente', project_id: 'x',
      resumo: 'Plano sintético', payload: { tipo, avisos: ['Confira <valor>'] },
      arquivo_path: 'x/plano.docx' };
    db.propostas_agente = [p];
    await page.load(root);
    const botao = [...root.querySelectorAll('button')].find(b => b.textContent.includes('Revisar e aplicar'));
    expect(botao).toBeDefined();
    const acionar = vi.fn();
    new Function('BuritiPage', botao.getAttribute('onclick'))({ revisar: acionar });
    expect(acionar).toHaveBeenCalledWith(p.id);
    expect(root.textContent).toContain(tipo === 'original' ? 'Plano original' : 'Remanejamento');
    expect(root.textContent).toContain('Confira <valor>');
    expect(root.querySelector('valor')).toBeNull();
    await page.revisar(p.id);
    expect(revisarPropostaPlano).toHaveBeenCalledWith(p, expect.any(Function));
    expect(revisarPropostaBalancete).not.toHaveBeenCalled();
  });
  it('plano já decidido não mostra botão de aplicação', async () => {
    db.propostas_agente = [{ id: 'p', tipo: 'plano', status: 'aplicada', resumo: 'Sintético', payload: { tipo: 'original' } }];
    await page.load(root);
    page.trocarAba('decididas');
    await vi.waitFor(() => expect(root.textContent).toContain('Sintético'));
    expect(root.textContent).not.toContain('Revisar e aplicar');
  });
});

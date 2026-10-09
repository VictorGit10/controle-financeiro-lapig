// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { escapeAttr } from '../frontend/js/pure-fns.js';

const ler = path => readFileSync(path, 'utf8');
const appSource = ler('frontend/js/app.js').split('// Warn before')[0];
const routerSource = ler('frontend/js/router.js');
const authSource = ler('frontend/js/auth.js');
const tarefasSource = ler('frontend/js/pages/buriti-tarefas.js');
let role, centros, tarefas, erroTarefas, sessionUser, user, renders, consultas, authCallback;

beforeEach(() => {
  window.location.hash = '';
  role = 'professor'; centros = []; tarefas = [{ id: 't1', responsavel_id: 'arthur' }];
  erroTarefas = null; sessionUser = null; user = { id: 'arthur', email: 'arthur@exemplo.invalid' }; consultas = [];
  document.body.innerHTML = `<div id="login-screen"><form id="login-form">
    <input id="login-email"><input id="login-password"><button id="login-btn"><span class="btn__text"></span><span class="btn__loader"></span></button>
    </form><div id="login-error" hidden><span id="login-error-text"></span></div></div>
    <div id="app" hidden><button id="sidebar-toggle"></button><aside id="sidebar"><ul>
      <li data-minhas-tarefas hidden><button class="sidebar__link" data-page="atividades"></button></li>
      <li data-minhas-status role="alert" hidden></li><li data-admin><button class="sidebar__link" data-page="usuarios"></button></li>
      <li><button class="sidebar__link" data-page="projetos"></button></li></ul></aside>
      <span id="user-email"></span><span id="user-avatar"></span><button id="logout-btn"></button>
      <h2 id="page-title"></h2><div id="page-actions"></div><div id="page-content"></div></div>`;
  vi.stubGlobal('lucide', { createIcons: vi.fn() });
  vi.stubGlobal('Notifications', { init: vi.fn(), refresh: vi.fn() });
  vi.stubGlobal('showToast', vi.fn()); vi.stubGlobal('escapeAttr', escapeAttr);
  vi.stubGlobal('supabaseClient', {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: sessionUser ? { user: sessionUser } : null } })),
      signInWithPassword: vi.fn(async () => ({ data: { user } })),
      signOut: vi.fn(async () => { authCallback('SIGNED_OUT'); }),
      onAuthStateChange: fn => { authCallback = fn; },
    },
    from: table => {
      const filtro = []; consultas.push([table, filtro]);
      const q = {};
      for (const op of ['select', 'eq', 'limit', 'maybeSingle']) q[op] = (...args) => { filtro.push([op, ...args]); return q; };
      q.then = (resolve, reject) => {
        const uid = filtro.find(f => f[0] === 'eq')?.[2];
        const data = table === 'app_users' ? { role, display_name: 'Usuário de teste' } :
          table === 'user_projects' ? centros.map(project_id => ({ project_id })) : tarefas.filter(t => t.responsavel_id === uid);
        return Promise.resolve({ data, error: table === 'tarefas' ? erroTarefas : null }).then(resolve, reject);
      };
      return q;
    },
  });
  vi.stubGlobal('Router', new Function(routerSource + '\nreturn Router;')());
  renders = {};
  for (const name of ['projetos', 'atividades', 'usuarios', 'holders']) {
    renders[name] = vi.fn(container => { container.textContent = name; });
    Router.register(name, { title: name, render: renders[name] });
  }
  new Function(tarefasSource)();
  vi.stubGlobal('App', new Function(appSource + '\nreturn App;')());
  vi.stubGlobal('Auth', new Function(authSource + '\nreturn Auth;')());
});
afterEach(() => { document.body.innerHTML = ''; window.location.hash = ''; vi.unstubAllGlobals(); });

async function entrar() {
  document.getElementById('login-email').value = user.email;
  document.getElementById('login-password').value = 'senha-sintetica';
  document.getElementById('login-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(document.getElementById('login-btn').disabled).toBe(false));
  expect(document.getElementById('login-error').hidden).toBe(true);
}

describe('página de entrada após autenticação', () => {
  it('Arthur sem centros e com tarefa cai em Atividades sem renderizar Projetos', async () => {
    await entrar();
    expect(Router.getCurrent()).toBe('atividades');
    expect(renders.projetos).not.toHaveBeenCalled();
    expect(consultas.filter(([table]) => table === 'tarefas')).toHaveLength(1);
  });
  it.each([
    ['professor', ['centro'], true], ['admin', [], true], ['professor', [], false],
  ])('mantém Projetos para %s, centros %j, tarefas %s', async (papel, escopo, atribuidas) => {
    role = papel; centros = escopo; if (!atribuidas) tarefas = [];
    await entrar();
    expect(Router.getCurrent()).toBe('projetos');
    expect(renders['atividades']).not.toHaveBeenCalled();
  });
  it('falha de consulta mantém banner e acesso ao menu, sem tratar como lista vazia', async () => {
    erroTarefas = { message: 'Falha de rede' };
    await entrar();
    expect(document.querySelector('[data-minhas-status]').hidden).toBe(false);
    expect(document.querySelector('[data-minhas-status]').textContent).toContain('Não foi possível consultar');
    expect(document.querySelector('[data-minhas-tarefas]').hidden).toBe(false);
  });
  it('respeita #minhas-tarefas depois do login mesmo com centros atribuídos', async () => {
    window.location.hash = '#minhas-tarefas'; centros = ['centro'];
    await Auth.checkSession();
    expect(Router.getCurrent()).toBeNull();
    expect(document.getElementById('login-screen').hidden).toBe(false);
    await entrar();
    expect(Router.getCurrent()).toBe('atividades');
    expect(renders.projetos).not.toHaveBeenCalled();
  });
  it('respeita o link com sessão restaurada e não depende de haver atribuições', async () => {
    window.location.hash = '#minhas-tarefas'; sessionUser = user; role = 'admin'; tarefas = [];
    await Auth.checkSession();
    expect(Router.getCurrent()).toBe('atividades');
    expect(document.getElementById('app').hidden).toBe(false);
  });
  it('ignora hash desconhecido e mantém o destino atual numa reinicialização', async () => {
    window.location.hash = '#desconhecido'; centros = ['centro'];
    await entrar();
    expect(Router.getCurrent()).toBe('projetos');
    await Router.navigate('holders');
    await App.init();
    expect(Router.getCurrent()).toBe('holders');
    expect(Notifications.init).toHaveBeenCalledTimes(1);
  });
  it('reavalia a entrada após logout e recarrega a rota para o novo login', async () => {
    centros = ['centro'];
    await entrar();
    expect(Router.getCurrent()).toBe('projetos');
    await supabaseClient.auth.signOut();
    centros = [];
    await entrar();
    expect(Router.getCurrent()).toBe('atividades');
    await supabaseClient.auth.signOut();
    user = { id: 'outro', email: 'outro@exemplo.invalid' };
    tarefas = [{ id: 't2', responsavel_id: 'outro' }];
    await entrar();
    expect(renders['atividades']).toHaveBeenCalledTimes(2);
  });
  it('resultado lento não substitui navegação feita pelo usuário', async () => {
    sessionUser = user;
    let resolver;
    const menu = vi.spyOn(window.BuritiTarefasUI, 'atualizarMenu').mockReturnValue(new Promise(r => { resolver = r; }));
    const entrada = Auth.checkSession();
    await vi.waitFor(() => expect(menu).toHaveBeenCalled());
    await Router.navigate('holders');
    resolver(true);
    await entrada;
    expect(Router.getCurrent()).toBe('holders');
    menu.mockRestore();
  });
});

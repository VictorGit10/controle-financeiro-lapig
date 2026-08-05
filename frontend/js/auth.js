/* ============================================================
   Auth — Login, Logout, Session Management
   ============================================================
   Suporta login por usuário simples (ex: "Laerte") que é
   convertido internamente para email Supabase.

   Multi-tenancy: após o login, carrega o perfil do usuário em
   `app_users` (papel: admin/professor) e os centros de custo
   permitidos em `user_projects`. O papel precisa estar pronto
   ANTES de App.init() (que esconde links admin e registra o
   guard de rota). A segurança real fica no banco (RLS + guards
   nas RPCs); o papel no frontend só controla a UI.
   ============================================================ */

const Auth = (() => {
  const loginScreen = document.getElementById('login-screen');
  const appScreen   = document.getElementById('app');
  const loginForm   = document.getElementById('login-form');
  const loginInput  = document.getElementById('login-email');
  const loginPass   = document.getElementById('login-password');
  const loginBtn    = document.getElementById('login-btn');
  const loginError  = document.getElementById('login-error');
  const loginErrorText = document.getElementById('login-error-text');
  const logoutBtn   = document.getElementById('logout-btn');
  const togglePass  = document.getElementById('toggle-password');
  const userEmailEl = document.getElementById('user-email');
  const userAvatarEl= document.getElementById('user-avatar');

  let currentUser = null;
  let userRole = null;           // 'admin' | 'professor'
  let allowedProjectIds = [];    // centros de custo permitidos (vazio p/ admin)

  // Mapeamento de usuários (login simplificado -> email real no Supabase)
  const USER_MAPPING = {
    'laerte': '[e-mail removido]',
    'victor': '[e-mail removido]'
  };
  // E-mails que viram admin por padrão (fallback quando não há linha em
  // app_users — ex.: migração 033 ainda não aplicada, ou usuário criado
  // antes do trigger on_auth_user_created). Pós-migração, app_users é a
  // fonte da verdade; isto é só rede de segurança.
  const ADMIN_EMAILS = new Set(Object.values(USER_MAPPING));

  /**
   * Convert a username to Supabase email.
   * If it already contains @, use as-is. Otherwise, look up the mapping.
   */
  function toEmail(input) {
    const trimmed = (input || '').trim().toLowerCase();

    // Se já contiver @, é o email direto
    if (trimmed.includes('@')) return trimmed;

    // Procura no mapeamento (usando chave em minúsculo)
    if (USER_MAPPING[trimmed]) {
      return USER_MAPPING[trimmed];
    }

    // Se não encontrar, retorna o que foi digitado (provavelmente falhará no Supabase, o que é o esperado)
    return trimmed;
  }

  /**
   * Extract display name from email.
   * "[e-mail removido]" -> "Laerte"
   */
  function displayName(email) {
    if (!email) return '';
    const local = email.split('@')[0];
    // Capitalize first letter of each word
    return local.split('.').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  // Toggle password visibility
  togglePass?.addEventListener('click', () => {
    const isPassword = loginPass.type === 'password';
    loginPass.type = isPassword ? 'text' : 'password';
    const icon = togglePass.querySelector('.input-group__toggle-icon');
    icon.setAttribute('data-lucide', isPassword ? 'eye-off' : 'eye');
    lucide.createIcons({ nodes: [togglePass] });
  });

  // Show error
  function showError(msg) {
    loginError.hidden = false;
    loginErrorText.textContent = msg;
  }

  function hideError() {
    loginError.hidden = true;
  }

  // Carrega o perfil (papel + centros de custo) do usuário autenticado.
  // RLS permite ler a própria linha de app_users e user_projects.
  // Fallback: sem linha (ou tabela ausente pré-migração) → admin por email
  // conhecido, senão professor sem projetos.
  async function loadProfile(user) {
    userRole = 'professor';
    allowedProjectIds = [];
    if (!user?.id) return;

    const email = (user.email || '').toLowerCase();
    const fallbackRole = ADMIN_EMAILS.has(email) ? 'admin' : 'professor';

    try {
      const [profileRes, projRes] = await Promise.all([
        supabaseClient
          .from('app_users')
          .select('role, display_name, email')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabaseClient
          .from('user_projects')
          .select('project_id')
          .eq('user_id', user.id),
      ]);

      if (profileRes.data) {
        userRole = profileRes.data.role || fallbackRole;
        if (profileRes.data.display_name) {
          user._displayName = profileRes.data.display_name;
        }
      } else {
        userRole = fallbackRole;
      }

      if (projRes.data) {
        allowedProjectIds = projRes.data.map(r => r.project_id);
      }
    } catch (e) {
      console.error('Erro ao carregar perfil (app_users/user_projects):', e);
      userRole = fallbackRole;
    }
  }

  // Switch screens
  async function showApp(user) {
    currentUser = user;
    await loadProfile(user);   // papel pronto antes de App.init()
    loginScreen.hidden = true;
    appScreen.hidden = false;

    // Update user info in sidebar
    const email = user.email || '';
    const name = user._displayName || displayName(email);
    userEmailEl.textContent = name || email;
    userAvatarEl.textContent = (name || email).charAt(0).toUpperCase();

    // Initialize the app
    if (typeof App !== 'undefined' && App.init) {
      App.init();
    }
  }

  function showLogin() {
    currentUser = null;
    userRole = null;
    allowedProjectIds = [];
    loginScreen.hidden = false;
    appScreen.hidden = true;
    loginPass.value = '';
    hideError();
  }

  // Login handler
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const rawInput = loginInput.value.trim();
    const password = loginPass.value;

    if (!rawInput || !password) {
      showError('Preencha todos os campos.');
      return;
    }

    const email = toEmail(rawInput);

    // Show loading
    const btnText = loginBtn.querySelector('.btn__text');
    const btnLoader = loginBtn.querySelector('.btn__loader');
    btnText.hidden = true;
    btnLoader.hidden = false;
    loginBtn.disabled = true;

    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        const errorMessages = {
          'Invalid login credentials': 'Usuário ou senha incorretos.',
          'Email not confirmed': 'Conta ainda não confirmada.',
        };
        showError(errorMessages[error.message] || `Erro: ${error.message}`);
        return;
      }

      await showApp(data.user);
    } catch (err) {
      console.error("ERRO DE LOGIN COMPLETO:", err);
      showError(`Erro interno: ${err.message || err.toString()}`);
    } finally {
      btnText.hidden = false;
      btnLoader.hidden = true;
      loginBtn.disabled = false;
    }
  });

  // Logout handler
  logoutBtn?.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    showLogin();
  });

  // Check existing session on load
  async function checkSession() {
    try {
      const { data, error } = await supabaseClient.auth.getSession();

      if (error) {
        console.error("Session check error:", error);
        showLogin();
        return;
      }

      if (data?.session?.user) {
        await showApp(data.session.user);
      } else {
        showLogin();
      }
    } catch (err) {
      console.error("Critical error checking session:", err);
      showLogin();
    }
  }

  // Listen for auth state changes
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      showLogin();
    }
  });

  return {
    checkSession,
    getUser: () => currentUser,
    isAdmin: () => userRole === 'admin',
    getRole: () => userRole,
    getAllowedProjectIds: () => allowedProjectIds.slice(),
  };
})();
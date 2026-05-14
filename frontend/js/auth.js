/* ============================================================
   Auth — Login, Logout, Session Management
   ============================================================
   Suporta login por usuário simples (ex: "Laerte") que é
   convertido internamente para email Supabase.
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

  // Mapeamento de usuários (login simplificado -> email real no Supabase)
  const USER_MAPPING = {
    'laerte': '[e-mail removido]',
    'victor': '[e-mail removido]'
  };

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

  // Switch screens
  function showApp(user) {
    currentUser = user;
    loginScreen.hidden = true;
    appScreen.hidden = false;

    // Update user info in sidebar
    const email = user.email || '';
    const name = displayName(email);
    userEmailEl.textContent = name || email;
    userAvatarEl.textContent = (name || email).charAt(0).toUpperCase();

    // Initialize the app
    if (typeof App !== 'undefined' && App.init) {
      App.init();
    }
  }

  function showLogin() {
    currentUser = null;
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

      showApp(data.user);
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
        showApp(data.session.user);
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
  };
})();

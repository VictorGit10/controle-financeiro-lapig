/* ============================================================
   Usuários & Centros de Custo (admin-only)
   Define o papel (admin/professor) e quais centros de custo
   (projects) cada usuário autenticado enxerga. A criação do
   login (e-mail/senha) continua no painel do Supabase — o
   trigger on_auth_user_created (mig. 033) cria a linha em
   app_users automaticamente, e ela aparece aqui.

   Segurança: a rota é bloqueada pelo guard em app.js e o link
   fica oculto no sidebar (data-admin). A RPC save_user_assignments
   é security definer admin-only (re-checa is_admin no banco), então
   mesmo um professor que chamasse a RPC direto levaria erro.
   ============================================================ */

Router.register('usuarios', {
  title: 'Usuários & Centros de Custo',

  async render(container) {
    await UsuariosPage.load(container);
  },
});


const UsuariosPage = (() => {

  let containerEl = null;
  let users       = [];
  let allProjects = [];

  /* ── Load ────────────────────────────────────────────────── */

  async function load(container) {
    containerEl = container;
    containerEl.innerHTML = '<div class="skeleton skeleton--card" style="height:200px;"></div>';
    await refresh();
  }

  async function refresh() {
    const [usersRes, upRes, projRes] = await Promise.all([
      supabaseClient.from('app_users')
        .select('user_id, role, display_name, email, created_at')
        .order('role')
        .order('email'),
      supabaseClient.from('user_projects').select('user_id, project_id'),
      supabaseClient.from('projects').select('id, name, code, active').order('name'),
    ]);

    if (usersRes.error) { showToast('Erro ao carregar usuários: ' + usersRes.error.message, 'error'); return; }
    if (upRes.error)   { showToast('Erro ao carregar atribuições: ' + upRes.error.message, 'error'); return; }
    if (projRes.error) { showToast('Erro ao carregar projetos: ' + projRes.error.message, 'error'); return; }

    users       = usersRes.data || [];
    allProjects = projRes.data || [];

    const assigned = {};
    (upRes.data || []).forEach(r => {
      (assigned[r.user_id] = assigned[r.user_id] || new Set()).add(r.project_id);
    });
    users.forEach(u => { u._projectIds = assigned[u.user_id] || new Set(); });

    renderPage();
  }

  /* ── Render ──────────────────────────────────────────────── */

  function nameFromEmail(email) {
    if (!email) return '';
    const local = email.split('@')[0];
    return local.split(/[._-]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  function renderPage() {
    if (!users.length) {
      containerEl.innerHTML = `
        <div class="empty-state">
          <i data-lucide="users" class="empty-state__icon"></i>
          <h3 class="empty-state__title">Nenhum usuário cadastrado</h3>
          <p class="empty-state__text">Crie usuários no painel do Supabase (Authentication → Users). Eles aparecem aqui automaticamente após o cadastro.</p>
        </div>`;
      lucide.createIcons();
      return;
    }

    const rows = users.map(u => {
      const projCount  = u._projectIds.size;
      const roleBadge  = u.role === 'admin'
        ? '<span class="badge badge--active">Administrador</span>'
        : '<span class="badge badge--info">Professor</span>';
      const name = u.display_name || nameFromEmail(u.email) || '—';
      return `
        <tr>
          <td style="font-weight:600;">${escapeAttr(name)}</td>
          <td style="color:var(--text-secondary);">${escapeAttr(u.email || '—')}</td>
          <td>${roleBadge}</td>
          <td style="text-align:center;">${u.role === 'admin' ? '<span style="color:var(--text-muted);">—</span>' : projCount}</td>
          <td style="font-size:0.8rem;color:var(--text-secondary);">${u.created_at ? formatDate(u.created_at.substring(0, 10)) : '—'}</td>
          <td>
            <button class="btn btn--ghost btn--sm" onclick="UsuariosPage.openEdit('${u.user_id}')" title="Editar atribuições">
              <i data-lucide="pencil" style="width:16px;height:16px;"></i>
            </button>
          </td>
        </tr>`;
    }).join('');

    containerEl.innerHTML = `
      <div class="card fade-in">
        <div class="card__header">
          <div>
            <h3 class="card__title">Usuários & Centros de Custo</h3>
            <p class="card__subtitle">Defina o papel de cada usuário e quais centros de custo ele enxerga. A criação do login (e-mail/senha) é feita no painel do Supabase.</p>
          </div>
        </div>
        <div class="data-table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Papel</th>
                <th style="text-align:center;">Centros de custo</th>
                <th>Criado em</th>
                <th style="width:80px;">Ações</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>

      <div class="callout callout--info" style="margin-top:var(--sp-4);">
        <i data-lucide="info"></i>
        <div>
          Novos logins são criados no <strong>painel do Supabase</strong> (Authentication → Users → Add user, com e-mail/senha e auto-confirmação).
          O usuário aparece aqui automaticamente após o cadastro (papel padrão: <strong>professor</strong>, sem centros de custo).
          Use o botão de edição para atribuir projetos e, se preciso, promover a administrador.
        </div>
      </div>
    `;
    lucide.createIcons();
  }

  /* ── Editar atribuições ──────────────────────────────────── */

  async function openEdit(userId) {
    const user = users.find(u => u.user_id === userId);
    if (!user) return;
    const assigned = user._projectIds;
    const isSelf = Auth.getUser()?.id === userId;

    const projChecks = allProjects.map(p => `
      <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;">
        <input type="checkbox" class="user-proj-check" value="${p.id}" ${assigned.has(p.id) ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent);">
        <span>${escapeAttr(p.name)}${p.code ? ' — ' + escapeAttr(p.code) : ''}${p.active === false ? ' <span class="badge badge--ended" style="font-size:0.6rem;">Inativo</span>' : ''}</span>
      </label>`).join('');

    createModal({
      title: `Editar usuário — ${escapeAttr(user.display_name || nameFromEmail(user.email) || user.email || '—')}`,
      bodyHTML: `
        <div class="form-group">
          <label class="form-label">Papel</label>
          <select class="form-input" id="user-role-sel">
            <option value="professor" ${user.role === 'professor' ? 'selected' : ''}>Professor — vê apenas os centros de custo atribuídos</option>
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador — acesso total</option>
          </select>
          ${isSelf ? '<p style="font-size:0.8rem;color:var(--warning);margin-top:4px;">Você não pode remover seu próprio acesso de administrador por aqui.</p>' : ''}
        </div>
        <div class="form-group">
          <label class="form-label">Centros de custo permitidos</label>
          <p style="font-size:0.8rem;color:var(--text-secondary);margin:0 0 8px;">Relevante para professores. Administradores ignoram esta lista (acessam todos os centros de custo).</p>
          <div style="max-height:320px;overflow-y:auto;border:1px solid var(--border-color);border-radius:8px;padding:8px 12px;">
            ${projChecks || '<p style="color:var(--text-muted);font-size:0.85rem;">Nenhum projeto cadastrado.</p>'}
          </div>
          <div style="display:flex;gap:12px;margin-top:8px;">
            <button type="button" class="btn btn--ghost btn--sm" onclick="UsuariosPage._toggleAll(true)"><i data-lucide="check-square"></i> Marcar todos</button>
            <button type="button" class="btn btn--ghost btn--sm" onclick="UsuariosPage._toggleAll(false)"><i data-lucide="square"></i> Limpar</button>
          </div>
        </div>
      `,
      saveLabel: 'Salvar',
      onSave: async () => {
        const role = document.getElementById('user-role-sel').value;
        // Evita lockout: o admin não pode rebaixar a si mesmo por aqui.
        if (isSelf && role !== 'admin') {
          throw new Error('Você não pode remover seu próprio acesso de administrador. Peça a outro administrador para alterar seu papel.');
        }
        const projectIds = Array.from(document.querySelectorAll('.user-proj-check:checked')).map(cb => cb.value);

        const { error } = await supabaseClient.rpc('save_user_assignments', {
          p_user_id: userId,
          p_role: role,
          p_project_ids: projectIds,
        });
        if (error) throw new Error('Erro ao salvar: ' + error.message);
        showToast('Atribuições salvas com sucesso.', 'success');
        await refresh();
      },
    });
    lucide.createIcons();
  }

  function _toggleAll(checked) {
    document.querySelectorAll('.user-proj-check').forEach(cb => { cb.checked = checked; });
  }

  return { load, openEdit, _toggleAll };
})();
// A atribuição concede acesso apenas à tarefa. A consulta de projeto continua no RLS normal.
Router.register('minhas-tarefas', {
  title: 'Minhas tarefas',
  async render(container) {
    container.innerHTML = '<div class="buriti-pagina"><p class="buriti-intro">Registre o que você fez. O Victor confere e confirma os passos.</p><div data-minhas-conteudo></div></div>';
    await window.BuritiTarefasUI.tarefas(container.querySelector('[data-minhas-conteudo]'), 'todas', true);
    await window.BuritiTarefasUI.atualizarMenu();
  },
});

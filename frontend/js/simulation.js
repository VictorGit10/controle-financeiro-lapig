/* ============================================================
   Simulation Engine — delegates to window.* (set by pure-fns.js)
   API pública inalterada: { calcProjectMonthly, diffProjections, generateMonthSeries }
   ============================================================ */

/* exported SimulationEngine -- global de script clássico: consumido por projetos.js. */
const SimulationEngine = (() => {
  return {
    calcProjectMonthly: function(...a) { return window.calcProjectMonthly(...a); },
    diffProjections: function(...a) { return window.diffProjections(...a); },
    generateMonthSeries: function(...a) { return window.generateMonthSeries(...a); },
  };
})();

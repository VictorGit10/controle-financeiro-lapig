/* ============================================================
   Simulation Engine — delegates to window.* (set by pure-fns.js)
   API pública inalterada: { calcProjectMonthly, diffProjections, generateMonthSeries }
   ============================================================ */

const SimulationEngine = (() => {
  return {
    calcProjectMonthly: function(...a) { return window.calcProjectMonthly(...a); },
    diffProjections: function(...a) { return window.diffProjections(...a); },
    generateMonthSeries: function(...a) { return window.generateMonthSeries(...a); },
  };
})();

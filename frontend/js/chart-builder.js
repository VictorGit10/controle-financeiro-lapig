/* ============================================================
   ChartBuilder — Shared chart configuration for financial charts
   ============================================================ */

const ChartBuilder = (() => {

  const COLORS = {
    funding:  'rgba(42,157,143,0.78)',
    bolsas:   'rgba(196,147,63,0.78)',
    gastos:   'rgba(217,67,67,0.68)',
    saldo:    '#429B4D',
    saldoNeg: '#D94343',
  };

  function buildFinancialChart(canvasId, data, { originalData = null, existingChart = null } = {}) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    if (existingChart) { existingChart.destroy(); }

    const labels      = data.map(m => m.month_label);
    const saldos      = data.map(m => m.net_balance);
    const funding     = data.map(m => m.funding_income);
    const bolsas      = data.map(m => m.scholarship_expense);
    const gastos      = data.map(m => m.other_expense);
    const pointColors = saldos.map(v => v < 0 ? COLORS.saldoNeg : COLORS.saldo);

    const datasets = [
      { label: 'Desembolsos',   data: funding, backgroundColor: COLORS.funding, borderRadius: 4, order: 2 },
      { label: 'Bolsas',        data: bolsas,  backgroundColor: COLORS.bolsas,  borderRadius: 4, order: 2 },
      { label: 'Outros Gastos', data: gastos,  backgroundColor: COLORS.gastos,  borderRadius: 4, order: 2 },
      {
        label: 'Saldo', data: saldos, type: 'line',
        borderColor: COLORS.saldo,
        backgroundColor: 'rgba(66,155,77,0.07)',
        pointBackgroundColor: pointColors,
        pointBorderColor: pointColors,
        pointRadius: 5, pointHoverRadius: 7,
        fill: true, tension: 0.35, borderWidth: 2.5, order: 1,
      },
    ];

    if (originalData && originalData.length > 0) {
      datasets.push({
        label: 'Saldo Original',
        data: originalData.map(m => m.net_balance),
        type: 'line',
        borderColor: 'rgba(92,120,104,0.5)',
        borderDash: [5, 4],
        pointRadius: 0,
        fill: false,
        tension: 0.35,
        borderWidth: 1.5,
        order: 1,
      });
    }

    const chart = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(255,255,255,0.97)',
            titleColor: '#1B3A2A',
            bodyColor: '#345943',
            borderColor: '#DCD2BF',
            borderWidth: 1,
            padding: 12,
            callbacks: {
              title: items => items[0]?.label || '',
              label: ctx => {
                const v = new Intl.NumberFormat('pt-BR', {
                  style: 'currency', currency: 'BRL',
                }).format(ctx.parsed.y ?? ctx.parsed);
                return `  ${ctx.dataset.label}: ${v}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#5C7868', font: { size: 11 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 24 },
          },
          y: {
            beginAtZero: false,
            grid: { color: 'rgba(27,58,42,0.06)' },
            ticks: {
              color: '#5C7868',
              callback: v => new Intl.NumberFormat('pt-BR', {
                style: 'currency', currency: 'BRL', minimumFractionDigits: 0,
              }).format(v),
            },
          },
        },
      },
    });

    return chart;
  }

  return { buildFinancialChart, COLORS };
})();
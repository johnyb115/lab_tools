import Plotly from 'plotly.js-dist-min'

export { Plotly }

const PALETTE = [
  '#4c9aff', '#2ea043', '#f2994a', '#e0559a', '#a970ff',
  '#58c4dc', '#f2c94c', '#eb5757', '#6fcf97', '#bb6bd9',
]

export function colorForIndex(i) {
  return PALETTE[i % PALETTE.length]
}

function getThemeColors() {
  const s = getComputedStyle(document.documentElement)
  const v = (name) => s.getPropertyValue(name).trim()
  return {
    paper: v('--bg-elev') || '#131316',
    plot: v('--bg') || '#09090b',
    text: v('--text') || '#ededf0',
    grid: v('--border') || '#23232b',
    font: v('--font') || "'Inter', ui-sans-serif, system-ui, sans-serif",
  }
}

export function baseLayout(overrides = {}) {
  const c = getThemeColors()
  return {
    paper_bgcolor: c.paper,
    plot_bgcolor: c.plot,
    font: { color: c.text, family: c.font },
    margin: { t: 50, r: 30, l: 60, b: 50 },
    legend: { bgcolor: 'rgba(0,0,0,0)' },
    xaxis: { gridcolor: c.grid, zerolinecolor: c.grid, ...overrides.xaxis },
    yaxis: { gridcolor: c.grid, zerolinecolor: c.grid, ...overrides.yaxis },
    ...overrides,
  }
}

export function baseConfig(filenameBase = 'plot') {
  return {
    responsive: true,
    scrollZoom: true,
    displaylogo: false,
    toImageButtonOptions: { format: 'png', filename: filenameBase, scale: 2 },
  }
}

function relayoutForTheme(container) {
  const c = getThemeColors()
  Plotly.relayout(container, {
    paper_bgcolor: c.paper,
    plot_bgcolor: c.plot,
    'font.color': c.text,
    'xaxis.gridcolor': c.grid,
    'xaxis.zerolinecolor': c.grid,
    'yaxis.gridcolor': c.grid,
    'yaxis.zerolinecolor': c.grid,
  }).catch(() => {})
}

export async function renderPlot(container, traces, layout = {}, filenameBase = 'plot') {
  await Plotly.react(container, traces, baseLayout(layout), baseConfig(filenameBase))
  if (!container._themeWatcher) {
    container._themeWatcher = true
    document.addEventListener('labtools:themechange', () => relayoutForTheme(container))
  }
}

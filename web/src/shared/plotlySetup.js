import Plotly from 'plotly.js-dist-min'

export { Plotly }

// Distinct series colours that hold up on both the quartz and chrome grounds.
const PALETTE = [
  '#3a62d6', '#e0601a', '#11968f', '#c8457c', '#c99a00',
  '#8a4bb0', '#3aa0e0', '#6b9a2a', '#e07a5f', '#7a8088',
]

export function colorForIndex(i) {
  return PALETTE[i % PALETTE.length]
}

function getThemeColors() {
  const s = getComputedStyle(document.documentElement)
  const v = (name) => s.getPropertyValue(name).trim()
  return {
    paper: v('--bg-elev') || '#171a1d',
    plot: v('--bg-elev') || '#171a1d',
    text: v('--text') || '#ededf0',
    grid: v('--border') || '#23232b',
    font: v('--font') || 'ui-sans-serif, system-ui, sans-serif',
    zero: v('--border-hover') || '#444a51',
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
    xaxis: { gridcolor: c.grid, zerolinecolor: c.zero, linecolor: c.zero, ...overrides.xaxis },
    yaxis: { gridcolor: c.grid, zerolinecolor: c.zero, linecolor: c.zero, ...overrides.yaxis },
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
    'xaxis.zerolinecolor': c.zero,
    'xaxis.linecolor': c.zero,
    'yaxis.gridcolor': c.grid,
    'yaxis.zerolinecolor': c.zero,
    'yaxis.linecolor': c.zero,
  }).catch(() => {})
}

export async function renderPlot(container, traces, layout = {}, filenameBase = 'plot') {
  await Plotly.react(container, traces, baseLayout(layout), baseConfig(filenameBase))
  if (!container._themeWatcher) {
    container._themeWatcher = true
    document.addEventListener('labtools:themechange', () => relayoutForTheme(container))
  }
}

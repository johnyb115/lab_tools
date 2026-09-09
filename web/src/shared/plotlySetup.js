// Thin wrapper around Plotly so every tool gets the same dark styling
// and the same toolbar/export behaviour for free.

import Plotly from 'plotly.js-dist-min'

export { Plotly }

const PALETTE = [
  '#4c9aff', '#2ea043', '#f2994a', '#e0559a', '#a970ff',
  '#58c4dc', '#f2c94c', '#eb5757', '#6fcf97', '#bb6bd9',
]

export function colorForIndex(i) {
  return PALETTE[i % PALETTE.length]
}

export function baseLayout(overrides = {}) {
  return {
    paper_bgcolor: '#131316',
    plot_bgcolor: '#09090b',
    font: { color: '#ededf0', family: "'Inter', ui-sans-serif, system-ui, sans-serif" },
    margin: { t: 50, r: 30, l: 60, b: 50 },
    legend: { bgcolor: 'rgba(0,0,0,0)' },
    xaxis: { gridcolor: '#23232b', zerolinecolor: '#23232b', ...overrides.xaxis },
    yaxis: { gridcolor: '#23232b', zerolinecolor: '#23232b', ...overrides.yaxis },
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

export async function renderPlot(container, traces, layout = {}, filenameBase = 'plot') {
  await Plotly.react(container, traces, baseLayout(layout), baseConfig(filenameBase))
}

import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { downloadCSV, toCSV } from '../shared/download.js'
import { Plotly, baseLayout, baseConfig } from '../shared/plotlySetup.js'
import Papa from 'papaparse'

initChrome('data-normalizer')

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let parsedData = null   // { headers: string[], rows: object[] }
let xData = []
let yData = []
let normalizedY = []

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const dropzone     = document.getElementById('dn-dropzone')
const fileInput    = document.getElementById('dn-file-input')
const pasteArea    = document.getElementById('dn-paste')
const loadPasteBtn = document.getElementById('dn-load-paste')
const statusEl     = document.getElementById('dn-status')

const colPanel     = document.getElementById('dn-col-panel')
const xColSelect   = document.getElementById('dn-x-col')
const yColSelect   = document.getElementById('dn-y-col')

const normPanel    = document.getElementById('dn-norm-panel')
const methodSelect = document.getElementById('dn-method')
const rangeFields  = document.getElementById('dn-range-fields')
const rangeMinEl   = document.getElementById('dn-range-min')
const rangeMaxEl   = document.getElementById('dn-range-max')

const exportPanel  = document.getElementById('dn-export-panel')
const dlBtn        = document.getElementById('dn-dl')

const plotEl       = document.getElementById('dn-plot')

// ---------------------------------------------------------------------------
// Theme change listener
// ---------------------------------------------------------------------------
document.addEventListener('labtools:themechange', () => {
  if (plotEl && plotEl._fullData) updatePlot()
})

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
initDropzone(dropzone, fileInput, (files) => {
  const file = files[0]
  const reader = new FileReader()
  reader.onload = () => handleText(reader.result, file.name)
  reader.readAsText(file)
})

loadPasteBtn.addEventListener('click', () => {
  const text = pasteArea.value.trim()
  if (!text) return
  handleText(text, 'pasted data')
})

function handleText(text, sourceName) {
  const result = Papa.parse(text, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  })

  if (!result.data.length || !result.meta.fields.length) {
    showStatus(`Could not parse <strong>${escapeHtml(sourceName)}</strong>: no data found.`, 'danger')
    return
  }

  parsedData = { headers: result.meta.fields, rows: result.data }
  populateColumnSelectors()
  colPanel.style.display = ''
  normPanel.style.display = ''
  exportPanel.style.display = ''

  showStatus(
    `Loaded <strong>${escapeHtml(sourceName)}</strong> — ${result.data.length} rows, ${result.meta.fields.length} columns.`,
    'success'
  )

  extractAndNormalize()
}

function showStatus(html, type) {
  statusEl.innerHTML = `<div class="alert alert-${type}">${html}</div>`
}

// ---------------------------------------------------------------------------
// Column selection
// ---------------------------------------------------------------------------
function populateColumnSelectors() {
  const headers = parsedData.headers
  xColSelect.innerHTML = ''
  yColSelect.innerHTML = ''

  headers.forEach((h, i) => {
    xColSelect.add(new Option(h, i))
    yColSelect.add(new Option(h, i))
  })

  if (headers.length >= 2) yColSelect.value = '1'
}

xColSelect.addEventListener('change', () => extractAndNormalize())
yColSelect.addEventListener('change', () => extractAndNormalize())

function extractColumns() {
  if (!parsedData) return false
  const xHeader = parsedData.headers[+xColSelect.value]
  const yHeader = parsedData.headers[+yColSelect.value]
  const xRaw = []
  const yRaw = []

  for (const row of parsedData.rows) {
    const xv = Number(row[xHeader])
    const yv = Number(row[yHeader])
    if (!isNaN(xv) && !isNaN(yv)) {
      xRaw.push(xv)
      yRaw.push(yv)
    }
  }

  if (xRaw.length < 2) {
    showStatus('Need at least 2 valid numeric rows.', 'danger')
    return false
  }

  xData = xRaw
  yData = yRaw
  return true
}

// ---------------------------------------------------------------------------
// Method UI switching
// ---------------------------------------------------------------------------
methodSelect.addEventListener('change', () => {
  rangeFields.hidden = methodSelect.value !== 'range'
  if (parsedData) {
    applyNormalization()
    updatePlot()
  }
})

rangeMinEl.addEventListener('input', () => {
  if (parsedData && methodSelect.value === 'range') {
    applyNormalization()
    updatePlot()
  }
})

rangeMaxEl.addEventListener('input', () => {
  if (parsedData && methodSelect.value === 'range') {
    applyNormalization()
    updatePlot()
  }
})

// ---------------------------------------------------------------------------
// Normalization algorithms
// ---------------------------------------------------------------------------

function normalizeMinMax(y) {
  const min = Math.min(...y)
  const max = Math.max(...y)
  const range = max - min
  if (range === 0) return y.map(() => 0)
  return y.map((v) => (v - min) / range)
}

function normalizeZScore(y) {
  const n = y.length
  const mean = y.reduce((s, v) => s + v, 0) / n
  let sumSq = 0
  for (let i = 0; i < n; i++) sumSq += (y[i] - mean) ** 2
  const std = Math.sqrt(sumSq / (n - 1))
  if (std === 0) return y.map(() => 0)
  return y.map((v) => (v - mean) / std)
}

function normalizeDivideByMax(y) {
  const maxAbs = Math.max(...y.map((v) => Math.abs(v)))
  if (maxAbs === 0) return y.map(() => 0)
  return y.map((v) => v / maxAbs)
}

function normalizeToArea(x, y) {
  // Trapezoidal rule
  let integral = 0
  for (let i = 1; i < x.length; i++) {
    integral += 0.5 * (y[i] + y[i - 1]) * (x[i] - x[i - 1])
  }
  if (integral === 0) return y.map(() => 0)
  return y.map((v) => v / integral)
}

function normalizeCustomRange(y, a, b) {
  const min = Math.min(...y)
  const max = Math.max(...y)
  const range = max - min
  if (range === 0) return y.map(() => a)
  return y.map((v) => a + (b - a) * (v - min) / range)
}

// ---------------------------------------------------------------------------
// Normalization dispatcher
// ---------------------------------------------------------------------------
function applyNormalization() {
  if (!yData.length) return

  const method = methodSelect.value
  switch (method) {
    case 'minmax':
      normalizedY = normalizeMinMax(yData)
      break
    case 'zscore':
      normalizedY = normalizeZScore(yData)
      break
    case 'max':
      normalizedY = normalizeDivideByMax(yData)
      break
    case 'area':
      normalizedY = normalizeToArea(xData, yData)
      break
    case 'range': {
      const a = parseFloat(rangeMinEl.value) || 0
      const b = parseFloat(rangeMaxEl.value) || 1
      normalizedY = normalizeCustomRange(yData, a, b)
      break
    }
  }
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------
function extractAndNormalize() {
  if (!extractColumns()) return
  applyNormalization()
  updatePlot()
}

// ---------------------------------------------------------------------------
// Plot
// ---------------------------------------------------------------------------
function updatePlot() {
  if (!xData.length) return

  const xLabel = parsedData.headers[+xColSelect.value]
  const yLabel = parsedData.headers[+yColSelect.value]

  const traces = [
    {
      x: xData,
      y: yData,
      mode: 'lines',
      name: 'Original',
      line: { color: '#4c9aff', width: 1.5 },
      yaxis: 'y',
    },
    {
      x: xData,
      y: Array.from(normalizedY),
      mode: 'lines',
      name: 'Normalized',
      line: { color: '#2ea043', width: 2 },
      yaxis: 'y2',
    },
  ]

  const layout = baseLayout({
    margin: { t: 30, r: 60, l: 60, b: 50 },
  })
  layout.xaxis.title = xLabel
  layout.yaxis.title = yLabel + ' (original)'
  layout.yaxis2 = {
    title: yLabel + ' (normalized)',
    overlaying: 'y',
    side: 'right',
    gridcolor: 'rgba(0,0,0,0)',
    zerolinecolor: layout.yaxis.zerolinecolor,
    titlefont: { color: '#2ea043' },
    tickfont: { color: '#2ea043' },
  }
  layout.legend = {
    bgcolor: 'rgba(0,0,0,0)',
    x: 0,
    y: 1.12,
    orientation: 'h',
  }

  Plotly.react(plotEl, traces, layout, baseConfig('normalized-data'))
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
dlBtn.addEventListener('click', () => {
  const xH = parsedData.headers[+xColSelect.value]
  const yH = parsedData.headers[+yColSelect.value]
  const rows = xData.map((x, i) => [x, yData[i], normalizedY[i]])
  downloadCSV(toCSV([xH, yH + '_original', yH + '_normalized'], rows), 'normalized.csv')
})

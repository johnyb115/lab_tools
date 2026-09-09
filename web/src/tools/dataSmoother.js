import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { downloadCSV, toCSV } from '../shared/download.js'
import { Plotly, baseLayout, baseConfig } from '../shared/plotlySetup.js'
import Papa from 'papaparse'

initChrome('data-smoother')

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let parsedData = null   // { headers: string[], rows: object[] }
let xData = []
let yData = []
let smoothedY = []

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const dropzone    = document.getElementById('ds-dropzone')
const fileInput   = document.getElementById('ds-file-input')
const pasteArea   = document.getElementById('ds-paste')
const loadPasteBtn = document.getElementById('ds-load-paste')
const statusEl    = document.getElementById('ds-status')

const colPanel    = document.getElementById('ds-col-panel')
const xColSelect  = document.getElementById('ds-x-col')
const yColSelect  = document.getElementById('ds-y-col')

const filterPanel = document.getElementById('ds-filter-panel')
const filterType  = document.getElementById('ds-filter-type')
const showOriginal = document.getElementById('ds-show-original')

const exportPanel = document.getElementById('ds-export-panel')
const dlSmoothed  = document.getElementById('ds-dl-smoothed')
const dlBoth      = document.getElementById('ds-dl-both')

const plotEl      = document.getElementById('ds-plot')

document.addEventListener('labtools:themechange', () => {
  if (plotEl && plotEl._fullData) updatePlot()
})

const maWin       = document.getElementById('ds-ma-win')
const maWinVal    = document.getElementById('ds-ma-win-val')
const sgWin       = document.getElementById('ds-sg-win')
const sgWinVal    = document.getElementById('ds-sg-win-val')
const sgOrd       = document.getElementById('ds-sg-ord')
const sgOrdVal    = document.getElementById('ds-sg-ord-val')
const gaussSigma  = document.getElementById('ds-gauss-sigma')
const gaussSigmaVal = document.getElementById('ds-gauss-sigma-val')
const medWin      = document.getElementById('ds-med-win')
const medWinVal   = document.getElementById('ds-med-win-val')
const emaAlpha    = document.getElementById('ds-ema-alpha')
const emaAlphaVal = document.getElementById('ds-ema-alpha-val')

const paramContainers = {
  'moving-avg':      document.getElementById('ds-params-moving-avg'),
  'savitzky-golay':  document.getElementById('ds-params-savitzky-golay'),
  'gaussian':        document.getElementById('ds-params-gaussian'),
  'median':          document.getElementById('ds-params-median'),
  'ema':             document.getElementById('ds-params-ema'),
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

function debounce(fn, ms) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

function reflectIndex(i, n) {
  if (n <= 1) return 0
  const period = 2 * (n - 1)
  let j = ((i % period) + period) % period
  if (j >= n) j = period - j
  return j
}

function getReflected(arr, i) {
  return arr[reflectIndex(i, arr.length)]
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
  filterPanel.style.display = ''
  exportPanel.style.display = ''

  showStatus(
    `Loaded <strong>${escapeHtml(sourceName)}</strong> — ${result.data.length} rows, ${result.meta.fields.length} columns.`,
    'success'
  )

  extractAndSmooth()
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

xColSelect.addEventListener('change', () => extractAndSmooth())
yColSelect.addEventListener('change', () => extractAndSmooth())

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

  if (xRaw.length < 3) {
    showStatus('Need at least 3 valid numeric rows.', 'danger')
    return false
  }

  xData = xRaw
  yData = yRaw
  return true
}

// ---------------------------------------------------------------------------
// Filter type UI switching
// ---------------------------------------------------------------------------
filterType.addEventListener('change', () => {
  for (const [key, el] of Object.entries(paramContainers)) {
    el.hidden = key !== filterType.value
  }
  scheduleSmooth()
})

// ---------------------------------------------------------------------------
// Slider value displays and live updates
// ---------------------------------------------------------------------------
const scheduleSmooth = debounce(() => {
  if (!parsedData) return
  applySmoothing()
  updatePlot()
}, 100)

function wireSlider(slider, display, formatter, extra) {
  const update = () => {
    display.textContent = formatter(slider.value)
    if (extra) extra()
    scheduleSmooth()
  }
  slider.addEventListener('input', update)
}

wireSlider(maWin, maWinVal, (v) => v)
wireSlider(sgWin, sgWinVal, (v) => v, () => {
  const maxOrd = Math.min(5, +sgWin.value - 1)
  sgOrd.max = maxOrd
  if (+sgOrd.value > maxOrd) {
    sgOrd.value = maxOrd
    sgOrdVal.textContent = maxOrd
  }
})
wireSlider(sgOrd, sgOrdVal, (v) => v)
wireSlider(gaussSigma, gaussSigmaVal, (v) => Number(v).toFixed(1))
wireSlider(medWin, medWinVal, (v) => v)
wireSlider(emaAlpha, emaAlphaVal, (v) => Number(v).toFixed(2))

showOriginal.addEventListener('change', () => updatePlot())

// ---------------------------------------------------------------------------
// Smoothing algorithms
// ---------------------------------------------------------------------------

function movingAverage(y, windowSize) {
  const half = (windowSize - 1) / 2
  const n = y.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let j = -half; j <= half; j++) {
      sum += getReflected(y, i + j)
    }
    out[i] = sum / windowSize
  }
  return out
}

function invertMatrix(A) {
  const n = A.length
  const aug = A.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ])

  for (let col = 0; col < n; col++) {
    let maxRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row
    }
    ;[aug[col], aug[maxRow]] = [aug[maxRow], aug[col]]

    const pivot = aug[col][col]
    if (Math.abs(pivot) < 1e-14) return null
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot

    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = aug[row][col]
      for (let j = 0; j < 2 * n; j++) aug[row][j] -= factor * aug[col][j]
    }
  }

  return aug.map((row) => row.slice(n))
}

function sgCoefficients(windowSize, polyOrder) {
  const half = (windowSize - 1) / 2
  const m = windowSize
  const k = polyOrder

  const J = []
  for (let r = 0; r < m; r++) {
    const row = []
    const x = r - half
    for (let c = 0; c <= k; c++) row.push(Math.pow(x, c))
    J.push(row)
  }

  const JtJ = Array.from({ length: k + 1 }, () => new Float64Array(k + 1))
  for (let i = 0; i <= k; i++) {
    for (let j = 0; j <= k; j++) {
      let s = 0
      for (let r = 0; r < m; r++) s += J[r][i] * J[r][j]
      JtJ[i][j] = s
    }
  }

  const inv = invertMatrix(JtJ.map((r) => Array.from(r)))
  if (!inv) return null

  const coeffs = new Float64Array(m)
  for (let r = 0; r < m; r++) {
    let c = 0
    for (let j = 0; j <= k; j++) c += inv[0][j] * J[r][j]
    coeffs[r] = c
  }
  return coeffs
}

function savitzkyGolay(y, windowSize, polyOrder) {
  const coeffs = sgCoefficients(windowSize, polyOrder)
  if (!coeffs) return new Float64Array(y)

  const half = (windowSize - 1) / 2
  const n = y.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let j = 0; j < windowSize; j++) {
      s += coeffs[j] * getReflected(y, i + j - half)
    }
    out[i] = s
  }
  return out
}

function gaussianSmooth(y, sigma) {
  const radius = Math.ceil(sigma * 4)
  const kernelSize = 2 * radius + 1
  const kernel = new Float64Array(kernelSize)
  let sum = 0
  for (let i = 0; i < kernelSize; i++) {
    const x = i - radius
    kernel[i] = Math.exp(-0.5 * (x / sigma) ** 2)
    sum += kernel[i]
  }
  for (let i = 0; i < kernelSize; i++) kernel[i] /= sum

  const n = y.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let j = 0; j < kernelSize; j++) {
      s += kernel[j] * getReflected(y, i + j - radius)
    }
    out[i] = s
  }
  return out
}

function medianFilter(y, windowSize) {
  const half = (windowSize - 1) / 2
  const n = y.length
  const out = new Float64Array(n)
  const buf = new Float64Array(windowSize)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < windowSize; j++) {
      buf[j] = getReflected(y, i + j - half)
    }
    buf.sort()
    out[i] = buf[half]
  }
  return out
}

function exponentialMovingAverage(y, alpha) {
  const n = y.length
  const out = new Float64Array(n)
  out[0] = y[0]
  for (let i = 1; i < n; i++) {
    out[i] = alpha * y[i] + (1 - alpha) * out[i - 1]
  }
  return out
}

// ---------------------------------------------------------------------------
// Smooth dispatcher
// ---------------------------------------------------------------------------
function applySmoothing() {
  if (!yData.length) return

  const type = filterType.value
  switch (type) {
    case 'moving-avg':
      smoothedY = movingAverage(yData, clampWindow(+maWin.value, yData.length))
      break
    case 'savitzky-golay': {
      const win = clampWindow(+sgWin.value, yData.length)
      const ord = Math.min(+sgOrd.value, win - 1)
      smoothedY = savitzkyGolay(yData, win, ord)
      break
    }
    case 'gaussian':
      smoothedY = gaussianSmooth(yData, +gaussSigma.value)
      break
    case 'median':
      smoothedY = medianFilter(yData, clampWindow(+medWin.value, yData.length))
      break
    case 'ema':
      smoothedY = exponentialMovingAverage(yData, +emaAlpha.value)
      break
  }
}

function clampWindow(win, dataLen) {
  let w = Math.min(win, dataLen)
  if (w % 2 === 0) w--
  return Math.max(3, w)
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------
function extractAndSmooth() {
  if (!extractColumns()) return
  applySmoothing()
  updatePlot()
}

// ---------------------------------------------------------------------------
// Plot
// ---------------------------------------------------------------------------
function getLayout() {
  return baseLayout({ margin: { t: 30, r: 30, l: 60, b: 50 } })
}

function updatePlot() {
  if (!xData.length) return

  const xLabel = parsedData.headers[+xColSelect.value]
  const yLabel = parsedData.headers[+yColSelect.value]

  const traces = []

  if (showOriginal.checked) {
    traces.push({
      x: xData,
      y: yData,
      mode: 'lines',
      name: 'Original',
      line: { color: 'rgba(76,154,255,0.3)', width: 1 },
    })
  }

  traces.push({
    x: xData,
    y: Array.from(smoothedY),
    mode: 'lines',
    name: 'Smoothed',
    line: { color: '#4c9aff', width: 2 },
  })

  const layout = getLayout()
  layout.xaxis.title = xLabel
  layout.yaxis.title = yLabel

  Plotly.react(plotEl, traces, layout, baseConfig('smoothed-data'))
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
dlSmoothed.addEventListener('click', () => {
  const xH = parsedData.headers[+xColSelect.value]
  const yH = parsedData.headers[+yColSelect.value] + '_smoothed'
  const rows = xData.map((x, i) => [x, smoothedY[i]])
  downloadCSV(toCSV([xH, yH], rows), 'smoothed.csv')
})

dlBoth.addEventListener('click', () => {
  const xH = parsedData.headers[+xColSelect.value]
  const yH = parsedData.headers[+yColSelect.value]
  const rows = xData.map((x, i) => [x, yData[i], smoothedY[i]])
  downloadCSV(toCSV([xH, yH, yH + '_smoothed'], rows), 'original_and_smoothed.csv')
})

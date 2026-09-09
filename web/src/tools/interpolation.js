import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { downloadCSV, toCSV } from '../shared/download.js'
import { Plotly, baseLayout, baseConfig } from '../shared/plotlySetup.js'
import Papa from 'papaparse'

initChrome('interpolation')

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let parsedData = null   // { headers: string[], rows: object[] }
let xData = []
let yData = []
let interpX = []
let interpY = []

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const dropzone     = document.getElementById('ip-dropzone')
const fileInput    = document.getElementById('ip-file-input')
const pasteArea    = document.getElementById('ip-paste')
const loadPasteBtn = document.getElementById('ip-load-paste')
const statusEl     = document.getElementById('ip-status')

const colPanel     = document.getElementById('ip-col-panel')
const xColSelect   = document.getElementById('ip-x-col')
const yColSelect   = document.getElementById('ip-y-col')

const interpPanel  = document.getElementById('ip-interp-panel')
const methodSelect = document.getElementById('ip-method')
const npointsInput = document.getElementById('ip-npoints')
const xminInput    = document.getElementById('ip-xmin')
const xmaxInput    = document.getElementById('ip-xmax')

const exportPanel  = document.getElementById('ip-export-panel')
const dlBtn        = document.getElementById('ip-dl')

const plotEl       = document.getElementById('ip-plot')

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

function debounce(fn, ms) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
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
  interpPanel.style.display = ''
  exportPanel.style.display = ''

  showStatus(
    `Loaded <strong>${escapeHtml(sourceName)}</strong> — ${result.data.length} rows, ${result.meta.fields.length} columns.`,
    'success'
  )

  extractAndInterpolate()
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

xColSelect.addEventListener('change', () => extractAndInterpolate())
yColSelect.addEventListener('change', () => extractAndInterpolate())

function extractColumns() {
  if (!parsedData) return false
  const xHeader = parsedData.headers[+xColSelect.value]
  const yHeader = parsedData.headers[+yColSelect.value]
  const pairs = []

  for (const row of parsedData.rows) {
    const xv = Number(row[xHeader])
    const yv = Number(row[yHeader])
    if (!isNaN(xv) && !isNaN(yv)) {
      pairs.push([xv, yv])
    }
  }

  if (pairs.length < 2) {
    showStatus('Need at least 2 valid numeric rows.', 'danger')
    return false
  }

  // Sort by x
  pairs.sort((a, b) => a[0] - b[0])

  // Remove duplicate x values (keep last occurrence)
  const deduped = []
  for (let i = 0; i < pairs.length; i++) {
    if (i < pairs.length - 1 && pairs[i][0] === pairs[i + 1][0]) continue
    deduped.push(pairs[i])
  }

  if (deduped.length < 2) {
    showStatus('Need at least 2 unique x values.', 'danger')
    return false
  }

  xData = deduped.map((p) => p[0])
  yData = deduped.map((p) => p[1])
  return true
}

// ---------------------------------------------------------------------------
// Interpolation parameter changes
// ---------------------------------------------------------------------------
const scheduleInterp = debounce(() => {
  if (!parsedData) return
  applyInterpolation()
  updatePlot()
}, 200)

methodSelect.addEventListener('change', scheduleInterp)
npointsInput.addEventListener('input', scheduleInterp)
xminInput.addEventListener('input', scheduleInterp)
xmaxInput.addEventListener('input', scheduleInterp)

// ---------------------------------------------------------------------------
// Interpolation algorithms
// ---------------------------------------------------------------------------

/**
 * Piecewise linear interpolation.
 */
function interpLinear(xs, ys, xOut) {
  const n = xs.length
  const out = new Float64Array(xOut.length)
  for (let k = 0; k < xOut.length; k++) {
    const xq = xOut[k]
    if (xq <= xs[0]) {
      out[k] = ys[0]
      continue
    }
    if (xq >= xs[n - 1]) {
      out[k] = ys[n - 1]
      continue
    }
    // Binary search for the bracket
    let lo = 0, hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (xs[mid] <= xq) lo = mid
      else hi = mid
    }
    const t = (xq - xs[lo]) / (xs[hi] - xs[lo])
    out[k] = ys[lo] + t * (ys[hi] - ys[lo])
  }
  return out
}

/**
 * Natural cubic spline interpolation.
 *
 * Given N data points, computes N-1 cubic polynomials with natural boundary
 * conditions (second derivative = 0 at endpoints). Uses the Thomas algorithm
 * to solve the tridiagonal system for the second derivatives M[i].
 *
 * Reference: De Boor, C. (1978). A Practical Guide to Splines. Springer.
 */
function interpCubicSpline(xs, ys, xOut) {
  const n = xs.length
  if (n === 2) return interpLinear(xs, ys, xOut)

  // Step a: compute intervals h[i] = x[i+1] - x[i]
  const h = new Float64Array(n - 1)
  for (let i = 0; i < n - 1; i++) {
    h[i] = xs[i + 1] - xs[i]
  }

  // Step b: set up tridiagonal system for M[i] (second derivatives)
  // Natural boundary: M[0] = 0, M[n-1] = 0
  // Interior equations (i = 1..n-2):
  //   h[i-1]*M[i-1] + 2*(h[i-1]+h[i])*M[i] + h[i]*M[i+1]
  //     = 6*((y[i+1]-y[i])/h[i] - (y[i]-y[i-1])/h[i-1])
  const nm = n - 2 // number of interior unknowns
  if (nm === 0) {
    // Only 2 points, fall back to linear
    return interpLinear(xs, ys, xOut)
  }

  // Tridiagonal system arrays (for indices 1..n-2, stored 0..nm-1)
  const a = new Float64Array(nm) // sub-diagonal
  const b = new Float64Array(nm) // main diagonal
  const c = new Float64Array(nm) // super-diagonal
  const d = new Float64Array(nm) // right-hand side

  for (let j = 0; j < nm; j++) {
    const i = j + 1 // original index
    a[j] = h[i - 1]
    b[j] = 2 * (h[i - 1] + h[i])
    c[j] = h[i]
    d[j] = 6 * ((ys[i + 1] - ys[i]) / h[i] - (ys[i] - ys[i - 1]) / h[i - 1])
  }

  // Step c: Thomas algorithm (tridiagonal solver)
  // Forward sweep
  for (let j = 1; j < nm; j++) {
    const w = a[j] / b[j - 1]
    b[j] -= w * c[j - 1]
    d[j] -= w * d[j - 1]
  }
  // Back substitution
  const M = new Float64Array(n) // M[0] = M[n-1] = 0
  M[nm] = d[nm - 1] / b[nm - 1] // M[n-2] stored at index nm = n-2
  for (let j = nm - 2; j >= 0; j--) {
    M[j + 1] = (d[j] - c[j] * M[j + 2]) / b[j]
  }
  // M[0] and M[n-1] remain 0 (natural boundary)

  // Step d: evaluate spline for each output x
  const out = new Float64Array(xOut.length)
  for (let k = 0; k < xOut.length; k++) {
    const xq = xOut[k]
    // Clamp to data range
    if (xq <= xs[0]) { out[k] = ys[0]; continue }
    if (xq >= xs[n - 1]) { out[k] = ys[n - 1]; continue }

    // Binary search for interval
    let lo = 0, hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (xs[mid] <= xq) lo = mid
      else hi = mid
    }

    const i = lo
    const t = (xq - xs[i]) / h[i]
    // y = (1-t)*y[i] + t*y[i+1]
    //   + h[i]^2/6 * ((1-t)^3 - (1-t))*M[i]
    //   + h[i]^2/6 * (t^3 - t)*M[i+1]
    const h2over6 = (h[i] * h[i]) / 6
    const omt = 1 - t
    out[k] = omt * ys[i] + t * ys[i + 1]
            + h2over6 * (omt * omt * omt - omt) * M[i]
            + h2over6 * (t * t * t - t) * M[i + 1]
  }
  return out
}

/**
 * Nearest-neighbor interpolation.
 */
function interpNearest(xs, ys, xOut) {
  const n = xs.length
  const out = new Float64Array(xOut.length)
  for (let k = 0; k < xOut.length; k++) {
    const xq = xOut[k]
    if (xq <= xs[0]) { out[k] = ys[0]; continue }
    if (xq >= xs[n - 1]) { out[k] = ys[n - 1]; continue }

    // Binary search for closest
    let lo = 0, hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (xs[mid] <= xq) lo = mid
      else hi = mid
    }
    out[k] = (xq - xs[lo] <= xs[hi] - xq) ? ys[lo] : ys[hi]
  }
  return out
}

// ---------------------------------------------------------------------------
// Generate output x grid and apply interpolation
// ---------------------------------------------------------------------------
function applyInterpolation() {
  if (!xData.length) return

  const nRaw = parseInt(npointsInput.value, 10)
  const npoints = (isNaN(nRaw) || nRaw < 2) ? 500 : Math.min(nRaw, 100000)

  const xminRaw = xminInput.value.trim()
  const xmaxRaw = xmaxInput.value.trim()
  const xmin = (xminRaw === '' || isNaN(Number(xminRaw))) ? xData[0] : Number(xminRaw)
  const xmax = (xmaxRaw === '' || isNaN(Number(xmaxRaw))) ? xData[xData.length - 1] : Number(xmaxRaw)

  if (xmin >= xmax) {
    showStatus('X min must be less than X max.', 'danger')
    return
  }

  // Generate uniformly spaced output x values
  const xOut = new Float64Array(npoints)
  const step = (xmax - xmin) / (npoints - 1)
  for (let i = 0; i < npoints; i++) {
    xOut[i] = xmin + i * step
  }

  const method = methodSelect.value
  let yOut
  switch (method) {
    case 'linear':
      yOut = interpLinear(xData, yData, xOut)
      break
    case 'spline':
      yOut = interpCubicSpline(xData, yData, xOut)
      break
    case 'nearest':
      yOut = interpNearest(xData, yData, xOut)
      break
    default:
      yOut = interpLinear(xData, yData, xOut)
  }

  interpX = Array.from(xOut)
  interpY = Array.from(yOut)
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------
function extractAndInterpolate() {
  if (!extractColumns()) return
  applyInterpolation()
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

  // Original data as scatter markers
  traces.push({
    x: xData,
    y: yData,
    mode: 'markers',
    name: 'Original',
    marker: { color: '#4c9aff', size: 6, symbol: 'circle' },
  })

  // Interpolated curve as a line
  traces.push({
    x: interpX,
    y: interpY,
    mode: 'lines',
    name: 'Interpolated',
    line: { color: '#2ea043', width: 2 },
  })

  const layout = getLayout()
  layout.xaxis.title = xLabel
  layout.yaxis.title = yLabel

  Plotly.react(plotEl, traces, layout, baseConfig('interpolated-data'))
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
dlBtn.addEventListener('click', () => {
  if (!interpX.length) return
  const rows = interpX.map((x, i) => [x, interpY[i]])
  downloadCSV(toCSV(['x', 'y_interpolated'], rows), 'interpolated.csv')
})

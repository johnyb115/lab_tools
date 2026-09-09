import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { downloadCSV, toCSV } from '../shared/download.js'
import { Plotly, baseLayout, baseConfig, colorForIndex } from '../shared/plotlySetup.js'
import Papa from 'papaparse'

initChrome('baseline-correction')

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let parsedData = null   // { headers: string[], rows: object[] }
let xData = []
let yData = []
let baseline = []
let corrected = []

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const dropzone     = document.getElementById('bl-dropzone')
const fileInput    = document.getElementById('bl-file-input')
const pasteArea    = document.getElementById('bl-paste')
const loadPasteBtn = document.getElementById('bl-load-paste')
const statusEl     = document.getElementById('bl-status')

const colPanel     = document.getElementById('bl-col-panel')
const xColSelect   = document.getElementById('bl-x-col')
const yColSelect   = document.getElementById('bl-y-col')

const methodPanel  = document.getElementById('bl-method-panel')
const methodSelect = document.getElementById('bl-method')

const exportPanel  = document.getElementById('bl-export-panel')
const dlCorrected  = document.getElementById('bl-dl-corrected')
const dlBaseline   = document.getElementById('bl-dl-baseline')

const plotEl       = document.getElementById('bl-plot')

// Method-specific option containers
const optsPoly = document.getElementById('bl-opts-poly')
const optsAls  = document.getElementById('bl-opts-als')

// Method-specific controls
const polyDeg      = document.getElementById('bl-poly-deg')
const polyDegVal   = document.getElementById('bl-poly-deg-val')
const alsLambda    = document.getElementById('bl-als-lambda')
const alsLambdaVal = document.getElementById('bl-als-lambda-val')
const alsP         = document.getElementById('bl-als-p')
const alsPVal      = document.getElementById('bl-als-p-val')

// ---------------------------------------------------------------------------
// Theme change
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
  methodPanel.style.display = ''
  exportPanel.style.display = ''

  showStatus(
    `Loaded <strong>${escapeHtml(sourceName)}</strong> — ${result.data.length} rows, ${result.meta.fields.length} columns.`,
    'success'
  )

  extractAndCompute()
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

xColSelect.addEventListener('change', () => extractAndCompute())
yColSelect.addEventListener('change', () => extractAndCompute())

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

  // Sort by x for baseline algorithms
  const indices = xRaw.map((_, i) => i)
  indices.sort((a, b) => xRaw[a] - xRaw[b])
  xData = indices.map((i) => xRaw[i])
  yData = indices.map((i) => yRaw[i])
  return true
}

// ---------------------------------------------------------------------------
// Method UI switching
// ---------------------------------------------------------------------------
methodSelect.addEventListener('change', () => {
  const m = methodSelect.value
  optsPoly.hidden = m !== 'poly'
  optsAls.hidden  = m !== 'als'
  scheduleCompute()
})

// ---------------------------------------------------------------------------
// Slider wiring and live updates
// ---------------------------------------------------------------------------
const scheduleCompute = debounce(() => {
  if (!parsedData) return
  computeBaseline()
  updatePlot()
}, 100)

function wireSlider(slider, display, formatter) {
  slider.addEventListener('input', () => {
    display.textContent = formatter(slider.value)
    scheduleCompute()
  })
}

wireSlider(polyDeg, polyDegVal, (v) => v)

wireSlider(alsLambda, alsLambdaVal, (v) => {
  const exp = Number(v)
  return (Math.pow(10, exp)).toExponential(1).replace('+', '')
})

wireSlider(alsP, alsPVal, (v) => Number(v).toFixed(3))

// ---------------------------------------------------------------------------
// Matrix utilities
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Baseline algorithms
// ---------------------------------------------------------------------------

/**
 * Linear baseline: straight line from first to last data point.
 */
function linearBaseline(x, y) {
  const n = x.length
  const bl = new Float64Array(n)
  const x0 = x[0], xN = x[n - 1]
  const y0 = y[0], yN = y[n - 1]
  const dx = xN - x0
  if (Math.abs(dx) < 1e-30) {
    // All x values are the same; flat baseline
    bl.fill((y0 + yN) / 2)
    return bl
  }
  const slope = (yN - y0) / dx
  for (let i = 0; i < n; i++) {
    bl[i] = y0 + slope * (x[i] - x0)
  }
  return bl
}

/**
 * Polynomial baseline: least-squares fit of degree d to all data points.
 * Uses normalized x values for numerical stability.
 */
function polyBaseline(x, y, degree) {
  const n = x.length
  const d = Math.min(degree, n - 1)

  // Normalize x to [-1, 1] for numerical stability
  const xMin = x[0]
  const xMax = x[n - 1]
  const xRange = xMax - xMin
  const xNorm = (xRange > 0)
    ? x.map((v) => 2 * (v - xMin) / xRange - 1)
    : x.map(() => 0)

  const m = d + 1  // number of coefficients

  // Build normal equations: (V'V) c = V'y
  const VtV = Array.from({ length: m }, () => new Float64Array(m))
  const Vty = new Float64Array(m)

  for (let i = 0; i < n; i++) {
    const powers = new Float64Array(m)
    powers[0] = 1
    for (let j = 1; j < m; j++) powers[j] = powers[j - 1] * xNorm[i]

    for (let a = 0; a < m; a++) {
      Vty[a] += powers[a] * y[i]
      for (let b = 0; b < m; b++) {
        VtV[a][b] += powers[a] * powers[b]
      }
    }
  }

  // Solve via matrix inversion
  const inv = invertMatrix(VtV.map((r) => Array.from(r)))
  if (!inv) {
    // Fallback to linear if singular
    return linearBaseline(x, y)
  }

  const coeffs = new Float64Array(m)
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      coeffs[i] += inv[i][j] * Vty[j]
    }
  }

  // Evaluate polynomial at all x points
  const bl = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let val = coeffs[d]
    for (let j = d - 1; j >= 0; j--) {
      val = val * xNorm[i] + coeffs[j]
    }
    bl[i] = val
  }

  return bl
}

/**
 * Asymmetric Least Squares (ALS) baseline estimation.
 *
 * Implements the Whittaker smoother with asymmetric weights, as described in:
 *   Eilers, P. H. C. & Boelens, H. F. M. (2005).
 *   "Baseline Correction with Asymmetric Least Squares Smoothing."
 *   Leiden University Medical Centre report.
 *
 * Solves: (W + lambda * D'D) z = W y  iteratively,
 * where D is the second-difference matrix and W = diag(w).
 * Uses banded Cholesky decomposition for the pentadiagonal system.
 */
function alsBaseline(x, y, lambda, p) {
  const n = y.length
  if (n < 3) return linearBaseline(x, y)

  // Build D'D diagonals (second-difference penalty matrix)
  // D is (n-2) x n, D'D is n x n pentadiagonal
  const dd0 = new Float64Array(n) // main diagonal
  const dd1 = new Float64Array(n) // first off-diagonal (length n-1, indexed 0..n-2)
  const dd2 = new Float64Array(n) // second off-diagonal (length n-2, indexed 0..n-3)

  // Main diagonal of D'D
  for (let i = 0; i < n; i++) {
    let v = 0
    if (i <= n - 3) v += 1        // from D[i,i]^2
    if (i >= 1 && i <= n - 2) v += 4  // from D[i-1,i]^2
    if (i >= 2) v += 1            // from D[i-2,i]^2
    dd0[i] = v
  }

  // First off-diagonal of D'D
  for (let i = 0; i < n - 1; i++) {
    let v = 0
    if (i <= n - 3) v += -2       // D[i,i]*D[i,i+1]
    if (i >= 1 && i <= n - 2) v += -2  // D[i-1,i]*D[i-1,i+1]
    dd1[i] = v
  }

  // Second off-diagonal of D'D: always 1
  for (let i = 0; i < n - 2; i++) {
    dd2[i] = 1
  }

  // Iterative ALS
  const w = new Float64Array(n).fill(1)
  let z = new Float64Array(y)
  const maxIter = 20
  const tol = 1e-6

  for (let iter = 0; iter < maxIter; iter++) {
    // Build H = W + lambda * D'D (pentadiagonal, symmetric)
    // Store as three diagonals: h0 (main), h1 (first off), h2 (second off)
    const h0 = new Float64Array(n)
    const h1 = new Float64Array(n)
    const h2 = new Float64Array(n)

    for (let i = 0; i < n; i++) h0[i] = w[i] + lambda * dd0[i]
    for (let i = 0; i < n - 1; i++) h1[i] = lambda * dd1[i]
    for (let i = 0; i < n - 2; i++) h2[i] = lambda * dd2[i]

    // Right-hand side: W * y
    const rhs = new Float64Array(n)
    for (let i = 0; i < n; i++) rhs[i] = w[i] * y[i]

    // Solve H * z_new = rhs via banded Cholesky
    const zNew = bandedCholeskySolve(h0, h1, h2, rhs, n)
    if (!zNew) {
      // Fallback if Cholesky fails
      return linearBaseline(x, y)
    }

    // Check convergence
    let maxDiff = 0
    let maxVal = 0
    for (let i = 0; i < n; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(zNew[i] - z[i]))
      maxVal = Math.max(maxVal, Math.abs(zNew[i]))
    }
    z = zNew

    if (maxVal > 0 && maxDiff / maxVal < tol) break

    // Update weights
    for (let i = 0; i < n; i++) {
      w[i] = y[i] > z[i] ? p : (1 - p)
    }
  }

  return z
}

/**
 * Banded Cholesky decomposition and solve for a symmetric positive-definite
 * pentadiagonal matrix stored as three diagonals:
 *   h0[i] = H[i,i],  h1[i] = H[i,i+1],  h2[i] = H[i,i+2]
 *
 * Computes H = L L^T where L is lower triangular with bandwidth 2:
 *   l0[i] = L[i,i],  l1[i] = L[i+1,i],  l2[i] = L[i+2,i]
 *
 * Then solves L L^T x = b via forward and back substitution.
 */
function bandedCholeskySolve(h0, h1, h2, b, n) {
  const l0 = new Float64Array(n)
  const l1 = new Float64Array(n)
  const l2 = new Float64Array(n)

  // Cholesky factorization
  for (let j = 0; j < n; j++) {
    let s = h0[j]
    if (j >= 1) s -= l1[j - 1] * l1[j - 1]
    if (j >= 2) s -= l2[j - 2] * l2[j - 2]
    if (s <= 0) return null  // not positive definite
    l0[j] = Math.sqrt(s)

    if (j < n - 1) {
      s = h1[j]
      if (j >= 1) s -= l2[j - 1] * l1[j - 1]
      l1[j] = s / l0[j]
    }

    if (j < n - 2) {
      l2[j] = h2[j] / l0[j]
    }
  }

  // Forward substitution: L y' = b
  const yp = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = b[i]
    if (i >= 1) s -= l1[i - 1] * yp[i - 1]
    if (i >= 2) s -= l2[i - 2] * yp[i - 2]
    yp[i] = s / l0[i]
  }

  // Back substitution: L^T x = y'
  const x = new Float64Array(n)
  for (let i = n - 1; i >= 0; i--) {
    let s = yp[i]
    if (i < n - 1) s -= l1[i] * x[i + 1]
    if (i < n - 2) s -= l2[i] * x[i + 2]
    x[i] = s / l0[i]
  }

  return x
}

/**
 * Rubber band / convex hull baseline.
 * Computes the lower convex hull of the data and linearly interpolates
 * between hull vertices to form the baseline.
 */
function rubberbandBaseline(x, y) {
  const n = x.length
  if (n < 3) return linearBaseline(x, y)

  // Build lower convex hull (Andrew's monotone chain, lower part)
  // Data is already sorted by x
  const hull = [] // indices into x,y
  for (let i = 0; i < n; i++) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2]
      const b = hull[hull.length - 1]
      // Cross product: (B - A) x (P - A)
      const cross =
        (x[b] - x[a]) * (y[i] - y[a]) -
        (y[b] - y[a]) * (x[i] - x[a])
      if (cross <= 0) {
        // Right turn or collinear: remove middle point
        hull.pop()
      } else {
        break
      }
    }
    hull.push(i)
  }

  // Interpolate between hull vertices
  const bl = new Float64Array(n)
  let hi = 0  // current hull segment index
  for (let i = 0; i < n; i++) {
    // Advance to the correct hull segment
    while (hi < hull.length - 2 && x[i] >= x[hull[hi + 1]]) hi++

    const a = hull[hi]
    const b = hull[hi + 1]
    const dx = x[b] - x[a]
    if (Math.abs(dx) < 1e-30) {
      bl[i] = y[a]
    } else {
      const t = (x[i] - x[a]) / dx
      bl[i] = y[a] + t * (y[b] - y[a])
    }
  }

  return bl
}

// ---------------------------------------------------------------------------
// Baseline dispatcher
// ---------------------------------------------------------------------------
function computeBaseline() {
  if (!yData.length) return

  const method = methodSelect.value
  switch (method) {
    case 'linear':
      baseline = linearBaseline(xData, yData)
      break
    case 'poly':
      baseline = polyBaseline(xData, yData, +polyDeg.value)
      break
    case 'als': {
      const lam = Math.pow(10, Number(alsLambda.value))
      const pVal = Number(alsP.value)
      baseline = alsBaseline(xData, yData, lam, pVal)
      break
    }
    case 'rubberband':
      baseline = rubberbandBaseline(xData, yData)
      break
  }

  // Compute corrected signal
  corrected = new Float64Array(yData.length)
  for (let i = 0; i < yData.length; i++) {
    corrected[i] = yData[i] - baseline[i]
  }
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------
function extractAndCompute() {
  if (!extractColumns()) return
  computeBaseline()
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

  const traces = [
    {
      x: xData,
      y: Array.from(yData),
      mode: 'lines',
      name: 'Original',
      line: { color: '#4c9aff', width: 1.5 },
    },
    {
      x: xData,
      y: Array.from(baseline),
      mode: 'lines',
      name: 'Baseline',
      line: { color: '#ef4444', width: 2, dash: 'dash' },
    },
    {
      x: xData,
      y: Array.from(corrected),
      mode: 'lines',
      name: 'Corrected',
      line: { color: '#22c55e', width: 1.5 },
    },
  ]

  const layout = getLayout()
  layout.xaxis.title = xLabel
  layout.yaxis.title = yLabel

  Plotly.react(plotEl, traces, layout, baseConfig('baseline-corrected'))
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
dlCorrected.addEventListener('click', () => {
  const xH = parsedData.headers[+xColSelect.value]
  const yH = parsedData.headers[+yColSelect.value]
  const rows = xData.map((x, i) => [x, yData[i], baseline[i], corrected[i]])
  downloadCSV(
    toCSV([xH, yH + '_original', 'baseline', yH + '_corrected'], rows),
    'baseline_corrected.csv'
  )
})

dlBaseline.addEventListener('click', () => {
  const xH = parsedData.headers[+xColSelect.value]
  const rows = xData.map((x, i) => [x, baseline[i]])
  downloadCSV(toCSV([xH, 'baseline'], rows), 'baseline.csv')
})

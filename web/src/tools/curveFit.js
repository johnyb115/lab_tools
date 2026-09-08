import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { downloadBlob, downloadCSV, toCSV } from '../shared/download.js'
import { parseDelimitedText, parseTableFile, numericColumn } from '../shared/parseTable.js'
import { Plotly, baseLayout, baseConfig, colorForIndex } from '../shared/plotlySetup.js'
import { escapeHtml } from '../shared/dom.js'
import { levenbergMarquardt } from 'ml-levenberg-marquardt'

initChrome('curve-fit')

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let parsed = null        // { columns, rows }
let xData = []           // numeric arrays after column selection
let yData = []
let fitResult = null     // { params, errors, gof, model, curveX, curveY, residuals }

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const dropzone      = document.getElementById('cf-dropzone')
const fileInput     = document.getElementById('cf-file-input')
const pasteArea     = document.getElementById('cf-paste-area')
const parsePasteBtn = document.getElementById('cf-parse-paste-btn')
const exampleSelect = document.getElementById('cf-example-select')
const dataStatus    = document.getElementById('cf-data-status')

const colPanel  = document.getElementById('cf-col-panel')
const xColSel   = document.getElementById('cf-x-col')
const yColSel   = document.getElementById('cf-y-col')
const rowCount  = document.getElementById('cf-row-count')

const modelPanel  = document.getElementById('cf-model-panel')
const modelSel    = document.getElementById('cf-model')
const degreeSel   = document.getElementById('cf-degree')
const degreeWrap  = document.getElementById('cf-degree-wrap')
const paramsDiv   = document.getElementById('cf-model-params')
const fitBtn      = document.getElementById('cf-fit-btn')

const resultsPanel = document.getElementById('cf-results-panel')
const eqDiv        = document.getElementById('cf-equation')
const resultsTbody = document.getElementById('cf-results-tbody')
const gofDiv       = document.getElementById('cf-gof')

const dlCurve    = document.getElementById('cf-dl-curve')
const dlResid    = document.getElementById('cf-dl-residuals')
const dlSummary  = document.getElementById('cf-dl-summary')

const plotEl         = document.getElementById('cf-plot')
const residToggle    = document.getElementById('cf-residual-toggle')
const showResidualsC = document.getElementById('cf-show-residuals')

// ---------------------------------------------------------------------------
// Model definitions
// ---------------------------------------------------------------------------
const MODELS = {
  linear: {
    label: 'Linear',
    eq: 'y = a·x + b',
    paramNames: ['a', 'b'],
    isLinear: true,
    fn: ([a, b]) => (x) => a * x + b,
    guess(x, y) {
      const n = x.length
      const sx = x.reduce((a, v) => a + v, 0)
      const sy = y.reduce((a, v) => a + v, 0)
      const sxy = x.reduce((a, v, i) => a + v * y[i], 0)
      const sx2 = x.reduce((a, v) => a + v * v, 0)
      const a = (n * sxy - sx * sy) / (n * sx2 - sx * sx)
      const b = (sy - a * sx) / n
      return [a, b]
    },
  },
  polynomial: {
    label: 'Polynomial',
    eq: (deg) => 'y = ' + Array.from({ length: deg + 1 }, (_, i) =>
      i === 0 ? 'a₀' : i === 1 ? `a₁·x` : `a${subscript(i)}·x${superscript(i)}`
    ).reverse().join(' + '),
    paramNames: (deg) => Array.from({ length: deg + 1 }, (_, i) => `a${i}`),
    isLinear: true,
    fn: (params) => (x) => {
      let v = 0
      for (let i = 0; i < params.length; i++) v += params[i] * Math.pow(x, i)
      return v
    },
    guess(x, y, deg) {
      return new Array(deg + 1).fill(0).map((_, i) => i === 0 ? mean(y) : 0)
    },
  },
  'exp-growth': {
    label: 'Exponential growth',
    eq: 'y = a·exp(b·x)',
    paramNames: ['a', 'b'],
    fn: ([a, b]) => (x) => a * Math.exp(b * x),
    guess(x, y) {
      const posY = y.map(v => Math.max(v, 1e-30))
      const lnY = posY.map(Math.log)
      const n = x.length
      const sx = x.reduce((a, v) => a + v, 0)
      const sly = lnY.reduce((a, v) => a + v, 0)
      const sxly = x.reduce((a, v, i) => a + v * lnY[i], 0)
      const sx2 = x.reduce((a, v) => a + v * v, 0)
      const b = (n * sxly - sx * sly) / (n * sx2 - sx * sx)
      const a = Math.exp((sly - b * sx) / n)
      return [isFinite(a) ? a : 1, isFinite(b) ? b : 0.1]
    },
  },
  'exp-decay': {
    label: 'Exponential decay',
    eq: 'y = a·exp(−b·x) + c',
    paramNames: ['a', 'b', 'c'],
    fn: ([a, b, c]) => (x) => a * Math.exp(-b * x) + c,
    guess(x, y) {
      const c = y[y.length - 1]
      const a = y[0] - c
      const shifted = y.map(v => Math.max(v - c, 1e-30))
      const mid = Math.floor(x.length / 2)
      const b = mid > 0 ? -Math.log(shifted[mid] / shifted[0]) / (x[mid] - x[0]) : 0.1
      return [isFinite(a) ? a : 1, isFinite(b) && b > 0 ? b : 0.1, isFinite(c) ? c : 0]
    },
  },
  gaussian: {
    label: 'Gaussian',
    eq: 'y = a·exp(−(x−b)²/(2c²))',
    paramNames: ['a', 'b', 'c'],
    fn: ([a, b, c]) => (x) => a * Math.exp(-((x - b) ** 2) / (2 * c * c)),
    guess(x, y) {
      const maxIdx = y.indexOf(Math.max(...y))
      const a = y[maxIdx]
      const b = x[maxIdx]
      const halfMax = a / 2
      let fwhmLeft = x[0], fwhmRight = x[x.length - 1]
      for (let i = maxIdx; i >= 0; i--) {
        if (y[i] < halfMax) { fwhmLeft = x[i]; break }
      }
      for (let i = maxIdx; i < x.length; i++) {
        if (y[i] < halfMax) { fwhmRight = x[i]; break }
      }
      const fwhm = Math.abs(fwhmRight - fwhmLeft)
      const c = fwhm / 2.355 // FWHM = 2·sqrt(2·ln2)·sigma
      return [isFinite(a) ? a : 1, isFinite(b) ? b : 0, isFinite(c) && c > 0 ? c : 1]
    },
  },
  power: {
    label: 'Power law',
    eq: 'y = a·x^b',
    paramNames: ['a', 'b'],
    fn: ([a, b]) => (x) => a * Math.pow(x, b),
    guess(x, y) {
      const posX = x.filter((v, i) => v > 0 && y[i] > 0)
      const posY = y.filter((v, i) => x[i] > 0 && v > 0)
      if (posX.length < 2) return [1, 1]
      const lnX = posX.map(Math.log)
      const lnY = posY.map(Math.log)
      const n = lnX.length
      const sx = lnX.reduce((a, v) => a + v, 0)
      const sy = lnY.reduce((a, v) => a + v, 0)
      const sxy = lnX.reduce((a, v, i) => a + v * lnY[i], 0)
      const sx2 = lnX.reduce((a, v) => a + v * v, 0)
      const b = (n * sxy - sx * sy) / (n * sx2 - sx * sx)
      const a = Math.exp((sy - b * sx) / n)
      return [isFinite(a) ? a : 1, isFinite(b) ? b : 1]
    },
  },
  logarithmic: {
    label: 'Logarithmic',
    eq: 'y = a·ln(x) + b',
    paramNames: ['a', 'b'],
    isLinear: true,
    fn: ([a, b]) => (x) => a * Math.log(x) + b,
    guess(x, y) {
      const posX = x.filter(v => v > 0)
      const posY = y.filter((_, i) => x[i] > 0)
      if (posX.length < 2) return [1, 0]
      const lnX = posX.map(Math.log)
      const n = lnX.length
      const sx = lnX.reduce((a, v) => a + v, 0)
      const sy = posY.reduce((a, v) => a + v, 0)
      const sxy = lnX.reduce((a, v, i) => a + v * posY[i], 0)
      const sx2 = lnX.reduce((a, v) => a + v * v, 0)
      const a = (n * sxy - sx * sy) / (n * sx2 - sx * sx)
      const b = (sy - a * sx) / n
      return [isFinite(a) ? a : 1, isFinite(b) ? b : 0]
    },
  },
  arrhenius: {
    label: 'Arrhenius',
    eq: 'k = A·exp(−Eₐ/(R·T))  →  ln(k) = ln(A) − Eₐ/R · 1/T',
    paramNames: ['A', 'Ea'],
    fn: ([A, Ea]) => {
      const R = 8.314462
      return (T) => A * Math.exp(-Ea / (R * T))
    },
    guess(x, y) {
      const R = 8.314462
      const posY = y.map(v => Math.max(v, 1e-30))
      const invT = x.map(v => 1 / v)
      const lnK = posY.map(Math.log)
      const n = invT.length
      const sx = invT.reduce((a, v) => a + v, 0)
      const sy = lnK.reduce((a, v) => a + v, 0)
      const sxy = invT.reduce((a, v, i) => a + v * lnK[i], 0)
      const sx2 = invT.reduce((a, v) => a + v * v, 0)
      const slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx)
      const intercept = (sy - slope * sx) / n
      const Ea = -slope * R
      const A = Math.exp(intercept)
      return [isFinite(A) ? A : 1, isFinite(Ea) ? Ea : 50000]
    },
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mean(arr) { return arr.reduce((s, v) => s + v, 0) / arr.length }

function subscript(n) {
  const map = '₀₁₂₃₄₅₆₇₈₉'
  return String(n).split('').map(c => map[+c] || c).join('')
}

function superscript(n) {
  const map = '⁰¹²³⁴⁵⁶⁷⁸⁹'
  return String(n).split('').map(c => map[+c] || c).join('')
}

function formatSci(v, digits = 5) {
  if (!isFinite(v)) return String(v)
  if (Math.abs(v) < 1e-15) return '0'
  if (Math.abs(v) >= 0.001 && Math.abs(v) < 1e6) return v.toPrecision(digits)
  return v.toExponential(digits - 1)
}

function setStatus(html) {
  dataStatus.innerHTML = html
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
initDropzone(dropzone, fileInput, async (files) => {
  try {
    parsed = await parseTableFile(files[0])
    if (!parsed.columns.length || !parsed.rows.length) throw new Error('No data found.')
    onDataLoaded(files[0].name)
  } catch (err) {
    setStatus(`<div class="alert alert-danger">${escapeHtml(err.message)}</div>`)
  }
})

parsePasteBtn.addEventListener('click', () => {
  const text = pasteArea.value.trim()
  if (!text) return setStatus('<div class="alert alert-danger">Paste some data first.</div>')
  try {
    parsed = parseDelimitedText(text)
    if (!parsed.columns.length || !parsed.rows.length) throw new Error('No data rows found.')
    onDataLoaded('pasted data')
  } catch (err) {
    setStatus(`<div class="alert alert-danger">${escapeHtml(err.message)}</div>`)
  }
})

// ---------------------------------------------------------------------------
// Example datasets
// ---------------------------------------------------------------------------
function noise(i, amplitude) {
  return amplitude * (Math.sin(i * 7.3 + 0.5) * Math.cos(i * 3.1) * 2)
}

function linspace(start, end, n) {
  return Array.from({ length: n }, (_, i) => start + (end - start) * i / (n - 1))
}

const EXAMPLES = {
  linear: {
    xLabel: 'Current_A',
    yLabel: 'Voltage_V',
    model: 'linear',
    generate() {
      const R = 47
      const x = linspace(0, 0.5, 30)
      const y = x.map((I, i) => R * I + noise(i, 0.4))
      return { x, y }
    },
  },
  polynomial: {
    xLabel: 'Time_s',
    yLabel: 'Height_m',
    model: 'polynomial',
    generate() {
      const x = linspace(0, 4.2, 35)
      const y = x.map((t, i) => -4.9 * t * t + 20 * t + 1.5 + noise(i, 0.3))
      return { x, y }
    },
  },
  'exp-growth': {
    xLabel: 'Time_h',
    yLabel: 'Cell_count',
    model: 'exp-growth',
    generate() {
      const x = linspace(0, 10, 40)
      const y = x.map((t, i) => 100 * Math.exp(0.35 * t) + noise(i, 8))
      return { x, y }
    },
  },
  'exp-decay': {
    xLabel: 'Time_s',
    yLabel: 'Voltage_V',
    model: 'exp-decay',
    generate() {
      const x = linspace(0, 10, 40)
      const y = x.map((t, i) => 5 * Math.exp(-0.5 * t) + 0.1 + noise(i, 0.08))
      return { x, y }
    },
  },
  gaussian: {
    xLabel: 'Wavelength_nm',
    yLabel: 'Intensity',
    model: 'gaussian',
    generate() {
      const x = linspace(460, 600, 50)
      const y = x.map((lam, i) => {
        const peak = 1000 * Math.exp(-((lam - 532) ** 2) / (2 * 15 * 15))
        return peak + noise(i, 18)
      })
      return { x, y }
    },
  },
  power: {
    xLabel: 'Body_mass_kg',
    yLabel: 'Metabolic_rate_W',
    model: 'power',
    generate() {
      const x = []
      // log-spaced from 0.1 to 100
      for (let i = 0; i < 30; i++) {
        x.push(Math.pow(10, -1 + 3 * i / 29))
      }
      const y = x.map((W, i) => 70 * Math.pow(W, 0.75) + noise(i, 3))
      return { x, y }
    },
  },
  logarithmic: {
    xLabel: 'Concentration_M',
    yLabel: 'Voltage_mV',
    model: 'logarithmic',
    generate() {
      const x = []
      // log-spaced from 0.001 to 1
      for (let i = 0; i < 25; i++) {
        x.push(Math.pow(10, -3 + 3 * i / 24))
      }
      const y = x.map((c, i) => -59.2 * Math.log(c) + 200 + noise(i, 4))
      return { x, y }
    },
  },
  arrhenius: {
    xLabel: 'Temperature_K',
    yLabel: 'Rate_constant',
    model: 'arrhenius',
    generate() {
      const x = linspace(300, 600, 25)
      const R = 8.314462
      const y = x.map((T, i) => {
        const k = 1e13 * Math.exp(-80000 / (R * T))
        return k + noise(i, k * 0.05)
      })
      return { x, y }
    },
  },
}

exampleSelect.addEventListener('change', () => {
  const key = exampleSelect.value
  if (!key) return
  const example = EXAMPLES[key]
  const { x, y } = example.generate()

  // Format as CSV
  const lines = [example.xLabel + ',' + example.yLabel]
  for (let i = 0; i < x.length; i++) {
    lines.push(x[i].toPrecision(6) + ',' + y[i].toPrecision(6))
  }
  const csv = lines.join('\n')

  try {
    parsed = parseDelimitedText(csv)
    if (!parsed.columns.length || !parsed.rows.length) throw new Error('No data rows found.')
    onDataLoaded('example: ' + key)

    // Pre-select the matching model
    modelSel.value = example.model
    modelSel.dispatchEvent(new Event('change'))
  } catch (err) {
    setStatus(`<div class="alert alert-danger">${escapeHtml(err.message)}</div>`)
  }

  // Reset the dropdown to the placeholder
  exampleSelect.selectedIndex = 0
})

function onDataLoaded(source) {
  setStatus(`<div class="alert alert-success">Loaded ${escapeHtml(source)} — ${parsed.rows.length} rows, ${parsed.columns.length} columns.</div>`)

  xColSel.innerHTML = parsed.columns.map((c, i) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')
  yColSel.innerHTML = parsed.columns.map((c, i) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')

  if (parsed.columns.length >= 2) yColSel.selectedIndex = 1

  colPanel.style.display = ''
  modelPanel.style.display = ''
  resultsPanel.style.display = 'none'
  residToggle.style.display = 'none'
  fitResult = null

  onColumnsChanged()
}

xColSel.addEventListener('change', onColumnsChanged)
yColSel.addEventListener('change', onColumnsChanged)

function onColumnsChanged() {
  const xCol = xColSel.value
  const yCol = yColSel.value
  xData = numericColumn(parsed.rows, xCol)
  yData = numericColumn(parsed.rows, yCol)

  const paired = []
  for (const row of parsed.rows) {
    const xv = row[xCol], yv = row[yCol]
    if (typeof xv === 'number' && isFinite(xv) && typeof yv === 'number' && isFinite(yv)) {
      paired.push([xv, yv])
    }
  }
  xData = paired.map(p => p[0])
  yData = paired.map(p => p[1])

  rowCount.textContent = `${xData.length} valid numeric pairs`

  updateGuesses()
  plotRawData()
}

// ---------------------------------------------------------------------------
// Model selection + initial guesses
// ---------------------------------------------------------------------------
modelSel.addEventListener('change', () => {
  degreeWrap.style.display = modelSel.value === 'polynomial' ? '' : 'none'
  updateGuesses()
})
degreeSel.addEventListener('change', updateGuesses)

function getModelDef() {
  const key = modelSel.value
  return MODELS[key]
}

function getDegree() {
  return parseInt(degreeSel.value, 10)
}

function getParamNames() {
  const m = getModelDef()
  if (modelSel.value === 'polynomial') return m.paramNames(getDegree())
  return m.paramNames
}

function updateGuesses() {
  const m = getModelDef()
  const names = getParamNames()
  let guesses
  if (xData.length >= 2) {
    guesses = modelSel.value === 'polynomial'
      ? m.guess(xData, yData, getDegree())
      : m.guess(xData, yData)
  } else {
    guesses = new Array(names.length).fill(1)
  }

  paramsDiv.innerHTML = names.map((name, i) =>
    `<div class="cf-param-row">
      <label>${escapeHtml(name)}</label>
      <input type="number" step="any" class="cf-guess-input" data-index="${i}" value="${formatSci(guesses[i], 4)}" />
    </div>`
  ).join('')
}

function readGuesses() {
  return Array.from(paramsDiv.querySelectorAll('.cf-guess-input')).map(el => {
    const v = parseFloat(el.value)
    return isFinite(v) ? v : 0
  })
}

// ---------------------------------------------------------------------------
// Linear / polynomial solver via normal equations (QR-free, good enough for deg <= 6)
// ---------------------------------------------------------------------------
function fitLinear(x, y, basisFns) {
  const n = x.length
  const p = basisFns.length

  const A = x.map(xi => basisFns.map(fn => fn(xi)))

  // AtA = A^T · A
  const AtA = Array.from({ length: p }, () => new Array(p).fill(0))
  const AtY = new Array(p).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      AtY[j] += A[i][j] * y[i]
      for (let k = 0; k < p; k++) {
        AtA[j][k] += A[i][j] * A[i][k]
      }
    }
  }

  const params = solveSymmetric(AtA, AtY)

  const yPred = x.map(xi => {
    let v = 0
    for (let j = 0; j < p; j++) v += params[j] * basisFns[j](xi)
    return v
  })

  const residuals = y.map((yi, i) => yi - yPred[i])
  const rss = residuals.reduce((s, r) => s + r * r, 0)
  const s2 = rss / (n - p) // residual variance

  // Covariance = s2 * (AtA)^-1
  const AtAInv = invertSymmetric(AtA)
  const errors = AtAInv ? params.map((_, j) => Math.sqrt(Math.max(0, s2 * AtAInv[j][j]))) : params.map(() => NaN)

  return { params, errors, rss, residuals, yPred }
}

function solveSymmetric(M, b) {
  const n = M.length
  const A = M.map(row => [...row])
  const x = [...b]

  // Gaussian elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    let maxRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row
    }
    [A[col], A[maxRow]] = [A[maxRow], A[col]]
    ;[x[col], x[maxRow]] = [x[maxRow], x[col]]

    const pivot = A[col][col]
    if (Math.abs(pivot) < 1e-30) continue
    for (let row = col + 1; row < n; row++) {
      const factor = A[row][col] / pivot
      for (let k = col; k < n; k++) A[row][k] -= factor * A[col][k]
      x[row] -= factor * x[col]
    }
  }

  // Back-substitution
  const result = new Array(n).fill(0)
  for (let row = n - 1; row >= 0; row--) {
    let sum = x[row]
    for (let col = row + 1; col < n; col++) sum -= A[row][col] * result[col]
    result[row] = Math.abs(A[row][row]) > 1e-30 ? sum / A[row][row] : 0
  }
  return result
}

function invertSymmetric(M) {
  const n = M.length
  const A = M.map(row => [...row])
  const I = Array.from({ length: n }, (_, i) => {
    const row = new Array(n).fill(0)
    row[i] = 1
    return row
  })

  for (let col = 0; col < n; col++) {
    let maxRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row
    }
    [A[col], A[maxRow]] = [A[maxRow], A[col]]
    ;[I[col], I[maxRow]] = [I[maxRow], I[col]]

    const pivot = A[col][col]
    if (Math.abs(pivot) < 1e-30) return null
    for (let k = 0; k < n; k++) {
      A[col][k] /= pivot
      I[col][k] /= pivot
    }
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = A[row][col]
      for (let k = 0; k < n; k++) {
        A[row][k] -= factor * A[col][k]
        I[row][k] -= factor * I[col][k]
      }
    }
  }
  return I
}

// ---------------------------------------------------------------------------
// Nonlinear fitting (Levenberg-Marquardt) + Jacobian-based standard errors
// ---------------------------------------------------------------------------
function fitNonlinear(x, y, modelFn, initialParams) {
  const data = { x, y }

  const result = levenbergMarquardt(data, modelFn, {
    initialValues: initialParams,
    maxIterations: 1000,
    damping: 1e-2,
    gradientDifference: 1e-6,
    centralDifference: true,
    errorTolerance: 1e-12,
  })

  const params = Array.from(result.parameterValues)
  const evalFn = modelFn(params)
  const yPred = x.map(evalFn)
  const residuals = y.map((yi, i) => yi - yPred[i])
  const rss = residuals.reduce((s, r) => s + r * r, 0)

  const n = x.length
  const p = params.length
  const s2 = n > p ? rss / (n - p) : 0

  // Numerical Jacobian for covariance estimation
  const h = 1e-7
  const J = x.map((xi, i) => {
    return params.map((_, j) => {
      const pPlus = [...params]
      const pMinus = [...params]
      pPlus[j] += h * (1 + Math.abs(params[j]))
      pMinus[j] -= h * (1 + Math.abs(params[j]))
      return (modelFn(pPlus)(xi) - modelFn(pMinus)(xi)) / (2 * h * (1 + Math.abs(params[j])))
    })
  })

  // JtJ = J^T J
  const JtJ = Array.from({ length: p }, () => new Array(p).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      for (let k = 0; k < p; k++) {
        JtJ[j][k] += J[i][j] * J[i][k]
      }
    }
  }

  const JtJInv = invertSymmetric(JtJ)
  const errors = JtJInv
    ? params.map((_, j) => Math.sqrt(Math.max(0, s2 * JtJInv[j][j])))
    : params.map(() => NaN)

  return { params, errors, rss, residuals, yPred, iterations: result.iterations }
}

// ---------------------------------------------------------------------------
// Main fit logic
// ---------------------------------------------------------------------------
fitBtn.addEventListener('click', runFit)

function runFit() {
  if (xData.length < 2) {
    return setStatus('<div class="alert alert-danger">Need at least 2 data points.</div>')
  }

  const modelKey = modelSel.value
  const m = getModelDef()
  const paramNames = getParamNames()
  const guesses = readGuesses()

  let params, errors, rss, residuals, yPred

  try {
    if (modelKey === 'linear') {
      const basis = [x => x, () => 1]
      const res = fitLinear(xData, yData, basis)
      params = res.params; errors = res.errors; rss = res.rss
      residuals = res.residuals; yPred = res.yPred
    } else if (modelKey === 'polynomial') {
      const deg = getDegree()
      const basis = Array.from({ length: deg + 1 }, (_, i) => (x) => Math.pow(x, i))
      const res = fitLinear(xData, yData, basis)
      params = res.params; errors = res.errors; rss = res.rss
      residuals = res.residuals; yPred = res.yPred
    } else if (modelKey === 'logarithmic') {
      const basis = [x => Math.log(x), () => 1]
      const res = fitLinear(xData, yData, basis)
      params = res.params; errors = res.errors; rss = res.rss
      residuals = res.residuals; yPred = res.yPred
    } else {
      const res = fitNonlinear(xData, yData, m.fn, guesses)
      params = res.params; errors = res.errors; rss = res.rss
      residuals = res.residuals; yPred = res.yPred
    }
  } catch (err) {
    return setStatus(`<div class="alert alert-danger">Fit failed: ${escapeHtml(err.message)}</div>`)
  }

  // Goodness-of-fit statistics
  const n = xData.length
  const p = params.length
  const yMean = mean(yData)
  const ssTot = yData.reduce((s, v) => s + (v - yMean) ** 2, 0)
  const r2 = 1 - rss / ssTot
  const adjR2 = n > p + 1 ? 1 - (1 - r2) * (n - 1) / (n - p - 1) : NaN
  const rmse = Math.sqrt(rss / n)

  // Dense fitted curve for plotting
  const xMin = Math.min(...xData)
  const xMax = Math.max(...xData)
  const nCurve = 300
  const curveX = Array.from({ length: nCurve }, (_, i) => xMin + (xMax - xMin) * i / (nCurve - 1))
  const evalFn = m.fn(params)
  const curveY = curveX.map(evalFn)

  fitResult = { params, errors, rss, residuals, yPred, curveX, curveY, r2, adjR2, rmse, modelKey, paramNames }

  renderResults()
  plotFit()
}

// ---------------------------------------------------------------------------
// Render results
// ---------------------------------------------------------------------------
function renderResults() {
  const { params, errors, r2, adjR2, rmse, rss, modelKey, paramNames } = fitResult
  const m = MODELS[modelKey]

  let eqText
  if (modelKey === 'polynomial') {
    eqText = m.eq(getDegree())
  } else {
    eqText = m.eq
  }
  eqDiv.textContent = eqText

  resultsTbody.innerHTML = params.map((v, i) =>
    `<tr>
      <td>${escapeHtml(paramNames[i])}</td>
      <td>${formatSci(v)}</td>
      <td>± ${formatSci(errors[i])}</td>
    </tr>`
  ).join('')

  gofDiv.innerHTML = `
    <dt>R²</dt><dd>${formatSci(r2, 6)}</dd>
    <dt>Adjusted R²</dt><dd>${formatSci(adjR2, 6)}</dd>
    <dt>RMSE</dt><dd>${formatSci(rmse)}</dd>
    <dt>RSS</dt><dd>${formatSci(rss)}</dd>
  `

  resultsPanel.style.display = ''
  residToggle.style.display = ''
}

// ---------------------------------------------------------------------------
// Plotting
// ---------------------------------------------------------------------------
function plotRawData() {
  const traces = [{
    x: xData,
    y: yData,
    mode: 'markers',
    type: 'scatter',
    name: 'Data',
    marker: { color: colorForIndex(0), size: 6 },
  }]

  const layout = {
    xaxis: { title: xColSel.value },
    yaxis: { title: yColSel.value },
    margin: { t: 30, r: 30, l: 60, b: 50 },
  }

  Plotly.react(plotEl, traces, baseLayout(layout), baseConfig('curve-fit'))
}

function plotFit() {
  if (!fitResult) return

  const showResiduals = showResidualsC.checked

  const dataTrace = {
    x: xData,
    y: yData,
    mode: 'markers',
    type: 'scatter',
    name: 'Data',
    marker: { color: colorForIndex(0), size: 6 },
    xaxis: 'x',
    yaxis: 'y',
  }

  const fitTrace = {
    x: fitResult.curveX,
    y: fitResult.curveY,
    mode: 'lines',
    type: 'scatter',
    name: 'Fit',
    line: { color: colorForIndex(2), width: 2 },
    xaxis: 'x',
    yaxis: 'y',
  }

  const traces = [dataTrace, fitTrace]

  let layout
  if (showResiduals) {
    const residTrace = {
      x: xData,
      y: fitResult.residuals,
      mode: 'markers',
      type: 'scatter',
      name: 'Residuals',
      marker: { color: colorForIndex(3), size: 5 },
      xaxis: 'x2',
      yaxis: 'y2',
      showlegend: false,
    }
    traces.push(residTrace)

    const residZero = {
      x: [Math.min(...xData), Math.max(...xData)],
      y: [0, 0],
      mode: 'lines',
      type: 'scatter',
      line: { color: '#9aa4b2', width: 1, dash: 'dash' },
      xaxis: 'x2',
      yaxis: 'y2',
      showlegend: false,
    }
    traces.push(residZero)

    layout = {
      grid: { rows: 2, columns: 1, subplots: [['xy'], ['x2y2']], roworder: 'top to bottom' },
      xaxis: { title: xColSel.value },
      yaxis: { title: yColSel.value, domain: [0.35, 1] },
      xaxis2: { title: xColSel.value, gridcolor: '#2a3140', zerolinecolor: '#2a3140', anchor: 'y2' },
      yaxis2: { title: 'Residual', domain: [0, 0.25], gridcolor: '#2a3140', zerolinecolor: '#2a3140', anchor: 'x2' },
      margin: { t: 30, r: 30, l: 60, b: 50 },
      height: 600,
    }
  } else {
    layout = {
      xaxis: { title: xColSel.value },
      yaxis: { title: yColSel.value },
      margin: { t: 30, r: 30, l: 60, b: 50 },
    }
  }

  Plotly.react(plotEl, traces, baseLayout(layout), baseConfig('curve-fit'))
}

showResidualsC.addEventListener('change', plotFit)

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------
dlCurve.addEventListener('click', () => {
  if (!fitResult) return
  const csv = toCSV(['x', 'y_fit'], fitResult.curveX.map((x, i) => [x, fitResult.curveY[i]]))
  downloadCSV(csv, 'curve-fit-fitted.csv')
})

dlResid.addEventListener('click', () => {
  if (!fitResult) return
  const csv = toCSV(['x', 'y_data', 'y_fit', 'residual'],
    xData.map((x, i) => [x, yData[i], fitResult.yPred[i], fitResult.residuals[i]]))
  downloadCSV(csv, 'curve-fit-residuals.csv')
})

dlSummary.addEventListener('click', () => {
  if (!fitResult) return
  const m = MODELS[fitResult.modelKey]
  const lines = [
    'Curve Fitting Results',
    '=====================',
    '',
    `Model: ${m.label}`,
    `Equation: ${typeof m.eq === 'function' ? m.eq(getDegree()) : m.eq}`,
    '',
    'Parameters:',
    ...fitResult.paramNames.map((name, i) =>
      `  ${name} = ${formatSci(fitResult.params[i])} ± ${formatSci(fitResult.errors[i])}`),
    '',
    'Goodness of fit:',
    `  R²          = ${formatSci(fitResult.r2, 6)}`,
    `  Adjusted R² = ${formatSci(fitResult.adjR2, 6)}`,
    `  RMSE        = ${formatSci(fitResult.rmse)}`,
    `  RSS         = ${formatSci(fitResult.rss)}`,
    '',
    `Data points: ${xData.length}`,
    `Parameters:  ${fitResult.params.length}`,
    '',
    `Generated by Lab Tools — Curve Fitting`,
    `Date: ${new Date().toISOString()}`,
  ]
  downloadBlob(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), 'curve-fit-summary.txt')
})

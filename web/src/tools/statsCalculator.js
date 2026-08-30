import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { parseTableFile, numericColumn } from '../shared/parseTable.js'
import { escapeHtml } from '../shared/dom.js'

initChrome('stats-calculator')

// ------------------------------------------------------------------
// Student's t-distribution (Lanczos log-gamma + incomplete-beta CDF).
// Both the critical-value lookup (for CIs) and the p-value (for the
// t-test) are derived from the same tCDFTwoTailed(), so they can't
// silently disagree with each other.
// ------------------------------------------------------------------
function logGamma(x) {
  const g = 7
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  x -= 1
  let a = c[0]
  const t = x + g + 0.5
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i)
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}

// Continued-fraction expansion for the incomplete beta function (standard
// numerical-methods algorithm).
function betacf(x, a, b) {
  const MAXIT = 200, EPS = 3e-14, FPMIN = 1e-300
  const qab = a + b, qap = a + 1, qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

// Regularized incomplete beta function I_x(a, b).
function betai(x, a, b) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  )
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(x, a, b)) / a
  return 1 - (bt * betacf(1 - x, b, a)) / b
}

// Two-tailed P(|T| > |t|) for a t-distribution with `df` degrees of freedom.
function tCDFTwoTailed(t, df) {
  const absT = Math.abs(t)
  const x = df / (df + absT * absT)
  return betai(x, df / 2, 0.5)
}

// Inverts tCDFTwoTailed via bisection to get the critical t for a given
// two-tailed alpha (e.g. alpha=0.05 -> the 95% CI critical value).
function tCritical(df, alpha) {
  let lo = 0
  let hi = 1
  let guard = 0
  while (tCDFTwoTailed(hi, df) > alpha && guard < 200) {
    hi *= 2
    guard++
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (tCDFTwoTailed(mid, df) > alpha) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

// Dev-only sanity check against textbook reference values; left in as a
// cheap regression guard since a silently-wrong beta/gamma implementation
// would otherwise be very easy to ship unnoticed.
console.assert(Math.abs(tCritical(10, 0.05) - 2.228) < 0.01, 'tCritical(10, 0.05) mismatch')
console.assert(Math.abs(tCritical(30, 0.05) - 2.042) < 0.01, 'tCritical(30, 0.05) mismatch')
console.assert(Math.abs(tCritical(1, 0.05) - 12.706) < 0.01, 'tCritical(1, 0.05) mismatch')
console.assert(Math.abs(tCDFTwoTailed(2.228, 10) - 0.05) < 0.001, 'tCDFTwoTailed(2.228, 10) mismatch')

// ------------------------------------------------------------------
// Descriptive stats
// ------------------------------------------------------------------
function mean(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length
}
function sampleStd(arr) {
  if (arr.length <= 1) return 0
  const m = mean(arr)
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1)
  return Math.sqrt(variance)
}
function fmt(x, sig = 6) {
  if (!Number.isFinite(x)) return String(x)
  if (x === 0) return '0'
  return Number(x.toPrecision(sig)).toString()
}

function parsePastedNumbers(text) {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number)
    .filter((v) => Number.isFinite(v))
}

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------
let mode = 'single' // 'single' | 'compare'
const datasets = {
  a: { values: [], parsed: null },
  b: { values: [], parsed: null },
}

// ------------------------------------------------------------------
// DOM refs
// ------------------------------------------------------------------
const modeSingleBtn = document.getElementById('sc-mode-single')
const modeCompareBtn = document.getElementById('sc-mode-compare')
const panelB = document.getElementById('sc-panel-b')
const datasetGrid = document.getElementById('sc-dataset-grid')
const titleA = document.getElementById('sc-title-a')
const levelLabel = document.getElementById('sc-level-label')
const ciSelect = document.getElementById('sc-ci-select')
const resultsEl = document.getElementById('sc-results')

function setMode(next) {
  mode = next
  modeSingleBtn.classList.toggle('btn-primary', mode === 'single')
  modeCompareBtn.classList.toggle('btn-primary', mode === 'compare')
  panelB.hidden = mode === 'single'
  datasetGrid.classList.toggle('sc-single-col', mode === 'single')
  titleA.textContent = mode === 'single' ? 'Dataset' : 'Group A'
  levelLabel.textContent = mode === 'single' ? 'Confidence level' : 'Significance level (α)'
  renderResults()
}
modeSingleBtn.addEventListener('click', () => setMode('single'))
modeCompareBtn.addEventListener('click', () => setMode('compare'))
ciSelect.addEventListener('change', renderResults)

// ------------------------------------------------------------------
// Per-dataset wiring (textarea + optional file/column upload)
// ------------------------------------------------------------------
function wireDataset(key) {
  const ds = datasets[key]
  const textarea = document.getElementById(`sc-textarea-${key}`)
  const dropzone = document.getElementById(`sc-dropzone-${key}`)
  const fileInput = document.getElementById(`sc-file-input-${key}`)
  const columnField = document.getElementById(`sc-column-field-${key}`)
  const columnSelect = document.getElementById(`sc-column-select-${key}`)
  const statusEl = document.getElementById(`sc-status-${key}`)
  const nBadge = document.getElementById(`sc-n-badge-${key}`)

  function setValues(values) {
    ds.values = values
    nBadge.textContent = values.length > 0 ? `n = ${values.length}` : ''
    renderResults()
  }

  textarea.addEventListener('input', () => {
    setValues(parsePastedNumbers(textarea.value))
  })

  initDropzone(dropzone, fileInput, async (files) => {
    const file = files[0]
    if (!file) return
    try {
      const parsed = await parseTableFile(file)
      if (!parsed.columns.length) throw new Error('No columns found in this file.')
      ds.parsed = parsed
      columnField.hidden = false
      columnSelect.innerHTML = parsed.columns
        .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
        .join('')
      columnSelect.dispatchEvent(new Event('change'))
      statusEl.innerHTML = `<div class="alert alert-success">Loaded <strong>${escapeHtml(file.name)}</strong>.</div>`
    } catch (err) {
      statusEl.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message || String(err))}</div>`
    }
  })

  columnSelect.addEventListener('change', () => {
    if (!ds.parsed) return
    setValues(numericColumn(ds.parsed.rows, columnSelect.value))
  })
}
wireDataset('a')
wireDataset('b')

// ------------------------------------------------------------------
// Rendering
// ------------------------------------------------------------------
function renderResults() {
  const alpha = Number(ciSelect.value)
  if (mode === 'single') {
    renderSingle(datasets.a.values, alpha)
  } else {
    renderCompare(datasets.a.values, datasets.b.values, alpha)
  }
}

function renderSingle(values, alpha) {
  if (values.length < 2) {
    resultsEl.innerHTML = `<div class="empty-state">Paste or upload at least 2 numbers to see statistics.</div>`
    return
  }
  const n = values.length
  const m = mean(values)
  const sd = sampleStd(values)
  const sem = sd / Math.sqrt(n)
  const df = n - 1
  const tCrit = tCritical(df, alpha)
  const half = tCrit * sem
  const levelPct = Math.round((1 - alpha) * 100)

  resultsEl.innerHTML = `
    <div class="panel">
      <div class="sc-banner">
        <div class="sc-banner__title">Mean ± ${levelPct}% CI</div>
        <div class="sc-banner__value">${fmt(m)} ± ${fmt(half)}</div>
        <div class="sc-banner__sub">[${fmt(m - half)}, ${fmt(m + half)}] &nbsp;·&nbsp; t<sub>crit</sub>(df=${df}) = ${fmt(tCrit, 5)}</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>n</th><th>Mean</th><th>Sample SD</th><th>SEM</th></tr></thead>
          <tbody><tr><td>${n}</td><td>${fmt(m)}</td><td>${fmt(sd)}</td><td>${fmt(sem)}</td></tr></tbody>
        </table>
      </div>
    </div>
  `
}

function renderCompare(a, b, alpha) {
  if (a.length < 2 || b.length < 2) {
    resultsEl.innerHTML = `<div class="empty-state">Paste or upload at least 2 numbers in each group to run a t-test.</div>`
    return
  }
  const n1 = a.length, n2 = b.length
  const m1 = mean(a), m2 = mean(b)
  const s1 = sampleStd(a), s2 = sampleStd(b)
  const se1sq = (s1 * s1) / n1
  const se2sq = (s2 * s2) / n2
  const t = (m1 - m2) / Math.sqrt(se1sq + se2sq)
  const df = (se1sq + se2sq) ** 2 / ((se1sq * se1sq) / (n1 - 1) + (se2sq * se2sq) / (n2 - 1))
  const p = tCDFTwoTailed(t, df)
  const significant = p < alpha
  const levelPct = Math.round((1 - alpha) * 100)

  resultsEl.innerHTML = `
    <div class="panel">
      <div class="sc-banner ${significant ? '' : 'sc-banner--not-significant'}">
        <div class="sc-banner__title">Welch's t-test</div>
        <div class="sc-banner__value">t = ${fmt(t, 5)}, df = ${fmt(df, 5)}, p = ${fmt(p, 5)}</div>
        <div class="sc-banner__sub">
          Difference is <strong>${significant ? 'statistically significant' : 'not statistically significant'}</strong>
          at the ${levelPct}% level (α = ${alpha}).
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Group</th><th>n</th><th>Mean</th><th>Sample SD</th><th>SEM</th></tr></thead>
          <tbody>
            <tr><td>A</td><td>${n1}</td><td>${fmt(m1)}</td><td>${fmt(s1)}</td><td>${fmt(Math.sqrt(se1sq))}</td></tr>
            <tr><td>B</td><td>${n2}</td><td>${fmt(m2)}</td><td>${fmt(s2)}</td><td>${fmt(Math.sqrt(se2sq))}</td></tr>
          </tbody>
        </table>
      </div>
      <p class="sc-hint">Mean difference (A − B): <strong>${fmt(m1 - m2)}</strong></p>
    </div>
  `
}

setMode('single')

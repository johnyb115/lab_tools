import { initChrome } from '../shared/nav.js'
import { downloadCSV, toCSV } from '../shared/download.js'

initChrome('linspace')

const minInput = document.getElementById('min-val')
const maxInput = document.getElementById('max-val')
const countInput = document.getElementById('count-val')
const validationMsg = document.getElementById('validation-msg')
const generateBtn = document.getElementById('generate-btn')
const resultsArea = document.getElementById('results-area')

const PREVIEW_EDGE_ROWS = 50

// Mirrors numpy.linspace(start, stop, num, endpoint=True): num evenly
// spaced values, both endpoints inclusive.
function linspace(min, max, n) {
  if (n <= 1) return [min]
  return Array.from({ length: n }, (_, i) => min + (i * (max - min)) / (n - 1))
}

function validate(min, max) {
  if (min === max) return 'Minimum and Maximum must differ.'
  if (max < min) return 'Maximum must be greater than Minimum.'
  return null
}

// Formats a number for display only; full precision is preserved for CSV export.
function formatDisplay(x) {
  return Number(x.toPrecision(6)).toString()
}

generateBtn.addEventListener('click', () => {
  const min = Number(minInput.value)
  const max = Number(maxInput.value)
  const count = Math.trunc(Number(countInput.value))

  const error = validate(min, max)
  if (error) {
    validationMsg.innerHTML = `<div class="alert alert-danger">${error}</div>`
    return
  }
  validationMsg.innerHTML = ''

  const values = linspace(min, max, count)
  const n = values.length

  let rowsHtml
  if (n > 100) {
    const headRows = values
      .slice(0, PREVIEW_EDGE_ROWS)
      .map((v) => `<tr><td>${formatDisplay(v)}</td></tr>`)
      .join('')
    const tailRows = values
      .slice(n - PREVIEW_EDGE_ROWS)
      .map((v) => `<tr><td>${formatDisplay(v)}</td></tr>`)
      .join('')
    const hiddenCount = n - PREVIEW_EDGE_ROWS * 2
    rowsHtml = `${headRows}<tr><td>… ${hiddenCount} more rows not shown (full data is in the download) …</td></tr>${tailRows}`
  } else {
    rowsHtml = values.map((v) => `<tr><td>${formatDisplay(v)}</td></tr>`).join('')
  }

  resultsArea.innerHTML = `
    <div class="alert alert-success">Generated ${n} values from ${min} to ${max}.</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Numbers</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div class="field" style="margin-top: 0.9rem;">
      <button class="btn btn-primary" id="download-btn">Download CSV</button>
    </div>
  `

  document.getElementById('download-btn').addEventListener('click', () => {
    const csv = toCSV(['Numbers'], values.map((v) => [v]))
    downloadCSV(csv, `linspace_min=${min}_max=${max}_N=${count}.csv`)
  })
})

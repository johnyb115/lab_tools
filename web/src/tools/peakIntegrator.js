import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { parseTableFile } from '../shared/parseTable.js'
import { renderPlot, colorForIndex } from '../shared/plotlySetup.js'
import { toCSV, downloadCSV, timestampSlug } from '../shared/download.js'
import { escapeHtml, escapeAttr } from '../shared/dom.js'

initChrome('peak-integrator')

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------
// Each loaded file: { id, name, columns, rows, xCol, yCol, baseline: {x1,y1,x2,y2}|null,
//                      result: {peakX, peakHeight, area}|null, color }
let files = []
let fileIdCounter = 0
let colorCounter = 0
let activeId = null

let pickingBaseline = false
let pendingClicks = [] // [{x,y}] data-coordinate clicks collected while picking
let plotClickBound = false

// ------------------------------------------------------------------
// DOM refs
// ------------------------------------------------------------------
const dropzone = document.getElementById('pi-dropzone')
const fileInput = document.getElementById('pi-file-input')
const fileListEl = document.getElementById('pi-file-list')

const columnPanel = document.getElementById('pi-column-panel')
const xSelect = document.getElementById('pi-x-select')
const ySelect = document.getElementById('pi-y-select')
const pickBaselineBtn = document.getElementById('pi-pick-baseline-btn')
const resetBaselineBtn = document.getElementById('pi-reset-baseline-btn')
const baselineStatus = document.getElementById('pi-baseline-status')

const plotContainer = document.getElementById('pi-plot')
const resultBanner = document.getElementById('pi-result-banner')
const resultsTable = document.getElementById('pi-results-table')
const downloadBtn = document.getElementById('pi-download-btn')

// ------------------------------------------------------------------
// File loading
// ------------------------------------------------------------------
initDropzone(dropzone, fileInput, (fileList) => {
  Array.from(fileList).forEach(loadFile)
})

async function loadFile(file) {
  try {
    const parsed = await parseTableFile(file)
    if (!parsed.columns.length || !parsed.rows.length) {
      throw new Error('No data rows found in this file.')
    }
    const xCol = parsed.columns[0]
    const yCol = parsed.columns.find((c) => c !== xCol) || parsed.columns[0]

    const f = {
      id: fileIdCounter++,
      name: file.name,
      columns: parsed.columns,
      rows: parsed.rows,
      xCol,
      yCol,
      baseline: null,
      result: null,
      color: colorForIndex(colorCounter++),
    }
    files.push(f)
    activeId = f.id
    renderFileList()
    renderColumnPanel()
    exitPicking()
    updatePlot()
    renderResultsTable()
  } catch (err) {
    baselineStatus.innerHTML = `<div class="alert alert-danger">Could not load ${escapeHtml(
      file.name
    )}: ${escapeHtml(err.message || String(err))}</div>`
  }
}

function activeFile() {
  return files.find((f) => f.id === activeId) || null
}

// ------------------------------------------------------------------
// Sidebar: file list
// ------------------------------------------------------------------
function renderFileList() {
  fileListEl.innerHTML = files
    .map(
      (f) => `
      <li class="pi-file-item${f.id === activeId ? ' is-active' : ''}" data-id="${f.id}">
        <span title="${escapeAttr(f.name)}">📄 ${escapeHtml(f.name)}${
          f.result ? ' ✓' : ''
        }</span>
        <button type="button" class="pi-remove-btn" data-id="${f.id}" title="Remove">✕</button>
      </li>`
    )
    .join('')

  fileListEl.querySelectorAll('.pi-file-item').forEach((li) => {
    li.addEventListener('click', (e) => {
      if (e.target.closest('.pi-remove-btn')) return
      activeId = Number(li.dataset.id)
      exitPicking()
      renderFileList()
      renderColumnPanel()
      updatePlot()
    })
  })
  fileListEl.querySelectorAll('.pi-remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id)
      files = files.filter((f) => f.id !== id)
      if (activeId === id) activeId = files.length ? files[0].id : null
      exitPicking()
      renderFileList()
      renderColumnPanel()
      updatePlot()
      renderResultsTable()
    })
  })
}

// ------------------------------------------------------------------
// Sidebar: column pickers + baseline controls
// ------------------------------------------------------------------
function renderColumnPanel() {
  const f = activeFile()
  if (!f) {
    columnPanel.style.display = 'none'
    return
  }
  columnPanel.style.display = ''

  xSelect.innerHTML = f.columns
    .map((c) => `<option value="${escapeAttr(c)}" ${c === f.xCol ? 'selected' : ''}>${escapeHtml(c)}</option>`)
    .join('')
  ySelect.innerHTML = f.columns
    .map((c) => `<option value="${escapeAttr(c)}" ${c === f.yCol ? 'selected' : ''}>${escapeHtml(c)}</option>`)
    .join('')

  updateBaselineStatus()
}

xSelect.addEventListener('change', () => {
  const f = activeFile()
  if (!f) return
  f.xCol = xSelect.value
  clearBaseline(f)
  exitPicking()
  updatePlot()
  renderResultsTable()
})
ySelect.addEventListener('change', () => {
  const f = activeFile()
  if (!f) return
  f.yCol = ySelect.value
  clearBaseline(f)
  exitPicking()
  updatePlot()
  renderResultsTable()
})

pickBaselineBtn.addEventListener('click', () => {
  const f = activeFile()
  if (!f) return
  clearBaseline(f)
  pickingBaseline = true
  pendingClicks = []
  updateBaselineStatus()
})

resetBaselineBtn.addEventListener('click', () => {
  const f = activeFile()
  if (!f) return
  clearBaseline(f)
  exitPicking()
  updatePlot()
  renderResultsTable()
})

function clearBaseline(f) {
  f.baseline = null
  f.result = null
}

function exitPicking() {
  pickingBaseline = false
  pendingClicks = []
}

function updateBaselineStatus() {
  const f = activeFile()
  if (!f) {
    baselineStatus.innerHTML = ''
    return
  }
  if (pickingBaseline) {
    baselineStatus.innerHTML = `<div class="alert alert-info">Click ${
      2 - pendingClicks.length
    } more point(s) on the curve to set the baseline.</div>`
  } else if (f.baseline) {
    baselineStatus.innerHTML = `<div class="alert alert-success">Baseline set: (${fmt(
      f.baseline.x1
    )}, ${fmt(f.baseline.y1)}) → (${fmt(f.baseline.x2)}, ${fmt(f.baseline.y2)})</div>`
  } else {
    baselineStatus.innerHTML = `<div class="alert alert-warning">No baseline picked yet for this file.</div>`
  }
}

// ------------------------------------------------------------------
// Data extraction
// ------------------------------------------------------------------
function getXY(f) {
  const xs = []
  const ys = []
  for (const row of f.rows) {
    const xv = row[f.xCol]
    const yv = row[f.yCol]
    if (Number.isFinite(xv) && Number.isFinite(yv)) {
      xs.push(xv)
      ys.push(yv)
    }
  }
  return { xs, ys }
}

function nearestIndex(xs, xVal) {
  let bestI = 0
  let bestD = Infinity
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs(xs[i] - xVal)
    if (d < bestD) {
      bestD = d
      bestI = i
    }
  }
  return bestI
}

// ------------------------------------------------------------------
// Peak height + trapezoidal area vs. the picked linear baseline
// ------------------------------------------------------------------
function computeResult(f) {
  const { xs, ys } = getXY(f)
  const { x1, y1, x2, y2 } = f.baseline
  if (x1 === x2) throw new Error('Baseline points have the same X — pick two distinct X values.')

  const xlo = Math.min(x1, x2)
  const xhi = Math.max(x1, x2)
  const idxs = []
  xs.forEach((x, i) => {
    if (x >= xlo && x <= xhi) idxs.push(i)
  })
  idxs.sort((a, b) => xs[a] - xs[b])
  if (idxs.length < 2) throw new Error('Fewer than 2 data points fall between the baseline X values.')

  const baselineAt = (x) => y1 + ((y2 - y1) * (x - x1)) / (x2 - x1)

  let peakHeight = 0
  let peakX = xs[idxs[0]]
  let area = 0
  let prevIdx = null
  let prevDev = null
  for (const i of idxs) {
    const dev = ys[i] - baselineAt(xs[i])
    if (Math.abs(dev) > Math.abs(peakHeight)) {
      peakHeight = dev
      peakX = xs[i]
    }
    if (prevIdx !== null) {
      area += (0.5 * (prevDev + dev) * (xs[i] - xs[prevIdx]))
    }
    prevIdx = i
    prevDev = dev
  }

  return { peakX, peakHeight, area, idxs, baselineAt }
}

// ------------------------------------------------------------------
// Plotting
// ------------------------------------------------------------------
function updatePlot() {
  const f = activeFile()
  if (!f) {
    plotContainer.innerHTML = '<div class="empty-state">Upload one or more data files to get started.</div>'
    resultBanner.innerHTML = ''
    return
  }

  const { xs, ys } = getXY(f)
  if (xs.length === 0) {
    plotContainer.innerHTML = '<div class="empty-state">No numeric X/Y pairs for the selected columns.</div>'
    resultBanner.innerHTML = ''
    return
  }

  // Plotly tags the container itself (not a descendant) with this class, so a
  // querySelector here always misses and would wipe the DOM out from under
  // Plotly's own in-flight re-render on every call — check classList instead.
  if (!plotContainer.classList.contains('js-plotly-plot')) {
    plotContainer.innerHTML = ''
  }

  const traces = [
    {
      x: xs,
      y: ys,
      type: 'scatter',
      mode: 'lines',
      name: f.name,
      line: { color: f.color },
    },
  ]

  if (f.baseline) {
    try {
      const { idxs, baselineAt, peakX, peakHeight, area } = computeResult(f)
      const bx = idxs.map((i) => xs[i])
      const by = bx.map(baselineAt)
      const curveY = idxs.map((i) => ys[i])

      traces.push({
        x: bx,
        y: by,
        type: 'scatter',
        mode: 'lines',
        name: 'baseline',
        line: { color: '#f2c94c', dash: 'dash' },
      })
      traces.push({
        x: bx,
        y: curveY,
        type: 'scatter',
        mode: 'lines',
        name: 'peak region',
        showlegend: false,
        line: { color: f.color },
        fill: 'tonexty',
        fillcolor: 'rgba(242,201,76,0.18)',
      })
      traces.push({
        x: [peakX],
        y: [ys[idxs[nearestIndex(bx, peakX)]]],
        type: 'scatter',
        mode: 'markers',
        name: 'peak',
        marker: { color: '#eb5757', size: 10, symbol: 'x' },
      })

      resultBanner.innerHTML = `
        <div class="pi-banner">
          <div class="pi-banner__item">
            <div class="pi-banner__label">Peak height (signed)</div>
            <div class="pi-banner__value">${fmt(peakHeight)}</div>
          </div>
          <div class="pi-banner__item">
            <div class="pi-banner__label">Peak at X</div>
            <div class="pi-banner__value">${fmt(peakX)}</div>
          </div>
          <div class="pi-banner__item">
            <div class="pi-banner__label">Integrated area (curve − baseline)</div>
            <div class="pi-banner__value">${fmt(area)}</div>
          </div>
        </div>`

      f.result = { peakX, peakHeight, area }
    } catch (err) {
      resultBanner.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`
      f.result = null
    }
  } else {
    resultBanner.innerHTML = ''
  }

  renderPlot(
    plotContainer,
    traces,
    {
      title: { text: f.name, x: 0.5 },
      xaxis: { title: { text: f.xCol } },
      yaxis: { title: { text: f.yCol } },
      height: 550,
    },
    'peak_integrator'
  ).then(() => {
    if (!plotClickBound) {
      plotClickBound = true
      plotContainer.on('plotly_click', onPlotClick)
    }
  })

  renderResultsTable()
}

function onPlotClick(evt) {
  if (!pickingBaseline) return
  const f = activeFile()
  if (!f) return
  const point = evt.points && evt.points[0]
  if (!point) return

  const { xs, ys } = getXY(f)
  const idx = nearestIndex(xs, point.x)
  pendingClicks.push({ x: xs[idx], y: ys[idx] })
  updateBaselineStatus()

  if (pendingClicks.length === 2) {
    const [p1, p2] = pendingClicks
    f.baseline = { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }
    exitPicking()
    updateBaselineStatus()
    updatePlot()
  }
}

// ------------------------------------------------------------------
// Results table + CSV export
// ------------------------------------------------------------------
function renderResultsTable() {
  const processed = files.filter((f) => f.result)
  downloadBtn.disabled = processed.length === 0

  if (processed.length === 0) {
    resultsTable.innerHTML = '<p class="empty-state">Process at least one file to see results here.</p>'
    return
  }

  resultsTable.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>File</th><th>X col</th><th>Y col</th>
            <th>x1</th><th>y1</th><th>x2</th><th>y2</th>
            <th>Peak X</th><th>Peak height</th><th>Area</th>
          </tr>
        </thead>
        <tbody>
          ${processed
            .map(
              (f) => `
            <tr>
              <td>${escapeHtml(f.name)}</td>
              <td>${escapeHtml(f.xCol)}</td>
              <td>${escapeHtml(f.yCol)}</td>
              <td>${fmt(f.baseline.x1)}</td>
              <td>${fmt(f.baseline.y1)}</td>
              <td>${fmt(f.baseline.x2)}</td>
              <td>${fmt(f.baseline.y2)}</td>
              <td>${fmt(f.result.peakX)}</td>
              <td>${fmt(f.result.peakHeight)}</td>
              <td>${fmt(f.result.area)}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`
}

downloadBtn.addEventListener('click', () => {
  const processed = files.filter((f) => f.result)
  if (processed.length === 0) return
  const headers = ['File', 'X col', 'Y col', 'x1', 'y1', 'x2', 'y2', 'Peak X', 'Peak height', 'Area']
  const rows = processed.map((f) => [
    f.name,
    f.xCol,
    f.yCol,
    f.baseline.x1,
    f.baseline.y1,
    f.baseline.x2,
    f.baseline.y2,
    f.result.peakX,
    f.result.peakHeight,
    f.result.area,
  ])
  downloadCSV(toCSV(headers, rows), `peak_integrator_${timestampSlug()}.csv`)
})

// ------------------------------------------------------------------
// Utils
// ------------------------------------------------------------------
function fmt(x) {
  if (!Number.isFinite(x)) return String(x)
  if (x === 0) return '0'
  return Number(x.toPrecision(6)).toString()
}

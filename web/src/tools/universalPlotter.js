import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { parseTableFile } from '../shared/parseTable.js'
import { renderPlot, colorForIndex } from '../shared/plotlySetup.js'
import { toCSV, downloadCSV, timestampSlug } from '../shared/download.js'

initChrome('universal-plotter')

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------
// Each loaded file: { id, name, columns, rows, xCol, seriesState }
// seriesState: columnName -> { checked, color }
let loadedFiles = []
let fileIdCounter = 0
let colorCounter = 0

// Whether the user has hand-edited the axis-label inputs; while false we
// keep overwriting them with a sensible default as the set of traces changes.
let xLabelDirty = false
let yLabelDirty = false

// ------------------------------------------------------------------
// DOM references
// ------------------------------------------------------------------
const dropzone = document.getElementById('up-dropzone')
const fileInput = document.getElementById('up-file-input')
const fileStatus = document.getElementById('up-file-status')
const filePanels = document.getElementById('up-file-panels')

const stylePanel = document.getElementById('up-style-panel')

const titleInput = document.getElementById('up-title')
const xlabelInput = document.getElementById('up-xlabel')
const ylabelInput = document.getElementById('up-ylabel')
const logxCheckbox = document.getElementById('up-logx')
const logyCheckbox = document.getElementById('up-logy')
const traceStyleSelect = document.getElementById('up-trace-style')
const downloadBtn = document.getElementById('up-download-btn')

const plotContainer = document.getElementById('up-plot')

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

    addFile(file.name, parsed)
    renderFilePanels()
    stylePanel.style.display = ''
    updatePlot()

    appendStatus(
      `<div class="alert alert-success">Loaded <strong>${escapeHtml(file.name)}</strong> — ${
        parsed.rows.length
      } rows, ${parsed.columns.length} columns.</div>`
    )
  } catch (err) {
    appendStatus(
      `<div class="alert alert-danger">Could not load ${escapeHtml(file.name)}: ${escapeHtml(
        err.message || String(err)
      )}</div>`
    )
  }
}

function appendStatus(html) {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = html
  fileStatus.appendChild(wrapper.firstElementChild)
}

function addFile(name, parsed) {
  const seriesState = {}
  parsed.columns.forEach((col) => {
    seriesState[col] = { checked: false, color: colorForIndex(colorCounter++) }
  })
  const xCol = parsed.columns[0]
  const firstY = parsed.columns.find((c) => c !== xCol)
  if (firstY) seriesState[firstY].checked = true

  loadedFiles.push({
    id: fileIdCounter++,
    name,
    columns: parsed.columns,
    rows: parsed.rows,
    xCol,
    seriesState,
  })
}

// ------------------------------------------------------------------
// Per-file sidebar panels
// ------------------------------------------------------------------
function renderFilePanels() {
  filePanels.innerHTML = loadedFiles.map((f) => filePanelHtml(f)).join('')
  loadedFiles.forEach((f) => wireFilePanel(f))
}

function filePanelHtml(f) {
  return `
    <div class="panel" data-file-id="${f.id}">
      <div class="up-panel-head">
        <h2 title="${escapeAttr(f.name)}">${escapeHtml(f.name)}</h2>
        <button type="button" class="btn up-btn-small up-remove-file">Remove</button>
      </div>
      <div class="field">
        <label>X axis</label>
        <select class="up-x-select">
          ${f.columns
            .map(
              (c) =>
                `<option value="${escapeAttr(c)}" ${c === f.xCol ? 'selected' : ''}>${escapeHtml(
                  c
                )}</option>`
            )
            .join('')}
        </select>
      </div>
      <div class="field">
        <label>Y series (choose which to display)</label>
        <div class="up-y-list">
          ${f.columns
            .filter((c) => c !== f.xCol)
            .map((c) => yRowHtml(f, c))
            .join('')}
        </div>
      </div>
    </div>`
}

function yRowHtml(f, col) {
  const st = f.seriesState[col]
  return `
    <div class="up-y-row" data-col="${escapeAttr(col)}">
      <input type="checkbox" class="up-y-check" ${st.checked ? 'checked' : ''} />
      <label title="${escapeAttr(col)}">${escapeHtml(col)}</label>
      <input type="color" class="up-y-color" value="${st.color}" />
    </div>`
}

function wireFilePanel(f) {
  const panel = filePanels.querySelector(`.panel[data-file-id="${f.id}"]`)
  if (!panel) return

  const xSelect = panel.querySelector('.up-x-select')
  xSelect.addEventListener('change', () => {
    f.xCol = xSelect.value
    const yListEl = panel.querySelector('.up-y-list')
    yListEl.innerHTML = f.columns
      .filter((c) => c !== f.xCol)
      .map((c) => yRowHtml(f, c))
      .join('')
    wireYRows(f, panel)
    updatePlot()
  })

  panel.querySelector('.up-remove-file').addEventListener('click', () => {
    loadedFiles = loadedFiles.filter((x) => x.id !== f.id)
    renderFilePanels()
    updatePlot()
  })

  wireYRows(f, panel)
}

function wireYRows(f, panel) {
  panel.querySelectorAll('.up-y-row').forEach((row) => {
    const col = row.dataset.col
    row.querySelector('.up-y-check').addEventListener('change', (e) => {
      f.seriesState[col].checked = e.target.checked
      updatePlot()
    })
    row.querySelector('.up-y-color').addEventListener('input', (e) => {
      f.seriesState[col].color = e.target.value
      updatePlot()
    })
  })
}

// ------------------------------------------------------------------
// Global chart option wiring
// ------------------------------------------------------------------
titleInput.addEventListener('input', updatePlot)
xlabelInput.addEventListener('input', () => {
  xLabelDirty = true
  updatePlot()
})
ylabelInput.addEventListener('input', () => {
  yLabelDirty = true
  updatePlot()
})
logxCheckbox.addEventListener('change', updatePlot)
logyCheckbox.addEventListener('change', updatePlot)
traceStyleSelect.addEventListener('change', updatePlot)

// ------------------------------------------------------------------
// Trace collection
// ------------------------------------------------------------------
function getVisibleTraces() {
  const traces = []
  for (const f of loadedFiles) {
    for (const col of f.columns) {
      if (col === f.xCol) continue
      const st = f.seriesState[col]
      if (!st || !st.checked) continue

      const xs = []
      const ys = []
      for (const row of f.rows) {
        const xv = row[f.xCol]
        const yv = row[col]
        if (Number.isFinite(xv) && Number.isFinite(yv)) {
          xs.push(xv)
          ys.push(yv)
        }
      }
      traces.push({
        file: f,
        xCol: f.xCol,
        yCol: col,
        name: `${f.name}: ${col}`,
        color: st.color,
        x: xs,
        y: ys,
      })
    }
  }
  return traces
}

// ------------------------------------------------------------------
// Plotting
// ------------------------------------------------------------------
function updateLabelDefaults(traces) {
  if (!xLabelDirty) xlabelInput.value = traces.length === 1 ? traces[0].xCol : 'X'
  if (!yLabelDirty) ylabelInput.value = traces.length === 1 ? traces[0].yCol : 'Y'
}

function updatePlot() {
  if (loadedFiles.length === 0) {
    plotContainer.innerHTML = '<div class="empty-state">Upload one or more data files to get started.</div>'
    downloadBtn.disabled = true
    return
  }

  const traces = getVisibleTraces()
  updateLabelDefaults(traces)

  if (traces.length === 0) {
    plotContainer.innerHTML = '<div class="empty-state">Select at least one Y series to plot.</div>'
    downloadBtn.disabled = true
    return
  }
  downloadBtn.disabled = false

  // Plotly.react needs a real element (not innerHTML-replaced empty-state div)
  if (!plotContainer.querySelector('.js-plotly-plot')) {
    plotContainer.innerHTML = ''
  }

  const mode = traceStyleSelect.value
  const plotlyTraces = traces.map((t) => ({
    x: t.x,
    y: t.y,
    type: 'scatter',
    mode,
    name: t.name,
    line: { color: t.color },
    marker: { color: t.color },
  }))

  renderPlot(
    plotContainer,
    plotlyTraces,
    {
      title: { text: titleInput.value || '', x: 0.5 },
      xaxis: {
        title: { text: xlabelInput.value || 'X' },
        type: logxCheckbox.checked ? 'log' : 'linear',
      },
      yaxis: {
        title: { text: ylabelInput.value || 'Y' },
        type: logyCheckbox.checked ? 'log' : 'linear',
      },
      height: 600,
    },
    'universal_plot'
  )
}

// ------------------------------------------------------------------
// CSV export of currently visible traces (wide format, ragged-padded)
// ------------------------------------------------------------------
downloadBtn.addEventListener('click', () => {
  const traces = getVisibleTraces()
  if (traces.length === 0) return

  const headers = []
  traces.forEach((t) => {
    headers.push(`${t.file.name}::${t.xCol}`)
    headers.push(`${t.file.name}::${t.yCol}`)
  })

  const maxLen = Math.max(...traces.map((t) => t.x.length))
  const dataRows = []
  for (let i = 0; i < maxLen; i++) {
    const row = []
    traces.forEach((t) => {
      row.push(i < t.x.length ? t.x[i] : '')
      row.push(i < t.y.length ? t.y[i] : '')
    })
    dataRows.push(row)
  }

  const csv = toCSV(headers, dataRows)
  downloadCSV(csv, `universal_plot_${timestampSlug()}.csv`)
})

// ------------------------------------------------------------------
// Utils
// ------------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  )
}
function escapeAttr(s) {
  return escapeHtml(s)
}

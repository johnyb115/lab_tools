import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { parseTableFile } from '../shared/parseTable.js'
import { renderPlot, colorForIndex } from '../shared/plotlySetup.js'
import { toCSV, downloadCSV, timestampSlug } from '../shared/download.js'
import { escapeHtml, escapeAttr } from '../shared/dom.js'

initChrome('eis-plotter')

// ------------------------------------------------------------------
// Column-name guessing (best-effort defaults; user can override any of them)
// ------------------------------------------------------------------
const FREQ_PATTERNS = [/freq/i]
const RE_PATTERNS = [/z['’]\s*\(?re/i, /^z'$/i, /z_?re/i, /real/i]
const IM_PATTERNS = [/z['’]{2}|z''/i, /z_?im/i, /imag/i]
const MAG_PATTERNS = [/\|z\|/i, /magnitude/i, /\bmag\b/i, /^z$/i]
const PHASE_PATTERNS = [/phase/i, /angle/i]

function guess(columns, patterns) {
  for (const p of patterns) {
    const found = columns.find((c) => p.test(c))
    if (found) return found
  }
  return null
}

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------
// Each loaded file: { id, name, columns, rows, color, freqCol, format, reCol, imCol, magCol, phaseCol }
let loadedFiles = []
let fileIdCounter = 0
let colorCounter = 0

// ------------------------------------------------------------------
// DOM references
// ------------------------------------------------------------------
const dropzone = document.getElementById('eis-dropzone')
const fileInput = document.getElementById('eis-file-input')
const fileStatus = document.getElementById('eis-file-status')
const filePanels = document.getElementById('eis-file-panels')
const exportPanel = document.getElementById('eis-export-panel')
const downloadBtn = document.getElementById('eis-download-btn')

const nyquistContainer = document.getElementById('eis-nyquist-plot')
const bodeContainer = document.getElementById('eis-bode-plot')

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
    exportPanel.style.display = ''
    updatePlots()

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
  const columns = parsed.columns
  const freqCol = guess(columns, FREQ_PATTERNS) || columns[0]
  const reCol = guess(columns, RE_PATTERNS)
  const imCol = guess(columns, IM_PATTERNS)
  const magCol = guess(columns, MAG_PATTERNS)
  const phaseCol = guess(columns, PHASE_PATTERNS)

  const format = (!reCol || !imCol) && magCol && phaseCol ? 'mag-phase' : 're-im'

  const otherCols = columns.filter((c) => c !== freqCol)

  loadedFiles.push({
    id: fileIdCounter++,
    name,
    columns,
    rows: parsed.rows,
    color: colorForIndex(colorCounter++),
    freqCol,
    format,
    reCol: reCol || otherCols[0] || freqCol,
    imCol: imCol || otherCols[1] || otherCols[0] || freqCol,
    magCol: magCol || otherCols[0] || freqCol,
    phaseCol: phaseCol || otherCols[1] || otherCols[0] || freqCol,
  })
}

// ------------------------------------------------------------------
// Normalization: every file -> array of { freq, zReal, zImag }
// ------------------------------------------------------------------
function normalizedPoints(f) {
  const pts = []
  for (const row of f.rows) {
    const freq = row[f.freqCol]
    if (!Number.isFinite(freq) || freq <= 0) continue

    let zReal, zImag
    if (f.format === 'mag-phase') {
      const mag = row[f.magCol]
      const phaseDeg = row[f.phaseCol]
      if (!Number.isFinite(mag) || !Number.isFinite(phaseDeg)) continue
      const rad = (phaseDeg * Math.PI) / 180
      zReal = mag * Math.cos(rad)
      zImag = mag * Math.sin(rad)
    } else {
      zReal = row[f.reCol]
      zImag = row[f.imCol]
      if (!Number.isFinite(zReal) || !Number.isFinite(zImag)) continue
    }
    pts.push({ freq, zReal, zImag })
  }
  return pts
}

// ------------------------------------------------------------------
// Per-file sidebar panels
// ------------------------------------------------------------------
function renderFilePanels() {
  filePanels.innerHTML = loadedFiles.map((f) => filePanelHtml(f)).join('')
  loadedFiles.forEach((f) => wireFilePanel(f))
}

function columnOptionsHtml(columns, selected) {
  return columns
    .map(
      (c) =>
        `<option value="${escapeAttr(c)}" ${c === selected ? 'selected' : ''}>${escapeHtml(c)}</option>`
    )
    .join('')
}

function colsFieldsHtml(f) {
  if (f.format === 'mag-phase') {
    return `
      <div class="field">
        <label>|Z| (magnitude)</label>
        <select class="eis-mag-select">${columnOptionsHtml(f.columns, f.magCol)}</select>
      </div>
      <div class="field">
        <label>Phase (degrees)</label>
        <select class="eis-phase-select">${columnOptionsHtml(f.columns, f.phaseCol)}</select>
      </div>`
  }
  return `
    <div class="field">
      <label>Z′ (real)</label>
      <select class="eis-re-select">${columnOptionsHtml(f.columns, f.reCol)}</select>
    </div>
    <div class="field">
      <label>Z″ (imaginary)</label>
      <select class="eis-im-select">${columnOptionsHtml(f.columns, f.imCol)}</select>
    </div>`
}

function filePanelHtml(f) {
  return `
    <div class="panel" data-file-id="${f.id}">
      <div class="eis-panel-head">
        <h2 title="${escapeAttr(f.name)}"><span class="eis-swatch" style="background:${f.color}"></span>${escapeHtml(
          f.name
        )}</h2>
        <button type="button" class="btn eis-btn-small eis-remove-file">Remove</button>
      </div>
      <div class="field">
        <label>Frequency column</label>
        <select class="eis-freq-select">${columnOptionsHtml(f.columns, f.freqCol)}</select>
      </div>
      <div class="field">
        <label>Impedance given as</label>
        <select class="eis-format-select">
          <option value="re-im" ${f.format === 're-im' ? 'selected' : ''}>Z′ / Z″ (real, imaginary)</option>
          <option value="mag-phase" ${f.format === 'mag-phase' ? 'selected' : ''}>|Z| / Phase (degrees)</option>
        </select>
      </div>
      <div class="eis-cols-wrap">${colsFieldsHtml(f)}</div>
    </div>`
}

function wireFilePanel(f) {
  const panel = filePanels.querySelector(`.panel[data-file-id="${f.id}"]`)
  if (!panel) return

  panel.querySelector('.eis-freq-select').addEventListener('change', (e) => {
    f.freqCol = e.target.value
    updatePlots()
  })

  panel.querySelector('.eis-format-select').addEventListener('change', (e) => {
    f.format = e.target.value
    panel.querySelector('.eis-cols-wrap').innerHTML = colsFieldsHtml(f)
    wireColsSelects(f, panel)
    updatePlots()
  })

  panel.querySelector('.eis-remove-file').addEventListener('click', () => {
    loadedFiles = loadedFiles.filter((x) => x.id !== f.id)
    renderFilePanels()
    if (loadedFiles.length === 0) exportPanel.style.display = 'none'
    updatePlots()
  })

  wireColsSelects(f, panel)
}

function wireColsSelects(f, panel) {
  if (f.format === 'mag-phase') {
    panel.querySelector('.eis-mag-select').addEventListener('change', (e) => {
      f.magCol = e.target.value
      updatePlots()
    })
    panel.querySelector('.eis-phase-select').addEventListener('change', (e) => {
      f.phaseCol = e.target.value
      updatePlots()
    })
  } else {
    panel.querySelector('.eis-re-select').addEventListener('change', (e) => {
      f.reCol = e.target.value
      updatePlots()
    })
    panel.querySelector('.eis-im-select').addEventListener('change', (e) => {
      f.imCol = e.target.value
      updatePlots()
    })
  }
}

// ------------------------------------------------------------------
// Plotting
// ------------------------------------------------------------------
function ensureRealElement(container) {
  // Plotly tags the container itself (not a descendant) with this class, so a
  // querySelector here always misses and would wipe the DOM out from under
  // Plotly's own in-flight re-render on every call — check classList instead.
  if (!container.classList.contains('js-plotly-plot')) container.innerHTML = ''
}

function updatePlots() {
  if (loadedFiles.length === 0) {
    nyquistContainer.innerHTML = '<div class="empty-state">Upload one or more EIS data files to get started.</div>'
    bodeContainer.innerHTML = '<div class="empty-state">Upload one or more EIS data files to get started.</div>'
    downloadBtn.disabled = true
    return
  }

  const perFile = loadedFiles.map((f) => ({ file: f, points: normalizedPoints(f) }))
  const usable = perFile.filter((p) => p.points.length > 0)

  if (usable.length === 0) {
    nyquistContainer.innerHTML =
      '<div class="empty-state">No valid numeric points with the selected columns. Check the column mapping for each file.</div>'
    bodeContainer.innerHTML =
      '<div class="empty-state">No valid numeric points with the selected columns. Check the column mapping for each file.</div>'
    downloadBtn.disabled = true
    return
  }
  downloadBtn.disabled = false

  ensureRealElement(nyquistContainer)
  ensureRealElement(bodeContainer)

  const nyquistTraces = usable.map(({ file, points }) => ({
    x: points.map((p) => p.zReal),
    y: points.map((p) => -p.zImag),
    type: 'scatter',
    mode: 'lines+markers',
    name: file.name,
    line: { color: file.color },
    marker: { color: file.color, size: 6 },
  }))

  renderPlot(
    nyquistContainer,
    nyquistTraces,
    {
      xaxis: { title: { text: "Z′ (Ω)" } },
      yaxis: { title: { text: '−Z″ (Ω)' }, scaleanchor: 'x', scaleratio: 1 },
      height: 520,
    },
    'nyquist_plot'
  )

  const bodeTraces = []
  usable.forEach(({ file, points }) => {
    const freqs = points.map((p) => p.freq)
    const mags = points.map((p) => Math.hypot(p.zReal, p.zImag))
    const phases = points.map((p) => (Math.atan2(p.zImag, p.zReal) * 180) / Math.PI)

    bodeTraces.push({
      x: freqs,
      y: mags,
      type: 'scatter',
      mode: 'lines+markers',
      name: `${file.name} — |Z|`,
      line: { color: file.color },
      marker: { color: file.color, size: 5 },
      yaxis: 'y',
    })
    bodeTraces.push({
      x: freqs,
      y: phases,
      type: 'scatter',
      mode: 'lines+markers',
      name: `${file.name} — phase`,
      line: { color: file.color, dash: 'dot' },
      marker: { color: file.color, size: 5, symbol: 'diamond' },
      yaxis: 'y2',
    })
  })

  renderPlot(
    bodeContainer,
    bodeTraces,
    {
      xaxis: { title: { text: 'Frequency (Hz)' }, type: 'log' },
      yaxis: { title: { text: '|Z| (Ω)' }, type: 'log' },
      yaxis2: {
        title: { text: 'Phase (°)' },
        overlaying: 'y',
        side: 'right',
        gridcolor: 'rgba(0,0,0,0)',
      },
      height: 520,
    },
    'bode_plot'
  )
}

// ------------------------------------------------------------------
// CSV export of normalized data (long-form, one row per point)
// ------------------------------------------------------------------
downloadBtn.addEventListener('click', () => {
  const headers = ['file', 'freq_Hz', 'Z_real', 'Z_imag', 'Z_mag', 'phase_deg']
  const dataRows = []

  for (const f of loadedFiles) {
    const points = normalizedPoints(f)
    for (const p of points) {
      const mag = Math.hypot(p.zReal, p.zImag)
      const phaseDeg = (Math.atan2(p.zImag, p.zReal) * 180) / Math.PI
      dataRows.push([f.name, p.freq, p.zReal, p.zImag, mag, phaseDeg])
    }
  }

  if (dataRows.length === 0) return

  const csv = toCSV(headers, dataRows)
  downloadCSV(csv, `eis_data_${timestampSlug()}.csv`)
})

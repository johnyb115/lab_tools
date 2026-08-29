import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { downloadBlob, toCSV } from '../shared/download.js'
import { renderPlot, colorForIndex } from '../shared/plotlySetup.js'
import JSZip from 'jszip'

initChrome('voltammetry')

// ------------------------------------------------------------------
// Column definitions for the two recognised file types
// ------------------------------------------------------------------
const CV_COLUMNS = ['Scan', 'WE(1).Potential (V)', 'WE(1).Current (A)']
const DPV_COLUMNS = ['WE(1).Base.Potential (V)', 'WE(1).δ.Current (A)']

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------
// files: { id, name, type: 'CV'|'DPV', header: string[], rows: object[] }[]
let files = []
let nextFileId = 1

// ------------------------------------------------------------------
// DOM refs
// ------------------------------------------------------------------
const dropzone = document.getElementById('vt-dropzone')
const fileInput = document.getElementById('vt-file-input')
const fileListEl = document.getElementById('vt-file-list')
const fileStatusEl = document.getElementById('vt-file-status')
const statusEl = document.getElementById('vt-status')

const scanRangeInput = document.getElementById('vt-scan-range')
const processBtn = document.getElementById('vt-process-btn')
const clearBtn = document.getElementById('vt-clear-btn')
const exportBtn = document.getElementById('vt-export-btn')

const plotContainer = document.getElementById('vt-plot')
const previewContainer = document.getElementById('vt-preview-container')

// ------------------------------------------------------------------
// File loading
// ------------------------------------------------------------------
initDropzone(dropzone, fileInput, (fileListArg) => handleFiles(fileListArg))

async function handleFiles(fileListArg) {
  const errors = []
  for (const file of Array.from(fileListArg)) {
    try {
      const text = await file.text()
      const { header, rows } = parseSemicolonFile(text)
      const type = detectFileType(header)
      if (!type) {
        errors.push(`Skipping ${file.name}: unrecognized columns`)
        continue
      }
      files.push({ id: nextFileId++, name: file.name, type, header, rows })
    } catch (err) {
      errors.push(`Skipping ${file.name}: ${err.message || String(err)}`)
    }
  }

  fileStatusEl.innerHTML = errors
    .map((msg) => `<div class="alert alert-danger">${escapeHtml(msg)}</div>`)
    .join('')

  renderFileList()
  renderPreviews()
  fileInput.value = ''
}

function parseSemicolonFile(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) {
    throw new Error('No data rows found in this file.')
  }
  let headerLine = lines[0]
  if (headerLine.charCodeAt(0) === 0xfeff) headerLine = headerLine.slice(1)
  const header = headerLine.split(';').map((h) => h.trim())

  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(';').map((c) => c.trim())
    const row = {}
    header.forEach((h, idx) => {
      row[h] = cells[idx] !== undefined ? cells[idx] : ''
    })
    rows.push(row)
  }
  return { header, rows }
}

function detectFileType(header) {
  if (CV_COLUMNS.every((c) => header.includes(c))) return 'CV'
  if (DPV_COLUMNS.every((c) => header.includes(c))) return 'DPV'
  return null
}

// ------------------------------------------------------------------
// Scan range parsing
// ------------------------------------------------------------------
function parseScanRange(rangeStr, availableScans) {
  const trimmed = (rangeStr || '').trim().toLowerCase()
  const availableSet = new Set(availableScans)
  if (trimmed === '' || trimmed === 'all') {
    return [...availableSet].sort((a, b) => a - b)
  }

  const selected = new Set()
  for (const rawPart of rangeStr.split(',')) {
    const part = rawPart.trim()
    if (!part) continue
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-').map((s) => s.trim())
      const start = parseInt(startStr, 10)
      const end = parseInt(endStr, 10)
      if (Number.isNaN(start) || Number.isNaN(end)) {
        console.warn(`Invalid scan range token: "${part}"`)
        continue
      }
      for (let s = start; s <= end; s++) selected.add(s)
    } else {
      const val = parseInt(part, 10)
      if (Number.isNaN(val)) {
        console.warn(`Invalid scan token: "${part}"`)
        continue
      }
      selected.add(val)
    }
  }

  return [...selected].filter((s) => availableSet.has(s)).sort((a, b) => a - b)
}

function groupByScan(rows) {
  const map = new Map()
  for (const row of rows) {
    const scan = Number(row['Scan'])
    if (!map.has(scan)) map.set(scan, [])
    map.get(scan).push(row)
  }
  return map
}

// ------------------------------------------------------------------
// File list UI
// ------------------------------------------------------------------
function renderFileList() {
  fileListEl.innerHTML = files
    .map(
      (f) => `
      <li data-id="${f.id}">
        <span class="vt-fname" title="${escapeAttr(f.name)}">${escapeHtml(f.name)}</span>
        <span class="vt-ftype">${f.type}</span>
        <button type="button" class="vt-remove-btn" data-id="${f.id}" title="Remove">✕</button>
      </li>`
    )
    .join('')

  fileListEl.querySelectorAll('.vt-remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id)
      files = files.filter((f) => f.id !== id)
      renderFileList()
      renderPreviews()
    })
  })
}

// ------------------------------------------------------------------
// Loaded-data preview tables
// ------------------------------------------------------------------
const PREVIEW_ROW_CAP = 500

function renderPreviews() {
  if (!files.length) {
    previewContainer.innerHTML = ''
    return
  }

  previewContainer.innerHTML = files
    .map((f) => {
      const rowsToShow = f.rows.slice(0, PREVIEW_ROW_CAP)
      const thead = `<thead><tr>${f.header.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`
      const tbody = `<tbody>${rowsToShow
        .map((r) => `<tr>${f.header.map((h) => `<td>${escapeHtml(r[h])}</td>`).join('')}</tr>`)
        .join('')}</tbody>`
      const note =
        f.rows.length > PREVIEW_ROW_CAP
          ? `<p class="vt-preview-note">showing first ${PREVIEW_ROW_CAP} of ${f.rows.length} rows</p>`
          : ''
      return `
        <details class="vt-preview">
          <summary>${escapeHtml(f.name)}</summary>
          <div class="table-wrap"><table>${thead}${tbody}</table></div>
          ${note}
        </details>`
    })
    .join('')
}

// ------------------------------------------------------------------
// Process & Plot
// ------------------------------------------------------------------
processBtn.addEventListener('click', () => {
  if (!files.length) {
    setStatus('alert-warning', 'No valid CV/DPV files to plot.')
    return
  }

  const traces = []
  const contributingFiles = new Set()
  let traceIndex = 0

  for (const file of files) {
    if (file.type === 'CV') {
      const groups = groupByScan(file.rows)
      const availableScans = [...groups.keys()]
      const selectedScans = parseScanRange(scanRangeInput.value, availableScans)
      for (const scan of selectedScans) {
        const rows = groups.get(scan)
        const x = rows.map((r) => Number(r['WE(1).Potential (V)']))
        const y = rows.map((r) => Number(r['WE(1).Current (A)']) * 1e6)
        traces.push({
          x,
          y,
          type: 'scatter',
          mode: 'lines',
          name: `${file.name} — Scan ${scan}`,
          line: { color: colorForIndex(traceIndex) },
        })
        traceIndex++
        contributingFiles.add(file.id)
      }
    } else if (file.type === 'DPV') {
      const x = file.rows.map((r) => Number(r['WE(1).Base.Potential (V)']))
      const y = file.rows.map((r) => Number(r['WE(1).δ.Current (A)']) * 1e6)
      traces.push({
        x,
        y,
        type: 'scatter',
        mode: 'lines',
        name: file.name,
        line: { color: colorForIndex(traceIndex) },
      })
      traceIndex++
      contributingFiles.add(file.id)
    }
  }

  if (!traces.length) {
    setStatus('alert-warning', 'No valid CV/DPV files to plot.')
    return
  }

  if (!plotContainer.querySelector('.js-plotly-plot')) plotContainer.innerHTML = ''

  renderPlot(
    plotContainer,
    traces,
    {
      title: 'Combined Voltammetry Plot',
      xaxis: { title: 'Potential (V)' },
      yaxis: { title: 'Current (µA)' },
      height: 650,
    },
    'voltammetry_plot'
  )

  setStatus('alert-success', `Plotted ${traces.length} trace(s) from ${contributingFiles.size} file(s).`)
})

// ------------------------------------------------------------------
// Clear All
// ------------------------------------------------------------------
clearBtn.addEventListener('click', () => {
  files = []
  nextFileId = 1
  scanRangeInput.value = ''
  fileStatusEl.innerHTML = ''
  statusEl.innerHTML = ''
  renderFileList()
  renderPreviews()
  plotContainer.innerHTML = '<div class="empty-state">Upload one or more CV/DPV files to get started.</div>'
})

// ------------------------------------------------------------------
// ZIP export of processed CSVs
// ------------------------------------------------------------------
exportBtn.addEventListener('click', async () => {
  if (!files.length) {
    setStatus('alert-warning', 'No files loaded yet — upload CV/DPV files first.')
    return
  }

  const zip = new JSZip()
  for (const file of files) {
    const csv = file.type === 'CV' ? buildCvCsv(file) : buildDpvCsv(file)
    zip.file(`processed_${file.name}.csv`, csv)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(blob, 'processed_files.zip')
})

function buildCvCsv(file) {
  const groups = groupByScan(file.rows)
  const scans = [...groups.keys()].sort((a, b) => a - b)
  const columns = scans.map((scan) => {
    const rows = groups.get(scan)
    return {
      scan,
      potentials: rows.map((r) => Number(r['WE(1).Potential (V)'])),
      currents: rows.map((r) => Number(r['WE(1).Current (A)']) * 1e6),
    }
  })

  const maxLen = columns.reduce((max, c) => Math.max(max, c.potentials.length), 0)
  const headers = columns.flatMap((c) => [`Potential_${c.scan}`, `Current_${c.scan}`])
  const dataRows = []
  for (let i = 0; i < maxLen; i++) {
    const row = []
    for (const c of columns) {
      row.push(i < c.potentials.length ? c.potentials[i] : '')
      row.push(i < c.currents.length ? c.currents[i] : '')
    }
    dataRows.push(row)
  }
  return toCSV(headers, dataRows)
}

function buildDpvCsv(file) {
  const headers = ['Potential (V)', 'Delta Current (µA)']
  const dataRows = file.rows.map((r) => [
    Number(r['WE(1).Base.Potential (V)']),
    Number(r['WE(1).δ.Current (A)']) * 1e6,
  ])
  return toCSV(headers, dataRows)
}

// ------------------------------------------------------------------
// Utils
// ------------------------------------------------------------------
function setStatus(alertClass, message) {
  statusEl.innerHTML = `<div class="alert ${alertClass}">${escapeHtml(message)}</div>`
}

function escapeHtml(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  )
}
function escapeAttr(s) {
  return escapeHtml(s)
}

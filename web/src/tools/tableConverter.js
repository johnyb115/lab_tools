import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { parseTableFile } from '../shared/parseTable.js'
import { toCSV, downloadText, downloadBlob, timestampSlug } from '../shared/download.js'
import { escapeHtml } from '../shared/dom.js'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'

initChrome('table-converter')

const PREVIEW_ROWS = 20

// One entry per loaded file: { id, name, columns, rows, error }.
// `error` is set (and columns/rows left empty) when the file couldn't be parsed.
let entries = []
let nextId = 1

const dropzone = document.getElementById('dropzone')
const fileInput = document.getElementById('file-input')
const formatSelect = document.getElementById('format-select')
const convertBtn = document.getElementById('convert-btn')
const clearAllBtn = document.getElementById('clear-all-btn')
const resultsArea = document.getElementById('results-area')

initDropzone(dropzone, fileInput, (files) => handleFiles(files))

async function handleFiles(fileList) {
  const files = Array.from(fileList)
  if (files.length === 0) return
  await Promise.all(files.map(loadFile))
  render()
}

async function loadFile(file) {
  try {
    let parsed
    if (file.name.toLowerCase().endsWith('.json')) {
      parsed = await parseJSONFile(file)
    } else {
      parsed = await parseTableFile(file)
    }
    if (!parsed.columns.length || !parsed.rows.length) {
      throw new Error('No data rows found in this file.')
    }
    entries.push({ id: nextId++, name: file.name, columns: parsed.columns, rows: parsed.rows, error: null })
  } catch (err) {
    entries.push({ id: nextId++, name: file.name, columns: [], rows: [], error: err.message || String(err) })
  }
}

async function parseJSONFile(file) {
  const text = await file.text()
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error(`Could not parse JSON: ${e.message}`)
  }
  const isFlatObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (!Array.isArray(data) || data.length === 0 || !isFlatObject(data[0])) {
    throw new Error('Expected a JSON array of flat objects, e.g. [{"col1": 1, "col2": 2}, …].')
  }
  const columns = Object.keys(data[0])
  return { columns, rows: data }
}

// ------------------------------------------------------------------
// Rendering
// ------------------------------------------------------------------
function render() {
  clearAllBtn.hidden = entries.length === 0
  convertBtn.disabled = !entries.some((e) => !e.error)

  if (entries.length === 0) {
    resultsArea.innerHTML = '<div class="empty-state">Upload one or more CSV, TSV, XLSX or JSON files to preview and convert them.</div>'
    return
  }

  resultsArea.innerHTML = entries.map((e) => panelHtml(e)).join('')

  entries.forEach((e) => {
    const panel = resultsArea.querySelector(`[data-entry-id="${e.id}"]`)
    panel?.querySelector('[data-action="remove"]').addEventListener('click', () => removeEntry(e.id))
  })
}

function panelHtml(e) {
  if (e.error) {
    return `
      <div class="panel tc-panel" data-entry-id="${e.id}">
        <div class="tc-panel-head">
          <h3>${escapeHtml(e.name)}</h3>
          <button type="button" class="tc-remove-btn" data-action="remove" title="Remove">✕</button>
        </div>
        <div class="alert alert-danger">${escapeHtml(e.error)}</div>
      </div>`
  }

  const rows = e.rows.slice(0, PREVIEW_ROWS)
  const headHtml = `<tr>${e.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`
  const bodyHtml = rows
    .map((r) => `<tr>${e.columns.map((c) => `<td>${escapeHtml(formatCell(r[c]))}</td>`).join('')}</tr>`)
    .join('')

  return `
    <div class="panel tc-panel" data-entry-id="${e.id}">
      <div class="tc-panel-head">
        <h3>${escapeHtml(e.name)}</h3>
        <span class="badge">${e.rows.length} rows × ${e.columns.length} cols</span>
        <button type="button" class="tc-remove-btn" data-action="remove" title="Remove">✕</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>${headHtml}</thead>
          <tbody>${bodyHtml}</tbody>
        </table>
      </div>
      ${e.rows.length > PREVIEW_ROWS ? `<p class="tc-more">… ${e.rows.length - PREVIEW_ROWS} more rows not shown (full data is in the download).</p>` : ''}
    </div>`
}

function formatCell(v) {
  if (v === null || v === undefined) return ''
  return String(v)
}

function removeEntry(id) {
  entries = entries.filter((e) => e.id !== id)
  render()
}

clearAllBtn.addEventListener('click', () => {
  entries = []
  render()
})

// ------------------------------------------------------------------
// Conversion
// ------------------------------------------------------------------
function rowsToArrays(entry) {
  return entry.rows.map((r) => entry.columns.map((c) => formatCell(r[c])))
}

function toTSV(headers, dataRows) {
  const esc = (v) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return /[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.map(esc).join('\t')]
  for (const row of dataRows) lines.push(row.map(esc).join('\t'))
  return lines.join('\n')
}

function buildXlsxBlob(entry) {
  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(entry.rows, { header: entry.columns })
  XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1')
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// Returns { content, mime, ext } where content is a string (csv/tsv/json) or a Blob (xlsx).
function convertEntry(entry, format) {
  if (format === 'csv') {
    return { content: toCSV(entry.columns, rowsToArrays(entry)), mime: 'text/csv;charset=utf-8', ext: 'csv' }
  }
  if (format === 'tsv') {
    return { content: toTSV(entry.columns, rowsToArrays(entry)), mime: 'text/tab-separated-values;charset=utf-8', ext: 'tsv' }
  }
  if (format === 'json') {
    return { content: JSON.stringify(entry.rows, null, 2), mime: 'application/json', ext: 'json' }
  }
  if (format === 'xlsx') {
    return { content: buildXlsxBlob(entry), mime: null, ext: 'xlsx' }
  }
  throw new Error(`Unknown output format: ${format}`)
}

function baseName(name) {
  return name.replace(/\.[^.]+$/, '')
}

convertBtn.addEventListener('click', async () => {
  const format = formatSelect.value
  const valid = entries.filter((e) => !e.error)
  if (valid.length === 0) return

  if (valid.length === 1) {
    const e = valid[0]
    const { content, mime, ext } = convertEntry(e, format)
    const filename = `${baseName(e.name)}.${ext}`
    if (content instanceof Blob) downloadBlob(content, filename)
    else downloadText(content, filename, mime)
    return
  }

  const zip = new JSZip()
  for (const e of valid) {
    const { content, ext } = convertEntry(e, format)
    zip.file(`${baseName(e.name)}.${ext}`, content)
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(zipBlob, `converted_${timestampSlug()}.zip`)
})

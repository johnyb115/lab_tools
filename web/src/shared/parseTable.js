// Generic tabular-file parsing: CSV / semicolon-CSV / TSV / whitespace-ASCII / XLSX.
// Used by the voltammetry, universal-plotter and four-point-probe tools so each
// one doesn't need to re-implement delimiter sniffing.

import Papa from 'papaparse'
import * as XLSX from 'xlsx'

const CANDIDATE_DELIMITERS = [',', ';', '\t']

/** Look at the first few non-empty lines and pick the delimiter with the most
 * consistent column count. Falls back to "whitespace runs" for ASCII exports. */
export function sniffDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 20)
  if (lines.length === 0) return ','

  let best = { delimiter: ',', score: -1 }
  for (const delim of CANDIDATE_DELIMITERS) {
    const counts = lines.map((l) => l.split(delim).length)
    const modal = counts[0]
    if (modal < 2) continue
    const consistent = counts.filter((c) => c === modal).length
    const score = consistent / counts.length + modal / 100
    if (score > best.score) best = { delimiter: delim, score }
  }
  if (best.score >= 0) return best.delimiter
  return 'whitespace'
}

/**
 * Parse delimited/whitespace text into { columns, rows }.
 * rows is an array of objects keyed by column name.
 * Non-numeric strings are kept as strings; parseable numbers become Number.
 */
export function parseDelimitedText(text, { delimiter } = {}) {
  const clean = text.replace(/^﻿/, '') // strip BOM (Autolab NOVA exports)
  const delim = delimiter || sniffDelimiter(clean)

  let rows
  if (delim === 'whitespace') {
    const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0)
    rows = lines.map((l) => l.trim().split(/\s+/))
  } else {
    const result = Papa.parse(clean, { delimiter: delim, skipEmptyLines: true })
    rows = result.data
  }

  if (rows.length === 0) return { columns: [], rows: [] }

  const header = rows[0].map((h, i) => (h && String(h).trim()) || `col_${i + 1}`)
  const body = rows.slice(1)

  const parsedRows = body.map((r) => {
    const obj = {}
    header.forEach((h, i) => {
      obj[h] = coerceNumber(r[i])
    })
    return obj
  })

  return { columns: header, rows: parsedRows }
}

/** Read the first sheet of an .xlsx/.xls ArrayBuffer into { columns, rows }. */
export function parseXLSX(arrayBuffer, { sheetName } = {}) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })
  const name = sheetName || workbook.SheetNames[0]
  const sheet = workbook.Sheets[name]
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })

  if (!raw || raw.length === 0) return { columns: [], rows: [] }

  const header = raw[0].map((h, i) => (h && String(h).trim()) || `col_${i + 1}`)
  const rows = raw.slice(1).map((r) => {
    const obj = {}
    header.forEach((h, i) => { obj[h] = coerceNumber(r[i]) })
    return obj
  })
  return { columns: header, rows }
}

function coerceNumber(v) {
  if (v === null || v === undefined) return v
  if (typeof v === 'number') return v
  const s = String(v).trim()
  if (s === '') return s
  // Accept plain floats and scientific notation (e.g. "-2.648E-06")
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return Number(s)
  return s
}

/** Dispatch based on file extension: xlsx/xls -> parseXLSX, else text parsing. */
export async function parseTableFile(file) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buf = await file.arrayBuffer()
    return parseXLSX(buf)
  }
  const text = await file.text()
  return parseDelimitedText(text)
}

/** Extract a numeric column as a plain array, skipping non-numeric cells. */
export function numericColumn(rows, columnName) {
  return rows
    .map((r) => r[columnName])
    .filter((v) => typeof v === 'number' && Number.isFinite(v))
}

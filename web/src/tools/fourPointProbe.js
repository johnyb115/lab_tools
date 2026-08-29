import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { downloadBlob, timestampSlug } from '../shared/download.js'
import { escapeHtml } from '../shared/dom.js'
import * as XLSX from 'xlsx'

initChrome('four-point-probe')

// ------------------------------------------------------------------
// Constants (ported from lab_app/pages/02_FourPointProbe.py)
// ------------------------------------------------------------------
const K = 4.53236

const RECT_TABLE_LW = [1, 2, 3, 4]
const RECT_TABLE_WS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 7.5, 10, 15, 20, 40, Infinity]
const RECT_TABLE_C = [
  [0.2204, 0.2205, null, null], // w/s = 1
  [0.2751, 0.2751, null, null], // 1.25
  [0.3263, 0.3286, 0.3286, null], // 1.5
  [0.3794, 0.3803, 0.3803, null], // 1.75
  [0.4292, 0.4297, 0.4297, null], // 2
  [0.5192, 0.5194, 0.5194, null], // 2.5
  [0.5422, 0.5957, 0.5958, 0.5958], // 3
  [0.687, 0.7115, 0.7115, 0.7115], // 4
  [0.7744, 0.7887, 0.7887, 0.7887], // 5
  [0.8846, 0.8905, 0.8905, 0.8905], // 7.5
  [0.9313, 0.9345, 0.9345, 0.9345], // 10
  [0.9682, 0.9696, 0.9696, 0.9696], // 15
  [0.9822, 0.983, 0.983, 0.983], // 20
  [0.9955, 0.9957, 0.9957, 0.9957], // 40
  [1.0, 1.0, 1.0, 1.0], // inf
]

function nearest(arr, x) {
  let bestI = 0
  let bestD = Infinity
  const xEff = x === Infinity ? 1e9 : x
  for (let i = 0; i < arr.length; i++) {
    const vEff = arr[i] === Infinity ? 1e9 : arr[i]
    const d = Math.abs(vEff - xEff)
    if (d < bestD) {
      bestD = d
      bestI = i
    }
  }
  return bestI
}

function rectangularCorrectionFactor(lMm, wMm, sMm) {
  if (sMm <= 0) throw new Error('Probe spacing s must be > 0.')
  const L = Math.max(lMm, wMm)
  const W = Math.min(lMm, wMm)
  const trueLW = W > 0 ? L / W : Infinity
  const trueWS = W / sMm
  let j = nearest(RECT_TABLE_LW, trueLW)
  let i = nearest(RECT_TABLE_WS, trueWS)
  let C = RECT_TABLE_C[i][j]

  if (C === null) {
    const row = RECT_TABLE_C[i]
    const altCols = row
      .map((_, k) => k)
      .sort((a, b) => Math.abs(RECT_TABLE_LW[a] - RECT_TABLE_LW[j]) - Math.abs(RECT_TABLE_LW[b] - RECT_TABLE_LW[j]))
    for (const jj of altCols) {
      if (row[jj] !== null) {
        C = row[jj]
        j = jj
        break
      }
    }
    if (C === null) {
      for (const di of [1, -1, 2, -2]) {
        const ii = i + di
        if (ii >= 0 && ii < RECT_TABLE_C.length && RECT_TABLE_C[ii][j] !== null) {
          C = RECT_TABLE_C[ii][j]
          i = ii
          break
        }
      }
    }
    if (C === null) C = 1.0
  }

  return { C: Number(C), usedLW: RECT_TABLE_LW[j], usedWS: RECT_TABLE_WS[i], trueLW, trueWS }
}

// ------------------------------------------------------------------
// File parsers
// ------------------------------------------------------------------
function mapVIColumns(headerCells) {
  const cmap = {}
  headerCells.forEach((c, idx) => {
    const lc = String(c).trim().toLowerCase()
    if (lc.includes('volt') || lc === 'v') cmap[idx] = 'V'
    if (lc.includes('current') || lc === 'i') cmap[idx] = 'I'
    if (lc.includes('status')) cmap[idx] = 'Status'
  })
  return cmap
}

function rowsFromWhitespaceBlock(text) {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => l.trim().split(/\t|\s{2,}/).map((c) => c.trim()).filter((c) => c.length > 0))
}

function parseAsc(text) {
  const m = /\[\[DATA\]\]\s*([\s\S]*?)(?:\n\s*\[\[|$)/.exec(text)
  if (!m) throw new Error('No [[DATA]] block found in file.')
  const block = m[1].trim()
  const rows = rowsFromWhitespaceBlock(block)
  if (rows.length < 2) throw new Error('No data rows found in [[DATA]] block.')

  const header = rows[0]
  const cmap = mapVIColumns(header)
  const vIdx = Object.keys(cmap).find((k) => cmap[k] === 'V')
  const iIdx = Object.keys(cmap).find((k) => cmap[k] === 'I')
  const statusIdx = Object.keys(cmap).find((k) => cmap[k] === 'Status')
  if (vIdx === undefined || iIdx === undefined) {
    throw new Error(`Missing V/I columns. Found: ${header.join(', ')}`)
  }

  const V = []
  const I = []
  for (const r of rows.slice(1)) {
    if (statusIdx !== undefined && !(r[statusIdx] || '').includes('4PT')) continue
    const v = Number(r[vIdx])
    const i = Number(r[iIdx])
    if (Number.isFinite(v) && Number.isFinite(i)) {
      V.push(v)
      I.push(i)
    }
  }
  if (V.length === 0) throw new Error('No valid V/I rows found.')
  return { V, I }
}

function parseDelimitedVI(text) {
  const seps = [',', ';', '\t']
  for (const sep of seps) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
    if (lines.length < 2) continue
    const rows = lines.map((l) => l.split(sep).map((c) => c.trim()))
    const modal = rows[0].length
    if (modal < 2) continue
    const header = rows[0]
    const cmap = mapVIColumns(header)
    const vIdx = Object.keys(cmap).find((k) => cmap[k] === 'V')
    const iIdx = Object.keys(cmap).find((k) => cmap[k] === 'I')
    if (vIdx === undefined || iIdx === undefined) continue

    const V = []
    const I = []
    for (const r of rows.slice(1)) {
      const v = Number(r[vIdx])
      const i = Number(r[iIdx])
      if (Number.isFinite(v) && Number.isFinite(i)) {
        V.push(v)
        I.push(i)
      }
    }
    if (V.length > 0) return { V, I }
  }
  const fallbackHeader = text.split(/\r?\n/).find((l) => l.trim().length > 0) || ''
  const cols = fallbackHeader.split(/[,;\t]/).map((c) => c.trim())
  throw new Error(`Could not identify V/I columns. Columns found: ${cols.join(', ')}`)
}

async function readAny(file) {
  const text = await file.text()
  if (file.name.toLowerCase().endsWith('.asc')) return parseAsc(text)
  return parseDelimitedVI(text)
}

// ------------------------------------------------------------------
// Math
// ------------------------------------------------------------------
function fitIVReturnDetails(V, I) {
  const N = V.length
  if (N < 2) throw new Error('Not enough points for a linear fit.')
  let SV = 0, SI = 0, SV2 = 0, SVI = 0
  for (let k = 0; k < N; k++) {
    SV += V[k]
    SI += I[k]
    SV2 += V[k] * V[k]
    SVI += V[k] * I[k]
  }
  const denom = N * SV2 - SV * SV
  if (denom === 0) throw new Error('Singular fit (all V identical).')
  const a = (N * SVI - SV * SI) / denom
  const b = (SI - a * SV) / N
  if (a === 0) throw new Error('Zero slope; cannot compute R = 1/a.')
  const R = 1.0 / a
  const Rs = K * R
  return { N, SV, SI, SV2, SVI, denom, a, b, R, Rs }
}

function mean(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length
}
function stdSample(arr) {
  if (arr.length <= 1) return 0
  const m = mean(arr)
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1)
  return Math.sqrt(variance)
}
function fmtG(x, sig = 6) {
  if (!Number.isFinite(x)) return String(x)
  if (x === 0) return '0'
  return Number(x.toPrecision(sig)).toString()
}

// ------------------------------------------------------------------
// Geometry SVG (ported from render_geometry_svg)
// ------------------------------------------------------------------
function renderGeometrySvg(lMm, wMm, sMm) {
  const L = Math.max(lMm, wMm)
  const W = Math.min(lMm, wMm)
  const lwRatio = W > 0 ? L / W : Infinity
  const wsRatio = sMm > 0 ? W / sMm : Infinity

  const VW = 900, VH = 420
  const LEFT = 80, RIGHT = 40, TOP = 70, BOTTOM = 80
  const INNER_W = VW - LEFT - RIGHT
  const INNER_H = VH - TOP - BOTTOM

  let asp = W > 0 ? L / W : 4.0
  asp = Math.max(0.25, Math.min(asp, 4.0))

  let rectW = INNER_W
  let rectH = rectW / asp
  if (rectH > INNER_H) {
    rectH = INNER_H
    rectW = rectH * asp
  }
  rectW = Math.max(rectW, 200.0)
  rectH = Math.max(rectH, 120.0)
  rectW = Math.min(rectW, INNER_W)
  rectH = Math.min(rectH, INNER_H)

  const rectX = LEFT + (INNER_W - rectW) / 2.0
  const rectY = TOP + (INNER_H - rectH) / 2.0

  const cy = rectY + rectH * 0.5
  const marginX = rectW * 0.12
  const xStart = rectX + marginX
  const xEnd = rectX + rectW - marginX
  const xs = [0, 1 / 3, 2 / 3, 1].map((t) => xStart + (xEnd - xStart) * t)

  const sX1 = xs[0], sX2 = xs[1]
  const sY = rectY + rectH * 0.72
  const lY = rectY + rectH - 18.0
  const wX = rectX + 18.0

  return `
<svg viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <style>
    .rect { fill: #4c9aff1a; stroke: #2a3140; stroke-width: 2; }
    .probe { fill: #4c9aff; }
    .axis { stroke: #9aa4b2; stroke-width: 2; marker-end: url(#fpp-arrow); }
    .axisthin { stroke: #9aa4b2; stroke-width: 1.5; marker-end: url(#fpp-arrow); marker-start: url(#fpp-arrow-start); }
    .label { fill: #e6e9ef; font-size: 15px; font-family: ui-sans-serif, system-ui, sans-serif; }
    .labelbig { fill: #e6e9ef; font-size: 18px; font-weight: 700; font-family: ui-sans-serif, system-ui, sans-serif; }
  </style>
  <defs>
    <marker id="fpp-arrow" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6" fill="#9aa4b2" />
    </marker>
    <marker id="fpp-arrow-start" markerWidth="10" markerHeight="10" refX="0" refY="3" orient="auto">
      <path d="M6,0 L0,3 L6,6" fill="#9aa4b2" />
    </marker>
  </defs>
  <text x="${VW / 2}" y="28" text-anchor="middle" class="labelbig">Rectangular sample (diagram not to scale)</text>
  <text x="${VW / 2}" y="50" text-anchor="middle" class="label">l/w = ${fmtG(lwRatio, 4)},  w/s = ${fmtG(wsRatio, 4)}</text>
  <rect x="${rectX.toFixed(1)}" y="${rectY.toFixed(1)}" width="${rectW.toFixed(1)}" height="${rectH.toFixed(1)}" class="rect" />
  ${xs.map((x) => `<circle cx="${x.toFixed(1)}" cy="${cy.toFixed(1)}" r="6" class="probe" />`).join('')}
  <line x1="${sX1.toFixed(1)}" y1="${sY.toFixed(1)}" x2="${sX2.toFixed(1)}" y2="${sY.toFixed(1)}" class="axisthin" />
  <text x="${((sX1 + sX2) / 2).toFixed(1)}" y="${(sY - 8).toFixed(1)}" text-anchor="middle" class="label">s = ${fmtG(sMm, 4)} mm</text>
  <line x1="${(rectX + 10).toFixed(1)}" y1="${lY.toFixed(1)}" x2="${(rectX + rectW - 10).toFixed(1)}" y2="${lY.toFixed(1)}" class="axis" />
  <text x="${(rectX + rectW / 2).toFixed(1)}" y="${(lY - 8).toFixed(1)}" text-anchor="middle" class="label">l = ${fmtG(L, 4)} mm</text>
  <line x1="${wX.toFixed(1)}" y1="${(rectY + rectH - 10).toFixed(1)}" x2="${wX.toFixed(1)}" y2="${(rectY + 10).toFixed(1)}" class="axis" />
  <text x="${(wX - 6).toFixed(1)}" y="${(rectY + rectH / 2).toFixed(1)}" text-anchor="end" class="label">w = ${fmtG(W, 4)} mm</text>
</svg>`
}

// ------------------------------------------------------------------
// XLSX export (ported from build_xlsx)
// ------------------------------------------------------------------
function buildXlsx(perFileRows, calcsRows, meanRsStar, stdRsStar, geom, usedLW, usedWS, C) {
  const wb = XLSX.utils.book_new()

  const summary = XLSX.utils.aoa_to_sheet([
    ['Metric', 'Value'],
    ['Mean Rs* [Ω/□]', meanRsStar],
    ['Std Rs* [Ω/□]', stdRsStar],
    ['K (geom. const.)', K],
    ['Rect. l [mm]', geom.l],
    ['Rect. w [mm]', geom.w],
    ['Probe s [mm]', geom.s],
    ['Used table l/w', usedLW],
    ['Used table w/s', usedWS],
    ['Correction C', C],
    ['Timestamp', new Date().toISOString()],
  ])
  XLSX.utils.book_append_sheet(wb, summary, 'Summary')

  const perFileSheet = XLSX.utils.json_to_sheet(perFileRows)
  XLSX.utils.book_append_sheet(wb, perFileSheet, 'Per-file Results')

  const calcsSheet = XLSX.utils.json_to_sheet(calcsRows)
  XLSX.utils.book_append_sheet(wb, calcsSheet, 'Calcs per File')

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// ------------------------------------------------------------------
// State + UI wiring
// ------------------------------------------------------------------
const state = { files: [], lastResults: null, lastErrors: null }

const dropzone = document.getElementById('fpp-dropzone')
const fileInput = document.getElementById('fpp-file-input')
const fileListEl = document.getElementById('fpp-file-list')
const analyzeBtn = document.getElementById('fpp-analyze')
const showDetailEl = document.getElementById('fpp-show-detail')
const lEl = document.getElementById('fpp-l')
const wEl = document.getElementById('fpp-w')
const sEl = document.getElementById('fpp-s')
const applyGeomEl = document.getElementById('fpp-apply-geom')
const svgWrap = document.getElementById('fpp-geometry-svg')
const resultsEl = document.getElementById('fpp-results')

function renderFileList() {
  fileListEl.innerHTML = state.files.map((f) => `<li>📄 ${escapeHtml(f.name)}</li>`).join('')
}

function renderGeometryPreview() {
  const l = parseFloat(lEl.value) || 0
  const w = parseFloat(wEl.value) || 0
  const s = parseFloat(sEl.value) || 0.0001
  svgWrap.innerHTML = renderGeometrySvg(l, w, s)
}

initDropzone(dropzone, fileInput, (files) => {
  state.files = Array.from(files)
  renderFileList()
})
;[lEl, wEl, sEl].forEach((el) => el.addEventListener('input', renderGeometryPreview))
renderGeometryPreview()

analyzeBtn.addEventListener('click', async () => {
  if (state.files.length === 0) return
  const results = []
  const errors = []

  for (const file of state.files) {
    try {
      const { V, I } = await readAny(file)
      const det = fitIVReturnDetails(V, I)
      results.push({ File: file.name, ...det })
    } catch (e) {
      errors.push(`${file.name}: ${e.message}`)
    }
  }

  state.lastResults = results
  state.lastErrors = errors
  renderResults(results, errors)
})

// Re-render from cached fit results (no re-parsing) when the correction /
// detail toggles change after an Analyze run, so the view updates live.
;[applyGeomEl, showDetailEl].forEach((el) =>
  el.addEventListener('change', () => {
    if (state.lastResults) renderResults(state.lastResults, state.lastErrors)
  })
)

function renderResults(results, errors) {
  const geom = {
    l: parseFloat(lEl.value) || 0,
    w: parseFloat(wEl.value) || 0,
    s: parseFloat(sEl.value) || 0.0001,
    applyGeom: applyGeomEl.checked,
  }
  const showDetail = showDetailEl.checked

  let html = ''
  if (errors.length > 0) {
    html += `<div class="alert alert-warning">Some files were skipped:<br>${errors.map((e) => `- ${escapeHtml(e)}`).join('<br>')}</div>`
  }

  if (results.length === 0) {
    resultsEl.innerHTML = html + `<div class="panel"><p class="empty-state">No files could be analyzed.</p></div>`
    return
  }

  let correction
  try {
    correction = rectangularCorrectionFactor(geom.l, geom.w, geom.s)
  } catch (e) {
    resultsEl.innerHTML = html + `<div class="panel"><div class="alert alert-danger">${e.message}</div></div>`
    return
  }
  const { C, usedLW, usedWS, trueLW, trueWS } = correction
  const correctionUsed = geom.applyGeom ? C : 1.0

  const perFileRows = results.map((r) => ({
    File: r.File,
    'a (dI/dV)': r.a,
    b: r.b,
    'R [Ω]': r.R,
    'Rs [Ω/□]': r.Rs,
    'Correction C': correctionUsed,
    'Rs* [Ω/□]': r.Rs * correctionUsed,
    'N points': r.N,
  }))

  const calcsRows = []
  for (const r of results) {
    const quantities = [
      ['N', r.N], ['ΣV', r.SV], ['ΣI', r.SI], ['ΣV²', r.SV2], ['Σ(VI)', r.SVI],
      ['denom', r.denom], ['a (dI/dV)', r.a], ['b', r.b], ['R [Ω]', r.R], ['Rs [Ω/□]', r.Rs],
    ]
    for (const [Quantity, Value] of quantities) calcsRows.push({ File: r.File, Quantity, Value })
  }

  const rsStarVals = perFileRows.map((r) => r['Rs* [Ω/□]'])
  const meanRsStar = mean(rsStarVals)
  const stdRsStar = stdSample(rsStarVals)

  html += `
    <div class="panel">
      <h2>Per-file summary</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>File</th><th>a (dI/dV)</th><th>b</th><th>R [Ω]</th><th>Rs [Ω/□]</th><th>Correction C</th><th>Rs* [Ω/□]</th><th>N points</th></tr></thead>
          <tbody>
            ${perFileRows
              .map(
                (r) => `<tr>
                  <td>${escapeHtml(r.File)}</td><td>${fmtG(r['a (dI/dV)'], 8)}</td><td>${fmtG(r.b, 8)}</td>
                  <td>${fmtG(r['R [Ω]'], 8)}</td><td>${fmtG(r['Rs [Ω/□]'], 8)}</td>
                  <td>${fmtG(r['Correction C'], 6)}</td><td>${fmtG(r['Rs* [Ω/□]'], 8)}</td><td>${r['N points']}</td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>

      <details class="panel" style="margin-top:1rem;">
        <summary>Geometry correction details</summary>
        <p>Rectangular correction (Ossila table; centered, probes ∥ long edge).</p>
        <p>Entered: l/w = <strong>${fmtG(trueLW, 4)}</strong>, w/s = <strong>${fmtG(trueWS, 4)}</strong></p>
        <p>Used table cell (nearest): l/w = <strong>${usedLW}</strong>, w/s = <strong>${usedWS}</strong> → <strong>C = ${fmtG(C, 6)}</strong></p>
        <p>Corrected sheet resistance per file: <code>Rs* = C · Rs</code> (or Rs if unchecked).</p>
      </details>

      <div class="fpp-banner">
        <div class="fpp-banner__title">${geom.applyGeom ? 'Final result (geometry-corrected): Rs* (mean ± SD)' : 'Final result: Rs (mean ± SD)'}</div>
        <div class="fpp-banner__value">${fmtG(meanRsStar, 6)} ± ${fmtG(stdRsStar, 6)} Ω/□</div>
      </div>

      ${
        showDetail
          ? `<h2>Detailed calculations</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>File</th><th>Quantity</th><th>Value</th></tr></thead>
            <tbody>${calcsRows.map((r) => `<tr><td>${escapeHtml(r.File)}</td><td>${escapeHtml(r.Quantity)}</td><td>${fmtG(r.Value, 8)}</td></tr>`).join('')}</tbody>
          </table>
        </div>`
          : ''
      }

      <button class="btn" id="fpp-download-xlsx" style="margin-top:1rem;">Download summary (XLSX)</button>
    </div>
  `

  resultsEl.innerHTML = html

  document.getElementById('fpp-download-xlsx').addEventListener('click', () => {
    const blob = buildXlsx(perFileRows, calcsRows, meanRsStar, stdRsStar, geom, usedLW, usedWS, correctionUsed)
    downloadBlob(blob, `four_point_probe_summary_${timestampSlug()}.xlsx`)
  })
}

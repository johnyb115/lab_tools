import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { downloadCSV, toCSV } from '../shared/download.js'
import { renderPlot, colorForIndex } from '../shared/plotlySetup.js'

initChrome('plot-digitizer')

// ------------------------------------------------------------------
// DOM refs
// ------------------------------------------------------------------
const canvas = document.getElementById('pd-canvas')
const ctx = canvas.getContext('2d')
const canvasWrap = document.getElementById('pd-canvas-wrap')
const emptyCanvas = document.getElementById('pd-empty-canvas')
const fileChip = document.getElementById('pd-file-chip')
const hintList = document.getElementById('pd-hint-list')

const calibBadges = document.getElementById('pd-calib-badges')
const calibXBtn = document.getElementById('pd-calib-x-btn')
const calibYBtn = document.getElementById('pd-calib-y-btn')
const calibAlert = document.getElementById('pd-calib-alert')
const calibXInputs = document.getElementById('pd-calib-x-inputs')
const calibYInputs = document.getElementById('pd-calib-y-inputs')
const resetCalibBtn = document.getElementById('pd-reset-calib')

const seriesGate = document.getElementById('pd-series-gate')
const seriesListEl = document.getElementById('pd-series-list')
const seriesEmptyEl = document.getElementById('pd-series-empty')
const addSeriesBtn = document.getElementById('pd-add-series')

const resultsEl = document.getElementById('pd-results')
const xLabelInput = document.getElementById('pd-xlabel')
const yLabelInput = document.getElementById('pd-ylabel')
const downloadBtn = document.getElementById('pd-download')

canvasWrap.style.display = 'none'

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------
const MAX_CANVAS_WIDTH = 1000

let img = null // loaded <img> (kept only for reference/dimensions)
let baseImageData = null // pristine ImageData sampled once from the (possibly downscaled) canvas —
// all calibration + color sampling + extraction happens in this same coordinate space, so no
// separate full-resolution buffer or coordinate translation is needed.

// currentMode drives the single centralized canvas click handler:
//   'idle' | 'calibrate-x' | 'calibrate-y' | 'pick-color:<seriesId>'
let currentMode = 'idle'
let pendingCalibClicks = [] // pixel {x,y} points collected for the axis currently being calibrated
let calibAwaitingValues = null // 'x' | 'y' | null — true once 2 clicks are in but not yet confirmed

let xCalib = null // { px1, val1, px2, val2, point1:{x,y}, point2:{x,y} }
let yCalib = null

let series = [] // { id, name, hsv:{h,s,v}|null, swatchColor:string|null, tolerance, maskEnabled, points:[{x,y}] }
let nextSeriesId = 1

// ------------------------------------------------------------------
// Upload
// ------------------------------------------------------------------
initDropzone(document.getElementById('pd-dropzone'), document.getElementById('pd-file-input'), (files) => {
  const file = files[0]
  if (!file || !file.type.startsWith('image/')) return
  loadImageFile(file)
})

function loadImageFile(file) {
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.onload = () => {
    img = image
    const scale = Math.min(1, MAX_CANVAS_WIDTH / image.naturalWidth)
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    baseImageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

    // Reset all downstream state — a new image invalidates any prior calibration/series.
    currentMode = 'idle'
    pendingCalibClicks = []
    calibAwaitingValues = null
    xCalib = null
    yCalib = null
    series = []
    calibXInputs.innerHTML = ''
    calibYInputs.innerHTML = ''

    calibXBtn.disabled = false
    calibYBtn.disabled = false

    emptyCanvas.style.display = 'none'
    canvasWrap.style.display = 'block'
    fileChip.innerHTML = `<li><span>📄 ${escapeAttr(file.name)}</span><span>${canvas.width}×${canvas.height}px</span></li>`

    updateCanvasModeClass()
    renderCalibBadges()
    updateCalibAlert()
    updateSeriesGate()
    renderSeriesList()
    renderResults()
    redraw()
    URL.revokeObjectURL(url)
  }
  image.src = url
}

// ------------------------------------------------------------------
// Canvas interaction — single centralized click handler
// ------------------------------------------------------------------
canvas.addEventListener('click', (evt) => {
  if (!img) return
  const { x, y } = clientToPixel(evt)

  if (currentMode === 'calibrate-x' || currentMode === 'calibrate-y') {
    handleCalibClick(x, y)
  } else if (currentMode.startsWith('pick-color:')) {
    const seriesId = Number(currentMode.slice('pick-color:'.length))
    handleColorPick(seriesId, x, y)
  }
})

function clientToPixel(evt) {
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  const x = clamp(Math.round((evt.clientX - rect.left) * scaleX), 0, canvas.width - 1)
  const y = clamp(Math.round((evt.clientY - rect.top) * scaleY), 0, canvas.height - 1)
  return { x, y }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

function updateCanvasModeClass() {
  canvas.classList.toggle('mode-active', currentMode !== 'idle')
  canvas.classList.toggle('mode-idle', currentMode === 'idle')
}

// ------------------------------------------------------------------
// Step 2 — Axis calibration
// ------------------------------------------------------------------
calibXBtn.addEventListener('click', () => startCalibration('x'))
calibYBtn.addEventListener('click', () => startCalibration('y'))

function startCalibration(axis) {
  currentMode = axis === 'x' ? 'calibrate-x' : 'calibrate-y'
  pendingCalibClicks = []
  calibAwaitingValues = null
  const container = axis === 'x' ? calibXInputs : calibYInputs
  container.innerHTML = ''
  updateCanvasModeClass()
  updateCalibAlert()
  redraw()
}

function handleCalibClick(x, y) {
  pendingCalibClicks.push({ x, y })
  if (pendingCalibClicks.length === 2) {
    const axis = currentMode === 'calibrate-x' ? 'x' : 'y'
    calibAwaitingValues = axis
    renderCalibValueForm(axis, pendingCalibClicks)
    currentMode = 'idle'
    updateCanvasModeClass()
  }
  updateCalibAlert()
  redraw()
}

function renderCalibValueForm(axis, points) {
  const container = axis === 'x' ? calibXInputs : calibYInputs
  const label = axis === 'x' ? 'X' : 'Y'
  container.innerHTML = ''

  const wrap = document.createElement('div')
  wrap.className = 'pd-calib-inputs'
  wrap.innerHTML = `
    <div class="field-row">
      <div class="field">
        <label>${label} value at point 1</label>
        <input type="number" step="any" class="pd-calib-val1" />
      </div>
      <div class="field">
        <label>${label} value at point 2</label>
        <input type="number" step="any" class="pd-calib-val2" />
      </div>
    </div>
    <button class="btn btn-primary" type="button">Confirm ${label} calibration</button>
  `
  const val1Input = wrap.querySelector('.pd-calib-val1')
  const val2Input = wrap.querySelector('.pd-calib-val2')
  const confirmBtn = wrap.querySelector('button')

  confirmBtn.addEventListener('click', () => {
    if (val1Input.value === '' || val2Input.value === '') {
      calibAlert.className = 'alert alert-warning'
      calibAlert.textContent = `Enter both ${label} values to confirm calibration.`
      return
    }
    const v1 = Number(val1Input.value)
    const v2 = Number(val2Input.value)
    if (Number.isNaN(v1) || Number.isNaN(v2)) {
      calibAlert.className = 'alert alert-warning'
      calibAlert.textContent = `${label} values must be numbers.`
      return
    }
    const px1 = axis === 'x' ? points[0].x : points[0].y
    const px2 = axis === 'x' ? points[1].x : points[1].y
    if (px1 === px2) {
      calibAlert.className = 'alert alert-danger'
      calibAlert.textContent = `The two ${label} points landed on the same pixel position — reset and click points further apart.`
      return
    }

    const calib = { px1, val1: v1, px2, val2: v2, point1: points[0], point2: points[1] }
    if (axis === 'x') xCalib = calib
    else yCalib = calib

    calibAwaitingValues = null
    container.innerHTML = ''
    // Existing extracted points were computed against the old mapping — invalidate them.
    series.forEach((s) => { s.points = [] })

    renderCalibBadges()
    updateCalibAlert()
    updateSeriesGate()
    renderSeriesList()
    renderResults()
    redraw()
  })

  container.appendChild(wrap)
}

function renderCalibBadges() {
  const parts = []
  if (xCalib) parts.push(`<span class="badge">X: px ${xCalib.px1}→${xCalib.val1}, px ${xCalib.px2}→${xCalib.val2}</span>`)
  if (yCalib) parts.push(`<span class="badge">Y: px ${yCalib.px1}→${yCalib.val1}, px ${yCalib.px2}→${yCalib.val2}</span>`)
  calibBadges.innerHTML = parts.join(' &middot; ')
}

function updateCalibAlert() {
  if (!img) {
    calibAlert.className = 'alert alert-info'
    calibAlert.textContent = 'Upload an image to begin.'
  } else if (currentMode === 'calibrate-x' || currentMode === 'calibrate-y') {
    const axis = currentMode === 'calibrate-x' ? 'X' : 'Y'
    const ordinal = pendingCalibClicks.length === 0 ? 'first' : 'second'
    calibAlert.className = 'alert alert-info'
    calibAlert.textContent = `Click the ${ordinal} point on the ${axis} axis on the image.`
  } else if (calibAwaitingValues) {
    calibAlert.className = 'alert alert-warning'
    calibAlert.textContent = `Enter the real-world value for each ${calibAwaitingValues.toUpperCase()} calibration point below, then confirm.`
  } else if (!xCalib && !yCalib) {
    calibAlert.className = 'alert alert-info'
    calibAlert.textContent = 'Click "Calibrate X axis", then "Calibrate Y axis".'
  } else if (!xCalib) {
    calibAlert.className = 'alert alert-info'
    calibAlert.textContent = 'Now calibrate the X axis.'
  } else if (!yCalib) {
    calibAlert.className = 'alert alert-info'
    calibAlert.textContent = 'Now calibrate the Y axis.'
  } else {
    calibAlert.className = 'alert alert-success'
    calibAlert.textContent = 'Both axes calibrated — add a curve series to continue.'
  }
  renderHintList()
}

resetCalibBtn.addEventListener('click', () => {
  currentMode = 'idle'
  pendingCalibClicks = []
  calibAwaitingValues = null
  xCalib = null
  yCalib = null
  calibXInputs.innerHTML = ''
  calibYInputs.innerHTML = ''
  series.forEach((s) => { s.points = [] })

  updateCanvasModeClass()
  renderCalibBadges()
  updateCalibAlert()
  updateSeriesGate()
  renderSeriesList()
  renderResults()
  redraw()
})

function isCalibrated() {
  return !!(xCalib && yCalib)
}

// real = val1 + (pixel - px1) * (val2 - val1) / (px2 - px1)
function pixelToReal(axis, pixelValue) {
  const c = axis === 'x' ? xCalib : yCalib
  if (!c) return NaN
  return c.val1 + ((pixelValue - c.px1) * (c.val2 - c.val1)) / (c.px2 - c.px1)
}

// ------------------------------------------------------------------
// Step 3 — Curve series (color pick, tolerance, mask preview)
// ------------------------------------------------------------------
function updateSeriesGate() {
  const ready = isCalibrated()
  addSeriesBtn.disabled = !ready
  seriesGate.style.display = ready ? 'none' : 'block'
}

addSeriesBtn.addEventListener('click', () => {
  series.push({
    id: nextSeriesId++,
    name: `Series ${series.length + 1}`,
    hsv: null,
    swatchColor: null,
    tolerance: 12,
    maskEnabled: false,
    points: [],
  })
  renderSeriesList()
})

function renderSeriesList() {
  seriesListEl.innerHTML = ''
  seriesEmptyEl.style.display = series.length ? 'none' : 'block'

  series.forEach((s, idx) => {
    const isPicking = currentMode === `pick-color:${s.id}`
    const card = document.createElement('div')
    card.className = 'pd-series-card'
    card.innerHTML = `
      <div class="pd-series-card__head">
        <input type="text" value="${escapeAttr(s.name)}" />
        <button class="btn btn-danger" type="button" title="Remove series">✕</button>
      </div>
      <div class="pd-series-row2">
        <span class="pd-series-swatch" style="background:${s.swatchColor || 'transparent'}${s.swatchColor ? '' : ';border-style:dashed'}"></span>
        <button class="btn" type="button">${isPicking ? '🖱️ Click on the curve…' : s.swatchColor ? '🎯 Re-pick color' : '🎯 Pick color from image'}</button>
      </div>
      <div class="pd-series-row2">
        <label style="font-size:0.78rem;color:var(--text-dim);width:5.2rem;">Tolerance</label>
        <input type="range" min="0" max="100" value="${s.tolerance}" />
        <span>${s.tolerance}</span>
      </div>
      <label class="checkbox-row">
        <input type="checkbox" ${s.maskEnabled ? 'checked' : ''} ${s.hsv ? '' : 'disabled'} />
        Show mask preview
      </label>
      <div class="pd-series-footer">
        <button class="btn btn-primary" type="button" ${s.hsv ? '' : 'disabled'}>Extract</button>
        <span class="badge">${s.points.length ? `Extracted ${s.points.length} pts` : 'Not extracted'}</span>
      </div>
    `
    const rows = card.querySelectorAll('.pd-series-row2')
    const [nameInput, removeBtn] = card.querySelector('.pd-series-card__head').children
    const pickBtn = rows[0].querySelector('button')
    const rangeInput = rows[1].querySelector('input')
    const rangeReadout = rows[1].querySelector('span')
    const maskCheckbox = card.querySelector('.checkbox-row input')
    const extractBtn = card.querySelector('.pd-series-footer button')

    nameInput.addEventListener('input', () => {
      s.name = nameInput.value || `Series ${idx + 1}`
      renderResults()
    })
    removeBtn.addEventListener('click', () => {
      if (currentMode === `pick-color:${s.id}`) {
        currentMode = 'idle'
        updateCanvasModeClass()
      }
      series = series.filter((x) => x.id !== s.id)
      renderSeriesList()
      renderResults()
      redraw()
    })
    pickBtn.addEventListener('click', () => {
      currentMode = isPicking ? 'idle' : `pick-color:${s.id}`
      updateCanvasModeClass()
      renderSeriesList()
    })
    rangeInput.addEventListener('input', () => {
      s.tolerance = Number(rangeInput.value)
      rangeReadout.textContent = String(s.tolerance)
      if (s.maskEnabled) redraw()
    })
    maskCheckbox.addEventListener('change', () => {
      s.maskEnabled = maskCheckbox.checked
      redraw()
    })
    extractBtn.addEventListener('click', () => {
      s.points = extractSeriesPoints(s)
      renderSeriesList()
      renderResults()
    })

    seriesListEl.appendChild(card)
  })

  renderHintList()
}

function handleColorPick(seriesId, x, y) {
  const s = series.find((se) => se.id === seriesId)
  if (!s || !baseImageData) return
  const i = (y * baseImageData.width + x) * 4
  const d = baseImageData.data
  const r = d[i]
  const g = d[i + 1]
  const b = d[i + 2]
  s.hsv = rgbToHsv(r, g, b)
  s.swatchColor = rgbToHex(r, g, b)

  currentMode = 'idle'
  updateCanvasModeClass()
  renderSeriesList()
  redraw()
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ------------------------------------------------------------------
// Color math — RGB <-> HSV, no external CV library needed
// ------------------------------------------------------------------
function rgbToHsv(r, g, b) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min

  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : (d / max) * 100
  const v = max * 100
  return { h, s, v }
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

// Circular hue distance (hue wraps at 360deg).
function hueDist(h1, h2) {
  const d = Math.abs(h1 - h2) % 360
  return d > 180 ? 360 - d : d
}

// tolerance is a single 0-100 slider value: H tolerance is the tightest (used directly as
// degrees), S/V are ~4x looser (mirrors the ratios used by the previous per-run Python/OpenCV
// scripts), clamped to sane ranges.
function matchesSeries(hsv, target, tolerance) {
  const hTol = clamp(tolerance, 0, 180)
  const sTol = clamp(tolerance * 4, 0, 100)
  const vTol = clamp(tolerance * 4, 0, 100)
  return hueDist(hsv.h, target.h) <= hTol && Math.abs(hsv.s - target.s) <= sTol && Math.abs(hsv.v - target.v) <= vTol
}

// ------------------------------------------------------------------
// Step 4 — Extraction: one point per pixel column, median row of matches
// ------------------------------------------------------------------

// Detects the plot frame rectangle.  Left & bottom come from axis positions
// (Y-calib x avg → y-axis column, X-calib y avg → x-axis row).  Right & top
// are found by scanning outward from the plot centre and looking for a line of
// axis-coloured pixels with strong perpendicular continuity — this distinguishes
// frame lines from thin data traces AND avoids dark image backgrounds.
function makeDataAreaFilter() {
  if (!xCalib || !yCalib || !baseImageData) return null
  const margin = 5
  const { width, height, data } = baseImageData

  const yAxisX = Math.round((yCalib.point1.x + yCalib.point2.x) / 2)
  const xAxisY = Math.round((xCalib.point1.y + xCalib.point2.y) / 2)

  const sIdx = (xCalib.point1.y * width + xCalib.point1.x) * 4
  const axR = data[sIdx], axG = data[sIdx + 1], axB = data[sIdx + 2]
  const isAxis = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false
    const i = (y * width + x) * 4
    return Math.abs(data[i] - axR) < 40 &&
      Math.abs(data[i + 1] - axG) < 40 &&
      Math.abs(data[i + 2] - axB) < 40
  }

  const midX = Math.round((yAxisX + Math.max(xCalib.point1.x, xCalib.point2.x)) / 2)
  const midY = Math.round((Math.min(yCalib.point1.y, yCalib.point2.y) + xAxisY) / 2)
  const halfProbe = 50

  let rightFrame = width
  for (let x = midX; x < width; x++) {
    if (isAxis(x, midY)) {
      let vCount = 0
      for (let dy = -halfProbe; dy <= halfProbe; dy++) {
        if (isAxis(x, midY + dy)) vCount++
      }
      if (vCount > halfProbe * 2 * 0.8) { rightFrame = x; break }
    }
  }

  let topFrame = 0
  for (let y = midY; y >= 0; y--) {
    if (isAxis(midX, y)) {
      let hCount = 0
      for (let dx = -halfProbe; dx <= halfProbe; dx++) {
        if (isAxis(midX + dx, y)) hCount++
      }
      if (hCount > halfProbe * 2 * 0.8) { topFrame = y; break }
    }
  }

  return (px, py) =>
    px > yAxisX + margin &&
    px < rightFrame - margin &&
    py > topFrame + margin &&
    py < xAxisY - margin
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function extractSeriesPoints(s) {
  if (!s.hsv || !baseImageData || !isCalibrated()) return []
  const { width, height, data } = baseImageData
  const inDataArea = makeDataAreaFilter()
  const columns = Array.from({ length: width }, () => [])

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * 4
    for (let x = 0; x < width; x++) {
      if (inDataArea && !inDataArea(x, y)) continue
      const i = rowOffset + x * 4
      const hsv = rgbToHsv(data[i], data[i + 1], data[i + 2])
      if (matchesSeries(hsv, s.hsv, s.tolerance)) columns[x].push(y)
    }
  }

  const points = []
  for (let x = 0; x < width; x++) {
    if (columns[x].length === 0) continue
    const repY = median(columns[x])
    points.push({ x: pixelToReal('x', x), y: pixelToReal('y', repY) })
  }
  points.sort((a, b) => a.x - b.x)
  return points
}

// ------------------------------------------------------------------
// Canvas rendering: always redraw from the pristine base image, then layer
// mask overlays + calibration markers on top — never mutate the base pixels.
// ------------------------------------------------------------------
function redraw() {
  if (!baseImageData) return
  const maskSeries = series.filter((s) => s.maskEnabled && s.hsv)
  const toDraw = maskSeries.length ? applyMaskOverlay(baseImageData, maskSeries) : baseImageData
  ctx.putImageData(toDraw, 0, 0)
  drawCalibMarkers()
}

function applyMaskOverlay(source, maskSeries) {
  const clone = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height)
  const out = clone.data
  const HIGHLIGHT = [255, 0, 220] // bright magenta — contrasts with typical plot colors
  const alpha = 0.55
  const inDataArea = makeDataAreaFilter()

  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      if (inDataArea && !inDataArea(x, y)) continue
      const i = (y * source.width + x) * 4
      const hsv = rgbToHsv(source.data[i], source.data[i + 1], source.data[i + 2])
      for (const s of maskSeries) {
        if (matchesSeries(hsv, s.hsv, s.tolerance)) {
          out[i] = Math.round(HIGHLIGHT[0] * alpha + out[i] * (1 - alpha))
          out[i + 1] = Math.round(HIGHLIGHT[1] * alpha + out[i + 1] * (1 - alpha))
          out[i + 2] = Math.round(HIGHLIGHT[2] * alpha + out[i + 2] * (1 - alpha))
          break
        }
      }
    }
  }
  return clone
}

function drawCalibMarkers() {
  const drawPoint = (pt, colorHex, label) => {
    ctx.beginPath()
    ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2)
    ctx.fillStyle = colorHex
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
    ctx.font = 'bold 13px sans-serif'
    ctx.lineWidth = 3
    ctx.strokeStyle = '#000000'
    ctx.strokeText(label, pt.x + 8, pt.y - 8)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, pt.x + 8, pt.y - 8)
  }

  if (xCalib) {
    drawPoint(xCalib.point1, '#4c9aff', 'X1')
    drawPoint(xCalib.point2, '#4c9aff', 'X2')
  } else if (currentMode === 'calibrate-x' || calibAwaitingValues === 'x') {
    pendingCalibClicks.forEach((pt, i) => drawPoint(pt, '#4c9aff', `X${i + 1}`))
  }

  if (yCalib) {
    drawPoint(yCalib.point1, '#f2994a', 'Y1')
    drawPoint(yCalib.point2, '#f2994a', 'Y2')
  } else if (currentMode === 'calibrate-y' || calibAwaitingValues === 'y') {
    pendingCalibClicks.forEach((pt, i) => drawPoint(pt, '#f2994a', `Y${i + 1}`))
  }
}

// ------------------------------------------------------------------
// Step 5 — Results: Plotly chart + combined CSV export
// ------------------------------------------------------------------
function renderResults() {
  const activeSeries = series.filter((s) => s.points.length > 0)
  if (activeSeries.length === 0) {
    resultsEl.style.display = 'none'
    return
  }
  resultsEl.style.display = 'block'

  const traces = activeSeries.map((s) => {
    const color = colorForIndex(series.indexOf(s))
    return {
      x: s.points.map((p) => p.x),
      y: s.points.map((p) => p.y),
      mode: 'lines+markers',
      name: s.name,
      line: { color },
      marker: { color, size: 5 },
    }
  })

  renderPlot(
    'digitizer-plot',
    traces,
    {
      xaxis: { title: xLabelInput.value || 'X' },
      yaxis: { title: yLabelInput.value || 'Y' },
    },
    'plot-digitizer'
  )
}

xLabelInput.addEventListener('input', renderResults)
yLabelInput.addEventListener('input', renderResults)

downloadBtn.addEventListener('click', () => {
  const activeSeries = series.filter((s) => s.points.length > 0)
  if (activeSeries.length === 0) return

  const headers = activeSeries.flatMap((s) => [`${s.name}_x`, `${s.name}_y`])
  const maxLen = Math.max(...activeSeries.map((s) => s.points.length))
  const rows = []
  for (let i = 0; i < maxLen; i++) {
    const row = []
    for (const s of activeSeries) {
      row.push(i < s.points.length ? s.points[i].x : '')
      row.push(i < s.points.length ? s.points[i].y : '')
    }
    rows.push(row)
  }
  downloadCSV(toCSV(headers, rows), 'plot_digitizer.csv')
})

// ------------------------------------------------------------------
// Persistent numbered hint list (highlights the current next step)
// ------------------------------------------------------------------
const HINT_STEPS = [
  'Upload an image.',
  'Calibrate X axis.',
  'Calibrate Y axis.',
  'Add a curve series and pick its color.',
  'Extract.',
  'Download CSV.',
]

function computeStepIndex() {
  if (!img) return 1
  if (!xCalib) return 2
  if (!yCalib) return 3
  if (!series.some((s) => s.hsv)) return 4
  if (!series.some((s) => s.points.length > 0)) return 5
  return 6
}

function renderHintList() {
  const current = computeStepIndex()
  hintList.innerHTML = HINT_STEPS.map((text, i) => {
    const n = i + 1
    const cls = n === current ? 'is-current' : n < current ? 'is-done' : ''
    return `<li class="${cls}">${text}</li>`
  }).join('')
}

// ------------------------------------------------------------------
// Initial render
// ------------------------------------------------------------------
updateSeriesGate()
updateCalibAlert()
renderSeriesList()

import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { downloadBlob } from '../shared/download.js'
import { escapeAttr } from '../shared/dom.js'

initChrome('scale-bar')

// ------------------------------------------------------------------
// DOM refs
// ------------------------------------------------------------------
const dropzone = document.getElementById('sb-dropzone')
const fileInput = document.getElementById('sb-file-input')
const fileChip = document.getElementById('sb-file-chip')

const calibBadges = document.getElementById('sb-calib-badges')
const calibrateBtn = document.getElementById('sb-calibrate-btn')
const resetCalibBtn = document.getElementById('sb-reset-calib-btn')
const calibAlert = document.getElementById('sb-calib-alert')
const distanceForm = document.getElementById('sb-distance-form')

const stylePanel = document.getElementById('sb-style-panel')
const barLengthInput = document.getElementById('sb-bar-length')
const barUnitReadout = document.getElementById('sb-bar-unit-readout')
const suggestLengthBtn = document.getElementById('sb-suggest-length-btn')
const cornerButtons = document.querySelectorAll('#sb-style-panel .sb-corner-grid button')
const colorInput = document.getElementById('sb-bar-color')
const thicknessInput = document.getElementById('sb-bar-thickness')
const thicknessValue = document.getElementById('sb-bar-thickness-value')
const showLabelCheckbox = document.getElementById('sb-show-label')

const canvas = document.getElementById('sb-canvas')
const ctx = canvas.getContext('2d')
const canvasWrap = document.getElementById('sb-canvas-wrap')
const emptyCanvas = document.getElementById('sb-empty-canvas')

const outputWrap = document.getElementById('sb-output-wrap')
const outputCanvas = document.getElementById('sb-output-canvas')
const outCtx = outputCanvas.getContext('2d')
const downloadBtn = document.getElementById('sb-download-btn')

canvasWrap.style.display = 'none'

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------
const MAX_CANVAS_WIDTH = 1000

let img = null // loaded <img>, kept for naturalWidth/naturalHeight + full-res redraws
let scale = 1 // display-canvas downscale factor relative to img.naturalWidth
let baseImageData = null // pristine ImageData of the (possibly downscaled) display canvas

// currentMode drives the single centralized canvas click handler: 'idle' | 'calibrating'
let currentMode = 'idle'
let pendingClicks = [] // display-canvas pixel {x,y} points collected while calibrating
let awaitingConfirm = null // { point1, point2 } once 2 clicks are in but distance not yet confirmed

let calib = null // { point1, point2, knownDistance, unit, originalPixelDist, unitsPerOriginalPixel }
let currentFileName = ''

const barConfig = { lengthUnits: 0, corner: 'bottom-right', color: '#ffffff', thicknessPx: 10, showLabel: true }

// ------------------------------------------------------------------
// Upload
// ------------------------------------------------------------------
initDropzone(dropzone, fileInput, (files) => {
  const file = files[0]
  if (!file || !file.type.startsWith('image/')) return
  loadImageFile(file)
})

function loadImageFile(file) {
  currentFileName = file.name
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.onload = () => {
    img = image
    scale = Math.min(1, MAX_CANVAS_WIDTH / image.naturalWidth)
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    baseImageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

    // Reset all downstream state — a new image invalidates any prior calibration/style.
    currentMode = 'idle'
    pendingClicks = []
    awaitingConfirm = null
    calib = null
    distanceForm.innerHTML = ''
    stylePanel.hidden = true
    outputWrap.hidden = true

    // Size the thickness slider sensibly relative to this image.
    const minSide = Math.min(image.naturalWidth, image.naturalHeight)
    const maxThickness = Math.max(4, Math.round(minSide * 0.05))
    const defaultThickness = Math.min(maxThickness, Math.max(2, Math.round(minSide * 0.006)))
    thicknessInput.max = String(maxThickness)
    thicknessInput.value = String(defaultThickness)
    thicknessValue.textContent = String(defaultThickness)
    barConfig.thicknessPx = defaultThickness

    calibrateBtn.disabled = false
    emptyCanvas.style.display = 'none'
    canvasWrap.style.display = 'block'
    fileChip.innerHTML = `<li><span>📄 ${escapeAttr(file.name)}</span><span>${image.naturalWidth}×${image.naturalHeight}px</span></li>`

    updateCanvasModeClass()
    renderCalibBadges()
    updateAlert()
    redraw()
    URL.revokeObjectURL(url)
  }
  image.src = url
}

// ------------------------------------------------------------------
// Canvas interaction — single centralized click handler
// ------------------------------------------------------------------
canvas.addEventListener('click', (evt) => {
  if (!img || currentMode !== 'calibrating') return
  const { x, y } = clientToPixel(evt)
  pendingClicks.push({ x, y })

  if (pendingClicks.length === 2) {
    awaitingConfirm = { point1: pendingClicks[0], point2: pendingClicks[1] }
    currentMode = 'idle'
    updateCanvasModeClass()
    renderDistanceForm()
  }
  updateAlert()
  redraw()
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
  canvas.classList.toggle('mode-active', currentMode === 'calibrating')
  canvas.classList.toggle('mode-idle', currentMode !== 'calibrating')
}

// ------------------------------------------------------------------
// Step 2 — Distance calibration
// ------------------------------------------------------------------
calibrateBtn.addEventListener('click', startCalibration)
resetCalibBtn.addEventListener('click', resetCalibration)

function startCalibration() {
  currentMode = 'calibrating'
  pendingClicks = []
  awaitingConfirm = null
  calib = null
  distanceForm.innerHTML = ''
  stylePanel.hidden = true
  outputWrap.hidden = true
  updateCanvasModeClass()
  renderCalibBadges()
  updateAlert()
  redraw()
}

function resetCalibration() {
  currentMode = 'idle'
  pendingClicks = []
  awaitingConfirm = null
  calib = null
  distanceForm.innerHTML = ''
  stylePanel.hidden = true
  outputWrap.hidden = true
  updateCanvasModeClass()
  renderCalibBadges()
  updateAlert()
  redraw()
}

function renderDistanceForm() {
  distanceForm.innerHTML = `
    <div class="sb-distance-form">
      <div class="field-row">
        <div class="field">
          <label>Known distance</label>
          <input type="number" step="any" min="0" class="sb-known-distance" />
        </div>
        <div class="field">
          <label>Unit</label>
          <select class="sb-known-unit">
            <option value="nm">nm</option>
            <option value="µm" selected>µm</option>
            <option value="mm">mm</option>
            <option value="cm">cm</option>
            <option value="in">in</option>
          </select>
        </div>
      </div>
      <button class="btn btn-primary" type="button">Confirm calibration</button>
    </div>
  `

  const distInput = distanceForm.querySelector('.sb-known-distance')
  const unitSelect = distanceForm.querySelector('.sb-known-unit')
  const confirmBtn = distanceForm.querySelector('button')

  confirmBtn.addEventListener('click', () => {
    const knownDistance = Number(distInput.value)
    if (distInput.value === '' || !Number.isFinite(knownDistance) || knownDistance <= 0) {
      calibAlert.className = 'alert alert-warning'
      calibAlert.textContent = 'Enter a known distance greater than zero.'
      return
    }

    const { point1, point2 } = awaitingConfirm
    const displayPixelDist = Math.hypot(point2.x - point1.x, point2.y - point1.y)
    if (displayPixelDist === 0) {
      calibAlert.className = 'alert alert-danger'
      calibAlert.textContent = 'The two points landed on the same pixel — reset and click points further apart.'
      return
    }

    // Clicks happen in the (possibly downscaled) display canvas; convert back to
    // original-image pixel space so the calibration is correct for the full-res output.
    const originalPixelDist = displayPixelDist / scale
    const unitsPerOriginalPixel = knownDistance / originalPixelDist

    calib = {
      point1,
      point2,
      knownDistance,
      unit: unitSelect.value,
      originalPixelDist,
      unitsPerOriginalPixel,
    }
    awaitingConfirm = null
    distanceForm.innerHTML = ''

    initStylePanelDefaults()
    stylePanel.hidden = false
    outputWrap.hidden = false

    renderCalibBadges()
    updateAlert()
    redraw()
    updateOutput()
  })
}

function renderCalibBadges() {
  if (!calib) {
    calibBadges.innerHTML = ''
    return
  }
  calibBadges.innerHTML = `<span class="badge">${fmtNum(calib.knownDistance)} ${escapeAttr(calib.unit)} = ${fmtNum(
    calib.originalPixelDist
  )} px → 1 px = ${fmtNum(calib.unitsPerOriginalPixel)} ${escapeAttr(calib.unit)}</span>`
}

function updateAlert() {
  if (!img) {
    calibAlert.className = 'alert alert-info'
    calibAlert.textContent = 'Upload an image to begin.'
  } else if (currentMode === 'calibrating') {
    const ordinal = pendingClicks.length === 0 ? 'first' : 'second'
    calibAlert.className = 'alert alert-info'
    calibAlert.textContent = `Click the ${ordinal} point on the image.`
  } else if (awaitingConfirm) {
    calibAlert.className = 'alert alert-warning'
    calibAlert.textContent = 'Enter the known real-world distance between the two points, then confirm.'
  } else if (calib) {
    calibAlert.className = 'alert alert-success'
    calibAlert.textContent = 'Calibrated — configure the scale bar below.'
  } else {
    calibAlert.className = 'alert alert-info'
    calibAlert.textContent = 'Click "Calibrate distance" to begin.'
  }
}

// ------------------------------------------------------------------
// Canvas rendering: always redraw from the pristine base image, then layer
// calibration markers on top — never mutate the base pixels.
// ------------------------------------------------------------------
function redraw() {
  if (!baseImageData) return
  ctx.putImageData(baseImageData, 0, 0)
  drawCalibMarkers()
}

function drawPoint(pt, colorHex, label) {
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

function drawLine(p1, p2, colorHex) {
  ctx.beginPath()
  ctx.moveTo(p1.x, p1.y)
  ctx.lineTo(p2.x, p2.y)
  ctx.strokeStyle = colorHex
  ctx.lineWidth = 2
  ctx.setLineDash([6, 4])
  ctx.stroke()
  ctx.setLineDash([])
}

function drawCalibMarkers() {
  if (calib) {
    drawLine(calib.point1, calib.point2, '#4c9aff')
    drawPoint(calib.point1, '#4c9aff', 'P1')
    drawPoint(calib.point2, '#4c9aff', 'P2')
  } else if (awaitingConfirm) {
    drawLine(awaitingConfirm.point1, awaitingConfirm.point2, '#4c9aff')
    drawPoint(awaitingConfirm.point1, '#4c9aff', 'P1')
    drawPoint(awaitingConfirm.point2, '#4c9aff', 'P2')
  } else if (currentMode === 'calibrating') {
    pendingClicks.forEach((pt, i) => drawPoint(pt, '#4c9aff', `P${i + 1}`))
  }
}

// ------------------------------------------------------------------
// Step 3 — Scale bar style + full-resolution burn-in
// ------------------------------------------------------------------
function initStylePanelDefaults() {
  barUnitReadout.textContent = calib.unit
  const suggested = suggestLength()
  barLengthInput.value = String(suggested)
  barConfig.lengthUnits = suggested
  barConfig.corner = 'bottom-right'
  cornerButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.corner === 'bottom-right'))
  barConfig.color = colorInput.value || '#ffffff'
  barConfig.thicknessPx = Number(thicknessInput.value)
  barConfig.showLabel = showLabelCheckbox.checked
}

function suggestLength() {
  if (!calib || !img) return 1
  const targetPx = img.naturalWidth * 0.18
  const targetUnits = targetPx * calib.unitsPerOriginalPixel
  return niceNumber(targetUnits)
}

// Rounds to the nearest "nice" 1/2/5 x 10^n value — the standard microscopy scale-bar convention.
function niceNumber(x) {
  if (!Number.isFinite(x) || x <= 0) return 1
  const exp = Math.floor(Math.log10(x))
  const base = x / Math.pow(10, exp)
  let niceBase
  if (base < 1.5) niceBase = 1
  else if (base < 3.5) niceBase = 2
  else if (base < 7.5) niceBase = 5
  else niceBase = 10
  return Number((niceBase * Math.pow(10, exp)).toPrecision(6))
}

barLengthInput.addEventListener('input', () => {
  barConfig.lengthUnits = Number(barLengthInput.value) || 0
  updateOutput()
})

suggestLengthBtn.addEventListener('click', () => {
  const v = suggestLength()
  barLengthInput.value = String(v)
  barConfig.lengthUnits = v
  updateOutput()
})

cornerButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    barConfig.corner = btn.dataset.corner
    cornerButtons.forEach((b) => b.classList.toggle('is-active', b === btn))
    updateOutput()
  })
})

colorInput.addEventListener('input', () => {
  barConfig.color = colorInput.value
  updateOutput()
})

thicknessInput.addEventListener('input', () => {
  barConfig.thicknessPx = Number(thicknessInput.value)
  thicknessValue.textContent = thicknessInput.value
  updateOutput()
})

showLabelCheckbox.addEventListener('change', () => {
  barConfig.showLabel = showLabelCheckbox.checked
  updateOutput()
})

function updateOutput() {
  if (!img || !calib) return
  outputCanvas.width = img.naturalWidth
  outputCanvas.height = img.naturalHeight
  outCtx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight)
  drawScaleBarOnOutput()
}

function drawScaleBarOnOutput() {
  const W = img.naturalWidth
  const H = img.naturalHeight
  const barPx = Math.max(1, barConfig.lengthUnits / calib.unitsPerOriginalPixel)
  const thickness = Math.max(1, barConfig.thicknessPx)
  const margin = Math.max(12, Math.round(Math.min(W, H) * 0.03))

  const isRight = barConfig.corner.endsWith('right')
  const isBottom = barConfig.corner.startsWith('bottom')
  const x = isRight ? W - margin - barPx : margin
  const y = isBottom ? H - margin - thickness : margin

  const outline = outlineColorFor(barConfig.color)

  outCtx.save()
  outCtx.strokeStyle = outline
  outCtx.lineWidth = Math.max(2, Math.round(thickness * 0.25))
  outCtx.strokeRect(x, y, barPx, thickness)
  outCtx.fillStyle = barConfig.color
  outCtx.fillRect(x, y, barPx, thickness)
  outCtx.restore()

  if (barConfig.showLabel) {
    const label = `${formatLength(barConfig.lengthUnits)} ${calib.unit}`
    const fontSize = Math.max(14, Math.round(thickness * 3.2))
    const labelGap = Math.max(4, Math.round(thickness * 0.3))

    outCtx.save()
    outCtx.font = `bold ${fontSize}px sans-serif`
    outCtx.textAlign = 'center'
    outCtx.textBaseline = isBottom ? 'bottom' : 'top'
    const textX = x + barPx / 2
    const textY = isBottom ? y - labelGap : y + thickness + labelGap
    outCtx.lineWidth = Math.max(2, Math.round(fontSize * 0.18))
    outCtx.strokeStyle = outline
    outCtx.strokeText(label, textX, textY)
    outCtx.fillStyle = barConfig.color
    outCtx.fillText(label, textX, textY)
    outCtx.restore()
  }
}

// Picks black or white — whichever contrasts with the chosen bar color — for the
// bar/label outline, so it stays legible against any background content.
function outlineColorFor(hex) {
  const { r, g, b } = hexToRgb(hex)
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b
  return luminance > 140 ? '#000000' : '#ffffff'
}

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function formatLength(v) {
  if (!Number.isFinite(v)) return String(v)
  if (Number.isInteger(v)) return String(v)
  return v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function fmtNum(x, sig = 4) {
  if (!Number.isFinite(x)) return String(x)
  return Number(x.toPrecision(sig)).toString()
}

// ------------------------------------------------------------------
// Download
// ------------------------------------------------------------------
downloadBtn.addEventListener('click', () => {
  if (!calib) return
  outputCanvas.toBlob((blob) => {
    if (!blob) return
    const base = currentFileName.replace(/\.[^./]+$/, '') || 'image'
    downloadBlob(blob, `${base}_scalebar.png`)
  }, 'image/png')
})

// ------------------------------------------------------------------
// Initial render
// ------------------------------------------------------------------
updateAlert()

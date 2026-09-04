import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { downloadBlob, downloadText } from '../shared/download.js'
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
const colorTextInput = document.getElementById('sb-bar-color-text')
const opacityInput = document.getElementById('sb-bar-opacity')
const opacityValue = document.getElementById('sb-bar-opacity-value')
const thicknessInput = document.getElementById('sb-bar-thickness')
const thicknessValue = document.getElementById('sb-bar-thickness-value')
const endTicksCheckbox = document.getElementById('sb-end-ticks')
const tickHeightInput = document.getElementById('sb-tick-height')
const tickHeightValue = document.getElementById('sb-tick-height-value')
const tickHeightField = document.getElementById('sb-tick-height-field')
const showStrokeCheckbox = document.getElementById('sb-show-stroke')
const strokeColorInput = document.getElementById('sb-stroke-color')
const strokeColorTextInput = document.getElementById('sb-stroke-color-text')
const strokeAutoBtn = document.getElementById('sb-stroke-auto-btn')
const strokeWidthInput = document.getElementById('sb-stroke-width')
const strokeWidthValue = document.getElementById('sb-stroke-width-value')
const strokeOptions = document.getElementById('sb-stroke-options')
const showLabelCheckbox = document.getElementById('sb-show-label')
const fontFamilySelect = document.getElementById('sb-font-family')
const fontSizeInput = document.getElementById('sb-font-size')
const fontAutoBtn = document.getElementById('sb-font-auto-btn')
const labelOptions = document.getElementById('sb-label-options')

const canvas = document.getElementById('sb-canvas')
const ctx = canvas.getContext('2d')
const canvasWrap = document.getElementById('sb-canvas-wrap')
const emptyCanvas = document.getElementById('sb-empty-canvas')

const outputWrap = document.getElementById('sb-output-wrap')
const outputCanvas = document.getElementById('sb-output-canvas')
const outCtx = outputCanvas.getContext('2d')
const downloadBtn = document.getElementById('sb-download-btn')
const downloadSvgBtn = document.getElementById('sb-download-svg')
const downloadPptxBtn = document.getElementById('sb-download-pptx')

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

const barConfig = {
  lengthUnits: 0,
  corner: 'bottom-right',
  color: '#ffffff',
  opacity: 1,
  thicknessPx: 10,
  endTicks: true,
  tickHeightMul: 3,
  showStroke: true,
  strokeColor: '#000000',
  strokeAuto: true,
  strokeWidth: 2,
  showLabel: true,
  fontFamily: 'Arial',
  fontSize: 0,
  fontSizeAuto: true,
}

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
  barConfig.opacity = 1
  opacityInput.value = '100'
  opacityValue.textContent = '100%'
  barConfig.thicknessPx = Number(thicknessInput.value)
  barConfig.endTicks = true
  endTicksCheckbox.checked = true
  barConfig.tickHeightMul = 3
  tickHeightInput.value = '3'
  tickHeightValue.textContent = '3×'
  tickHeightField.hidden = false
  barConfig.showStroke = true
  showStrokeCheckbox.checked = true
  barConfig.strokeAuto = true
  barConfig.strokeColor = outlineColorFor(barConfig.color)
  strokeColorInput.value = barConfig.strokeColor
  strokeColorTextInput.value = barConfig.strokeColor
  barConfig.strokeWidth = Math.max(2, Math.round(barConfig.thicknessPx * 0.25))
  strokeWidthInput.value = String(barConfig.strokeWidth)
  strokeWidthValue.textContent = String(barConfig.strokeWidth)
  strokeOptions.hidden = false
  barConfig.showLabel = showLabelCheckbox.checked
  barConfig.fontFamily = 'Arial'
  fontFamilySelect.value = 'Arial'
  barConfig.fontSizeAuto = true
  const autoFontSize = Math.max(14, Math.round(barConfig.thicknessPx * 3.2))
  barConfig.fontSize = autoFontSize
  fontSizeInput.value = String(autoFontSize)
  labelOptions.hidden = false
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

function syncColor(picker, text, apply) {
  picker.addEventListener('input', () => { text.value = picker.value; apply(picker.value) })
  text.addEventListener('input', () => {
    const v = text.value.startsWith('#') ? text.value : '#' + text.value
    if (/^#[0-9a-fA-F]{6}$/.test(v)) { picker.value = v; apply(v) }
  })
}

syncColor(colorInput, colorTextInput, (v) => {
  barConfig.color = v
  if (barConfig.strokeAuto) {
    barConfig.strokeColor = outlineColorFor(v)
    strokeColorInput.value = barConfig.strokeColor
    strokeColorTextInput.value = barConfig.strokeColor
  }
  updateOutput()
})

opacityInput.addEventListener('input', () => {
  barConfig.opacity = Number(opacityInput.value) / 100
  opacityValue.textContent = opacityInput.value + '%'
  updateOutput()
})

thicknessInput.addEventListener('input', () => {
  barConfig.thicknessPx = Number(thicknessInput.value)
  thicknessValue.textContent = thicknessInput.value
  if (barConfig.fontSizeAuto) {
    const fs = Math.max(14, Math.round(barConfig.thicknessPx * 3.2))
    barConfig.fontSize = fs
    fontSizeInput.value = String(fs)
  }
  updateOutput()
})

endTicksCheckbox.addEventListener('change', () => {
  barConfig.endTicks = endTicksCheckbox.checked
  tickHeightField.hidden = !barConfig.endTicks
  updateOutput()
})

tickHeightInput.addEventListener('input', () => {
  barConfig.tickHeightMul = Number(tickHeightInput.value)
  tickHeightValue.textContent = tickHeightInput.value + '×'
  updateOutput()
})

showStrokeCheckbox.addEventListener('change', () => {
  barConfig.showStroke = showStrokeCheckbox.checked
  strokeOptions.hidden = !barConfig.showStroke
  updateOutput()
})

syncColor(strokeColorInput, strokeColorTextInput, (v) => {
  barConfig.strokeColor = v
  barConfig.strokeAuto = false
  updateOutput()
})

strokeAutoBtn.addEventListener('click', () => {
  barConfig.strokeAuto = true
  barConfig.strokeColor = outlineColorFor(barConfig.color)
  strokeColorInput.value = barConfig.strokeColor
  strokeColorTextInput.value = barConfig.strokeColor
  updateOutput()
})

strokeWidthInput.addEventListener('input', () => {
  barConfig.strokeWidth = Number(strokeWidthInput.value)
  strokeWidthValue.textContent = strokeWidthInput.value
  updateOutput()
})

showLabelCheckbox.addEventListener('change', () => {
  barConfig.showLabel = showLabelCheckbox.checked
  labelOptions.hidden = !barConfig.showLabel
  updateOutput()
})

fontFamilySelect.addEventListener('change', () => {
  barConfig.fontFamily = fontFamilySelect.value
  updateOutput()
})

fontSizeInput.addEventListener('input', () => {
  barConfig.fontSize = Number(fontSizeInput.value) || 14
  barConfig.fontSizeAuto = false
  updateOutput()
})

fontAutoBtn.addEventListener('click', () => {
  barConfig.fontSizeAuto = true
  const fs = Math.max(14, Math.round(barConfig.thicknessPx * 3.2))
  barConfig.fontSize = fs
  fontSizeInput.value = String(fs)
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
  const g = computeBarGeometry()

  outCtx.save()
  outCtx.globalAlpha = g.opacity

  if (g.strokeWidth > 0 && g.strokeColor !== 'none') {
    outCtx.strokeStyle = g.strokeColor
    outCtx.lineWidth = g.strokeWidth
    outCtx.strokeRect(g.x, g.y, g.barPx, g.thickness)
  }
  outCtx.fillStyle = barConfig.color
  outCtx.fillRect(g.x, g.y, g.barPx, g.thickness)

  if (g.endTicks && g.tickHeight > 0) {
    outCtx.fillRect(g.x, g.tickY, g.strokeWidth || Math.max(2, g.thickness * 0.15), g.tickHeight)
    outCtx.fillRect(g.x + g.barPx - (g.strokeWidth || Math.max(2, g.thickness * 0.15)), g.tickY, g.strokeWidth || Math.max(2, g.thickness * 0.15), g.tickHeight)
    if (g.strokeWidth > 0 && g.strokeColor !== 'none') {
      outCtx.strokeStyle = g.strokeColor
      outCtx.lineWidth = g.strokeWidth
      outCtx.strokeRect(g.x, g.tickY, g.strokeWidth || Math.max(2, g.thickness * 0.15), g.tickHeight)
      outCtx.strokeRect(g.x + g.barPx - (g.strokeWidth || Math.max(2, g.thickness * 0.15)), g.tickY, g.strokeWidth || Math.max(2, g.thickness * 0.15), g.tickHeight)
    }
  }

  if (barConfig.showLabel) {
    outCtx.font = `bold ${g.fontSize}px "${g.fontFamily}", sans-serif`
    outCtx.textAlign = 'center'
    outCtx.textBaseline = g.isBottom ? 'bottom' : 'top'
    if (g.strokeWidth > 0 && g.strokeColor !== 'none') {
      outCtx.lineWidth = Math.max(g.strokeWidth, Math.round(g.fontSize * 0.12))
      outCtx.lineJoin = 'round'
      outCtx.strokeStyle = g.strokeColor
      outCtx.strokeText(g.label, g.textX, g.textY)
    }
    outCtx.fillStyle = barConfig.color
    outCtx.fillText(g.label, g.textX, g.textY)
  }

  outCtx.restore()
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
// Shared: compute scale bar geometry in original-image pixel space
// ------------------------------------------------------------------
function computeBarGeometry() {
  const W = img.naturalWidth
  const H = img.naturalHeight
  const barPx = Math.max(1, barConfig.lengthUnits / calib.unitsPerOriginalPixel)
  const thickness = Math.max(1, barConfig.thicknessPx)
  const margin = Math.max(12, Math.round(Math.min(W, H) * 0.03))

  const isRight = barConfig.corner.endsWith('right')
  const isBottom = barConfig.corner.startsWith('bottom')
  const x = isRight ? W - margin - barPx : margin
  const y = isBottom ? H - margin - thickness : margin

  const label = `${formatLength(barConfig.lengthUnits)} ${calib.unit}`
  const fontSize = barConfig.fontSize || Math.max(14, Math.round(thickness * 3.2))
  const labelGap = Math.max(4, Math.round(thickness * 0.3))
  const textX = x + barPx / 2
  const textY = isBottom ? y - labelGap : y + thickness + labelGap
  const strokeColor = barConfig.showStroke ? barConfig.strokeColor : 'none'
  const strokeWidth = barConfig.showStroke ? barConfig.strokeWidth : 0
  const tickHeight = barConfig.endTicks ? thickness * barConfig.tickHeightMul : 0
  const tickY = y + thickness / 2 - tickHeight / 2

  return {
    W, H, barPx, thickness, x, y, label, fontSize, labelGap, textX, textY,
    strokeColor, strokeWidth, isBottom,
    opacity: barConfig.opacity,
    fontFamily: barConfig.fontFamily,
    endTicks: barConfig.endTicks, tickHeight, tickY,
  }
}

// ------------------------------------------------------------------
// Download: PNG (flat burn-in)
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
// Download: SVG (editable scale bar as separate elements)
// ------------------------------------------------------------------
downloadSvgBtn.addEventListener('click', async () => {
  if (!calib || !img) return
  const g = computeBarGeometry()
  const dataUrl = await imageToDataUrl(img)

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const hasStroke = g.strokeWidth > 0 && g.strokeColor !== 'none'
  const strokeAttr = hasStroke ? `stroke="${g.strokeColor}" stroke-width="${g.strokeWidth}"` : 'stroke="none"'
  const tickW = hasStroke ? g.strokeWidth : Math.max(2, g.thickness * 0.15)

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${g.W}" height="${g.H}" viewBox="0 0 ${g.W} ${g.H}">
  <image xlink:href="${esc(dataUrl)}" width="${g.W}" height="${g.H}" />
  <g id="scale-bar" opacity="${g.opacity}">`

  svg += `
    <rect x="${g.x}" y="${g.y}" width="${g.barPx}" height="${g.thickness}"
          fill="${barConfig.color}" ${strokeAttr} />`

  if (g.endTicks && g.tickHeight > 0) {
    svg += `
    <rect x="${g.x}" y="${g.tickY}" width="${tickW}" height="${g.tickHeight}"
          fill="${barConfig.color}" ${strokeAttr} />
    <rect x="${g.x + g.barPx - tickW}" y="${g.tickY}" width="${tickW}" height="${g.tickHeight}"
          fill="${barConfig.color}" ${strokeAttr} />`
  }

  if (barConfig.showLabel) {
    const anchor = 'middle'
    const baseline = g.isBottom ? 'auto' : 'hanging'
    const textStrokeW = Math.max(g.strokeWidth, Math.round(g.fontSize * 0.12))
    const textStroke = hasStroke
      ? `stroke="${g.strokeColor}" stroke-width="${textStrokeW}" stroke-linejoin="round" paint-order="stroke fill"`
      : 'stroke="none"'
    svg += `
    <text x="${g.textX}" y="${g.textY}" font-family="${esc(g.fontFamily)}, sans-serif" font-size="${g.fontSize}"
          font-weight="bold" text-anchor="${anchor}" dominant-baseline="${baseline}"
          fill="${barConfig.color}" ${textStroke}>${esc(g.label)}</text>`
  }

  svg += `
  </g>
</svg>`

  const base = currentFileName.replace(/\.[^./]+$/, '') || 'image'
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${base}_scalebar.svg`)
})

// ------------------------------------------------------------------
// Download: PPTX (editable scale bar as separate shape + text box)
// ------------------------------------------------------------------
downloadPptxBtn.addEventListener('click', async () => {
  if (!calib || !img) return
  downloadPptxBtn.disabled = true
  downloadPptxBtn.textContent = 'Generating…'
  try {
    const PptxGenJS = (await import('pptxgenjs')).default
    const pptx = new PptxGenJS()

    const g = computeBarGeometry()
    const hasStroke = g.strokeWidth > 0 && g.strokeColor !== 'none'
    const fillHex = barConfig.color.replace('#', '')
    const strokeHex = g.strokeColor.replace('#', '')
    const lineOpts = hasStroke ? { color: strokeHex, width: Math.max(0.5, g.strokeWidth * 0.75) } : { type: 'none' }
    const opacityPct = Math.round(g.opacity * 100)

    const W_IN = g.W / 96
    const H_IN = g.H / 96
    pptx.defineLayout({ name: 'IMG', width: W_IN, height: H_IN })
    pptx.layout = 'IMG'

    const slide = pptx.addSlide()

    const dataUrl = await imageToDataUrl(img)
    slide.addImage({ data: dataUrl, x: 0, y: 0, w: W_IN, h: H_IN })

    const barX = g.x / 96
    const barY = g.y / 96
    const barW = g.barPx / 96
    const barH = g.thickness / 96

    slide.addShape(pptx.ShapeType.rect, {
      x: barX, y: barY, w: barW, h: barH,
      fill: { color: fillHex, transparency: 100 - opacityPct },
      line: lineOpts,
    })

    if (g.endTicks && g.tickHeight > 0) {
      const tickW = (hasStroke ? g.strokeWidth : Math.max(2, g.thickness * 0.15)) / 96
      const tickH = g.tickHeight / 96
      const tickYIn = g.tickY / 96
      slide.addShape(pptx.ShapeType.rect, {
        x: barX, y: tickYIn, w: tickW, h: tickH,
        fill: { color: fillHex, transparency: 100 - opacityPct }, line: lineOpts,
      })
      slide.addShape(pptx.ShapeType.rect, {
        x: barX + barW - tickW, y: tickYIn, w: tickW, h: tickH,
        fill: { color: fillHex, transparency: 100 - opacityPct }, line: lineOpts,
      })
    }

    if (barConfig.showLabel) {
      const fontPt = Math.max(6, Math.round(g.fontSize * 0.75))
      const labelH = fontPt * 1.6 / 72
      const labelY = g.isBottom ? barY - labelH : barY + barH
      const textOpts = {
        x: barX, y: labelY, w: barW, h: labelH,
        align: 'center', valign: 'middle',
        fontSize: fontPt, bold: true,
        color: fillHex,
        fontFace: g.fontFamily,
        transparency: 100 - opacityPct,
      }
      if (hasStroke) {
        textOpts.outline = { size: Math.max(g.strokeWidth * 0.75, fontPt * 0.04), color: strokeHex }
      }
      slide.addText(g.label, textOpts)
    }

    const pptxBlob = await pptx.write({ outputType: 'blob' })
    const base = currentFileName.replace(/\.[^./]+$/, '') || 'image'
    downloadBlob(pptxBlob, `${base}_scalebar.pptx`)
  } catch (err) {
    console.error(err)
    alert('PPTX generation failed: ' + (err?.message || err))
  } finally {
    downloadPptxBtn.disabled = false
    downloadPptxBtn.textContent = '⬇ PPTX (editable)'
  }
})

// Convert the loaded <img> to a data URL for embedding in SVG/PPTX.
function imageToDataUrl(image) {
  return new Promise((resolve) => {
    const c = document.createElement('canvas')
    c.width = image.naturalWidth
    c.height = image.naturalHeight
    c.getContext('2d').drawImage(image, 0, 0)
    resolve(c.toDataURL('image/png'))
  })
}

// ------------------------------------------------------------------
// Initial render
// ------------------------------------------------------------------
updateAlert()

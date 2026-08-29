import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { downloadBlob } from '../shared/download.js'

initChrome('background-remover')

const dropzone = document.getElementById('dropzone')
const fileInput = document.getElementById('file-input')
const modelSelect = document.getElementById('model-select')
const removeBtn = document.getElementById('remove-btn')
const clearBtn = document.getElementById('clear-btn')
const alertSlot = document.getElementById('alert-slot')
const statusLine = document.getElementById('status-line')
const statusText = document.getElementById('status-text')
const emptyState = document.getElementById('empty-state')
const compare = document.getElementById('compare')
const originalImg = document.getElementById('original-img')
const resultCanvas = document.getElementById('result-canvas')
const resultCtx = resultCanvas.getContext('2d')
const downloadSlot = document.getElementById('download-slot')

const tunePanel = document.getElementById('tune-panel')
const thresholdRange = document.getElementById('threshold-range')
const thresholdValue = document.getElementById('threshold-value')
const featherRange = document.getElementById('feather-range')
const featherValue = document.getElementById('feather-value')
const invertCheckbox = document.getElementById('invert-checkbox')
const resetTuneBtn = document.getElementById('reset-tune-btn')

const paintPanel = document.getElementById('paint-panel')
const eraseModeBtn = document.getElementById('erase-mode-btn')
const restoreModeBtn = document.getElementById('restore-mode-btn')
const brushSizeRange = document.getElementById('brush-size-range')
const brushSizeValue = document.getElementById('brush-size-value')
const undoPaintBtn = document.getElementById('undo-paint-btn')
const clearPaintBtn = document.getElementById('clear-paint-btn')

let currentFile = null
let originalUrl = null

// The model's raw output, decoded once per run — never mutated. Every
// fine-tune adjustment re-derives the displayed image from these.
let baseAlpha = null // Uint8ClampedArray, one byte per pixel, from the model's alpha channel
let originalRgb = null // Uint8ClampedArray RGBA of the *original* photo, resampled to the same WxH as baseAlpha
let maskWidth = 0
let maskHeight = 0

// autoAlpha = baseAlpha after invert/threshold/feather (recomputed only when
// those controls change). manualOverride is a hand-painted layer on top: -1
// means "no override, use autoAlpha"; any other value (0-255) is a literal
// alpha the user painted in, which stays fixed even if the sliders above
// change afterwards.
let autoAlpha = null
let manualOverride = null

let paintMode = 'erase' // 'erase' | 'restore'
let brushRadius = Number(brushSizeRange.value)
let isPainting = false
let lastPaintPoint = null
const undoStack = []
const UNDO_LIMIT = 15

function showAlert(kind, message) {
  alertSlot.innerHTML = message ? `<div class="alert alert-${kind}">${escapeHtml(message)}</div>` : ''
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

function baseName(name) {
  return name.replace(/\.[^./\\]+$/, '')
}

function setBusy(busy, label) {
  removeBtn.disabled = busy || !currentFile
  statusLine.hidden = !busy
  if (busy) statusText.textContent = label || 'Working…'
}

function resetToEmptyState() {
  currentFile = null
  baseAlpha = null
  originalRgb = null
  autoAlpha = null
  manualOverride = null
  maskWidth = 0
  maskHeight = 0
  undoStack.length = 0
  isPainting = false
  lastPaintPoint = null

  if (originalUrl) URL.revokeObjectURL(originalUrl)
  originalUrl = null

  fileInput.value = ''
  originalImg.removeAttribute('src')
  resultCanvas.width = 0
  resultCanvas.height = 0
  compare.hidden = true
  emptyState.hidden = false
  tunePanel.hidden = true
  paintPanel.hidden = true
  downloadSlot.innerHTML = ''
  showAlert(null)
  setBusy(false)
  clearBtn.disabled = true
  undoPaintBtn.disabled = true
  clearPaintBtn.disabled = true

  thresholdRange.value = 0
  thresholdValue.textContent = '0'
  featherRange.value = 0
  featherValue.textContent = '0'
  invertCheckbox.checked = false
}

initDropzone(dropzone, fileInput, (files) => {
  const file = files[0]
  if (!file || !file.type.startsWith('image/')) {
    showAlert('danger', 'Please choose an image file.')
    return
  }

  resetToEmptyState()
  currentFile = file
  clearBtn.disabled = false

  originalUrl = URL.createObjectURL(file)
  originalImg.src = originalUrl

  emptyState.hidden = true
  compare.hidden = false
  removeBtn.disabled = false
})

clearBtn.addEventListener('click', resetToEmptyState)

removeBtn.addEventListener('click', async () => {
  if (!currentFile) return

  showAlert(null)
  tunePanel.hidden = true
  paintPanel.hidden = true
  setBusy(true, 'Starting…')

  try {
    const { removeBackground } = await import('@imgly/background-removal')

    const blob = await removeBackground(currentFile, {
      model: modelSelect.value,
      progress: (key, current, total) => {
        if (total) {
          const pct = Math.round((current / total) * 100)
          setBusy(true, `${key}: ${pct}%`)
        } else {
          setBusy(true, `${key}…`)
        }
      },
    })

    await loadResultIntoBuffers(blob)
    thresholdRange.value = 0
    thresholdValue.textContent = '0'
    featherRange.value = 0
    featherValue.textContent = '0'
    invertCheckbox.checked = false
    undoStack.length = 0
    undoPaintBtn.disabled = true
    clearPaintBtn.disabled = false

    computeAutoAlpha()
    compositeFull()
    tunePanel.hidden = false
    paintPanel.hidden = false
    showAlert(
      'success',
      'Background removed. Use the sliders for the overall edge, or paint directly on the result for local touch-ups.'
    )
  } catch (err) {
    console.error(err)
    showAlert(
      'danger',
      `Could not remove the background (${err?.message || err}). Try a smaller image, ` +
        'a different browser, or check your network connection (the model has to download on first use).'
    )
  } finally {
    setBusy(false)
  }
})

// Decodes the model's PNG output (RGBA) and re-samples the original photo to
// the same pixel grid, so later adjustments can recombine "original color" +
// "adjusted alpha" without ever touching the pristine source data.
async function loadResultIntoBuffers(blob) {
  const resultBitmap = await blobToImage(blob)
  maskWidth = resultBitmap.naturalWidth
  maskHeight = resultBitmap.naturalHeight

  const decodeCanvas = document.createElement('canvas')
  decodeCanvas.width = maskWidth
  decodeCanvas.height = maskHeight
  const decodeCtx = decodeCanvas.getContext('2d')
  decodeCtx.drawImage(resultBitmap, 0, 0)
  const resultData = decodeCtx.getImageData(0, 0, maskWidth, maskHeight).data

  baseAlpha = new Uint8ClampedArray(maskWidth * maskHeight)
  for (let i = 0; i < baseAlpha.length; i++) baseAlpha[i] = resultData[i * 4 + 3]

  const origBitmap = await blobToImage(currentFile)
  const origCanvas = document.createElement('canvas')
  origCanvas.width = maskWidth
  origCanvas.height = maskHeight
  const origCtx = origCanvas.getContext('2d')
  origCtx.drawImage(origBitmap, 0, 0, maskWidth, maskHeight)
  originalRgb = origCtx.getImageData(0, 0, maskWidth, maskHeight).data

  manualOverride = new Float32Array(maskWidth * maskHeight).fill(-1)
  resultCanvas.width = maskWidth
  resultCanvas.height = maskHeight
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not decode image.'))
    }
    img.src = url
  })
}

// ------------------------------------------------------------------
// Fine-tune sliders: derive autoAlpha from baseAlpha. Cheap enough to run
// live on every slider input.
// ------------------------------------------------------------------
function computeAutoAlpha() {
  if (!baseAlpha) return

  const thresholdShift = Number(thresholdRange.value) // -100..100
  const feather = Number(featherRange.value) // 0..12 px
  const invert = invertCheckbox.checked

  let alpha = baseAlpha
  if (invert) {
    const inverted = new Uint8ClampedArray(alpha.length)
    for (let i = 0; i < alpha.length; i++) inverted[i] = 255 - alpha[i]
    alpha = inverted
  }
  if (thresholdShift !== 0) {
    const shifted = new Uint8ClampedArray(alpha.length)
    for (let i = 0; i < alpha.length; i++) shifted[i] = alpha[i] + thresholdShift * 2.55
    alpha = shifted
  }
  if (feather > 0) {
    alpha = boxBlur(alpha, maskWidth, maskHeight, feather)
  }
  autoAlpha = alpha
}

// Full recombination of original color + (manual override, else autoAlpha).
function compositeFull() {
  if (!autoAlpha || !originalRgb || !manualOverride) return

  const outData = resultCtx.createImageData(maskWidth, maskHeight)
  const out = outData.data
  for (let i = 0, p = 0; i < autoAlpha.length; i++, p += 4) {
    out[p] = originalRgb[p]
    out[p + 1] = originalRgb[p + 1]
    out[p + 2] = originalRgb[p + 2]
    const manual = manualOverride[i]
    out[p + 3] = manual >= 0 ? manual : autoAlpha[i]
  }
  resultCtx.putImageData(outData, 0, 0)
  ensureDownloadButton()
}

// Recombines only a sub-rectangle — used while painting, so a stroke doesn't
// have to touch every pixel in the image on every pointermove.
function compositeRegion(x0, y0, x1, y1) {
  x0 = Math.max(0, x0)
  y0 = Math.max(0, y0)
  x1 = Math.min(maskWidth - 1, x1)
  y1 = Math.min(maskHeight - 1, y1)
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  if (w <= 0 || h <= 0) return

  const patch = resultCtx.createImageData(w, h)
  const pd = patch.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y0 + y) * maskWidth + (x0 + x)
      const p = (y * w + x) * 4
      pd[p] = originalRgb[i * 4]
      pd[p + 1] = originalRgb[i * 4 + 1]
      pd[p + 2] = originalRgb[i * 4 + 2]
      const manual = manualOverride[i]
      pd[p + 3] = manual >= 0 ? manual : autoAlpha[i]
    }
  }
  resultCtx.putImageData(patch, x0, y0)
}

function ensureDownloadButton() {
  if (downloadSlot.childElementCount > 0) return
  const dlBtn = document.createElement('button')
  dlBtn.className = 'btn btn-primary'
  dlBtn.textContent = 'Download PNG'
  dlBtn.addEventListener('click', () => {
    resultCanvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `no-bg_${baseName(currentFile.name)}.png`)
    }, 'image/png')
  })
  downloadSlot.appendChild(dlBtn)
}

// Separable box blur over a single-channel byte array, using a sliding-window
// sum so cost is O(width*height) regardless of radius.
function boxBlur(channel, width, height, radius) {
  const temp = new Float32Array(width * height)
  const out = new Uint8ClampedArray(width * height)
  const windowSize = radius * 2 + 1

  for (let y = 0; y < height; y++) {
    const rowOff = y * width
    let sum = 0
    for (let x = -radius; x <= radius; x++) sum += channel[rowOff + clampIdx(x, width)]
    for (let x = 0; x < width; x++) {
      temp[rowOff + x] = sum / windowSize
      const leave = rowOff + clampIdx(x - radius, width)
      const enter = rowOff + clampIdx(x + radius + 1, width)
      sum += channel[enter] - channel[leave]
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = -radius; y <= radius; y++) sum += temp[clampIdx(y, height) * width + x]
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / windowSize
      const leave = clampIdx(y - radius, height) * width + x
      const enter = clampIdx(y + radius + 1, height) * width + x
      sum += temp[enter] - temp[leave]
    }
  }
  return out
}

function clampIdx(v, size) {
  return Math.max(0, Math.min(size - 1, v))
}

thresholdRange.addEventListener('input', () => {
  thresholdValue.textContent = thresholdRange.value
  computeAutoAlpha()
  compositeFull()
})
featherRange.addEventListener('input', () => {
  featherValue.textContent = featherRange.value
  computeAutoAlpha()
  compositeFull()
})
invertCheckbox.addEventListener('change', () => {
  computeAutoAlpha()
  compositeFull()
})
resetTuneBtn.addEventListener('click', () => {
  thresholdRange.value = 0
  thresholdValue.textContent = '0'
  featherRange.value = 0
  featherValue.textContent = '0'
  invertCheckbox.checked = false
  computeAutoAlpha()
  compositeFull()
})

// ------------------------------------------------------------------
// Manual touch-up: paint a soft-edged brush stroke directly into
// manualOverride, which permanently wins over autoAlpha wherever painted.
// ------------------------------------------------------------------
function setPaintMode(mode) {
  paintMode = mode
  eraseModeBtn.classList.toggle('is-active', mode === 'erase')
  restoreModeBtn.classList.toggle('is-active', mode === 'restore')
}
eraseModeBtn.addEventListener('click', () => setPaintMode('erase'))
restoreModeBtn.addEventListener('click', () => setPaintMode('restore'))

brushSizeRange.addEventListener('input', () => {
  brushRadius = Number(brushSizeRange.value)
  brushSizeValue.textContent = String(brushRadius)
})

function clientToMaskPixel(evt) {
  const rect = resultCanvas.getBoundingClientRect()
  const scaleX = maskWidth / rect.width
  const scaleY = maskHeight / rect.height
  const x = (evt.clientX - rect.left) * scaleX
  const y = (evt.clientY - rect.top) * scaleY
  return { x, y }
}

// Smoothstep radial falloff: 1 at the brush center, 0 at its edge. Blends the
// painted pixel's current value (manual override if any, else autoAlpha)
// toward the target (0 = erase, 255 = restore) — repeated stamps in the same
// spot converge smoothly on the target rather than snapping to it.
function stampBrush(cx, cy, target) {
  const r = brushRadius
  const x0 = Math.max(0, Math.floor(cx - r))
  const x1 = Math.min(maskWidth - 1, Math.ceil(cx + r))
  const y0 = Math.max(0, Math.floor(cy - r))
  const y1 = Math.min(maskHeight - 1, Math.ceil(cy + r))

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx
      const dy = y - cy
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d > r) continue
      let t = 1 - d / r
      t = t * t * (3 - 2 * t)
      const i = y * maskWidth + x
      const base = manualOverride[i] >= 0 ? manualOverride[i] : autoAlpha[i]
      manualOverride[i] = base + (target - base) * t
    }
  }
  return { x0, y0, x1, y1 }
}

function paintSegment(p0, p1) {
  const target = paintMode === 'erase' ? 0 : 255
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y
  const dist = Math.hypot(dx, dy)
  const step = Math.max(2, brushRadius / 4)
  const steps = Math.max(1, Math.ceil(dist / step))

  let bbox = null
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    const b = stampBrush(p0.x + dx * t, p0.y + dy * t, target)
    if (!bbox) bbox = { ...b }
    else {
      bbox.x0 = Math.min(bbox.x0, b.x0)
      bbox.y0 = Math.min(bbox.y0, b.y0)
      bbox.x1 = Math.max(bbox.x1, b.x1)
      bbox.y1 = Math.max(bbox.y1, b.y1)
    }
  }
  if (bbox) compositeRegion(bbox.x0, bbox.y0, bbox.x1, bbox.y1)
}

function pushUndoSnapshot() {
  undoStack.push(manualOverride.slice())
  if (undoStack.length > UNDO_LIMIT) undoStack.shift()
  undoPaintBtn.disabled = false
}

resultCanvas.addEventListener('pointerdown', (e) => {
  if (!autoAlpha || !manualOverride) return
  e.preventDefault()
  resultCanvas.setPointerCapture(e.pointerId)
  isPainting = true
  pushUndoSnapshot()
  const pt = clientToMaskPixel(e)
  lastPaintPoint = pt
  paintSegment(pt, pt)
})

resultCanvas.addEventListener('pointermove', (e) => {
  if (!isPainting) return
  const pt = clientToMaskPixel(e)
  paintSegment(lastPaintPoint, pt)
  lastPaintPoint = pt
})

function endStroke(e) {
  if (!isPainting) return
  isPainting = false
  lastPaintPoint = null
  try {
    resultCanvas.releasePointerCapture(e.pointerId)
  } catch {
    // already released
  }
}
resultCanvas.addEventListener('pointerup', endStroke)
resultCanvas.addEventListener('pointercancel', endStroke)

undoPaintBtn.addEventListener('click', () => {
  if (undoStack.length === 0) return
  manualOverride = undoStack.pop()
  undoPaintBtn.disabled = undoStack.length === 0
  compositeFull()
})

clearPaintBtn.addEventListener('click', () => {
  if (!manualOverride) return
  pushUndoSnapshot()
  manualOverride.fill(-1)
  compositeFull()
})

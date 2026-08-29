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
const resultImg = document.getElementById('result-img')
const downloadSlot = document.getElementById('download-slot')

const tunePanel = document.getElementById('tune-panel')
const thresholdRange = document.getElementById('threshold-range')
const thresholdValue = document.getElementById('threshold-value')
const featherRange = document.getElementById('feather-range')
const featherValue = document.getElementById('feather-value')
const invertCheckbox = document.getElementById('invert-checkbox')
const resetTuneBtn = document.getElementById('reset-tune-btn')

let currentFile = null
let originalUrl = null

// The model's raw output, decoded once per run — never mutated. Every
// fine-tune adjustment re-derives the final image from these two arrays.
let baseAlpha = null // Uint8ClampedArray, one byte per pixel, from the model's alpha channel
let originalRgb = null // Uint8ClampedArray RGBA of the *original* photo, resampled to the same WxH as baseAlpha
let maskWidth = 0
let maskHeight = 0

let finalResultUrl = null
let finalResultBlob = null

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
  maskWidth = 0
  maskHeight = 0

  if (originalUrl) URL.revokeObjectURL(originalUrl)
  if (finalResultUrl) URL.revokeObjectURL(finalResultUrl)
  originalUrl = null
  finalResultUrl = null
  finalResultBlob = null

  fileInput.value = ''
  originalImg.removeAttribute('src')
  resultImg.removeAttribute('src')
  compare.hidden = true
  emptyState.hidden = false
  tunePanel.hidden = true
  downloadSlot.innerHTML = ''
  showAlert(null)
  setBusy(false)
  clearBtn.disabled = true

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

    recomputeFinal()
    tunePanel.hidden = false
    showAlert('success', 'Background removed. Use the fine-tune panel if the edge needs adjusting.')
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

  const resultCanvas = document.createElement('canvas')
  resultCanvas.width = maskWidth
  resultCanvas.height = maskHeight
  const resultCtx = resultCanvas.getContext('2d')
  resultCtx.drawImage(resultBitmap, 0, 0)
  const resultData = resultCtx.getImageData(0, 0, maskWidth, maskHeight).data

  baseAlpha = new Uint8ClampedArray(maskWidth * maskHeight)
  for (let i = 0; i < baseAlpha.length; i++) baseAlpha[i] = resultData[i * 4 + 3]

  const origBitmap = await blobToImage(currentFile)
  const origCanvas = document.createElement('canvas')
  origCanvas.width = maskWidth
  origCanvas.height = maskHeight
  const origCtx = origCanvas.getContext('2d')
  origCtx.drawImage(origBitmap, 0, 0, maskWidth, maskHeight)
  originalRgb = origCtx.getImageData(0, 0, maskWidth, maskHeight).data
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
// Fine-tune: recombine original color + an adjusted version of the model's
// alpha channel. Cheap enough to run live on every slider input.
// ------------------------------------------------------------------
function recomputeFinal() {
  if (!baseAlpha || !originalRgb) return

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

  const canvas = document.createElement('canvas')
  canvas.width = maskWidth
  canvas.height = maskHeight
  const ctx = canvas.getContext('2d')
  const outData = ctx.createImageData(maskWidth, maskHeight)
  const out = outData.data
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    out[p] = originalRgb[p]
    out[p + 1] = originalRgb[p + 1]
    out[p + 2] = originalRgb[p + 2]
    out[p + 3] = alpha[i]
  }
  ctx.putImageData(outData, 0, 0)

  canvas.toBlob((blob) => {
    if (!blob) return
    if (finalResultUrl) URL.revokeObjectURL(finalResultUrl)
    finalResultUrl = URL.createObjectURL(blob)
    finalResultBlob = blob
    resultImg.src = finalResultUrl

    downloadSlot.innerHTML = ''
    const dlBtn = document.createElement('button')
    dlBtn.className = 'btn btn-primary'
    dlBtn.textContent = 'Download PNG'
    dlBtn.addEventListener('click', () => {
      downloadBlob(finalResultBlob, `no-bg_${baseName(currentFile.name)}.png`)
    })
    downloadSlot.appendChild(dlBtn)
  }, 'image/png')
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
  recomputeFinal()
})
featherRange.addEventListener('input', () => {
  featherValue.textContent = featherRange.value
  recomputeFinal()
})
invertCheckbox.addEventListener('change', recomputeFinal)
resetTuneBtn.addEventListener('click', () => {
  thresholdRange.value = 0
  thresholdValue.textContent = '0'
  featherRange.value = 0
  featherValue.textContent = '0'
  invertCheckbox.checked = false
  recomputeFinal()
})

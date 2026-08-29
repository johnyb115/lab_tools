import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { downloadBlob } from '../shared/download.js'
import { escapeHtml } from '../shared/dom.js'

initChrome('auto-crop')

const dropzone = document.getElementById('dropzone')
const fileInput = document.getElementById('file-input')
const fileChipList = document.getElementById('file-chip-list')
const autoBgSwatch = document.getElementById('auto-bg-swatch')
const bgColorInput = document.getElementById('bg-color')
const toleranceInput = document.getElementById('tolerance')
const toleranceValue = document.getElementById('tolerance-value')
const cropBtn = document.getElementById('crop-btn')
const downloadBtn = document.getElementById('download-btn')
const warningArea = document.getElementById('warning-area')
const resultArea = document.getElementById('result-area')

// Pristine, never-mutated state for the currently loaded image. Every crop
// recomputation starts from this, never from a previously-cropped canvas.
let pristine = null // { img, width, height, data, objectUrl }
let currentBaseName = 'image'
let lastCropCanvas = null // last successfully produced crop, for downloading

initDropzone(dropzone, fileInput, (files) => handleFile(files[0]))

toleranceInput.addEventListener('input', () => {
  toleranceValue.textContent = toleranceInput.value
  recompute()
})

bgColorInput.addEventListener('input', () => {
  recompute()
})

cropBtn.addEventListener('click', () => recompute())

downloadBtn.addEventListener('click', () => {
  if (!lastCropCanvas) return
  lastCropCanvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `cropped_${currentBaseName}.png`)
  }, 'image/png')
})

function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return

  currentBaseName = file.name.replace(/\.[^.]+$/, '')
  fileChipList.innerHTML = `<li><span>📄 ${escapeHtml(file.name)}</span><span>${(file.size / 1024).toFixed(1)} KB</span></li>`

  const objectUrl = URL.createObjectURL(file)

  const img = new Image()
  img.onload = () => {
    if (pristine && pristine.objectUrl) URL.revokeObjectURL(pristine.objectUrl)

    const width = img.naturalWidth
    const height = img.naturalHeight
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const { data } = ctx.getImageData(0, 0, width, height)

    pristine = { img, width, height, data, objectUrl }
    lastCropCanvas = null

    const autoRgb = detectBackgroundColor(data, width, height)
    const autoHex = rgbToHex(autoRgb)
    autoBgSwatch.style.background = autoHex
    bgColorInput.value = autoHex
    bgColorInput.disabled = false
    toleranceInput.disabled = false
    cropBtn.disabled = false

    warningArea.innerHTML = ''
    recompute()
  }
  img.onerror = () => {
    warningArea.innerHTML = '<div class="alert alert-danger">Could not load this file as an image.</div>'
  }
  img.src = objectUrl
}

// Averages a small (up to 5x5) patch at each corner, rather than a single
// pixel, so JPEG noise/compression artifacts don't skew the detected
// background color.
function detectBackgroundColor(data, width, height) {
  const patches = [
    cornerPatch(data, width, height, 0, 0),
    cornerPatch(data, width, height, width - 1, 0),
    cornerPatch(data, width, height, 0, height - 1),
    cornerPatch(data, width, height, width - 1, height - 1),
  ]
  const sum = [0, 0, 0]
  let n = 0
  for (const patch of patches) {
    for (const c of patch) {
      sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]
      n++
    }
  }
  return [sum[0] / n, sum[1] / n, sum[2] / n]
}

function cornerPatch(data, width, height, cx, cy, radius = 2) {
  const dx = cx === 0 ? 1 : -1
  const dy = cy === 0 ? 1 : -1
  const pixels = []
  for (let sy = 0; sy <= radius; sy++) {
    for (let sx = 0; sx <= radius; sx++) {
      const x = clamp(cx + dx * sx, 0, width - 1)
      const y = clamp(cy + dy * sy, 0, height - 1)
      const idx = (y * width + x) * 4
      pixels.push([data[idx], data[idx + 1], data[idx + 2]])
    }
  }
  return pixels
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '')
  const num = parseInt(clean, 16)
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

function rgbToHex([r, g, b]) {
  const toHex = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

// Euclidean RGB distance against the reference background color, scaled by
// the tolerance slider. Alpha is ignored for the comparison, except that a
// near-transparent pixel is always treated as background.
function isBackgroundPixel(data, idx, bg, maxDist) {
  if (data[idx + 3] < 16) return true
  const dr = data[idx] - bg[0]
  const dg = data[idx + 1] - bg[1]
  const db = data[idx + 2] - bg[2]
  return Math.sqrt(dr * dr + dg * dg + db * db) <= maxDist
}

function rowIsBackground(data, width, y, bg, maxDist) {
  for (let x = 0; x < width; x++) {
    if (!isBackgroundPixel(data, (y * width + x) * 4, bg, maxDist)) return false
  }
  return true
}

function colIsBackground(data, width, height, x, bg, maxDist) {
  for (let y = 0; y < height; y++) {
    if (!isBackgroundPixel(data, (y * width + x) * 4, bg, maxDist)) return false
  }
  return true
}

// Scans inward from each of the 4 edges. Returns the first non-background
// row/column index from each side (top/left default to the "past the end"
// sentinel, bottom/right to the "before the start" sentinel, when an entire
// scan direction never finds a non-background row/column).
function computeCropBox(data, width, height, bg, maxDist) {
  let top = 0
  while (top < height && rowIsBackground(data, width, top, bg, maxDist)) top++

  let bottom = height - 1
  while (bottom >= 0 && rowIsBackground(data, width, bottom, bg, maxDist)) bottom--

  let left = 0
  while (left < width && colIsBackground(data, width, height, left, bg, maxDist)) left++

  let right = width - 1
  while (right >= 0 && colIsBackground(data, width, height, right, bg, maxDist)) right--

  return { top, bottom, left, right }
}

function recompute() {
  if (!pristine) return
  const { img, width, height, data } = pristine

  const bg = hexToRgb(bgColorInput.value)
  const tolerance = Number(toleranceInput.value)
  const maxDist = (tolerance / 100) * 255 * Math.sqrt(3)

  const box = computeCropBox(data, width, height, bg, maxDist)
  const cropWidth = box.right - box.left + 1
  const cropHeight = box.bottom - box.top + 1

  if (cropWidth <= 0 || cropHeight <= 0) {
    warningArea.innerHTML =
      '<div class="alert alert-warning">Nothing left to crop at this tolerance — try lowering it.</div>'
    return // leave the previously displayed image untouched
  }

  const noMarginFound = box.top === 0 && box.left === 0 && box.bottom === height - 1 && box.right === width - 1

  if (noMarginFound) {
    warningArea.innerHTML =
      '<div class="alert alert-info">No uniform margin detected — image left uncropped.</div>'
  } else {
    warningArea.innerHTML = ''
  }

  const cropCanvas = document.createElement('canvas')
  cropCanvas.width = cropWidth
  cropCanvas.height = cropHeight
  const cropCtx = cropCanvas.getContext('2d')
  cropCtx.drawImage(img, box.left, box.top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)

  lastCropCanvas = cropCanvas
  downloadBtn.disabled = false

  renderCompare(width, height, cropCanvas)
}

function renderCompare(origWidth, origHeight, cropCanvas) {
  resultArea.innerHTML = `
    <div class="image-compare">
      <figure>
        <figcaption>Original</figcaption>
        <img id="original-preview" alt="Original image" />
        <p class="dim-caption">${origWidth} × ${origHeight} px</p>
      </figure>
      <figure>
        <figcaption>Cropped preview</figcaption>
        <div id="cropped-slot"></div>
        <p class="dim-caption">${cropCanvas.width} × ${cropCanvas.height} px</p>
      </figure>
    </div>
  `

  document.getElementById('original-preview').src = pristine.img.src
  document.getElementById('cropped-slot').appendChild(cropCanvas)
}

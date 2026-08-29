import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { downloadBlob } from '../shared/download.js'
import { escapeHtml } from '../shared/dom.js'
import JSZip from 'jszip'

initChrome('auto-crop')

const dropzone = document.getElementById('dropzone')
const fileInput = document.getElementById('file-input')
const fileChipList = document.getElementById('file-chip-list')
const clearAllBtn = document.getElementById('clear-all-btn')

const customBgCheckbox = document.getElementById('custom-bg-checkbox')
const customBgField = document.getElementById('custom-bg-field')
const autoBgHint = document.getElementById('auto-bg-hint')
const bgColorInput = document.getElementById('bg-color')
const toleranceInput = document.getElementById('tolerance')
const toleranceValue = document.getElementById('tolerance-value')
const paddingInput = document.getElementById('padding')
const cropAllBtn = document.getElementById('crop-all-btn')
const downloadZipBtn = document.getElementById('download-zip-btn')

const globalAlerts = document.getElementById('global-alerts')
const resultsArea = document.getElementById('results-area')

// One entry per loaded image: { id, file, name, img, width, height, data,
// objectUrl, cropCanvas, warning }. `data` is the pristine ImageData.data of
// the full-resolution image — never mutated; every recompute starts from it.
let entries = []
let nextId = 1
let debounceTimer = null

initDropzone(dropzone, fileInput, (files) => handleFiles(files))

async function handleFiles(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'))
  if (files.length === 0) return

  const results = await Promise.allSettled(files.map(decodeFile))
  const failures = []
  for (const r of results) {
    if (r.status === 'fulfilled') entries.push(r.value)
    else failures.push(r.reason?.message || String(r.reason))
  }

  globalAlerts.innerHTML = failures.length
    ? `<div class="alert alert-danger">${failures.map(escapeHtml).join('<br>')}</div>`
    : ''

  renderFileChipList()
  recomputeAll()
}

function decodeFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const width = img.naturalWidth
      const height = img.naturalHeight
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const { data } = ctx.getImageData(0, 0, width, height)
      resolve({
        id: nextId++,
        file,
        name: file.name,
        img,
        width,
        height,
        data,
        objectUrl,
        cropCanvas: null,
        warning: null,
      })
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error(`Could not load ${file.name} as an image.`))
    }
    img.src = objectUrl
  })
}

function renderFileChipList() {
  clearAllBtn.hidden = entries.length === 0
  cropAllBtn.disabled = entries.length === 0

  fileChipList.innerHTML = entries
    .map(
      (e) => `
      <li data-id="${e.id}">
        <span>📄 ${escapeHtml(e.name)}</span>
        <span>${(e.file.size / 1024).toFixed(1)} KB
          <button type="button" class="ac-remove-btn" data-id="${e.id}" title="Remove">✕</button>
        </span>
      </li>`
    )
    .join('')

  fileChipList.querySelectorAll('.ac-remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => removeEntry(Number(btn.dataset.id)))
  })
}

function removeEntry(id) {
  const entry = entries.find((e) => e.id === id)
  if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl)
  entries = entries.filter((e) => e.id !== id)
  renderFileChipList()
  renderResults()
}

clearAllBtn.addEventListener('click', () => {
  entries.forEach((e) => e.objectUrl && URL.revokeObjectURL(e.objectUrl))
  entries = []
  renderFileChipList()
  renderResults()
})

// ------------------------------------------------------------------
// Background detection (shared across all files unless a custom color is set)
// ------------------------------------------------------------------
function backgroundColorFor(entry) {
  if (customBgCheckbox.checked) return hexToRgb(bgColorInput.value)
  return detectBackgroundColor(entry.data, entry.width, entry.height)
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
// row/column index from each side.
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

// ------------------------------------------------------------------
// Recompute (shared tolerance/padding/background settings applied per file)
// ------------------------------------------------------------------
function recomputeEntry(entry) {
  const { img, width, height, data } = entry
  const bg = backgroundColorFor(entry)
  const tolerance = Number(toleranceInput.value)
  const maxDist = (tolerance / 100) * 255 * Math.sqrt(3)
  const padding = Math.max(0, parseInt(paddingInput.value, 10) || 0)

  const box = computeCropBox(data, width, height, bg, maxDist)
  const rawCropWidth = box.right - box.left + 1
  const rawCropHeight = box.bottom - box.top + 1

  if (rawCropWidth <= 0 || rawCropHeight <= 0) {
    entry.cropCanvas = null
    entry.warning = 'Nothing left to crop at this tolerance — try lowering it.'
    return
  }

  const noMarginFound =
    box.top === 0 && box.left === 0 && box.bottom === height - 1 && box.right === width - 1
  entry.warning = noMarginFound ? 'No uniform margin detected — image left uncropped.' : null

  const left = clamp(box.left - padding, 0, width - 1)
  const top = clamp(box.top - padding, 0, height - 1)
  const right = clamp(box.right + padding, 0, width - 1)
  const bottom = clamp(box.bottom + padding, 0, height - 1)
  const cropWidth = right - left + 1
  const cropHeight = bottom - top + 1

  const cropCanvas = document.createElement('canvas')
  cropCanvas.width = cropWidth
  cropCanvas.height = cropHeight
  const cropCtx = cropCanvas.getContext('2d')
  cropCtx.drawImage(img, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
  entry.cropCanvas = cropCanvas
}

function recomputeAll() {
  entries.forEach(recomputeEntry)
  renderResults()
}

function scheduleRecompute() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(recomputeAll, 200)
}

// ------------------------------------------------------------------
// Results UI
// ------------------------------------------------------------------
function renderResults() {
  if (entries.length === 0) {
    resultsArea.innerHTML = '<div class="empty-state">Upload one or more images to auto-crop their margins.</div>'
    downloadZipBtn.disabled = true
    return
  }

  resultsArea.innerHTML = entries
    .map(
      (e) => `
      <div class="panel ac-result-card" data-entry-id="${e.id}">
        <h3>${escapeHtml(e.name)}</h3>
        ${e.warning ? `<div class="alert alert-warning">${escapeHtml(e.warning)}</div>` : ''}
        <div class="image-compare">
          <figure>
            <figcaption>Original</figcaption>
            <img data-role="original" alt="Original: ${escapeHtml(e.name)}" />
            <p class="dim-caption">${e.width} × ${e.height} px</p>
          </figure>
          <figure>
            <figcaption>Cropped preview</figcaption>
            <div data-role="cropped-slot"></div>
            <p class="dim-caption" data-role="cropped-dims"></p>
          </figure>
        </div>
        <div class="btn-row" style="margin-top: 0.75rem;">
          <button class="btn" data-action="download" ${e.cropCanvas ? '' : 'disabled'}>⬇ Download PNG</button>
          <button class="btn btn-danger" data-action="remove" style="flex: 0 0 auto;">Remove</button>
        </div>
      </div>`
    )
    .join('')

  entries.forEach((e) => {
    const card = resultsArea.querySelector(`[data-entry-id="${e.id}"]`)
    if (!card) return
    card.querySelector('[data-role="original"]').src = e.img.src
    if (e.cropCanvas) {
      card.querySelector('[data-role="cropped-slot"]').appendChild(e.cropCanvas)
      card.querySelector('[data-role="cropped-dims"]').textContent =
        `${e.cropCanvas.width} × ${e.cropCanvas.height} px`
    }
    const dlBtn = card.querySelector('[data-action="download"]')
    if (dlBtn) {
      dlBtn.addEventListener('click', () => {
        e.cropCanvas.toBlob((blob) => {
          if (blob) downloadBlob(blob, `cropped_${baseName(e.name)}.png`)
        }, 'image/png')
      })
    }
    card.querySelector('[data-action="remove"]').addEventListener('click', () => removeEntry(e.id))
  })

  downloadZipBtn.disabled = !entries.some((e) => e.cropCanvas)
}

function baseName(name) {
  return name.replace(/\.[^.]+$/, '')
}

downloadZipBtn.addEventListener('click', async () => {
  const withCrops = entries.filter((e) => e.cropCanvas)
  if (withCrops.length === 0) return

  const zip = new JSZip()
  for (const e of withCrops) {
    const blob = await new Promise((resolve) => e.cropCanvas.toBlob(resolve, 'image/png'))
    if (blob) zip.file(`cropped_${baseName(e.name)}.png`, blob)
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(zipBlob, 'cropped_images.zip')
})

// ------------------------------------------------------------------
// Shared controls
// ------------------------------------------------------------------
customBgCheckbox.addEventListener('change', () => {
  customBgField.hidden = !customBgCheckbox.checked
  autoBgHint.hidden = customBgCheckbox.checked
  scheduleRecompute()
})
bgColorInput.addEventListener('input', scheduleRecompute)
toleranceInput.addEventListener('input', () => {
  toleranceValue.textContent = toleranceInput.value
  scheduleRecompute()
})
paddingInput.addEventListener('input', scheduleRecompute)
cropAllBtn.addEventListener('click', recomputeAll)

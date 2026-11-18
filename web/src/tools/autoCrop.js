import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { downloadBlob } from '../shared/download.js'
import { escapeHtml } from '../shared/dom.js'
import JSZip from 'jszip'

initChrome('auto-crop')

// Browsers refuse canvases much larger than this per side.
const MAX_DIM = 16384
// Encoding a huge output just to show its file size takes seconds and blocks
// later encodes, so above this size the size is only measured on download.
const AUTO_ENCODE_MAX_PX = 16e6

const dropzone = document.getElementById('dropzone')
const fileInput = document.getElementById('file-input')
const fileChipList = document.getElementById('file-chip-list')
const clearAllBtn = document.getElementById('clear-all-btn')

const cropEnabled = document.getElementById('crop-enabled')
const cropOptions = document.getElementById('crop-options')
const customBgCheckbox = document.getElementById('custom-bg-checkbox')
const customBgField = document.getElementById('custom-bg-field')
const autoBgHint = document.getElementById('auto-bg-hint')
const bgColorInput = document.getElementById('bg-color')
const toleranceInput = document.getElementById('tolerance')
const toleranceValue = document.getElementById('tolerance-value')
const paddingInput = document.getElementById('padding')

const modePercentBtn = document.getElementById('mode-percent')
const modePixelsBtn = document.getElementById('mode-pixels')
const modeFitBtn = document.getElementById('mode-fit')
const fitRow = document.getElementById('fit-row')
const fitMax = document.getElementById('fit-max')
const fitPresets = document.getElementById('fit-presets')
const sizeRow = document.getElementById('size-row')
const batchSummary = document.getElementById('batch-summary')
const sizeW = document.getElementById('size-w')
const sizeH = document.getElementById('size-h')
const sizeWLabel = document.getElementById('size-w-label')
const sizeHLabel = document.getElementById('size-h-label')
const lockBtn = document.getElementById('lock-aspect')
const percentPresets = document.getElementById('percent-presets')
const sizeHint = document.getElementById('size-hint')

const outFormat = document.getElementById('out-format')
const qualityField = document.getElementById('quality-field')
const outQuality = document.getElementById('out-quality')
const outQualityValue = document.getElementById('out-quality-value')
const jpegHint = document.getElementById('jpeg-hint')
const downloadZipBtn = document.getElementById('download-zip-btn')

const globalAlerts = document.getElementById('global-alerts')
const resultsArea = document.getElementById('results-area')

// One entry per loaded image:
//   { id, file, name, img, width, height,
//     data       – full-res RGBA pixels, read lazily (only needed for cropping)
//     srcCanvas  – result after cropping (or the whole image if cropping is off)
//     cropped    – whether margins were actually trimmed
//     outCanvas  – srcCanvas resized to the target size
//     outBlob    – outCanvas encoded in the chosen format (async)
//     gen        – bumped whenever outCanvas/format changes, to drop stale encodes
//     warning }
let entries = []
let nextId = 1

let mode = 'percent'   // 'percent' | 'pixels' | 'fit'
let lock = true
let driver = 'w'       // which size field the user last typed in

let cropTimer = null
let resizeTimer = null

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

  const hadPixelTarget = mode === 'pixels' && (sizeW.value || sizeH.value)
  renderFileChipList()
  recropAll()
  if (mode === 'pixels' && !hadPixelTarget) prefillPixelsFromFirst()
}

function decodeFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({
        id: nextId++,
        file,
        name: file.name,
        img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        data: null,
        objectUrl,
        srcCanvas: null,
        cropped: false,
        outCanvas: null,
        outBlob: null,
        gen: 0,
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

function getPixelData(entry) {
  if (!entry.data) {
    const canvas = makeCanvas(entry.width, entry.height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(entry.img, 0, 0)
    entry.data = ctx.getImageData(0, 0, entry.width, entry.height).data
  }
  return entry.data
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatLabel(mime) {
  const sub = (mime || '').split('/')[1] || '?'
  return sub.replace('jpeg', 'jpg').replace('svg+xml', 'svg').toUpperCase()
}

function renderFileChipList() {
  clearAllBtn.hidden = entries.length === 0

  fileChipList.innerHTML = entries
    .map(
      (e) => `
      <li data-id="${e.id}">
        <span>${escapeHtml(e.name)}</span>
        <span>${formatBytes(e.file.size)}
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
  updateSizeHint()
  renderResults()
}

clearAllBtn.addEventListener('click', () => {
  entries.forEach((e) => e.objectUrl && URL.revokeObjectURL(e.objectUrl))
  entries = []
  renderFileChipList()
  updateSizeHint()
  renderResults()
})

// ------------------------------------------------------------------
// Background detection
// ------------------------------------------------------------------
function backgroundColorFor(entry, data) {
  if (customBgCheckbox.checked) return hexToRgb(bgColorInput.value)
  return detectBackgroundColor(data, entry.width, entry.height)
}

// Averages a small (up to 3x3) patch at each corner, rather than a single
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
  const num = parseInt(hex.replace('#', ''), 16)
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

// Euclidean RGB distance against the reference background color, scaled by
// the tolerance slider. A near-transparent pixel is always background.
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
// Stage 1: crop
// ------------------------------------------------------------------
function cropEntry(entry) {
  const { img, width, height } = entry
  entry.warning = null
  entry.cropped = false

  if (!cropEnabled.checked) {
    const c = makeCanvas(width, height)
    c.getContext('2d').drawImage(img, 0, 0)
    entry.srcCanvas = c
    return
  }

  const data = getPixelData(entry)
  const bg = backgroundColorFor(entry, data)
  const maxDist = (Number(toleranceInput.value) / 100) * 255 * Math.sqrt(3)
  const padding = Math.max(0, parseInt(paddingInput.value, 10) || 0)

  const box = computeCropBox(data, width, height, bg, maxDist)
  if (box.right < box.left || box.bottom < box.top) {
    entry.srcCanvas = null
    entry.warning = 'Nothing left to crop at this tolerance — try lowering it.'
    return
  }

  const noMarginFound =
    box.top === 0 && box.left === 0 && box.bottom === height - 1 && box.right === width - 1
  if (noMarginFound) entry.warning = 'No uniform margin detected — image left uncropped.'
  entry.cropped = !noMarginFound

  const left = clamp(box.left - padding, 0, width - 1)
  const top = clamp(box.top - padding, 0, height - 1)
  const right = clamp(box.right + padding, 0, width - 1)
  const bottom = clamp(box.bottom + padding, 0, height - 1)
  const w = right - left + 1
  const h = bottom - top + 1

  const c = makeCanvas(w, h)
  c.getContext('2d').drawImage(img, left, top, w, h, 0, 0, w, h)
  entry.srcCanvas = c
}

function recropAll() {
  entries.forEach(cropEntry)
  syncLinkedField()
  updateSizeHint()
  resizeAll()
}

function scheduleRecrop() {
  clearTimeout(cropTimer)
  cropTimer = setTimeout(recropAll, 200)
}

// ------------------------------------------------------------------
// Stage 2: resize
// ------------------------------------------------------------------
function isPos(v) { return Number.isFinite(v) && v > 0 }

function targetSize(srcW, srcH) {
  const w = parseFloat(sizeW.value)
  const h = parseFloat(sizeH.value)
  let tw = srcW
  let th = srcH

  if (mode === 'fit') {
    // Only ever shrinks: images already within the limit are left alone, so
    // a batch of very differently sized images can share one setting.
    const max = parseFloat(fitMax.value)
    const long = Math.max(srcW, srcH)
    if (isPos(max) && long > max) {
      tw = (srcW * max) / long
      th = (srcH * max) / long
    }
  } else if (mode === 'percent') {
    let px = isPos(w) ? w : 100
    let py = isPos(h) ? h : 100
    if (lock) { const p = driver === 'h' ? py : px; px = p; py = p }
    tw = (srcW * px) / 100
    th = (srcH * py) / 100
  } else if (lock) {
    if (driver === 'h' && isPos(h)) { th = h; tw = (srcW * h) / srcH }
    else if (isPos(w)) { tw = w; th = (srcH * w) / srcW }
    else if (isPos(h)) { th = h; tw = (srcW * h) / srcH }
  } else {
    if (isPos(w)) tw = w
    if (isPos(h)) th = h
  }

  return {
    w: clamp(Math.round(tw), 1, MAX_DIM),
    h: clamp(Math.round(th), 1, MAX_DIM),
    clamped: tw > MAX_DIM || th > MAX_DIM,
  }
}

// Step down by halves before the final draw: a single huge downscale with
// drawImage samples too few source pixels and comes out aliased.
function resizeCanvas(src, w, h) {
  let cur = src
  let cw = src.width
  let ch = src.height
  while (cw / 2 >= w && ch / 2 >= h) {
    cw = Math.round(cw / 2)
    ch = Math.round(ch / 2)
    const step = makeCanvas(cw, ch)
    const ctx = step.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(cur, 0, 0, cw, ch)
    cur = step
  }
  const out = makeCanvas(w, h)
  const ctx = out.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(cur, 0, 0, w, h)
  return out
}

function resizeEntry(entry) {
  entry.gen++
  entry.outBlob = null
  entry.clamped = false
  if (!entry.srcCanvas) { entry.outCanvas = null; return }
  const src = entry.srcCanvas
  const t = targetSize(src.width, src.height)
  entry.outCanvas = t.w === src.width && t.h === src.height ? src : resizeCanvas(src, t.w, t.h)
  entry.clamped = t.clamped
}

function resizeAll() {
  entries.forEach(resizeEntry)
  renderResults()
}

function scheduleResize() {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(resizeAll, 150)
}

// ------------------------------------------------------------------
// Stage 3: encode
// ------------------------------------------------------------------
function encodeCanvas(canvas) {
  const type = outFormat.value
  const quality = Number(outQuality.value) / 100
  let source = canvas
  if (type === 'image/jpeg') {
    source = makeCanvas(canvas.width, canvas.height)
    const ctx = source.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, source.width, source.height)
    ctx.drawImage(canvas, 0, 0)
  }
  return new Promise((resolve) => source.toBlob(resolve, type, quality))
}

async function encodeEntry(entry) {
  if (!entry.outCanvas) return null
  if (entry.outBlob) return entry.outBlob
  const gen = entry.gen
  const blob = await encodeCanvas(entry.outCanvas)
  if (entry.gen !== gen) return null
  entry.outBlob = blob
  return blob
}

function reencodeAll() {
  entries.forEach((e) => { e.gen++; e.outBlob = null })
  renderResults()
}

function outputExt() {
  return { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[outFormat.value]
}

function outputName(entry) {
  const base = entry.name.replace(/\.[^.]+$/, '')
  const crop = entry.cropped ? '_cropped' : ''
  return `${base}${crop}_${entry.outCanvas.width}x${entry.outCanvas.height}.${outputExt()}`
}

// ------------------------------------------------------------------
// Results UI
// ------------------------------------------------------------------
function renderResults() {
  if (entries.length === 0) {
    resultsArea.innerHTML = '<div class="empty-state">Upload one or more images to crop or resize them.</div>'
    downloadZipBtn.disabled = true
    updateSummary()
    return
  }

  const fmt = formatLabel(outFormat.value)
  resultsArea.innerHTML = entries
    .map((e) => {
      const out = e.outCanvas
      const src = e.srcCanvas
      const steps = []
      if (e.cropped && src) steps.push(`trimmed to ${src.width} × ${src.height} px`)
      if (out && src && (out.width !== src.width || out.height !== src.height)) steps.push(`resized to ${out.width} × ${out.height} px`)
      return `
      <div class="panel ac-result-card" data-entry-id="${e.id}">
        <h3>${escapeHtml(e.name)}</h3>
        ${e.warning ? `<div class="alert alert-warning">${escapeHtml(e.warning)}</div>` : ''}
        ${e.clamped ? `<div class="alert alert-warning">Target size capped at ${MAX_DIM} px per side (browser canvas limit).</div>` : ''}
        <div class="image-compare">
          <figure>
            <figcaption>Original</figcaption>
            <img data-role="original" alt="Original: ${escapeHtml(e.name)}" />
          </figure>
          <figure>
            <figcaption>Output</figcaption>
            <div data-role="out-slot"></div>
            <p class="dim-caption">${steps.length ? escapeHtml(steps.join(', then ')) : 'Unchanged size'}</p>
          </figure>
        </div>
        <dl class="ac-stats">
          <dt>Current</dt>
          <dd>${e.width} × ${e.height} px</dd>
          <dd class="ac-fmt">${formatBytes(e.file.size)} ${formatLabel(e.file.type)}</dd>
          <dt>New</dt>
          <dd>${out ? `${out.width} × ${out.height} px` : '—'}</dd>
          <dd class="ac-fmt" data-role="new-size">${out ? `… ${fmt}` : '—'}</dd>
        </dl>
        <div class="btn-row" style="margin-top: 0.75rem;">
          <button class="btn" data-action="download" ${out ? '' : 'disabled'}>Download ${fmt}</button>
          <button class="btn btn-danger" data-action="remove" style="flex: 0 0 auto;">Remove</button>
        </div>
      </div>`
    })
    .join('')

  entries.forEach((e) => {
    const card = resultsArea.querySelector(`[data-entry-id="${e.id}"]`)
    if (!card) return
    card.querySelector('[data-role="original"]').src = e.img.src
    if (e.outCanvas) card.querySelector('[data-role="out-slot"]').appendChild(e.outCanvas)

    card.querySelector('[data-action="download"]').addEventListener('click', async () => {
      const blob = await encodeEntry(e)
      if (!blob) return
      showEncodedSize(e, blob)
      downloadBlob(blob, outputName(e))
    })
    card.querySelector('[data-action="remove"]').addEventListener('click', () => removeEntry(e.id))

    if (!e.outCanvas) return
    if (e.outCanvas.width * e.outCanvas.height > AUTO_ENCODE_MAX_PX) {
      card.querySelector('[data-role="new-size"]').textContent = `${fmt}, size on download`
      return
    }
    encodeEntry(e).then((blob) => blob && showEncodedSize(e, blob))
  })

  downloadZipBtn.disabled = !entries.some((e) => e.outCanvas)
  updateSummary()
}

function showEncodedSize(entry, blob) {
  const cell = resultsArea.querySelector(`[data-entry-id="${entry.id}"] [data-role="new-size"]`)
  if (cell) cell.textContent = `${formatBytes(blob.size)} ${formatLabel(outFormat.value)}`
  updateSummary()
}

function updateSummary() {
  const withOutput = entries.filter((e) => e.outCanvas)
  if (entries.length < 2 || withOutput.length === 0) {
    batchSummary.hidden = true
    return
  }
  batchSummary.hidden = false
  const before = withOutput.reduce((s, e) => s + e.file.size, 0)
  const pending = withOutput.filter((e) => !e.outBlob)
  const label = `<strong>${withOutput.length} images</strong>`
  if (pending.length) {
    const large = pending.some((e) => e.outCanvas.width * e.outCanvas.height > AUTO_ENCODE_MAX_PX)
    batchSummary.innerHTML = `${label}<span class="ac-fmt">${formatBytes(before)} → ${large ? 'some sizes measured on download' : 'measuring…'}</span>`
    return
  }
  const after = withOutput.reduce((s, e) => s + e.outBlob.size, 0)
  const pct = before > 0 ? Math.round((1 - after / before) * 100) : 0
  const change = pct >= 0 ? `${pct}% smaller` : `${-pct}% larger`
  batchSummary.innerHTML = `${label}<span>${formatBytes(before)} → <strong>${formatBytes(after)}</strong> <span class="ac-fmt">(${change})</span></span>`
}

downloadZipBtn.addEventListener('click', async () => {
  const ready = entries.filter((e) => e.outCanvas)
  if (ready.length === 0) return

  downloadZipBtn.disabled = true
  const label = downloadZipBtn.textContent
  downloadZipBtn.textContent = 'Zipping…'
  try {
    const zip = new JSZip()
    for (const e of ready) {
      const blob = await encodeEntry(e)
      if (!blob) continue
      zip.file(outputName(e), blob)
      showEncodedSize(e, blob)
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    downloadBlob(zipBlob, 'images.zip')
  } finally {
    downloadZipBtn.textContent = label
    downloadZipBtn.disabled = false
  }
})

// ------------------------------------------------------------------
// Resize controls
// ------------------------------------------------------------------
function refSize() {
  const e = entries.find((x) => x.srcCanvas)
  return e ? { w: e.srcCanvas.width, h: e.srcCanvas.height } : null
}

// With the aspect lock on, mirror the edited field into the other one so the
// panel reads like the Windows dialog. In pixel mode this uses the first
// image's ratio; each image still keeps its own ratio when resized.
function syncLinkedField() {
  if (!lock || mode === 'fit') return
  if (mode === 'percent') {
    if (driver === 'w') sizeH.value = sizeW.value
    else sizeW.value = sizeH.value
    return
  }
  const ref = refSize()
  if (!ref) return
  const t = targetSize(ref.w, ref.h)
  if (driver === 'w' && sizeW.value) sizeH.value = t.h
  else if (driver === 'h' && sizeH.value) sizeW.value = t.w
}

function prefillPixelsFromFirst() {
  const ref = refSize()
  if (!ref) return
  sizeW.value = ref.w
  sizeH.value = ref.h
  driver = 'w'
}

function updateSizeHint() {
  if (mode === 'fit') {
    sizeHint.textContent = 'Larger images are scaled down to fit; smaller ones are left as they are. For a full-width figure in Word, about 2000 px prints sharp, 1000 px is enough on screen.'
  } else if (mode === 'percent') {
    sizeHint.textContent = 'Applied after cropping. 100% keeps the original size.'
  } else if (lock) {
    sizeHint.textContent = entries.length > 1
      ? 'Each image keeps its own aspect ratio; the linked field shows the first image.'
      : 'Aspect ratio is kept. Type a width or a height.'
  } else {
    sizeHint.textContent = 'Aspect ratio unlocked: every image is stretched to exactly this size.'
  }
}

function setMode(next) {
  if (next === mode) return
  const ref = refSize()
  const t = ref ? targetSize(ref.w, ref.h) : null
  mode = next
  driver = 'w'

  if (mode === 'pixels') {
    sizeW.value = t ? t.w : ''
    sizeH.value = t ? t.h : ''
  } else if (mode === 'percent') {
    sizeW.value = t ? +((t.w / ref.w) * 100).toFixed(2) : 100
    sizeH.value = t ? +((t.h / ref.h) * 100).toFixed(2) : 100
  }

  const unit = mode === 'percent' ? '%' : 'px'
  sizeWLabel.textContent = `Width (${unit})`
  sizeHLabel.textContent = `Height (${unit})`
  for (const [btn, m] of [[modePercentBtn, 'percent'], [modePixelsBtn, 'pixels'], [modeFitBtn, 'fit']]) {
    btn.classList.toggle('is-active', mode === m)
    btn.setAttribute('aria-pressed', String(mode === m))
  }
  sizeRow.hidden = mode === 'fit'
  fitRow.hidden = mode !== 'fit'
  percentPresets.hidden = mode !== 'percent'
  updateSizeHint()
  resizeAll()
}

modePercentBtn.addEventListener('click', () => setMode('percent'))
modePixelsBtn.addEventListener('click', () => setMode('pixels'))
modeFitBtn.addEventListener('click', () => setMode('fit'))

fitMax.addEventListener('input', scheduleResize)
fitPresets.querySelectorAll('[data-fit]').forEach((btn) => {
  btn.addEventListener('click', () => {
    fitMax.value = btn.dataset.fit
    resizeAll()
  })
})

sizeW.addEventListener('input', () => { driver = 'w'; syncLinkedField(); scheduleResize() })
sizeH.addEventListener('input', () => { driver = 'h'; syncLinkedField(); scheduleResize() })

lockBtn.addEventListener('click', () => {
  lock = !lock
  lockBtn.classList.toggle('is-active', lock)
  lockBtn.setAttribute('aria-pressed', String(lock))
  lockBtn.title = lock ? 'Keep aspect ratio' : 'Aspect ratio unlocked'
  syncLinkedField()
  updateSizeHint()
  resizeAll()
})

percentPresets.querySelectorAll('[data-pct]').forEach((btn) => {
  btn.addEventListener('click', () => {
    sizeW.value = btn.dataset.pct
    sizeH.value = btn.dataset.pct
    driver = 'w'
    resizeAll()
  })
})

// ------------------------------------------------------------------
// Crop + output controls
// ------------------------------------------------------------------
cropEnabled.addEventListener('change', () => {
  cropOptions.hidden = !cropEnabled.checked
  recropAll()
})
customBgCheckbox.addEventListener('change', () => {
  customBgField.hidden = !customBgCheckbox.checked
  autoBgHint.hidden = customBgCheckbox.checked
  scheduleRecrop()
})
bgColorInput.addEventListener('input', scheduleRecrop)
toleranceInput.addEventListener('input', () => {
  toleranceValue.textContent = toleranceInput.value
  scheduleRecrop()
})
paddingInput.addEventListener('input', scheduleRecrop)

outFormat.addEventListener('change', () => {
  const lossy = outFormat.value !== 'image/png'
  qualityField.hidden = !lossy
  jpegHint.hidden = outFormat.value !== 'image/jpeg'
  reencodeAll()
})
let qualityTimer = null
outQuality.addEventListener('input', () => {
  outQualityValue.textContent = `${outQuality.value}%`
  clearTimeout(qualityTimer)
  qualityTimer = setTimeout(reencodeAll, 200)
})

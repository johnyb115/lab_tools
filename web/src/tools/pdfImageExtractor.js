import * as pdfjsLib from 'pdfjs-dist'
import JSZip from 'jszip'
import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { downloadBlob, timestampSlug } from '../shared/download.js'
import { escapeHtml } from '../shared/dom.js'

initChrome('pdf-image-extractor')

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

// Below this size an embedded XObject is almost always a decorative bullet/rule,
// not a figure worth surfacing.
const MIN_DIM = 32

// ------------------------------------------------------------------
// DOM refs
// ------------------------------------------------------------------
const dropzone = document.getElementById('pie-dropzone')
const fileInput = document.getElementById('pie-file-input')
const statusEl = document.getElementById('pie-status')
const downloadAllBtn = document.getElementById('pie-download-all')
const resultsEl = document.getElementById('pie-results')

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------
let images = [] // { page, name, width, height, blob, url }

initDropzone(dropzone, fileInput, (files) => {
  const file = files[0]
  if (!file) return
  loadPdf(file)
})

function revokeAll() {
  images.forEach((img) => URL.revokeObjectURL(img.url))
}

async function loadPdf(file) {
  revokeAll()
  images = []
  downloadAllBtn.disabled = true
  resultsEl.innerHTML = ''
  statusEl.innerHTML = `<div class="alert alert-info"><span class="spinner"></span> Extracting images from ${escapeHtml(file.name)}…</div>`

  try {
    const buf = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum)
      const opList = await page.getOperatorList()

      const seen = new Set()
      let countOnPage = 0
      for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i]
        if (fn !== pdfjsLib.OPS.paintImageXObject && fn !== pdfjsLib.OPS.paintImageXObjectRepeat) continue

        const objId = opList.argsArray[i][0]
        if (seen.has(objId)) continue
        seen.add(objId)

        try {
          const imgData = await getObj(page, objId)
          const canvas = imageObjToCanvas(imgData)
          if (!canvas) continue
          if (canvas.width < MIN_DIM || canvas.height < MIN_DIM) continue

          const blob = await canvasToPngBlob(canvas)
          countOnPage += 1
          images.push({
            page: pageNum,
            name: `page${pageNum}_image${countOnPage}.png`,
            width: canvas.width,
            height: canvas.height,
            blob,
            url: URL.createObjectURL(blob),
          })
        } catch {
          // Object never resolved (e.g. an inline mask dependency) — skip it.
        }
      }
      page.cleanup()
    }

    if (images.length === 0) {
      statusEl.innerHTML = `<div class="alert alert-warning">No embedded raster images (≥ ${MIN_DIM}px) were found in ${escapeHtml(file.name)}.</div>`
    } else {
      statusEl.innerHTML = `<div class="alert alert-success">Extracted ${images.length} image${images.length === 1 ? '' : 's'} from ${escapeHtml(file.name)} (${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}).</div>`
      downloadAllBtn.disabled = false
    }
    renderResults()
  } catch (err) {
    statusEl.innerHTML = `<div class="alert alert-danger">Could not read ${escapeHtml(file.name)}: ${escapeHtml(err.message || String(err))}</div>`
  }
}

// page.objs.get() throws if the object isn't resolved yet; the callback form
// always waits for resolution, so route through a promise instead of relying
// on getOperatorList() having already resolved every dependent image.
function getObj(page, objId) {
  return new Promise((resolve) => page.objs.get(objId, resolve))
}

// Decoded image objects come back in one of a few shapes depending on the
// codec pdf.js used internally: a ready-made ImageBitmap, or a raw
// {data, kind} buffer that needs unpacking per pdf.js's own ImageKind enum.
function imageObjToCanvas(imgData) {
  if (!imgData || !imgData.width || !imgData.height) return null
  const canvas = document.createElement('canvas')
  canvas.width = imgData.width
  canvas.height = imgData.height
  const ctx = canvas.getContext('2d')

  if (imgData.bitmap) {
    ctx.drawImage(imgData.bitmap, 0, 0)
    return canvas
  }
  if (imgData.data) {
    const id = decodeToImageData(imgData)
    if (!id) return null
    ctx.putImageData(id, 0, 0)
    return canvas
  }
  if (typeof HTMLElement === 'function' && imgData instanceof HTMLElement) {
    ctx.drawImage(imgData, 0, 0)
    return canvas
  }
  return null
}

function decodeToImageData(imgData) {
  const { width, height, kind, data } = imgData
  const out = new Uint8ClampedArray(width * height * 4)
  const ImageKind = pdfjsLib.ImageKind

  if (kind === ImageKind.RGBA_32BPP) {
    out.set(data.subarray(0, out.length))
  } else if (kind === ImageKind.RGB_24BPP) {
    for (let i = 0, j = 0; j < out.length; i += 3, j += 4) {
      out[j] = data[i]
      out[j + 1] = data[i + 1]
      out[j + 2] = data[i + 2]
      out[j + 3] = 255
    }
  } else if (kind === ImageKind.GRAYSCALE_1BPP) {
    const rowBytes = (width + 7) >> 3
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = data[y * rowBytes + (x >> 3)]
        const v = byte & (128 >> (x & 7)) ? 255 : 0
        const j = (y * width + x) * 4
        out[j] = v
        out[j + 1] = v
        out[j + 2] = v
        out[j + 3] = 255
      }
    }
  } else {
    return null
  }
  return new ImageData(out, width, height)
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png')
  })
}

// ------------------------------------------------------------------
// Results gallery
// ------------------------------------------------------------------
function renderResults() {
  if (images.length === 0) {
    resultsEl.innerHTML = '<div class="empty-state">Upload a PDF to extract its embedded images.</div>'
    return
  }

  const byPage = new Map()
  for (const img of images) {
    if (!byPage.has(img.page)) byPage.set(img.page, [])
    byPage.get(img.page).push(img)
  }

  resultsEl.innerHTML = Array.from(byPage.entries())
    .map(
      ([pageNum, pageImages]) => `
      <div class="panel">
        <h2>Page ${pageNum}</h2>
        <div class="pie-gallery">
          ${pageImages
            .map(
              (img) => `
            <div class="pie-card">
              <img src="${img.url}" alt="${escapeHtml(img.name)}" />
              <div class="pie-card__meta">
                <span class="badge">${img.width}×${img.height}px</span>
                <button type="button" class="btn pie-dl" data-name="${escapeHtml(img.name)}">⬇ PNG</button>
              </div>
            </div>`
            )
            .join('')}
        </div>
      </div>`
    )
    .join('')

  resultsEl.querySelectorAll('.pie-dl').forEach((btn) => {
    btn.addEventListener('click', () => {
      const img = images.find((i) => i.name === btn.dataset.name)
      if (img) downloadBlob(img.blob, img.name)
    })
  })
}

downloadAllBtn.addEventListener('click', async () => {
  if (images.length === 0) return
  const zip = new JSZip()
  images.forEach((img) => zip.file(img.name, img.blob))
  const zipBlob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(zipBlob, `pdf_images_${timestampSlug()}.zip`)
})

renderResults()

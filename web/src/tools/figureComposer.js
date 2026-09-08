import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { downloadBlob } from '../shared/download.js'
import PptxGenJS from 'pptxgenjs'

initChrome('figure-composer')

const state = {
  images: [],
  rows: 2,
  cols: 2,
}

const $ = (id) => document.getElementById(id)

const dropzone = $('fc-dropzone')
const fileInput = $('fc-file-input')
const imageList = $('fc-image-list')
const clearBtn = $('fc-clear-btn')
const canvas = $('fc-canvas')
const ctx = canvas.getContext('2d')
const outputWrap = $('fc-output')
const emptyState = outputWrap.querySelector('.empty-state')
const canvasWrap = outputWrap.querySelector('.fc-canvas-wrap')
const exportPng = $('fc-export-png')
const exportSvg = $('fc-export-svg')
const exportPptx = $('fc-export-pptx')

const gridPresets = $('fc-grid-presets')
const rowsInput = $('fc-rows')
const colsInput = $('fc-cols')

const labelStyle = $('fc-label-style')
const labelPos = $('fc-label-pos')
const labelSize = $('fc-label-size')
const labelSizeVal = $('fc-label-size-val')
const labelColor = $('fc-label-color')
const labelColorText = $('fc-label-color-text')
const labelBg = $('fc-label-bg')

const pageWidthInput = $('fc-page-width')
const gapSlider = $('fc-gap')
const gapVal = $('fc-gap-val')
const borderSelect = $('fc-border')
const bgColorSelect = $('fc-bg-color')

initDropzone(dropzone, fileInput, handleFiles)

function handleFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      state.images.push({ img, name: file.name, url })
      renderImageList()
      render()
    }
    img.src = url
  }
}

function renderImageList() {
  imageList.innerHTML = ''
  state.images.forEach((item, i) => {
    const li = document.createElement('li')

    const thumb = document.createElement('img')
    thumb.className = 'fc-thumb'
    thumb.src = item.url

    const name = document.createElement('span')
    name.className = 'fc-name'
    name.textContent = item.name

    const upBtn = document.createElement('button')
    upBtn.textContent = '▲'
    upBtn.title = 'Move up'
    upBtn.disabled = i === 0
    upBtn.onclick = () => { swap(i, i - 1); renderImageList(); render() }

    const downBtn = document.createElement('button')
    downBtn.textContent = '▼'
    downBtn.title = 'Move down'
    downBtn.disabled = i === state.images.length - 1
    downBtn.onclick = () => { swap(i, i + 1); renderImageList(); render() }

    const removeBtn = document.createElement('button')
    removeBtn.className = 'fc-remove-btn'
    removeBtn.textContent = '✕'
    removeBtn.title = 'Remove'
    removeBtn.onclick = () => {
      URL.revokeObjectURL(item.url)
      state.images.splice(i, 1)
      renderImageList()
      render()
    }

    li.append(thumb, name, upBtn, downBtn, removeBtn)
    imageList.appendChild(li)
  })

  clearBtn.hidden = state.images.length === 0
  const hasImages = state.images.length > 0
  exportPng.disabled = !hasImages
  exportSvg.disabled = !hasImages
  exportPptx.disabled = !hasImages
}

function swap(a, b) {
  ;[state.images[a], state.images[b]] = [state.images[b], state.images[a]]
}

clearBtn.addEventListener('click', () => {
  state.images.forEach((item) => URL.revokeObjectURL(item.url))
  state.images = []
  renderImageList()
  render()
})

gridPresets.addEventListener('click', (e) => {
  const btn = e.target.closest('button')
  if (!btn) return
  state.rows = +btn.dataset.r
  state.cols = +btn.dataset.c
  rowsInput.value = state.rows
  colsInput.value = state.cols
  gridPresets.querySelectorAll('button').forEach((b) => b.classList.remove('is-active'))
  btn.classList.add('is-active')
  render()
})

function syncGridFromInputs() {
  state.rows = Math.max(1, Math.min(10, +rowsInput.value || 1))
  state.cols = Math.max(1, Math.min(10, +colsInput.value || 1))
  gridPresets.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('is-active', +b.dataset.r === state.rows && +b.dataset.c === state.cols)
  })
  render()
}

rowsInput.addEventListener('change', syncGridFromInputs)
colsInput.addEventListener('change', syncGridFromInputs)

labelSize.addEventListener('input', () => { labelSizeVal.textContent = labelSize.value; render() })
gapSlider.addEventListener('input', () => { gapVal.textContent = gapSlider.value; render() })

labelColor.addEventListener('input', () => { labelColorText.value = labelColor.value; render() })
labelColorText.addEventListener('input', () => {
  if (/^#[0-9a-fA-F]{6}$/.test(labelColorText.value)) {
    labelColor.value = labelColorText.value
    render()
  }
})

;[labelStyle, labelPos, labelBg, borderSelect, bgColorSelect].forEach(
  (el) => el.addEventListener('change', render)
)
pageWidthInput.addEventListener('change', render)

function getSettings() {
  return {
    rows: state.rows,
    cols: state.cols,
    gap: +gapSlider.value,
    bgColor: bgColorSelect.value,
    borderStyle: borderSelect.value,
    labelStyleVal: labelStyle.value,
    labelPosVal: labelPos.value,
    labelSizePx: +labelSize.value,
    labelColorVal: labelColor.value,
    labelBgVal: labelBg.value,
  }
}

function getLabelText(index, style) {
  if (style === 'none') return null
  if (style === 'lower') return `(${String.fromCharCode(97 + index)})`
  if (style === 'upper') return String.fromCharCode(65 + index)
  return String(index + 1)
}

function drawComposite(targetCtx, w, h, settings, forExport) {
  const { rows, cols, gap, bgColor, borderStyle, labelStyleVal, labelPosVal, labelSizePx, labelColorVal, labelBgVal } = settings
  const borderW = borderStyle === 'thin' ? 1 : borderStyle === 'medium' ? 2 : 0
  const totalGapX = gap * (cols - 1)
  const totalGapY = gap * (rows - 1)
  const cellW = (w - totalGapX) / cols
  const cellH = (h - totalGapY) / rows

  targetCtx.fillStyle = bgColor
  targetCtx.fillRect(0, 0, w, h)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      const cx = c * (cellW + gap)
      const cy = r * (cellH + gap)

      if (borderW > 0) {
        targetCtx.strokeStyle = bgColor === '#000000' ? '#ffffff' : '#000000'
        targetCtx.lineWidth = borderW
        targetCtx.strokeRect(cx, cy, cellW, cellH)
      }

      if (idx < state.images.length) {
        const { img } = state.images[idx]
        const fit = fitImage(img.naturalWidth, img.naturalHeight, cellW, cellH)
        targetCtx.drawImage(img, cx + fit.x, cy + fit.y, fit.w, fit.h)
      }

      const labelText = getLabelText(idx, labelStyleVal)
      if (labelText && idx < state.images.length) {
        const fontSize = forExport ? labelSizePx : Math.max(10, labelSizePx * (cellW / 400))
        drawLabel(targetCtx, labelText, cx, cy, cellW, cellH, labelPosVal, fontSize, labelColorVal, labelBgVal)
      }
    }
  }
}

function fitImage(imgW, imgH, cellW, cellH) {
  const scaleX = cellW / imgW
  const scaleY = cellH / imgH
  const scale = Math.min(scaleX, scaleY)
  const w = imgW * scale
  const h = imgH * scale
  return { x: (cellW - w) / 2, y: (cellH - h) / 2, w, h }
}

function drawLabel(ctx, text, cx, cy, cellW, cellH, pos, fontSize, color, bg) {
  const pad = fontSize * 0.4
  ctx.font = `bold ${fontSize}px Arial, Helvetica, sans-serif`
  const metrics = ctx.measureText(text)
  const textW = metrics.width
  const textH = fontSize

  let x, y
  if (pos.endsWith('left')) x = cx + pad
  else x = cx + cellW - textW - pad

  if (pos.startsWith('top')) y = cy + pad + textH
  else y = cy + cellH - pad

  if (bg !== 'none') {
    const boxPad = fontSize * 0.2
    ctx.fillStyle = bg === 'semi' ? 'rgba(0,0,0,0.55)' : '#000000'
    ctx.fillRect(x - boxPad, y - textH - boxPad, textW + boxPad * 2, textH + boxPad * 2)
  }

  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

function render() {
  if (state.images.length === 0) {
    emptyState.hidden = false
    canvasWrap.hidden = true
    return
  }

  emptyState.hidden = true
  canvasWrap.hidden = false

  const settings = getSettings()
  const previewW = 800
  const aspect = computeAspect(settings)
  const previewH = Math.round(previewW / aspect)

  canvas.width = previewW
  canvas.height = previewH
  drawComposite(ctx, previewW, previewH, settings, false)
}

function computeAspect(settings) {
  const { rows, cols } = settings
  if (state.images.length === 0) return 4 / 3

  let maxCellAspect = 4 / 3
  for (let i = 0; i < Math.min(state.images.length, rows * cols); i++) {
    const { img } = state.images[i]
    maxCellAspect = img.naturalWidth / img.naturalHeight
    break
  }
  return (cols * maxCellAspect) / rows
}

function computeExportSize(settings) {
  const { rows, cols, gap } = settings
  const count = Math.min(state.images.length, rows * cols)
  if (count === 0) return { w: 800, h: 600 }

  const pageWidthCm = parseFloat(pageWidthInput.value) || 16
  const DPI = 300
  const w = Math.round(pageWidthCm / 2.54 * DPI)

  const totalGapX = gap * (cols - 1)
  const cellW = (w - totalGapX) / cols

  let maxAspect = 1
  for (let i = 0; i < count; i++) {
    const { img } = state.images[i]
    const a = img.naturalHeight / img.naturalWidth
    if (a > maxAspect) maxAspect = a
  }
  const cellH = cellW * maxAspect
  const h = Math.round(cellH * rows + gap * (rows - 1))
  return { w, h, cellW, cellH }
}

exportPng.addEventListener('click', () => {
  if (state.images.length === 0) return
  const settings = getSettings()
  const size = computeExportSize(settings)
  const offscreen = document.createElement('canvas')
  offscreen.width = size.w
  offscreen.height = size.h
  const offCtx = offscreen.getContext('2d')
  drawComposite(offCtx, size.w, size.h, settings, true)
  offscreen.toBlob((blob) => {
    if (blob) downloadBlob(blob, 'figure-panel.png')
  }, 'image/png')
})

exportSvg.addEventListener('click', async () => {
  if (state.images.length === 0) return
  const settings = getSettings()
  const { rows, cols, gap, bgColor, borderStyle, labelStyleVal, labelPosVal, labelSizePx, labelColorVal, labelBgVal } = settings
  const size = computeExportSize(settings)
  const borderW = borderStyle === 'thin' ? 1 : borderStyle === 'medium' ? 2 : 0
  const cellW = (size.w - gap * (cols - 1)) / cols
  const cellH = (size.h - gap * (rows - 1)) / rows

  const parts = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}" viewBox="0 0 ${size.w} ${size.h}">`)
  parts.push(`<rect width="${size.w}" height="${size.h}" fill="${bgColor}"/>`)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      const cx = c * (cellW + gap)
      const cy = r * (cellH + gap)

      if (borderW > 0) {
        const stroke = bgColor === '#000000' ? '#ffffff' : '#000000'
        parts.push(`<rect x="${cx}" y="${cy}" width="${cellW}" height="${cellH}" fill="none" stroke="${stroke}" stroke-width="${borderW}"/>`)
      }

      if (idx < state.images.length) {
        const { img } = state.images[idx]
        const fit = fitImage(img.naturalWidth, img.naturalHeight, cellW, cellH)
        const dataUrl = imgToDataUrl(img)
        parts.push(`<image href="${dataUrl}" x="${cx + fit.x}" y="${cy + fit.y}" width="${fit.w}" height="${fit.h}" preserveAspectRatio="xMidYMid meet"/>`)
      }

      const labelText = getLabelText(idx, labelStyleVal)
      if (labelText && idx < state.images.length) {
        const pad = labelSizePx * 0.4
        let lx, ly
        if (labelPosVal.endsWith('left')) lx = cx + pad
        else lx = cx + cellW - pad

        if (labelPosVal.startsWith('top')) ly = cy + pad + labelSizePx
        else ly = cy + cellH - pad

        const anchor = labelPosVal.endsWith('left') ? 'start' : 'end'

        if (labelBgVal !== 'none') {
          const boxPad = labelSizePx * 0.2
          const approxTextW = labelSizePx * labelText.length * 0.65
          let bx = labelPosVal.endsWith('left') ? lx - boxPad : lx - approxTextW - boxPad
          const by = ly - labelSizePx - boxPad
          const bw = approxTextW + boxPad * 2
          const bh = labelSizePx + boxPad * 2
          const fillColor = labelBgVal === 'semi' ? 'rgba(0,0,0,0.55)' : '#000000'
          parts.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="${fillColor}"/>`)
        }

        parts.push(`<text x="${lx}" y="${ly}" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="${labelSizePx}" fill="${labelColorVal}" text-anchor="${anchor}">${escapeXml(labelText)}</text>`)
      }
    }
  }

  parts.push('</svg>')
  const blob = new Blob([parts.join('\n')], { type: 'image/svg+xml' })
  downloadBlob(blob, 'figure-panel.svg')
})

exportPptx.addEventListener('click', async () => {
  if (state.images.length === 0) return
  const settings = getSettings()
  const { rows, cols, gap, bgColor, borderStyle, labelStyleVal, labelPosVal, labelSizePx, labelColorVal, labelBgVal } = settings

  const pres = new PptxGenJS()

  const pageWidthCm = parseFloat(pageWidthInput.value) || 16
  const DPI = 300
  const slideW = pageWidthCm / 2.54
  const gapIn = gap / DPI

  const totalGapX = gapIn * (cols - 1)
  const cellW = (slideW - totalGapX) / cols

  const count = Math.min(state.images.length, rows * cols)
  let maxAspect = 1
  for (let i = 0; i < count; i++) {
    const { img } = state.images[i]
    const a = img.naturalHeight / img.naturalWidth
    if (a > maxAspect) maxAspect = a
  }
  const cellH = cellW * maxAspect
  const slideH = cellH * rows + gapIn * (rows - 1)

  pres.defineLayout({ name: 'CUSTOM', width: slideW, height: slideH })
  pres.layout = 'CUSTOM'

  const slide = pres.addSlide()

  const bgHex = bgColor.replace(/^#/, '')
  slide.background = { fill: bgHex }

  const borderW = borderStyle === 'thin' ? 1 : borderStyle === 'medium' ? 2 : 0

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      const cx = c * (cellW + gapIn)
      const cy = r * (cellH + gapIn)

      if (borderW > 0) {
        const strokeColor = bgColor === '#000000' ? 'FFFFFF' : '000000'
        slide.addShape(pres.ShapeType.rect, {
          x: cx, y: cy, w: cellW, h: cellH,
          fill: { type: 'none' },
          line: { color: strokeColor, width: borderW },
        })
      }

      if (idx < state.images.length) {
        const { img } = state.images[idx]
        const fit = fitImage(img.naturalWidth, img.naturalHeight, cellW, cellH)
        const dataUrl = imgToDataUrl(img)
        slide.addImage({
          data: dataUrl,
          x: cx + fit.x,
          y: cy + fit.y,
          w: fit.w,
          h: fit.h,
        })
      }

      const labelText = getLabelText(idx, labelStyleVal)
      if (labelText && idx < state.images.length) {
        const padIn = labelSizePx * 0.4 / DPI
        const fontPt = Math.round(labelSizePx * 0.75)
        const textBoxW = labelSizePx * labelText.length * 0.65 / DPI + padIn * 2
        const textBoxH = labelSizePx / DPI + padIn * 2

        let lx, ly
        if (labelPosVal.endsWith('left')) lx = cx + padIn - padIn * 0.5
        else lx = cx + cellW - textBoxW - padIn + padIn * 0.5

        if (labelPosVal.startsWith('top')) ly = cy + padIn - padIn * 0.5
        else ly = cy + cellH - textBoxH - padIn + padIn * 0.5

        const labelHex = labelColorVal.replace(/^#/, '')

        const textOpts = {
          x: lx,
          y: ly,
          w: textBoxW,
          h: textBoxH,
          fontSize: fontPt,
          color: labelHex,
          bold: true,
          fontFace: 'Arial',
          align: 'center',
          valign: 'middle',
        }

        if (labelBgVal !== 'none') {
          textOpts.fill = {
            color: '000000',
            transparency: labelBgVal === 'semi' ? 45 : 0,
          }
        }

        slide.addText(labelText, textOpts)
      }
    }
  }

  await pres.writeFile({ fileName: 'figure-panel.pptx' })
})

function imgToDataUrl(img) {
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const cx = c.getContext('2d')
  cx.drawImage(img, 0, 0)
  return c.toDataURL('image/png')
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

render()

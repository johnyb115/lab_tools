import { initChrome } from '../shared/nav.js'
import { downloadBlob, downloadText } from '../shared/download.js'
import { escapeHtml } from '../shared/dom.js'

initChrome('arrow-generator')

const SVG_NS = 'http://www.w3.org/2000/svg'
const CANVAS_W = 900
const CANVAS_H = 560
const PX_PER_IN = 96

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let p1 = null   // { x, y } start point (canvas coords)
let p2 = null   // { x, y } end point
let placing = 'start'   // 'start' | 'end' | 'done'
let dragging = null     // 'p1' | 'p2' | null

const style = {
  shape: 'straight',       // straight | curved | elbow
  curvature: 35,            // -100..100
  elbowDir: 'h-first',      // h-first | v-first
  headMode: 'single',       // single | double | equilibrium
  headStyle: 'filled',      // filled | open
  singleBarb: false,
  headSize: 16,
  eqGap: 9,
  color: '#4c9aff',
  strokeWidth: 3,
  labelText: '',
  labelPos: 'above',        // above | below | on
  labelSize: 16,
}

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const editor = document.getElementById('ag-editor')

const shapeSel      = document.getElementById('ag-shape')
const curvatureField = document.getElementById('ag-curvature-field')
const curvature      = document.getElementById('ag-curvature')
const curvatureVal   = document.getElementById('ag-curvature-value')
const elbowField     = document.getElementById('ag-elbow-field')
const elbowHBtn      = document.getElementById('ag-elbow-h')
const elbowVBtn      = document.getElementById('ag-elbow-v')
const newArrowBtn    = document.getElementById('ag-new-arrow')

const headModeSel   = document.getElementById('ag-head-mode')
const headStyleSel  = document.getElementById('ag-head-style')
const barbRow       = document.getElementById('ag-barb-row')
const singleBarbChk = document.getElementById('ag-single-barb')
const headSize       = document.getElementById('ag-head-size')
const headSizeVal    = document.getElementById('ag-head-size-value')
const eqGapField     = document.getElementById('ag-eq-gap-field')
const eqGap           = document.getElementById('ag-eq-gap')
const eqGapVal        = document.getElementById('ag-eq-gap-value')

const colorInput     = document.getElementById('ag-color')
const colorText      = document.getElementById('ag-color-text')
const strokeWidth     = document.getElementById('ag-stroke-width')
const strokeWidthVal  = document.getElementById('ag-stroke-width-value')

const labelText      = document.getElementById('ag-label-text')
const labelPosField  = document.getElementById('ag-label-pos-field')
const labelPosSel    = document.getElementById('ag-label-pos')
const labelSizeField = document.getElementById('ag-label-size-field')
const labelSizeInput = document.getElementById('ag-label-size')
const labelSizeVal   = document.getElementById('ag-label-size-value')

const copySvgBtn     = document.getElementById('ag-copy-svg')
const downloadSvgBtn = document.getElementById('ag-download-svg')
const downloadPngBtn = document.getElementById('ag-download-png')
const downloadPptxBtn = document.getElementById('ag-download-pptx')

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
function angleTo(a, b) { return Math.atan2(b.y - a.y, b.x - a.x) }
function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y) }
function lerp(a, b, t) { return a + (b - a) * t }
function midOf(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }

function quadPoint(p0, pc, p1_, t) {
  const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * pc.x + t * t * p1_.x
  const y = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * pc.y + t * t * p1_.y
  return { x, y }
}

// Build a path description for a single leg between a and b, honoring the
// current shape setting. Returns { d, startAngle, endAngle, mid, midAngle }
// startAngle/endAngle point OUTWARD from the path (i.e. the direction an
// arrowhead at that end should face).
function buildLeg(a, b, shape, curvatureAmt, elbowDir) {
  if (shape === 'curved') {
    const dx = b.x - a.x, dy = b.y - a.y
    const d = Math.hypot(dx, dy) || 1
    const nx = -dy / d, ny = dx / d
    const offset = (curvatureAmt / 100) * d * 0.5
    const cx = (a.x + b.x) / 2 + nx * offset
    const cy = (a.y + b.y) / 2 + ny * offset
    const ctrl = { x: cx, y: cy }
    const endAngle = angleTo(ctrl, b)
    const startAngle = angleTo(ctrl, a)
    const mid = quadPoint(a, ctrl, b, 0.5)
    const midAngle = angleTo(quadPoint(a, ctrl, b, 0.45), quadPoint(a, ctrl, b, 0.55))
    return { d: `M ${a.x} ${a.y} Q ${ctrl.x} ${ctrl.y} ${b.x} ${b.y}`, startAngle, endAngle, mid, midAngle }
  }

  if (shape === 'elbow') {
    const corner = elbowDir === 'h-first' ? { x: b.x, y: a.y } : { x: a.x, y: b.y }
    const firstAngle = angleTo(a, corner)
    const lastAngle = angleTo(corner, b)
    const startAngle = firstAngle + Math.PI
    const endAngle = lastAngle
    return {
      d: `M ${a.x} ${a.y} L ${corner.x} ${corner.y} L ${b.x} ${b.y}`,
      startAngle, endAngle, mid: corner, midAngle: lastAngle,
    }
  }

  // straight
  const endAngle = angleTo(a, b)
  const startAngle = endAngle + Math.PI
  return { d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, startAngle, endAngle, mid: midOf(a, b), midAngle: endAngle }
}

// Maps our head styles onto pptxgenjs's native OOXML arrow-type enum
// (none/arrow/diamond/oval/stealth/triangle). Styles with no entry have no
// native PowerPoint equivalent and fall back to SVG/PNG-only export.
const PPTX_ARROW_TYPE = {
  filled: 'triangle',
  open: 'arrow',
  concave: 'stealth',
  diamond: 'diamond',
  circle: 'oval',
  bar: null,
}

function wingPoint(tip, facingAngle, size, spreadDeg) {
  const back = facingAngle + Math.PI - (spreadDeg * Math.PI) / 180
  return { x: tip.x + size * Math.cos(back), y: tip.y + size * Math.sin(back) }
}

function arrowheadPoints(tip, facingAngle, size, singleBarb, spreadDeg = 27) {
  const w1 = wingPoint(tip, facingAngle, size, spreadDeg)
  if (singleBarb) {
    const shaftBack = { x: tip.x + size * 0.45 * Math.cos(facingAngle + Math.PI), y: tip.y + size * 0.45 * Math.sin(facingAngle + Math.PI) }
    return [tip, w1, shaftBack]
  }
  const w2 = wingPoint(tip, facingAngle, size, -spreadDeg)
  return [tip, w1, w2]
}

function ptsAttr(pts) { return pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') }
function fmt(n) { return n.toFixed(2) }

function headMarkup(tip, facingAngle) {
  const size = style.headSize
  const color = style.color

  if (style.headStyle === 'diamond') {
    const back = (t) => ({ x: tip.x + t * size * Math.cos(facingAngle + Math.PI), y: tip.y + t * size * Math.sin(facingAngle + Math.PI) })
    const backTip = back(1.3)
    const mid = back(0.65)
    const perp = { x: -Math.sin(facingAngle), y: Math.cos(facingAngle) }
    const sideA = { x: mid.x + perp.x * size * 0.42, y: mid.y + perp.y * size * 0.42 }
    const sideB = { x: mid.x - perp.x * size * 0.42, y: mid.y - perp.y * size * 0.42 }
    return `<polygon points="${ptsAttr([tip, sideA, backTip, sideB])}" fill="${color}" />`
  }

  if (style.headStyle === 'circle') {
    const r = size * 0.4
    const cx = tip.x + r * Math.cos(facingAngle + Math.PI)
    const cy = tip.y + r * Math.sin(facingAngle + Math.PI)
    return `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="${color}" />`
  }

  if (style.headStyle === 'bar') {
    const half = size * 0.55
    const perp = { x: -Math.sin(facingAngle), y: Math.cos(facingAngle) }
    const a = { x: tip.x + perp.x * half, y: tip.y + perp.y * half }
    const b = { x: tip.x - perp.x * half, y: tip.y - perp.y * half }
    return `<line x1="${fmt(a.x)}" y1="${fmt(a.y)}" x2="${fmt(b.x)}" y2="${fmt(b.y)}" stroke="${color}" stroke-width="${style.strokeWidth}" stroke-linecap="round" />`
  }

  if (style.headStyle === 'concave') {
    const w1 = wingPoint(tip, facingAngle, size, 24)
    const w2 = style.singleBarb ? null : wingPoint(tip, facingAngle, size, -24)
    const mid = w2 ? midOf(w1, w2) : { x: tip.x + size * 0.5 * Math.cos(facingAngle + Math.PI), y: tip.y + size * 0.5 * Math.sin(facingAngle + Math.PI) }
    const notch = { x: lerp(mid.x, tip.x, 0.45), y: lerp(mid.y, tip.y, 0.45) }
    if (!w2) {
      const shaftBack = { x: tip.x + size * 0.45 * Math.cos(facingAngle + Math.PI), y: tip.y + size * 0.45 * Math.sin(facingAngle + Math.PI) }
      return `<path d="M ${fmt(tip.x)} ${fmt(tip.y)} L ${fmt(w1.x)} ${fmt(w1.y)} Q ${fmt(notch.x)} ${fmt(notch.y)} ${fmt(shaftBack.x)} ${fmt(shaftBack.y)} Z" fill="${color}" />`
    }
    return `<path d="M ${fmt(tip.x)} ${fmt(tip.y)} L ${fmt(w1.x)} ${fmt(w1.y)} Q ${fmt(notch.x)} ${fmt(notch.y)} ${fmt(w2.x)} ${fmt(w2.y)} Z" fill="${color}" />`
  }

  const pts = arrowheadPoints(tip, facingAngle, size, style.singleBarb)
  if (style.headStyle === 'filled') {
    return `<polygon points="${ptsAttr(pts)}" fill="${color}" />`
  }
  // open / chevron
  const [tipPt, w1, w2] = pts
  if (style.singleBarb) {
    return `<path d="M ${fmt(w1.x)} ${fmt(w1.y)} L ${fmt(tipPt.x)} ${fmt(tipPt.y)}" fill="none" stroke="${color}" stroke-width="${style.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />`
  }
  return `<path d="M ${fmt(w1.x)} ${fmt(w1.y)} L ${fmt(tipPt.x)} ${fmt(tipPt.y)} L ${fmt(w2.x)} ${fmt(w2.y)}" fill="none" stroke="${color}" stroke-width="${style.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />`
}

function labelMarkup(mid, midAngle) {
  if (!style.labelText.trim()) return ''
  let nx = -Math.sin(midAngle), ny = Math.cos(midAngle)
  if (ny > 0) { nx = -nx; ny = -ny }   // keep "above" visually upward
  const gap = style.strokeWidth * 2 + style.labelSize * 0.6
  let x = mid.x, y = mid.y
  if (style.labelPos === 'above') { x += nx * gap; y += ny * gap - 2 }
  else if (style.labelPos === 'below') { x -= nx * gap; y -= ny * gap - 2 }
  else { y -= 4 }
  return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="Arial, sans-serif" font-size="${style.labelSize}" fill="${style.color}" text-anchor="middle" dominant-baseline="middle">${escapeHtml(style.labelText)}</text>`
}

// Build the full set of legs (one, or two for equilibrium) with their own
// endpoints (offset for equilibrium mode).
function buildLegs() {
  if (style.headMode !== 'equilibrium') {
    return [{ a: p1, b: p2, headStart: style.headMode === 'double', headEnd: true }]
  }
  const overall = angleTo(p1, p2)
  const nx = -Math.sin(overall), ny = Math.cos(overall)
  const g = style.eqGap
  const a1 = { x: p1.x + nx * g, y: p1.y + ny * g }
  const b1 = { x: p2.x + nx * g, y: p2.y + ny * g }
  const a2 = { x: p2.x - nx * g, y: p2.y - ny * g }
  const b2 = { x: p1.x - nx * g, y: p1.y - ny * g }
  return [
    { a: a1, b: b1, headStart: false, headEnd: true },
    { a: a2, b: b2, headStart: false, headEnd: true },
  ]
}

// Renders the arrow (shaft + heads + label) as SVG markup, no grid/handles.
function buildArrowMarkup() {
  if (!p1 || !p2) return ''
  const legs = buildLegs()
  let out = ''
  let firstMid = null, firstMidAngle = 0
  for (const leg of legs) {
    const built = buildLeg(leg.a, leg.b, style.shape, style.curvature, style.elbowDir)
    if (!firstMid) { firstMid = built.mid; firstMidAngle = built.midAngle }
    out += `<path d="${built.d}" fill="none" stroke="${style.color}" stroke-width="${style.strokeWidth}" stroke-linecap="round" />`
    if (leg.headEnd) out += headMarkup(leg.b, built.endAngle)
    if (leg.headStart) out += headMarkup(leg.a, built.startAngle)
  }
  out += labelMarkup(firstMid, firstMidAngle)
  return out
}

// ---------------------------------------------------------------------------
// Editor rendering (grid + live arrow + handles)
// ---------------------------------------------------------------------------
function themeColor(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function renderEditor() {
  while (editor.firstChild) editor.removeChild(editor.firstChild)

  const defs = document.createElementNS(SVG_NS, 'defs')
  const pattern = document.createElementNS(SVG_NS, 'pattern')
  pattern.setAttribute('id', 'ag-grid')
  pattern.setAttribute('width', '24')
  pattern.setAttribute('height', '24')
  pattern.setAttribute('patternUnits', 'userSpaceOnUse')
  const dot = document.createElementNS(SVG_NS, 'circle')
  dot.setAttribute('cx', '1')
  dot.setAttribute('cy', '1')
  dot.setAttribute('r', '1')
  dot.setAttribute('fill', themeColor('--border', '#23232b'))
  pattern.appendChild(dot)
  defs.appendChild(pattern)
  editor.appendChild(defs)

  const bg = document.createElementNS(SVG_NS, 'rect')
  bg.setAttribute('width', String(CANVAS_W))
  bg.setAttribute('height', String(CANVAS_H))
  bg.setAttribute('fill', 'url(#ag-grid)')
  editor.appendChild(bg)

  if (p1 && placing === 'end' && !p2) {
    // rubber band handled separately via pointer move
  }

  if (p1 && p2) {
    const g = document.createElementNS(SVG_NS, 'g')
    g.innerHTML = buildArrowMarkup()
    editor.appendChild(g)
  }

  if (p1) drawHandle(p1, 'p1')
  if (p2) drawHandle(p2, 'p2')

  if (!p1) {
    const hint = document.createElementNS(SVG_NS, 'text')
    hint.setAttribute('x', String(CANVAS_W / 2))
    hint.setAttribute('y', String(CANVAS_H / 2))
    hint.setAttribute('text-anchor', 'middle')
    hint.setAttribute('font-family', 'Inter, sans-serif')
    hint.setAttribute('font-size', '15')
    hint.setAttribute('fill', themeColor('--text-muted', '#71717a'))
    hint.textContent = 'Click to place the start point'
    editor.appendChild(hint)
  }

  updateExportState()
}

function drawHandle(pt, id) {
  // Hollow ring (not a filled dot) so it doesn't hide the arrowhead
  // underneath — pointer-events="all" keeps the whole disc grabbable
  // even though the fill is transparent.
  const c = document.createElementNS(SVG_NS, 'circle')
  c.setAttribute('cx', String(pt.x))
  c.setAttribute('cy', String(pt.y))
  c.setAttribute('r', '10')
  c.setAttribute('fill', 'none')
  c.setAttribute('stroke', themeColor('--accent', '#4c9aff'))
  c.setAttribute('stroke-width', '2')
  c.setAttribute('pointer-events', 'all')
  c.style.cursor = 'grab'
  c.dataset.handle = id
  editor.appendChild(c)
}

// ---------------------------------------------------------------------------
// Pointer interaction
// ---------------------------------------------------------------------------
function svgPointFromEvent(evt) {
  const pt = editor.createSVGPoint()
  pt.x = evt.clientX
  pt.y = evt.clientY
  const ctm = editor.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const p = pt.matrixTransform(ctm.inverse())
  return { x: p.x, y: p.y }
}

editor.addEventListener('pointerdown', (evt) => {
  const target = evt.target
  if (target.dataset && target.dataset.handle) {
    dragging = target.dataset.handle
    editor.setPointerCapture(evt.pointerId)
    return
  }
  const pos = svgPointFromEvent(evt)
  if (!p1) {
    p1 = pos
    placing = 'end'
  } else if (!p2) {
    p2 = pos
    placing = 'done'
  } else {
    return // arrow already placed; use handles or "New arrow"
  }
  renderEditor()
})

editor.addEventListener('pointermove', (evt) => {
  const pos = svgPointFromEvent(evt)
  if (dragging === 'p1') { p1 = pos; renderEditor(); return }
  if (dragging === 'p2') { p2 = pos; renderEditor(); return }
  if (p1 && !p2) {
    renderEditor()
    const rubber = document.createElementNS(SVG_NS, 'line')
    rubber.setAttribute('x1', String(p1.x))
    rubber.setAttribute('y1', String(p1.y))
    rubber.setAttribute('x2', String(pos.x))
    rubber.setAttribute('y2', String(pos.y))
    rubber.setAttribute('stroke', themeColor('--text-muted', '#71717a'))
    rubber.setAttribute('stroke-width', '1.5')
    rubber.setAttribute('stroke-dasharray', '4 4')
    editor.appendChild(rubber)
  }
})

editor.addEventListener('pointerup', () => { dragging = null })
editor.addEventListener('pointerleave', () => { dragging = null })

newArrowBtn.addEventListener('click', () => {
  p1 = null; p2 = null; placing = 'start'; dragging = null
  renderEditor()
})

// ---------------------------------------------------------------------------
// Control panel wiring
// ---------------------------------------------------------------------------
const BARB_CAPABLE_STYLES = ['filled', 'open', 'concave']

function syncVisibility() {
  curvatureField.hidden = style.shape !== 'curved'
  elbowField.hidden = style.shape !== 'elbow'
  barbRow.hidden = style.headMode !== 'single' || !BARB_CAPABLE_STYLES.includes(style.headStyle)
  if (barbRow.hidden) { style.singleBarb = false; singleBarbChk.checked = false }
  eqGapField.hidden = style.headMode !== 'equilibrium'
  const hasLabel = labelText.value.trim().length > 0
  labelPosField.hidden = !hasLabel
  labelSizeField.hidden = !hasLabel
  if (style.shape === 'elbow' && style.headMode === 'equilibrium') {
    headModeSel.value = 'single'
    style.headMode = 'single'
    barbRow.hidden = false
    eqGapField.hidden = true
  }
}

shapeSel.addEventListener('change', () => {
  style.shape = shapeSel.value
  syncVisibility()
  renderEditor()
})

curvature.addEventListener('input', () => {
  style.curvature = +curvature.value
  curvatureVal.textContent = curvature.value
  renderEditor()
})

function setElbowDir(dir) {
  style.elbowDir = dir
  elbowHBtn.classList.toggle('is-active', dir === 'h-first')
  elbowVBtn.classList.toggle('is-active', dir === 'v-first')
  renderEditor()
}
elbowHBtn.addEventListener('click', () => setElbowDir('h-first'))
elbowVBtn.addEventListener('click', () => setElbowDir('v-first'))

headModeSel.addEventListener('change', () => {
  style.headMode = headModeSel.value
  syncVisibility()
  renderEditor()
})

headStyleSel.addEventListener('change', () => {
  style.headStyle = headStyleSel.value
  syncVisibility()
  renderEditor()
})

singleBarbChk.addEventListener('change', () => {
  style.singleBarb = singleBarbChk.checked
  renderEditor()
})

headSize.addEventListener('input', () => {
  style.headSize = +headSize.value
  headSizeVal.textContent = headSize.value
  renderEditor()
})

eqGap.addEventListener('input', () => {
  style.eqGap = +eqGap.value
  eqGapVal.textContent = eqGap.value
  renderEditor()
})

function setColor(hex) {
  style.color = hex
  colorInput.value = hex
  colorText.value = hex
  renderEditor()
}
colorInput.addEventListener('input', () => setColor(colorInput.value))
colorText.addEventListener('input', () => {
  if (/^#[0-9a-fA-F]{6}$/.test(colorText.value)) setColor(colorText.value)
})

strokeWidth.addEventListener('input', () => {
  style.strokeWidth = +strokeWidth.value
  strokeWidthVal.textContent = strokeWidth.value
  renderEditor()
})

labelText.addEventListener('input', () => {
  style.labelText = labelText.value
  syncVisibility()
  renderEditor()
})
labelPosSel.addEventListener('change', () => {
  style.labelPos = labelPosSel.value
  renderEditor()
})
labelSizeInput.addEventListener('input', () => {
  style.labelSize = +labelSizeInput.value
  labelSizeVal.textContent = labelSizeInput.value
  renderEditor()
})

document.addEventListener('labtools:themechange', () => renderEditor())

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
function updateExportState() {
  const ready = !!(p1 && p2)
  copySvgBtn.disabled = !ready
  downloadSvgBtn.disabled = !ready
  downloadPngBtn.disabled = !ready
  const pptxOk = ready && style.shape !== 'curved' && PPTX_ARROW_TYPE[style.headStyle] != null
  downloadPptxBtn.disabled = !pptxOk
}

function exportSvgString() {
  const inner = buildArrowMarkup()
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" width="${CANVAS_W}" height="${CANVAS_H}">\n${inner}\n</svg>`
}

copySvgBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(exportSvgString())
    copySvgBtn.textContent = 'Copied!'
    setTimeout(() => { copySvgBtn.textContent = 'Copy SVG' }, 1200)
  } catch {
    downloadText(exportSvgString(), 'arrow.svg', 'image/svg+xml')
  }
})

downloadSvgBtn.addEventListener('click', () => {
  downloadBlob(new Blob([exportSvgString()], { type: 'image/svg+xml' }), 'arrow.svg')
})

downloadPngBtn.addEventListener('click', async () => {
  const svgStr = exportSvgString()
  const scale = 3
  const img = new Image()
  const blob = new Blob([svgStr], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_W * scale
    canvas.height = CANVAS_H * scale
    const ctx = canvas.getContext('2d')
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0)
    URL.revokeObjectURL(url)
    canvas.toBlob((pngBlob) => downloadBlob(pngBlob, 'arrow.png'), 'image/png')
  }
  img.src = url
})

downloadPptxBtn.addEventListener('click', async () => {
  if (!p1 || !p2 || style.shape === 'curved' || PPTX_ARROW_TYPE[style.headStyle] == null) return
  downloadPptxBtn.disabled = true
  downloadPptxBtn.textContent = 'Generating…'
  try {
    const PptxGenJS = (await import('pptxgenjs')).default
    const pptx = new PptxGenJS()
    const W_IN = CANVAS_W / PX_PER_IN
    const H_IN = CANVAS_H / PX_PER_IN
    pptx.defineLayout({ name: 'ARROW', width: W_IN, height: H_IN })
    pptx.layout = 'ARROW'
    const slide = pptx.addSlide()

    const colorHex = style.color.replace('#', '')
    const widthPt = Math.max(0.5, style.strokeWidth * 0.75)
    const headType = PPTX_ARROW_TYPE[style.headStyle] || 'triangle'

    function addSegment(a, b, headBegin, headEnd) {
      const x = Math.min(a.x, b.x) / PX_PER_IN
      const y = Math.min(a.y, b.y) / PX_PER_IN
      const w = Math.max(0.01, Math.abs(b.x - a.x) / PX_PER_IN)
      const h = Math.max(0.01, Math.abs(b.y - a.y) / PX_PER_IN)
      slide.addShape(pptx.ShapeType.line, {
        x, y, w, h,
        flipH: b.x < a.x,
        flipV: b.y < a.y,
        line: {
          color: colorHex,
          width: widthPt,
          beginArrowType: headBegin ? headType : 'none',
          endArrowType: headEnd ? headType : 'none',
        },
      })
    }

    const legs = buildLegs()
    for (const leg of legs) {
      if (style.shape === 'elbow') {
        const corner = style.elbowDir === 'h-first' ? { x: leg.b.x, y: leg.a.y } : { x: leg.a.x, y: leg.b.y }
        addSegment(leg.a, corner, leg.headStart, false)
        addSegment(corner, leg.b, false, leg.headEnd)
      } else {
        addSegment(leg.a, leg.b, leg.headStart, leg.headEnd)
      }
    }

    if (style.labelText.trim()) {
      const built = buildLeg(legs[0].a, legs[0].b, style.shape, style.curvature, style.elbowDir)
      const fontPt = Math.max(6, Math.round(style.labelSize * 0.75))
      const labelW = 2
      const labelH = fontPt * 1.6 / 72
      let lx = built.mid.x / PX_PER_IN - labelW / 2
      let ly = built.mid.y / PX_PER_IN - labelH / 2
      if (style.labelPos === 'above') ly -= labelH * 0.9
      else if (style.labelPos === 'below') ly += labelH * 0.9
      slide.addText(style.labelText, {
        x: lx, y: ly, w: labelW, h: labelH,
        align: 'center', valign: 'middle',
        fontSize: fontPt, color: colorHex, fontFace: 'Arial',
      })
    }

    const pptxBlob = await pptx.write({ outputType: 'blob' })
    downloadBlob(pptxBlob, 'arrow.pptx')
  } finally {
    downloadPptxBtn.disabled = !(p1 && p2 && style.shape !== 'curved' && PPTX_ARROW_TYPE[style.headStyle] != null)
    downloadPptxBtn.textContent = '⬇ PPTX'
  }
})

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
syncVisibility()
renderEditor()

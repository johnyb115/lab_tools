import { initChrome } from '../shared/nav.js'
import qrcode from 'qrcode-generator'

initChrome('pcb-qr')

// ---- Seeded PRNG (mulberry32) ------------------------------------------------

class Rng {
  constructor(seed) {
    this.s = seed | 0
  }

  _next() {
    let t = (this.s += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  uniform(a, b) {
    return a + this._next() * (b - a)
  }

  choice(arr) {
    return arr[Math.floor(this._next() * arr.length)]
  }

  choices(population, weights, k) {
    const total = weights.reduce((s, w) => s + w, 0)
    const result = []
    for (let i = 0; i < k; i++) {
      let r = this._next() * total
      for (let j = 0; j < population.length; j++) {
        r -= weights[j]
        if (r <= 0) {
          result.push(population[j])
          break
        }
      }
      if (result.length <= i) result.push(population[population.length - 1])
    }
    return result
  }
}

// ---- QR matrix --------------------------------------------------------------

function qrMatrix(data) {
  const qr = qrcode(0, 'H')
  qr.addData(data)
  qr.make()
  const n = qr.getModuleCount()
  const matrix = []
  for (let r = 0; r < n; r++) {
    const row = []
    for (let c = 0; c < n; c++) row.push(qr.isDark(r, c))
    matrix.push(row)
  }
  return matrix
}

// ---- Edge detection and index selection -------------------------------------

function edgeIsDark(matrix, side, index) {
  const n = matrix.length
  if (side === 'top') return matrix[0][index]
  if (side === 'right') return matrix[index][n - 1]
  if (side === 'bottom') return matrix[n - 1][index]
  return matrix[index][0]
}

function chooseIndices(rng, matrix, side, maxTracks) {
  const n = matrix.length
  const candidates = []
  for (let i = 0; i < n; i++) {
    if (edgeIsDark(matrix, side, i)) candidates.push(i)
  }
  if (candidates.length <= maxTracks) return candidates

  let protectedRanges, finderTargets
  if (side === 'top') {
    protectedRanges = [[0, 7], [n - 7, n]]
    finderTargets = [0, 6, n - 7, n - 1]
  } else if (side === 'left') {
    protectedRanges = [[0, 7], [n - 7, n]]
    finderTargets = [2, 6, n - 7, n - 1]
  } else {
    protectedRanges = [[0, 7]]
    finderTargets = [2, 6]
  }

  const chosen = []
  for (const target of finderTargets) {
    const fc = candidates.filter((i) =>
      protectedRanges.some(([lo, hi]) => i >= lo && i < hi),
    )
    if (fc.length > 0) {
      const nearest = fc.reduce((best, c) =>
        Math.abs(c - target) < Math.abs(best - target) ? c : best,
      )
      if (Math.abs(nearest - target) <= 2 && !chosen.includes(nearest)) {
        chosen.push(nearest)
      }
    }
  }

  const safe = candidates.filter(
    (i) => !protectedRanges.some(([lo, hi]) => i >= lo && i < hi),
  )
  const openSlots = Math.max(0, maxTracks - chosen.length)
  const targets =
    openSlots > 1
      ? Array.from({ length: openSlots }, (_, i) => (i * (n - 1)) / (openSlots - 1))
      : openSlots === 1
        ? [(n - 1) / 2]
        : []

  for (const t of targets) {
    const usable = safe.filter(
      (c) => !chosen.includes(c) && chosen.every((old) => Math.abs(c - old) >= 2),
    )
    if (usable.length === 0) continue
    const bestDist = Math.min(...usable.map((c) => Math.abs(c - t)))
    const near = usable.filter((c) => Math.abs(c - t) === bestDist)
    chosen.push(rng.choice(near))
  }

  return chosen.sort((a, b) => a - b)
}

// ---- Coordinate transforms --------------------------------------------------

function localToXY(side, u, v, qrX, qrY, qrSide) {
  if (side === 'top') return [qrX + u, qrY - v]
  if (side === 'right') return [qrX + qrSide + v, qrY + u]
  if (side === 'bottom') return [qrX + u, qrY + qrSide + v]
  return [qrX - v, qrY + u]
}

function svgPathD(points) {
  return 'M ' + points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' L ')
}

function corridorBounds(anchors, pos, _module, qrSide) {
  const anchor = anchors[pos]
  const lo = pos === 0 ? 0 : (anchors[pos - 1] + anchor) / 2
  const hi = pos === anchors.length - 1 ? qrSide : (anchor + anchors[pos + 1]) / 2
  return [lo, hi]
}

// ---- Route generation -------------------------------------------------------

function routeInCorridor(rng, anchor, lo, hi, decor, padOuter, stroke) {
  const gap = 0.45
  let pathLo = lo + stroke / 2 + gap
  let pathHi = hi - stroke / 2 - gap
  let padLo = lo + padOuter + gap
  let padHi = hi - padOuter - gap
  if (pathLo > pathHi) pathLo = pathHi = anchor
  if (padLo > padHi) padLo = padHi = anchor

  const leftRoom = Math.max(0, anchor - padLo)
  const rightRoom = Math.max(0, padHi - anchor)
  const minDiag = decor * 0.085
  const dirs = []
  if (leftRoom >= minDiag) dirs.push([-1, leftRoom])
  if (rightRoom >= minDiag) dirs.push([1, rightRoom])

  const style = rng.choices([0, 1, 2], [2, 6, 3], 1)[0]
  const vEndTarget = rng.uniform(decor * 0.38, decor * 0.94)

  if (style === 0 || dirs.length === 0) {
    return [[anchor, 0], [anchor, vEndTarget]]
  }

  const [dir, room] = rng.choice(dirs)
  const maxShift = Math.min(room, decor * 0.2)
  const shift = rng.uniform(minDiag, maxShift)
  const termU = anchor + dir * shift
  const firstV = rng.uniform(decor * 0.08, decor * 0.3)

  if (style === 1 || room < 2 * minDiag) {
    const afterDiag = firstV + shift
    let vEnd = Math.max(vEndTarget, afterDiag + decor * 0.08)
    vEnd = Math.min(vEnd, decor * 0.96)
    return [[anchor, 0], [anchor, firstV], [termU, afterDiag], [termU, vEnd]]
  }

  const totalShift = rng.uniform(2 * minDiag, Math.min(room, decor * 0.32))
  const firstShift = rng.uniform(minDiag, totalShift - minDiag)
  const secondShift = totalShift - firstShift
  const termU2 = anchor + dir * totalShift
  const uMid = anchor + dir * firstShift
  const afterFirst = firstV + firstShift
  const secondV = Math.max(
    afterFirst + decor * rng.uniform(0.09, 0.2),
    decor * 0.34,
  )
  const afterSecond = secondV + secondShift
  let vEnd = Math.max(vEndTarget, afterSecond + decor * 0.07)
  vEnd = Math.min(vEnd, decor * 0.96)
  return [
    [anchor, 0],
    [anchor, firstV],
    [uMid, afterFirst],
    [uMid, secondV],
    [termU2, afterSecond],
    [termU2, vEnd],
  ]
}

// ---- SVG assembly -----------------------------------------------------------

function esc(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function makeSvg({
  data,
  color,
  trackColor: tc,
  qrBackground,
  canvas,
  module,
  decor,
  maxTracks,
  stroke,
  padRadius,
  seed,
  sizeMm,
  canvasCornerRadiusMm,
  transparentCanvas,
}) {
  const trackColor = tc || color
  const matrix = qrMatrix(data)
  const n = matrix.length
  const qrSide = n * module
  const qrX = decor
  const qrY = decor
  const total = qrSide + 2 * decor
  const cRadius =
    (Math.min(sizeMm / 2, Math.max(0, canvasCornerRadiusMm)) * total) / sizeMm
  const rng = new Rng(seed)
  const padOuter = padRadius + (stroke * 0.65) / 2

  const records = []
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const indices = chooseIndices(rng, matrix, side, maxTracks)
    const anchors = indices.map((i) => (i + 0.5) * module)
    for (let pos = 0; pos < anchors.length; pos++) {
      const [lo, hi] = corridorBounds(anchors, pos, module, qrSide)
      const localPts = routeInCorridor(
        rng,
        anchors[pos],
        lo,
        hi,
        decor,
        padOuter,
        stroke,
      )
      const pts = localPts.map(([u, v]) =>
        localToXY(side, u, v, qrX, qrY, qrSide),
      )
      records.push({ d: svgPathD(pts), end: pts[pts.length - 1] })
    }
  }

  const INK = 'http://www.inkscape.org/namespaces/inkscape'
  const L = []
  L.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>')
  L.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="${INK}" ` +
      `width="${sizeMm}mm" height="${sizeMm}mm" ` +
      `viewBox="0 0 ${total.toFixed(2)} ${total.toFixed(2)}">`,
  )
  L.push('  <title>Collision-free outward PCB QR code</title>')
  L.push(`  <desc>Encoded content: ${esc(data)}</desc>`)

  if (!transparentCanvas) {
    L.push(
      '  <g inkscape:groupmode="layer" inkscape:label="Board background" id="board-background">',
      `    <rect x="0" y="0" width="${total.toFixed(2)}" height="${total.toFixed(2)}" ` +
        `rx="${cRadius.toFixed(2)}" ry="${cRadius.toFixed(2)}" fill="${esc(canvas)}"/>`,
      '  </g>',
    )
  }

  L.push(
    '  <g inkscape:groupmode="layer" inkscape:label="Outward PCB tracks" id="pcb-tracks">',
  )
  records.forEach((r, i) => {
    const id = String(i + 1).padStart(2, '0')
    L.push(
      `    <path id="track-${id}" d="${r.d}" fill="none" stroke="${esc(trackColor)}" ` +
        `stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
  })
  L.push('  </g>')

  L.push(
    '  <g inkscape:groupmode="layer" inkscape:label="Terminal vias only" id="terminal-vias">',
  )
  records.forEach((r, i) => {
    const id = String(i + 1).padStart(2, '0')
    const [cx, cy] = r.end
    L.push(
      `    <circle id="terminal-via-${id}" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" ` +
        `r="${padRadius}" fill="${esc(canvas)}" stroke="${esc(trackColor)}" ` +
        `stroke-width="${(stroke * 0.65).toFixed(2)}"/>`,
    )
  })
  L.push('  </g>')

  L.push(
    '  <g inkscape:groupmode="layer" inkscape:label="QR field — no gap" id="qr-field">',
    `    <rect x="${qrX.toFixed(2)}" y="${qrY.toFixed(2)}" ` +
      `width="${qrSide.toFixed(2)}" height="${qrSide.toFixed(2)}" ` +
      `fill="${esc(qrBackground)}"/>`,
    '  </g>',
    '  <g inkscape:groupmode="layer" inkscape:label="QR modules — do not distort" id="qr-modules">',
  )

  let mid = 0
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (matrix[row][col]) {
        mid++
        const x = qrX + col * module
        const y = qrY + row * module
        L.push(
          `    <rect id="qr-module-${mid}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" ` +
            `width="${module}" height="${module}" fill="${esc(color)}"/>`,
        )
      }
    }
  }

  L.push('  </g>', '</svg>')
  return L.join('\n')
}

// ---- DOM wiring -------------------------------------------------------------

const $ = (id) => document.getElementById(id)

const el = {
  data: $('data'),
  seed: $('seed'),
  randomize: $('randomize-btn'),
  qrColor: $('qr-color'),
  qrColorPicker: $('qr-color-picker'),
  trackColor: $('track-color'),
  trackColorPicker: $('track-color-picker'),
  qrBg: $('qr-bg'),
  qrBgPicker: $('qr-bg-picker'),
  canvasColor: $('canvas-color'),
  canvasColorPicker: $('canvas-color-picker'),
  transparent: $('transparent'),
  sizeMm: $('size-mm'),
  sizeMmRange: $('size-mm-range'),
  tracksPerSide: $('tracks-per-side'),
  tracksPerSideRange: $('tracks-per-side-range'),
  trackWidth: $('track-width'),
  trackWidthRange: $('track-width-range'),
  viaRadius: $('via-radius'),
  viaRadiusRange: $('via-radius-range'),
  cornerRadius: $('corner-radius'),
  cornerRadiusRange: $('corner-radius-range'),
  moduleSize: $('module-size'),
  decorSpace: $('decor-space'),
  preview: $('preview'),
  error: $('error-msg'),
  download: $('download-btn'),
  filename: $('filename'),
}

function syncRangeNum(range, num) {
  range.addEventListener('input', () => {
    num.value = range.value
  })
  num.addEventListener('input', () => {
    range.value = num.value
  })
}

function syncColorText(picker, text) {
  picker.addEventListener('input', () => {
    text.value = picker.value
  })
  text.addEventListener('input', () => {
    if (/^#[0-9a-f]{6}$/i.test(text.value)) picker.value = text.value
  })
}

syncRangeNum(el.sizeMmRange, el.sizeMm)
syncRangeNum(el.tracksPerSideRange, el.tracksPerSide)
syncRangeNum(el.trackWidthRange, el.trackWidth)
syncRangeNum(el.viaRadiusRange, el.viaRadius)
syncRangeNum(el.cornerRadiusRange, el.cornerRadius)

syncColorText(el.qrColorPicker, el.qrColor)
syncColorText(el.trackColorPicker, el.trackColor)
syncColorText(el.qrBgPicker, el.qrBg)
syncColorText(el.canvasColorPicker, el.canvasColor)

let currentSvg = ''

function update() {
  const data = el.data.value.trim()
  if (!data) {
    el.preview.innerHTML = '<div class="empty-state">Enter data to encode.</div>'
    el.download.disabled = true
    return
  }

  try {
    const svg = makeSvg({
      data,
      color: el.qrColor.value,
      trackColor: el.trackColor.value,
      qrBackground: el.qrBg.value,
      canvas: el.canvasColor.value,
      module: Number(el.moduleSize.value) || 10,
      decor: Number(el.decorSpace.value) || 105,
      maxTracks: Number(el.tracksPerSide.value) || 12,
      stroke: Number(el.trackWidth.value) || 5.4,
      padRadius: Number(el.viaRadius.value) || 6.3,
      seed: Number(el.seed.value) || 0,
      sizeMm: Number(el.sizeMm.value) || 100,
      canvasCornerRadiusMm: Number(el.cornerRadius.value),
      transparentCanvas: el.transparent.checked,
    })
    currentSvg = svg

    const displaySvg = svg.replace(/<\?xml[^?]*\?>\n?/, '')
    el.preview.innerHTML = displaySvg
    const svgEl = el.preview.querySelector('svg')
    if (svgEl) {
      svgEl.removeAttribute('width')
      svgEl.removeAttribute('height')
      svgEl.style.width = '100%'
      svgEl.style.height = 'auto'
    }
    el.error.innerHTML = ''
    el.download.disabled = false
  } catch (err) {
    el.error.innerHTML = `<div class="alert alert-danger">${esc(err.message)}</div>`
    el.download.disabled = true
  }
}

let timer
function scheduleUpdate() {
  clearTimeout(timer)
  timer = setTimeout(update, 200)
}

document
  .querySelectorAll(
    [
      '#data',
      '#seed',
      '#qr-color',
      '#track-color',
      '#qr-bg',
      '#canvas-color',
      '#qr-color-picker',
      '#track-color-picker',
      '#qr-bg-picker',
      '#canvas-color-picker',
      '#size-mm',
      '#size-mm-range',
      '#tracks-per-side',
      '#tracks-per-side-range',
      '#track-width',
      '#track-width-range',
      '#via-radius',
      '#via-radius-range',
      '#corner-radius',
      '#corner-radius-range',
      '#module-size',
      '#decor-space',
      '#transparent',
    ].join(','),
  )
  .forEach((input) => {
    input.addEventListener('input', scheduleUpdate)
    input.addEventListener('change', scheduleUpdate)
  })

el.randomize.addEventListener('click', () => {
  el.seed.value = Math.floor(Math.random() * 100000)
  scheduleUpdate()
})

el.download.addEventListener('click', () => {
  if (!currentSvg) return
  const blob = new Blob([currentSvg], {
    type: 'image/svg+xml;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = el.filename.value || 'pcb_qr.svg'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
})

update()

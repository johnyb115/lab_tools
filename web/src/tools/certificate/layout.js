// Certificate layout engine. Produces a flat list of drawing primitives in
// millimetres (A4 portrait, origin top-left, text y = baseline). The same list
// feeds the live SVG preview and the PDF writer, so both always match.

export const PAGE = { w: 210, h: 297 }
const M = 15 // left/right margin
const CONTENT_W = PAGE.w - 2 * M

export const PRESETS = {
  cs: {
    heading: 'CERTIFIKÁT',
    subheading: 'O ÚČASTI',
    nameCaption: 'jméno a příjmení',
    eventLabel: 'AKCE',
    eventTitle: 'NÁZEV AKCE',
    eventSubtitle: 'Podnázev nebo typ akce',
    eventDetails: '1. 1. 2027 • Místo konání',
    programLabel: 'PROGRAM',
    program: 'První bod programu\nDruhý bod programu\nTřetí bod programu',
    placeDate: 'V Brně dne 1. 1. 2027',
    sig1Name: 'Jméno podepisujícího',
    sig1Role: 'funkce',
    sig2Name: '',
    sig2Role: '',
    footer1: 'Pořadatel akce',
    footer2: 'Ústav, fakulta, univerzita',
  },
  en: {
    heading: 'CERTIFICATE',
    subheading: 'OF PARTICIPATION',
    nameCaption: 'name and surname',
    eventLabel: 'EVENT',
    eventTitle: 'EVENT TITLE',
    eventSubtitle: 'Subtitle or event type',
    eventDetails: '1 January 2027 • Venue',
    programLabel: 'PROGRAMME',
    program: 'First programme item\nSecond programme item\nThird programme item',
    placeDate: 'Brno, 1 January 2027',
    sig1Name: 'Signatory name',
    sig1Role: 'position',
    sig2Name: '',
    sig2Role: '',
    footer1: 'Organised by',
    footer2: 'Department, faculty, university',
  },
}

export const NAME_PLACEHOLDER = { cs: 'Jméno Příjmení', en: 'Name Surname' }

// ---------------------------------------------------------------- colour
function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full.padEnd(6, '0').slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}
export function mix(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB)
  return rgbToHex(a.map((v, i) => v + (b[i] - v) * t))
}
function luminance(hex) {
  const c = hexToRgb(hex).map((v) => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
export function onColor(hex) {
  return luminance(hex) > 0.35 ? '#10243D' : '#FFFFFF'
}

// ------------------------------------------------------------ measuring
// fonts: { regular, bold } fontkit fonts. Width in mm for size in mm.
export function textWidth(fonts, weight, text, size, ls = 0) {
  const f = fonts[weight]
  if (!f || !text) return 0
  const run = f.layout(text)
  const w = (run.advanceWidth / f.unitsPerEm) * size
  return w + ls * Math.max(0, [...text].length - 1)
}

function wrap(fonts, weight, text, size, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean)
  const lines = []
  let cur = ''
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w
    if (cur && textWidth(fonts, weight, next, size) > maxW) {
      lines.push(cur)
      cur = w
    } else cur = next
  }
  if (cur) lines.push(cur)
  return lines
}

// Shrinks size until the text fits maxW, but never below minSize.
function fitSize(fonts, weight, text, size, maxW, minSize, ls = 0) {
  const w = textWidth(fonts, weight, text, size, ls)
  if (w <= maxW) return size
  return Math.max(minSize, size * (maxW / w))
}

// ------------------------------------------------------------- motifs
// Decorations live in the top-right corner (x > 150 mm, y 30-84 mm), next to the
// heading, and run off the page edge. All are thin tinted lines: almost no ink.
export const MOTIFS = {
  none: 'None',
  circuit: 'Circuit traces',
  fluidic: 'Microfluidic mixer',
  wafer: 'Wafer with dies',
  molecule: 'Molecule (rings)',
  signal: 'Signals',
  dots: 'Dot grid',
}

function motifCircuit(c) {
  const out = []
  const sp = 5.2, dy = 15
  const ends = [160, 168, 156, 170, 162, 174, 166]
  for (let i = 0; i < 7; i++) {
    const y = 33 + i * sp
    const xt = 190 + i * 2.2
    const xe = ends[i]
    out.push({ type: 'path', d: `M 211 ${y} L ${xt} ${y} L ${xt - dy} ${y + dy} L ${xe} ${y + dy}`, stroke: c, width: 0.7 })
    out.push({ type: 'circle', cx: xe, cy: y + dy, r: 1.5, fill: '#FFFFFF', stroke: c, width: 0.7 })
  }
  return out
}

function motifFluidic(c) {
  // Two inlet ports, channels that curve into a smooth Y-junction, then a
  // serpentine mixer with rounded turns that runs off the page edge.
  const top = 36, bot = 72, mid = 54, x0 = 174, pitch = 6.4, r = pitch / 2
  const inlet = (y) => `M 156 ${y} C 162 ${y} 163 ${mid} 168 ${mid}`
  let d = `${inlet(40)} ${inlet(68)} M 168 ${mid} L ${x0 - r} ${mid} A ${r} ${r} 0 0 1 ${x0} ${mid + r} L ${x0} ${bot}`
  let x = x0, down = true
  while (x < 214) {
    const nx = x + pitch
    d += down ? ` A ${r} ${r} 0 0 0 ${nx} ${bot} L ${nx} ${top}` : ` A ${r} ${r} 0 0 1 ${nx} ${top} L ${nx} ${bot}`
    x = nx
    down = !down
  }
  return [
    { type: 'path', d, stroke: c, width: 1.3 },
    { type: 'circle', cx: 156, cy: 40, r: 2.8, fill: '#FFFFFF', stroke: c, width: 0.8 },
    { type: 'circle', cx: 156, cy: 68, r: 2.8, fill: '#FFFFFF', stroke: c, width: 0.8 },
  ]
}

function motifWafer(c) {
  // Wafer outline with an orientation notch and a centred grid of separate dies,
  // drawn as light filled squares (scribe lanes between them stay white).
  const cx = 192, cy = 57, R = 27, die = 4.4, lane = 0.9, step = die + lane
  const nw = 1.8
  const a0 = Math.asin(nw / R)
  const sx = cx + R * Math.sin(a0), sy = cy + R * Math.cos(a0)
  const outline = `M ${(2 * cx - sx).toFixed(2)} ${sy.toFixed(2)} A ${R} ${R} 0 1 1 ${sx.toFixed(2)} ${sy.toFixed(2)} L ${cx} ${(cy + R - 2.2).toFixed(2)} Z`
  const out = []
  const inR = R - 1.8
  const n = Math.ceil(inR / step) + 1
  for (let j = -n; j < n; j++) {
    for (let i = -n; i < n; i++) {
      const x = cx + i * step + lane / 2, y = cy + j * step + lane / 2
      if (x + die > 211) continue
      const corners = [[x, y], [x + die, y], [x, y + die], [x + die, y + die]]
      if (corners.every(([px, py]) => (px - cx) ** 2 + (py - cy) ** 2 <= inR * inR)) {
        out.push({ type: 'rect', x, y, w: die, h: die, fill: c })
      }
    }
  }
  out.push({ type: 'path', d: outline, stroke: c, width: 0.7 })
  return out
}

function motifMolecule(c) {
  const out = []
  const R = 6.5
  const hex = (cx, cy) => {
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i + Math.PI / 6
      return [cx + R * Math.cos(a), cy + R * Math.sin(a)]
    })
    return pts
  }
  const w = R * Math.sqrt(3)
  const centres = [[176, 44], [176 + w, 44], [176 + w / 2, 44 + 1.5 * R], [176 + 1.5 * w, 44 + 1.5 * R], [176 + 2 * w, 44]]
  const atoms = new Map()
  let d = ''
  for (const [x, y] of centres) {
    const pts = hex(x, y)
    d += 'M ' + pts.map(([px, py]) => `${px.toFixed(2)} ${py.toFixed(2)}`).join(' L ') + ' Z '
    pts.forEach(([px, py]) => atoms.set(`${px.toFixed(1)},${py.toFixed(1)}`, [px, py]))
  }
  // side chains
  d += `M ${centres[0][0] - w / 2} ${44 - R / 2} L ${centres[0][0] - w / 2 - 7} ${44 - R / 2 - 4} `
  d += `M ${centres[2][0]} ${centres[2][1] + R} L ${centres[2][0]} ${centres[2][1] + R + 8} `
  out.push({ type: 'path', d, stroke: c, width: 0.7 })
  for (const [px, py] of atoms.values()) out.push({ type: 'circle', cx: px, cy: py, r: 0.9, fill: c, stroke: c, width: 0.1 })
  out.push({ type: 'circle', cx: centres[0][0] - w / 2 - 7, cy: 44 - R / 2 - 4, r: 1.6, fill: '#FFFFFF', stroke: c, width: 0.7 })
  out.push({ type: 'circle', cx: centres[2][0], cy: centres[2][1] + R + 8, r: 1.6, fill: '#FFFFFF', stroke: c, width: 0.7 })
  return out
}

function motifSignal(c) {
  const x0 = 156, x1 = 211
  const sine = (y, amp, period) => {
    let d = ''
    for (let x = x0; x <= x1; x += 0.8) d += `${d ? 'L' : 'M'} ${x.toFixed(2)} ${(y - amp * Math.sin(((x - x0) / period) * 2 * Math.PI)).toFixed(2)} `
    return d
  }
  let sq = `M ${x0} 58`
  for (let x = x0, hi = false; x < x1; x += 5) {
    const ny = hi ? 58 : 52
    sq += ` L ${x} ${ny} L ${Math.min(x + 5, x1)} ${ny}`
    hi = !hi
  }
  let pulse = ''
  for (let x = x0; x <= x1; x += 0.6) {
    const t = x - 170
    const y = 74 - (t > 0 ? 9 * Math.exp(-t / 9) * Math.cos(t * 0.9) : 0)
    pulse += `${pulse ? 'L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)} `
  }
  return [
    { type: 'path', d: `M ${x0} 30 L ${x0} 82`, stroke: c, width: 0.35 },
    { type: 'path', d: sine(40, 4, 14), stroke: c, width: 0.7 },
    { type: 'path', d: sq, stroke: c, width: 0.7 },
    { type: 'path', d: pulse, stroke: c, width: 0.7 },
  ]
}

function motifDots(c) {
  const out = []
  for (let y = 31; y <= 83; y += 4.4) {
    for (let x = 209; x >= 150; x -= 4.4) {
      const k = (x - 150) / 59 - (y - 31) / 70 // fade towards the bottom left
      if (k <= 0.05) continue
      out.push({ type: 'circle', cx: x, cy: y, r: 0.35 + 0.65 * Math.min(1, k), fill: c, stroke: c, width: 0.01 })
    }
  }
  return out
}

function motif(kind, color) {
  switch (kind) {
    case 'circuit': return motifCircuit(color)
    case 'fluidic': return motifFluidic(color)
    case 'wafer': return motifWafer(color)
    case 'molecule': return motifMolecule(color)
    case 'signal': return motifSignal(color)
    case 'dots': return motifDots(color)
    default: return []
  }
}

// ------------------------------------------------------------ layout
// t: template (texts, colours, options), logos: [{ w, h }] natural sizes,
// name: participant name or '' (blank line).
export function layoutCertificate(t, fonts, logos, name) {
  const P = t.primary || '#083777'
  const A = t.accent || '#FBCA07'
  const D = t.textColor || '#10243D'
  const MUTED = mix(D, '#FFFFFF', 0.38)
  const items = []
  const warnings = []
  const text = (x, y, size, str, weight, color, opts = {}) => {
    if (!str) return
    items.push({ type: 'text', x, y, size, text: str, weight, color, anchor: opts.anchor || 'start', ls: opts.ls || 0, role: opts.role })
  }

  // logos: one row, first left-aligned, last right-aligned, the rest centred in between
  const lh = t.logoHeight || 12
  const top = 12.5
  const placed = logos.map((l) => {
    let h = lh, w = (l.w / l.h) * lh
    const maxW = logos.length > 2 ? 62 : 90
    if (w > maxW) { w = maxW; h = (l.h / l.w) * maxW }
    return { w, h }
  })
  if (placed.length) {
    const total = placed.reduce((s, p) => s + p.w, 0)
    const la = t.alignLogos || 'spread'
    const spread = la === 'spread' && placed.length > 1
    const gap = spread ? (CONTENT_W - total) / (placed.length - 1) : 8
    const rowW = total + gap * (placed.length - 1)
    let x = spread || la === 'left' || la === 'spread' ? M : la === 'right' ? PAGE.w - M - rowW : (PAGE.w - rowW) / 2
    placed.forEach((p, i) => {
      items.push({ type: 'image', index: i, x, y: top + (lh - p.h) / 2, w: p.w, h: p.h })
      x += p.w + gap
    })
    if ((spread && gap < 4) || rowW > CONTENT_W) warnings.push('Logos are crowded: lower the logo height or use fewer logos.')
  }

  const motifKind = MOTIFS[t.motif] ? t.motif : 'none'
  items.push(...motif(motifKind, mix(P, '#FFFFFF', motifKind === 'wafer' ? 0.86 : 0.8)))

  // alignment helpers: x position and anchor for a block aligned left/center/right
  const AL = (a) => (a === 'center' ? { x: PAGE.w / 2, anchor: 'middle' } : a === 'right' ? { x: PAGE.w - M, anchor: 'end' } : { x: M, anchor: 'start' })

  // heading (always left: it pairs with the accent bar)
  const hs = fitSize(fonts, 'bold', t.heading, 25, motifKind !== 'none' ? 138 : CONTENT_W, 14, 1.2)
  text(M - 0.8, 66, hs, t.heading, 'bold', P, { ls: 1.2 })
  items.push({ type: 'rect', x: M, y: 71.5, w: 20, h: 1.6, fill: A })
  text(M + 24, 73.4, 6.6, t.subheading, 'bold', D, { ls: 1.4 })

  // name
  const na = AL(t.alignName)
  const nameStr = name || ''
  const nmax = 11
  let ns = nmax
  if (nameStr) {
    ns = fitSize(fonts, 'bold', nameStr, nmax, CONTENT_W * 0.98, nmax * 0.55)
    if (textWidth(fonts, 'bold', nameStr, ns) > CONTENT_W) warnings.push(`"${nameStr}" is too long and overflows the name line.`)
  }
  const nameY = 102.5 - (nmax - ns) * 0.35
  text(na.x, nameY, ns, nameStr, 'bold', P, { role: 'name', anchor: na.anchor })
  items.push({ type: 'rect', x: M, y: 107.5, w: CONTENT_W, h: 0.4, fill: P })
  text(na.x, 113.5, 4, t.nameCaption, 'regular', MUTED, { anchor: na.anchor })

  // event
  const ea = AL(t.alignEvent)
  let y = 130
  text(ea.x, y, 4, t.eventLabel, 'bold', MUTED, { ls: 0.6, anchor: ea.anchor })
  y += 9
  const titleLines = wrap(fonts, 'bold', t.eventTitle, 8.4, CONTENT_W)
  titleLines.slice(0, 2).forEach((ln, i) => {
    if (i) y += 9.4
    text(ea.x, y, 8.4, ln, 'bold', P, { anchor: ea.anchor })
  })
  if (titleLines.length > 2) warnings.push('Event title is longer than two lines; shorten it.')
  if (t.eventSubtitle) { y += 8; text(ea.x, y, 4.8, t.eventSubtitle, 'regular', D, { anchor: ea.anchor }) }
  if (t.eventDetails) { y += 7; text(ea.x, y, 4.4, t.eventDetails, 'regular', D, { anchor: ea.anchor }) }

  // programme: the bar sits on the aligned side; centred lists have no bar
  const pa = AL(t.alignProgram)
  const prog = String(t.program || '').split('\n').map((s) => s.trim()).filter(Boolean)
  const twoSig = !!(t.sig2Name || t.sig2Role)
  const sa = t.alignSign || 'split'
  const sigTop = twoSig || sa === 'center' ? 222 : 236 // keep the programme above the signature block
  if (prog.length) {
    y += 18
    text(pa.x, y, 4, t.programLabel, 'bold', MUTED, { ls: 0.6, anchor: pa.anchor })
    const barTop = y + 4
    y = barTop + 5.5
    const ix = pa.anchor === 'start' ? M + 5 : pa.anchor === 'end' ? PAGE.w - M - 5 : PAGE.w / 2
    let lines = 0
    for (const item of prog) {
      const wl = wrap(fonts, 'regular', item, 4.4, CONTENT_W - 6)
      wl.forEach((ln, j) => {
        if (lines) y += j ? 5.6 : 8
        text(ix, y, 4.4, ln, 'regular', D, { anchor: pa.anchor })
        lines++
      })
    }
    if (pa.anchor !== 'middle') {
      items.push({ type: 'rect', x: pa.anchor === 'start' ? M : PAGE.w - M - 0.8, y: barTop, w: 0.8, h: y - barTop + 3.5, fill: P })
    }
    if (y > sigTop) warnings.push('The programme is too long and runs into the signature block; shorten it.')
  }

  // place/date of signing and signatures
  const sigAt = (x0, x1, n, r) => {
    const cx = (x0 + x1) / 2
    items.push({ type: 'rect', x: x0, y: 243.6, w: x1 - x0, h: 0.3, fill: D })
    text(cx, 250, 4.4, n, 'bold', D, { anchor: 'middle' })
    text(cx, 255.5, 4, r, 'regular', D, { anchor: 'middle' })
  }
  if (twoSig) {
    const da = AL(sa === 'split' ? 'left' : sa === 'mirror' ? 'right' : 'center')
    text(da.x, 226, 4.4, t.placeDate, 'regular', D, { anchor: da.anchor })
    sigAt(M, 85, t.sig1Name, t.sig1Role)
    sigAt(125, PAGE.w - M, t.sig2Name, t.sig2Role)
  } else if (sa === 'center') {
    text(PAGE.w / 2, 226, 4.4, t.placeDate, 'regular', D, { anchor: 'middle' })
    sigAt(65, 145, t.sig1Name, t.sig1Role)
  } else if (sa === 'mirror') {
    text(PAGE.w - M, 244, 4.4, t.placeDate, 'regular', D, { anchor: 'end' })
    sigAt(M, 95, t.sig1Name, t.sig1Role)
  } else {
    text(M, 244, 4.4, t.placeDate, 'regular', D)
    sigAt(115, PAGE.w - M, t.sig1Name, t.sig1Role)
  }

  // footer
  const fa = AL(t.alignFooter)
  if (t.footerBand !== false) {
    items.push({ type: 'rect', x: 0, y: 270, w: PAGE.w, h: 27, fill: P })
    items.push({ type: 'rect', x: 0, y: 270, w: PAGE.w, h: 1.2, fill: A })
    const fc = onColor(P)
    text(fa.x, 283, 4.4, t.footer1, 'bold', fc, { anchor: fa.anchor })
    text(fa.x, 289, 4, t.footer2, 'regular', fc, { anchor: fa.anchor })
  } else {
    items.push({ type: 'rect', x: M, y: 270, w: CONTENT_W, h: 0.5, fill: P })
    text(fa.x, 280, 4.4, t.footer1, 'bold', P, { anchor: fa.anchor })
    text(fa.x, 286, 4, t.footer2, 'regular', D, { anchor: fa.anchor })
  }

  // where a fillable name field goes (blank certificate)
  const nameField = { x: M, y: 92, w: CONTENT_W, h: 14, align: t.alignName || 'left', color: P }
  return { items, warnings, nameField }
}

// Characters a font cannot draw (for the warning shown under the preview).
export function missingGlyphs(fonts, strings) {
  const miss = new Set()
  for (const [weight, s] of strings) {
    const f = fonts[weight]
    if (!f || !s) continue
    for (const ch of s) {
      if (/\s/.test(ch)) continue
      if (!f.hasGlyphForCodePoint(ch.codePointAt(0))) miss.add(ch)
    }
  }
  return [...miss]
}

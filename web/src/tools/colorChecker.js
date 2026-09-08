import { initChrome } from '../shared/nav.js'
initChrome('color-checker')

const DEFAULT_PALETTE = ['#4c9aff', '#f85149', '#2ea043', '#d29922', '#a371f7', '#f778ba']

let palette = [...DEFAULT_PALETTE]
let bgColor = '#ffffff'

const swatchList = document.getElementById('cc-swatch-list')
const addBtn = document.getElementById('cc-add-btn')
const bgPicker = document.getElementById('cc-bg-picker')
const showLabels = document.getElementById('cc-show-labels')

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(c => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')
}

function linearize(c) {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

function relativeLuminance([r, g, b]) {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

function contrastRatio(c1, c2) {
  const l1 = relativeLuminance(c1)
  const l2 = relativeLuminance(c2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

// Brettel et al. 1997 — colorblind simulation via LMS transform
const sRGBtoLMS = [
  [0.31399022, 0.63951294, 0.04649755],
  [0.15537241, 0.75789446, 0.08670142],
  [0.01775239, 0.10944209, 0.87256922],
]
const LMStoSRGB = [
  [5.47221206, -4.6419601, 0.16963708],
  [-1.1252419, 2.29317094, -0.1678952],
  [0.02980165, -0.19318073, 1.16364789],
]

function matMul(m, v) {
  return m.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2])
}

function simulateCVD(rgb, type) {
  const lin = rgb.map(c => linearize(c) * 255)
  const lms = matMul(sRGBtoLMS, lin)

  let simLms
  switch (type) {
    case 'protan':
      simLms = [0.0 * lms[0] + 2.02344 * lms[1] + -2.52581 * lms[2], lms[1], lms[2]]
      break
    case 'deutan':
      simLms = [lms[0], 0.49421 * lms[0] + 0.0 * lms[1] + 1.24827 * lms[2], lms[2]]
      break
    case 'tritan':
      simLms = [lms[0], lms[1], -0.01224 * lms[0] + 0.07203 * lms[1] + 0.0 * lms[2]]
      break
    case 'achrom': {
      const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
      return [y, y, y].map(c => {
        const s = c / 255
        const v = s <= 0.0031308 ? s * 12.92 : 1.055 * Math.pow(s, 1 / 2.4) - 0.055
        return Math.round(Math.max(0, Math.min(255, v * 255)))
      })
    }
    default:
      return rgb
  }

  const simLin = matMul(LMStoSRGB, simLms)
  return simLin.map(c => {
    const s = c / 255
    const v = s <= 0.0031308 ? s * 12.92 : 1.055 * Math.pow(s, 1 / 2.4) - 0.055
    return Math.round(Math.max(0, Math.min(255, v * 255)))
  })
}

function simulateHex(hex, type) {
  if (type === 'normal') return hex
  return rgbToHex(...simulateCVD(hexToRgb(hex), type))
}

function renderSwatchList() {
  swatchList.innerHTML = ''
  palette.forEach((hex, i) => {
    const row = document.createElement('div')
    row.className = 'cc-swatch-row'

    const picker = document.createElement('input')
    picker.type = 'color'
    picker.value = hex

    const text = document.createElement('input')
    text.type = 'text'
    text.value = hex

    const removeBtn = document.createElement('button')
    removeBtn.className = 'btn btn-danger'
    removeBtn.textContent = '×'
    removeBtn.addEventListener('click', () => { palette.splice(i, 1); update() })

    picker.addEventListener('input', () => { palette[i] = picker.value; text.value = picker.value; update() })
    text.addEventListener('change', () => {
      const v = text.value.trim()
      if (/^#[0-9a-f]{6}$/i.test(v)) { palette[i] = v; picker.value = v; update() }
      else text.value = palette[i]
    })

    row.append(picker, text, removeBtn)
    swatchList.appendChild(row)
  })
}

function renderStrip(containerId, type) {
  const el = document.getElementById(containerId)
  el.innerHTML = ''
  palette.forEach(hex => {
    const d = document.createElement('div')
    const simHex = simulateHex(hex, type)
    d.style.background = simHex
    const lum = relativeLuminance(hexToRgb(simHex))
    d.style.color = lum > 0.35 ? '#000' : '#fff'
    if (showLabels.checked) d.textContent = hex
    el.appendChild(d)
  })
}

function makeMiniChart(colors, bg) {
  const w = 360, h = 160, pad = 40
  const n = 30
  const series = colors.map((_, si) => {
    const pts = []
    let y = 0.3 + si * 0.12
    for (let i = 0; i <= n; i++) {
      y += (Math.sin(i * 0.4 + si * 2) * 0.03 + (Math.random() - 0.5) * 0.02)
      pts.push({ x: pad + (i / n) * (w - 2 * pad), y: pad + (1 - Math.max(0, Math.min(1, y))) * (h - 2 * pad) })
    }
    return pts
  })

  let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`
  svg += `<rect width="${w}" height="${h}" fill="${bg}" rx="4"/>`

  const axisColor = relativeLuminance(hexToRgb(bg)) > 0.35 ? '#666' : '#999'
  svg += `<line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h - pad}" stroke="${axisColor}" stroke-width="1"/>`
  svg += `<line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="${axisColor}" stroke-width="1"/>`

  series.forEach((pts, si) => {
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    svg += `<path d="${d}" fill="none" stroke="${colors[si]}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  })

  svg += '</svg>'
  return svg
}

function renderFigPreview(containerId, type) {
  const el = document.getElementById(containerId)
  const simBg = simulateHex(bgColor, type)
  const simColors = palette.map(c => simulateHex(c, type))
  el.style.background = simBg
  el.innerHTML = makeMiniChart(simColors, simBg)
}

function renderContrastTable() {
  const table = document.getElementById('cc-contrast-table')
  const bgRgb = hexToRgb(bgColor)
  let html = '<tr><th>Color</th><th>Hex</th><th>Ratio vs bg</th><th>AA text</th><th>AA large</th><th>AAA text</th></tr>'

  palette.forEach(hex => {
    const rgb = hexToRgb(hex)
    const ratio = contrastRatio(rgb, bgRgb)
    const r = ratio.toFixed(2)
    const aaText = ratio >= 4.5 ? '<span class="cc-pass">Pass</span>' : '<span class="cc-fail">Fail</span>'
    const aaLarge = ratio >= 3.0 ? '<span class="cc-pass">Pass</span>' : '<span class="cc-fail">Fail</span>'
    const aaaText = ratio >= 7.0 ? '<span class="cc-pass">Pass</span>' : '<span class="cc-fail">Fail</span>'
    html += `<tr>
      <td><span style="display:inline-block;width:18px;height:18px;background:${hex};border-radius:3px;vertical-align:middle;border:1px solid var(--border)"></span></td>
      <td style="font-family:var(--font-mono);font-size:0.82rem">${hex}</td>
      <td>${r}:1</td><td>${aaText}</td><td>${aaLarge}</td><td>${aaaText}</td>
    </tr>`
  })

  table.innerHTML = html
}

function renderPairTable() {
  const table = document.getElementById('cc-pair-table')
  if (palette.length < 2) { table.innerHTML = '<tr><td>Add at least 2 colors.</td></tr>'; return }

  let html = '<tr><th></th>'
  palette.forEach(h => {
    html += `<th><span style="display:inline-block;width:14px;height:14px;background:${h};border-radius:2px;border:1px solid var(--border)"></span></th>`
  })
  html += '</tr>'

  for (let i = 0; i < palette.length; i++) {
    html += `<tr><th><span style="display:inline-block;width:14px;height:14px;background:${palette[i]};border-radius:2px;border:1px solid var(--border)"></span></th>`
    for (let j = 0; j < palette.length; j++) {
      if (j <= i) { html += '<td>—</td>'; continue }
      const ratio = contrastRatio(hexToRgb(palette[i]), hexToRgb(palette[j]))
      const cls = ratio >= 3 ? 'cc-pass' : 'cc-fail'
      html += `<td class="${cls}">${ratio.toFixed(1)}:1</td>`
    }
    html += '</tr>'
  }

  table.innerHTML = html
}

function update() {
  renderSwatchList()
  const types = ['normal', 'protan', 'deutan', 'tritan', 'achrom']
  types.forEach(t => {
    renderStrip(`cc-preview-${t === 'normal' ? 'normal' : t.replace('achrom', 'achrom')}`, t)
    renderFigPreview(`cc-fig-${t === 'normal' ? 'normal' : t.replace('achrom', 'achrom')}`, t)
  })
  renderContrastTable()
  renderPairTable()
}

addBtn.addEventListener('click', () => {
  const hue = Math.round(Math.random() * 360)
  palette.push(`hsl(${hue}, 70%, 55%)`)
  const last = palette.length - 1
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = palette[last]
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  palette[last] = rgbToHex(r, g, b)
  update()
})

document.querySelectorAll('.cc-bg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    bgColor = btn.dataset.bg
    bgPicker.value = bgColor
    update()
  })
})
bgPicker.addEventListener('input', () => { bgColor = bgPicker.value; update() })
showLabels.addEventListener('change', update)

update()

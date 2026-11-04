// Logo import. Every logo becomes { name, mime, src, preview, w, h }:
//   mime     what goes into the PDF: image/svg+xml, application/pdf, image/png, image/jpeg
//   src      data URL of that content (SVG, PDF, PNG or JPG)
//   preview  data URL the browser can show (the SVG/PNG/JPG itself, or a PNG render of a PDF)
//   w, h     natural size (aspect ratio is what matters)
// EPS goes through Ghostscript (WebAssembly, loaded only when an EPS is added)
// and is stored as PDF, so SVG, PDF, AI and EPS logos all stay vector.

const MAX_BYTES = 12 * 1024 * 1024

export const LOGO_ACCEPT = '.svg,.pdf,.ai,.eps,.png,.jpg,.jpeg,image/svg+xml,application/pdf,application/postscript,image/png,image/jpeg'

function bytesToDataUrl(bytes, mime) {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  return `data:${mime};base64,${btoa(bin)}`
}

export function dataUrlToBytes(url) {
  const bin = atob(url.slice(url.indexOf(',') + 1))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

function svgSize(text) {
  const svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement
  const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number)
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { w: vb[2], h: vb[3] }
  const w = parseFloat(svg.getAttribute('width')), h = parseFloat(svg.getAttribute('height'))
  return w > 0 && h > 0 ? { w, h } : null
}

function kindOf(file, head) {
  const n = file.name.toLowerCase()
  const magic = String.fromCharCode(...head.slice(0, 4))
  if (magic === '%PDF') return 'pdf' // also Illustrator .ai saved with PDF compatibility
  if (magic === '%!PS' || (head[0] === 0xc5 && head[1] === 0xd0 && head[2] === 0xd3 && head[3] === 0xc6)) return 'eps'
  if (head[0] === 0x89 && magic.slice(1) === 'PNG') return 'png'
  if (head[0] === 0xff && head[1] === 0xd8) return 'jpeg'
  if (/\.svg$/.test(n) || file.type === 'image/svg+xml') return 'svg'
  if (/\.ai$/.test(n)) throw new Error('this .ai file was saved without PDF compatibility; save it again with "Create PDF Compatible File", or export PDF/SVG')
  throw new Error('unsupported format; use SVG, PDF, AI, EPS, PNG or JPG')
}

// ------------------------------------------------------------- PDF preview
let pdfjsPromise = null
async function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href
      return lib
    })
  }
  return pdfjsPromise
}

async function pdfPreview(bytes) {
  const lib = await pdfjs()
  const doc = await lib.getDocument({ data: bytes.slice() }).promise
  try {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(6, 1400 / Math.max(base.width, base.height))
    const vp = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(vp.width)
    canvas.height = Math.ceil(vp.height)
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, background: 'rgba(0,0,0,0)' }).promise
    return { preview: canvas.toDataURL('image/png'), w: base.width, h: base.height }
  } finally {
    doc.destroy()
  }
}

// --------------------------------------------------------- EPS -> PDF
let gsPromise = null
async function epsToPdf(bytes, onStatus) {
  onStatus?.('Loading the EPS converter (about 11 MB, only the first time)…')
  if (!gsPromise) {
    gsPromise = Promise.all([import('@okathira/ghostpdl-wasm'), import('@okathira/ghostpdl-wasm/gs.wasm?url')])
      .then(([{ default: load }, { default: wasmUrl }]) => ({ load, wasmUrl }))
  }
  const { load, wasmUrl } = await gsPromise
  onStatus?.('Converting EPS…')
  const errors = []
  const gs = await load({ locateFile: () => wasmUrl, print: () => {}, printErr: (t) => errors.push(t) })
  gs.FS.writeFile('in.eps', bytes)
  const rc = gs.callMain(['-q', '-dSAFER', '-dNOPAUSE', '-dBATCH', '-dEPSCrop', '-sDEVICE=pdfwrite', '-sOutputFile=out.pdf', 'in.eps'])
  let out = null
  try { out = gs.FS.readFile('out.pdf') } catch { /* no output */ }
  if (rc !== 0 || !out || !out.length) throw new Error(`EPS conversion failed${errors.length ? ': ' + errors.slice(-1)[0] : ''}`)
  return new Uint8Array(out)
}

// ---------------------------------------------------------------- import
export async function importLogo(file, onStatus) {
  if (file.size > MAX_BYTES) throw new Error('file is larger than 12 MB')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const kind = kindOf(file, bytes.slice(0, 4))
  const name = file.name

  if (kind === 'svg') {
    const text = new TextDecoder().decode(bytes)
    if (/<script|\son\w+\s*=|javascript:/i.test(text)) throw new Error('SVG contains scripts')
    const src = bytesToDataUrl(new TextEncoder().encode(text), 'image/svg+xml')
    let size = svgSize(text)
    if (!size) {
      const img = new Image()
      img.src = src
      await img.decode()
      size = { w: img.naturalWidth || 300, h: img.naturalHeight || 100 }
    }
    return { name, mime: 'image/svg+xml', src, preview: src, ...size }
  }

  if (kind === 'png' || kind === 'jpeg') {
    const mime = `image/${kind}`
    const src = bytesToDataUrl(bytes, mime)
    const img = new Image()
    img.src = src
    await img.decode()
    return { name, mime, src, preview: src, w: img.naturalWidth, h: img.naturalHeight }
  }

  const pdfBytes = kind === 'eps' ? await epsToPdf(bytes, onStatus) : bytes
  onStatus?.('Rendering preview…')
  const { preview, w, h } = await pdfPreview(pdfBytes)
  return { name, mime: 'application/pdf', src: bytesToDataUrl(pdfBytes, 'application/pdf'), preview, w, h }
}

// Validates logos coming from localStorage or a template file.
export function sanitizeLogo(l) {
  if (!l || typeof l.src !== 'string') return null
  const m = /^data:(image\/svg\+xml|image\/png|image\/jpeg|application\/pdf);base64,/.exec(l.src)
  if (!m) return null
  const mime = m[1]
  if (mime === 'image/svg+xml') {
    const text = new TextDecoder().decode(dataUrlToBytes(l.src))
    if (/<script|\son\w+\s*=|javascript:/i.test(text)) return null
  }
  const preview = mime === 'application/pdf' ? l.preview : l.src
  if (typeof preview !== 'string' || !/^data:image\/(png|svg\+xml|jpeg);base64,/.test(preview)) return null
  return { name: String(l.name || 'logo').slice(0, 120), mime, src: l.src, preview, w: +l.w || 1, h: +l.h || 1 }
}

// Renderers for the primitive list from layout.js: an SVG string for the live
// preview and pages in a pdf-lib document for the download.

import fontkit from '@pdf-lib/fontkit'
import { escapeHtml } from '../../shared/dom.js'
import { PAGE } from './layout.js'
import { dataUrlToBytes } from './logos.js'

const PT = 72 / 25.4 // mm -> pt

// ---------------------------------------------------------------- SVG
// families: { regular, bold } CSS font-family names registered via FontFace.
export function toSvg(items, logos, families, { nameBox = false } = {}) {
  const parts = []
  for (const it of items) {
    if (it.type === 'rect') {
      parts.push(`<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="${it.fill}"/>`)
    } else if (it.type === 'path') {
      parts.push(`<path d="${it.d}" fill="none" stroke="${it.stroke}" stroke-width="${it.width}" stroke-linejoin="round" stroke-linecap="round"/>`)
    } else if (it.type === 'circle') {
      parts.push(`<circle cx="${it.cx}" cy="${it.cy}" r="${it.r}" fill="${it.fill}" stroke="${it.stroke}" stroke-width="${it.width}"/>`)
    } else if (it.type === 'image') {
      const l = logos[it.index]
      if (l) parts.push(`<image href="${l.preview}" x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" preserveAspectRatio="xMidYMid meet"/>`)
    } else if (it.type === 'text') {
      const fam = families[it.weight]
      const anchor = it.anchor === 'middle' ? 'middle' : it.anchor === 'end' ? 'end' : 'start'
      parts.push(`<text x="${it.x}" y="${it.y}" font-family="${fam}" font-size="${it.size}" fill="${it.color}" text-anchor="${anchor}"${it.ls ? ` letter-spacing="${it.ls}"` : ''}>${escapeHtml(it.text)}</text>`)
    }
  }
  if (nameBox) {
    parts.push(`<rect x="15" y="89" width="180" height="17" fill="none" stroke="#e0a000" stroke-width="0.3" stroke-dasharray="1.2 0.8"/>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE.w} ${PAGE.h}" class="cm-page" role="img" aria-label="Certificate preview"><rect width="${PAGE.w}" height="${PAGE.h}" fill="#FFFFFF"/>${parts.join('')}</svg>`
}

// ---------------------------------------------------------------- PDF
let rgb, setCharacterSpacing // filled from the lazily loaded pdf-lib
function color(hex) {
  const h = hex.replace('#', '')
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255)
}

// PDF logos (also converted EPS) are embedded page-for-page. SVG logos stay vector: svg2pdf.js draws the SVG into a one-page PDF whose page
// pdf-lib then embeds as a Form XObject. PNG/JPG logos are embedded as they are.
// The SVG libraries load only when a PDF with an SVG logo is generated.
function svgText(dataUrl) {
  return new TextDecoder().decode(dataUrlToBytes(dataUrl))
}

async function svgToPdfBytes(logo, wPt, hPt) {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), import('svg2pdf.js')])
  const el = new DOMParser().parseFromString(svgText(logo.src), 'image/svg+xml').documentElement
  if (el.nodeName.toLowerCase() !== 'svg') throw new Error(`${logo.name} is not a valid SVG`)
  // svg2pdf reads computed styles, so the SVG has to be in the document while it draws.
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden'
  const node = document.importNode(el, true)
  host.appendChild(node)
  document.body.appendChild(host)
  try {
    const pdf = new jsPDF({ unit: 'pt', format: [wPt, hPt], orientation: wPt > hPt ? 'landscape' : 'portrait', compress: true })
    await pdf.svg(node, { x: 0, y: 0, width: wPt, height: hPt })
    return pdf.output('arraybuffer')
  } finally {
    host.remove()
  }
}

async function embedLogo(doc, logo, wMm, hMm) {
  const bytes = dataUrlToBytes(logo.src)
  if (logo.mime === 'application/pdf') {
    const [page] = await doc.embedPdf(bytes, [0])
    return { kind: 'page', obj: page }
  }
  if (logo.mime === 'image/png') return { kind: 'image', obj: await doc.embedPng(bytes) }
  if (logo.mime === 'image/jpeg') return { kind: 'image', obj: await doc.embedJpg(bytes) }
  let pdfBytes = await svgToPdfBytes(logo, wMm * PT, hMm * PT)
  // jsPDF lists the 14 standard fonts on every page. A logo without <text> uses none
  // of them, so drop the list: print shops flag non-embedded fonts.
  if (!/<text[\s>]/i.test(svgText(logo.src))) {
    const lib = await import('pdf-lib')
    const tmp = await lib.PDFDocument.load(pdfBytes)
    const res = tmp.getPage(0).node.Resources()
    if (res) res.delete(lib.PDFName.of('Font'))
    pdfBytes = await tmp.save()
  }
  const [page] = await doc.embedPdf(pdfBytes, [0])
  return { kind: 'page', obj: page }
}

// Fillable name field on page 1 (for the blank certificate). field: { x, y, w, h } in mm,
// align 'left' | 'center' | 'right', color hex. The field uses the certificate's bold
// font, registered in the form's resources so PDF readers type with it.
function addNameField(lib, doc, font, field, H) {
  const form = doc.getForm()
  const tf = form.createTextField('name')
  tf.disableMultiline()
  tf.disableScrolling()
  const al = { left: lib.TextAlignment.Left, center: lib.TextAlignment.Center, right: lib.TextAlignment.Right }
  tf.setAlignment(al[field.align] ?? lib.TextAlignment.Left)
  tf.addToPage(doc.getPage(0), {
    x: field.x * PT, y: H - (field.y + field.h) * PT, width: field.w * PT, height: field.h * PT,
    font, textColor: color(field.color), borderWidth: 0,
  })
  tf.updateAppearances(font)
  const { PDFName, PDFDict, PDFString } = lib
  // DA with size 0 = auto size, so long names shrink to fit the line when typed.
  const [r, g, b] = [1, 3, 5].map((i) => (parseInt(field.color.slice(i, i + 2), 16) / 255).toFixed(3))
  tf.acroField.dict.set(PDFName.of('DA'), PDFString.of(`/${font.name} 0 Tf ${r} ${g} ${b} rg`))
  // transparent widget: no white background or border over the certificate
  for (const w of tf.acroField.getWidgets()) {
    const mk = w.dict.lookupMaybe(PDFName.of('MK'), PDFDict)
    if (mk) { mk.delete(PDFName.of('BG')); mk.delete(PDFName.of('BC')) }
  }
  const acro = form.acroForm.dict
  let dr = acro.lookupMaybe(PDFName.of('DR'), PDFDict)
  if (!dr) { dr = doc.context.obj({}); acro.set(PDFName.of('DR'), dr) }
  let fonts = dr.lookupMaybe(PDFName.of('Font'), PDFDict)
  if (!fonts) { fonts = doc.context.obj({}); dr.set(PDFName.of('Font'), fonts) }
  fonts.set(PDFName.of(font.name), font.ref)
  acro.set(PDFName.of('NeedAppearances'), lib.PDFBool.True)
}

// pages: array of primitive lists (one per certificate). fontBytes: { regular, bold }.
export async function buildPdf(pages, logos, fontBytes, fonts, meta = {}) {
  const lib = await import('pdf-lib')
  ;({ rgb, setCharacterSpacing } = lib)
  const doc = await lib.PDFDocument.create()
  doc.registerFontkit(fontkit)
  doc.setTitle(meta.title || 'Certificates')
  doc.setCreator('Lab Tools Certificate Maker')
  doc.setProducer('Lab Tools (labtools.top)')
  // pdf-lib's subsetter breaks CFF-based OpenType fonts (magic "OTTO"); embed those whole.
  const isCff = (b) => b[0] === 0x4f && b[1] === 0x54 && b[2] === 0x54 && b[3] === 0x4f
  const pdfFonts = {
    regular: await doc.embedFont(fontBytes.regular, { subset: !isCff(fontBytes.regular) }),
    // A fillable name field needs the whole bold font: the reader draws whatever is typed.
    bold: await doc.embedFont(fontBytes.bold, { subset: !meta.field && !isCff(fontBytes.bold) }),
  }

  // Embed every logo once, reuse on all pages.
  const imgs = []
  const firstImages = pages[0]?.filter((i) => i.type === 'image') || []
  for (const it of firstImages) imgs[it.index] = await embedLogo(doc, logos[it.index], it.w, it.h)

  const W = PAGE.w * PT, H = PAGE.h * PT
  for (const items of pages) {
    const page = doc.addPage([W, H])
    for (const it of items) {
      if (it.type === 'rect') {
        page.drawRectangle({ x: it.x * PT, y: H - (it.y + it.h) * PT, width: it.w * PT, height: it.h * PT, color: color(it.fill) })
      } else if (it.type === 'path') {
        page.drawSvgPath(it.d, { x: 0, y: H, scale: PT, borderColor: color(it.stroke), borderWidth: it.width * PT, borderLineCap: 1 })
      } else if (it.type === 'circle') {
        page.drawCircle({ x: it.cx * PT, y: H - it.cy * PT, size: it.r * PT, color: color(it.fill), borderColor: color(it.stroke), borderWidth: it.width * PT })
      } else if (it.type === 'image') {
        const img = imgs[it.index]
        const box = { x: it.x * PT, y: H - (it.y + it.h) * PT, width: it.w * PT, height: it.h * PT }
        if (img?.kind === 'image') page.drawImage(img.obj, box)
        else if (img?.kind === 'page') page.drawPage(img.obj, box)
      } else if (it.type === 'text') {
        const f = pdfFonts[it.weight]
        const size = it.size * PT
        const font = fonts[it.weight]
        const run = font.layout(it.text)
        const n = [...it.text].length
        const w = (run.advanceWidth / font.unitsPerEm) * size + it.ls * PT * Math.max(0, n - 1)
        let x = it.x * PT
        if (it.anchor === 'middle') x -= w / 2
        else if (it.anchor === 'end') x -= w
        if (it.ls) page.pushOperators(setCharacterSpacing(it.ls * PT))
        page.drawText(it.text, { x, y: H - it.y * PT, size, font: f, color: color(it.color) })
        if (it.ls) page.pushOperators(setCharacterSpacing(0))
      }
    }
  }
  if (meta.field) addNameField(lib, doc, pdfFonts.bold, meta.field, H)
  return doc.save()
}

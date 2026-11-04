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
// align 'left' | 'center' | 'right', color hex.
//
// PDF readers (Acrobat, Chrome/Edge, Firefox) draw typed text themselves with the font
// named in the field's /DA. They do this reliably only with a *simple* font (one byte
// per character), not with the CID fonts used for the rest of the page: with those,
// typed text comes out as garbage. So the field gets its own simple embedding of the
// bold font, encoded as Windows-1250 (all Czech, Slovak, Polish, Hungarian and German
// letters), with the whole font file so any of those letters can be typed.
const CP1250_HIGH = [0x20ac,0,0x201a,0,0x201e,0x2026,0x2020,0x2021,0,0x2030,0x0160,0x2039,0x015a,0x0164,0x017d,0x0179,0,0x2018,0x2019,0x201c,0x201d,0x2022,0x2013,0x2014,0,0x2122,0x0161,0x203a,0x015b,0x0165,0x017e,0x017a,0x00a0,0x02c7,0x02d8,0x0141,0x00a4,0x0104,0x00a6,0x00a7,0x00a8,0x00a9,0x015e,0x00ab,0x00ac,0x00ad,0x00ae,0x017b,0x00b0,0x00b1,0x02db,0x0142,0x00b4,0x00b5,0x00b6,0x00b7,0x00b8,0x0105,0x015f,0x00bb,0x013d,0x02dd,0x013e,0x017c,0x0154,0x00c1,0x00c2,0x0102,0x00c4,0x0139,0x0106,0x00c7,0x010c,0x00c9,0x0118,0x00cb,0x011a,0x00cd,0x00ce,0x010e,0x0110,0x0143,0x0147,0x00d3,0x00d4,0x0150,0x00d6,0x00d7,0x0158,0x016e,0x00da,0x0170,0x00dc,0x00dd,0x0162,0x00df,0x0155,0x00e1,0x00e2,0x0103,0x00e4,0x013a,0x0107,0x00e7,0x010d,0x00e9,0x0119,0x00eb,0x011b,0x00ed,0x00ee,0x010f,0x0111,0x0144,0x0148,0x00f3,0x00f4,0x0151,0x00f6,0x00f7,0x0159,0x016f,0x00fa,0x0171,0x00fc,0x00fd,0x0163,0x02d9]
const FIELD_FONT = 'CertName'

function embedSimpleFieldFont(lib, doc, bytes, fk) {
  const { PDFName, PDFNumber } = lib
  const ctx = doc.context
  const upm = fk.unitsPerEm
  const s = 1000 / upm
  const codeToUni = (c) => (c < 128 ? c : CP1250_HIGH[c - 128])
  const widths = []
  const diffs = [128]
  for (let c = 32; c <= 255; c++) {
    const u = codeToUni(c)
    const has = u && fk.hasGlyphForCodePoint(u)
    widths.push(has ? Math.round(fk.glyphForCodePoint(u).advanceWidth * s) : 0)
    if (c >= 128) diffs.push(PDFName.of(u ? 'uni' + u.toString(16).toUpperCase().padStart(4, '0') : '.notdef'))
  }
  const isCff = bytes[0] === 0x4f && bytes[1] === 0x54 && bytes[2] === 0x54 && bytes[3] === 0x4f
  const file = ctx.flateStream(bytes, isCff ? { Subtype: 'OpenType' } : { Length1: bytes.length })
  const descriptor = ctx.obj({
    Type: 'FontDescriptor',
    FontName: FIELD_FONT,
    Flags: 32,
    FontBBox: [fk.bbox.minX, fk.bbox.minY, fk.bbox.maxX, fk.bbox.maxY].map((v) => Math.round(v * s)),
    ItalicAngle: 0,
    Ascent: Math.round(fk.ascent * s),
    Descent: Math.round(fk.descent * s),
    CapHeight: Math.round((fk.capHeight || fk.ascent * 0.7) * s),
    StemV: 120,
  })
  descriptor.set(PDFName.of(isCff ? 'FontFile3' : 'FontFile2'), ctx.register(file))
  // ToUnicode so copied/searched text is right
  const bf = []
  for (let c = 32; c <= 255; c++) {
    const u = codeToUni(c)
    if (u) bf.push(`<${c.toString(16).padStart(2, '0')}> <${u.toString(16).padStart(4, '0')}>`)
  }
  let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n'
  for (let i = 0; i < bf.length; i += 100) {
    const chunk = bf.slice(i, i + 100)
    cmap += `${chunk.length} beginbfchar\n${chunk.join('\n')}\nendbfchar\n`
  }
  cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n'
  const font = ctx.obj({
    Type: 'Font',
    Subtype: isCff ? 'Type1' : 'TrueType',
    BaseFont: FIELD_FONT,
    FirstChar: 32,
    LastChar: 255,
    Widths: widths.map((w) => PDFNumber.of(w)),
    Encoding: ctx.obj({ Type: 'Encoding', BaseEncoding: 'WinAnsiEncoding', Differences: diffs }),
  })
  font.set(PDFName.of('FontDescriptor'), ctx.register(descriptor))
  font.set(PDFName.of('ToUnicode'), ctx.register(ctx.flateStream(cmap)))
  return ctx.register(font)
}

function addNameField(lib, doc, fontBytes, fk, field, H) {
  const { PDFName, PDFString } = lib
  const ctx = doc.context
  const form = doc.getForm()
  const fontRef = embedSimpleFieldFont(lib, doc, fontBytes, fk)
  const tf = form.createTextField('name')
  tf.disableMultiline()
  tf.disableScrolling()
  const al = { left: lib.TextAlignment.Left, center: lib.TextAlignment.Center, right: lib.TextAlignment.Right }
  tf.setAlignment(al[field.align] ?? lib.TextAlignment.Left)
  const rect = { x: field.x * PT, y: H - (field.y + field.h) * PT, width: field.w * PT, height: field.h * PT }
  tf.addToPage(doc.getPage(0), { ...rect, borderWidth: 0 })
  // DA: size 0 = auto, so long names shrink to fit the line when typed.
  const [r, g, b] = [1, 3, 5].map((i) => (parseInt(field.color.slice(i, i + 2), 16) / 255).toFixed(3))
  tf.acroField.dict.set(PDFName.of('DA'), PDFString.of(`/${FIELD_FONT} 0 Tf ${r} ${g} ${b} rg`))
  // Transparent, empty widget: no background, no border, no pre-drawn text.
  for (const w of tf.acroField.getWidgets()) {
    w.dict.set(PDFName.of('MK'), ctx.obj({}))
    const apRef = ctx.register(ctx.stream('/Tx BMC EMC', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, rect.width, rect.height], Resources: ctx.obj({ Font: ctx.obj({ [FIELD_FONT]: fontRef }) }) }))
    w.dict.set(PDFName.of('AP'), ctx.obj({ N: apRef }))
  }
  // The font must sit in the form's default resources for readers to type with it.
  const acro = form.acroForm.dict
  acro.set(PDFName.of('DR'), ctx.obj({ Font: ctx.obj({ [FIELD_FONT]: fontRef }) }))
  acro.set(PDFName.of('DA'), PDFString.of(`/${FIELD_FONT} 0 Tf 0 g`))
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
    bold: await doc.embedFont(fontBytes.bold, { subset: !isCff(fontBytes.bold) }),
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
  if (meta.field) addNameField(lib, doc, fontBytes.bold, fonts.bold, meta.field, H)
  // keep our own (empty) field appearance; pdf-lib would otherwise redraw it with Helvetica
  return doc.save({ updateFieldAppearances: false })
}

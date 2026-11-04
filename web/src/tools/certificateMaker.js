import fontkit from '@pdf-lib/fontkit'
import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { downloadBlob, downloadText } from '../shared/download.js'
import { escapeHtml } from '../shared/dom.js'
import { parseTableFile } from '../shared/parseTable.js'
import { PRESETS, NAME_PLACEHOLDER, MOTIFS, layoutCertificate, missingGlyphs } from './certificate/layout.js'
import { toSvg, buildPdf } from './certificate/render.js'
import { importLogo, sanitizeLogo } from './certificate/logos.js'
import geistRegularUrl from '../assets/fonts/Geist-Regular.ttf?url'
import geistBoldUrl from '../assets/fonts/Geist-Bold.ttf?url'
import vafleRegularUrl from '../assets/fonts/VafleVUT-Regular.ttf?url'
import vafleBoldUrl from '../assets/fonts/VafleVUT-Bold.ttf?url'

const FONT_PRESETS = {
  vafle: { regular: vafleRegularUrl, bold: vafleBoldUrl, label: 'Vafle VUT' },
  geist: { regular: geistRegularUrl, bold: geistBoldUrl, label: 'Geist' },
}

initChrome('certificate-maker')

const STORE_KEY = 'lab-tools-certificate-template'
const MAX_LOGOS = 4
const $ = (id) => document.getElementById(id)

const DEFAULT_LOOK = {
  primary: '#083777', accent: '#FBCA07', textColor: '#10243D', footerBand: true, motif: 'circuit',
  logoHeight: 12, alignLogos: 'spread', fontPreset: 'vafle',
  alignName: 'left', alignEvent: 'left', alignProgram: 'left', alignSign: 'split', alignFooter: 'left',
}
const CHOICES = {
  alignName: ['left', 'center', 'right'], alignEvent: ['left', 'center', 'right'], alignProgram: ['left', 'center', 'right'],
  alignFooter: ['left', 'center', 'right'], alignSign: ['split', 'mirror', 'center'], alignLogos: ['spread', 'left', 'center', 'right'],
  motif: Object.keys(MOTIFS),
}
const defaults = (lang) => ({ lang, ...PRESETS[lang], ...DEFAULT_LOOK })

let tpl = defaults('cs')
let logos = [] // { name, mime, src, preview, w, h }, see certificate/logos.js
let names = []
const font = { regular: null, bold: null } // { bytes, fk, family, label }
let familySeq = 0

// ------------------------------------------------------------ persistence
function save() {
  const data = { version: 1, template: tpl, logos: logos.map(({ name, mime, src, preview, w, h }) => ({ name, mime, src, preview: mime === 'application/pdf' ? preview : undefined, w, h })) }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data))
  } catch {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ ...data, logos: [] }))
      showMsg('warning', 'The logos are too large to keep in this browser. Save a template file to keep them.')
    } catch { /* storage unavailable: work in memory only */ }
  }
}

function applyData(data) {
  if (!data || typeof data !== 'object' || !data.template) throw new Error('Not a certificate template file.')
  const lang = data.template.lang === 'en' ? 'en' : 'cs'
  const base = defaults(lang)
  tpl = { ...base }
  for (const k of Object.keys(base)) if (k in data.template) tpl[k] = data.template[k]
  if (!('motif' in data.template) && data.template.traces === false) tpl.motif = 'none' // older templates
  for (const [k, allowed] of Object.entries(CHOICES)) if (!allowed.includes(tpl[k])) tpl[k] = base[k]
  if (!FONT_PRESETS[tpl.fontPreset]) tpl.fontPreset = 'vafle'
  logos = Array.isArray(data.logos) ? data.logos.map(sanitizeLogo).filter(Boolean).slice(0, MAX_LOGOS) : []
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) applyData(JSON.parse(raw))
  } catch { tpl = defaults('cs'); logos = [] }
}

// ------------------------------------------------------------------ fonts
async function setFont(weight, bytes, label) {
  const fk = fontkit.create(bytes)
  if (!fk || typeof fk.layout !== 'function') throw new Error('Font collections (TTC) are not supported; use a single TTF or OTF.')
  const family = `cm-${weight}-${++familySeq}`
  const face = new FontFace(family, bytes)
  await face.load()
  document.fonts.add(face)
  font[weight] = { bytes, fk, family, label }
  $(`cm-font-${weight === 'regular' ? 'reg' : 'bold'}-name`).textContent = label
}

async function loadDefaultFonts() {
  const p = FONT_PRESETS[tpl.fontPreset] || FONT_PRESETS.vafle
  const [r, b] = await Promise.all([p.regular, p.bold].map((u) => fetch(u).then((res) => res.arrayBuffer())))
  await setFont('regular', new Uint8Array(r), `${p.label} Regular`)
  await setFont('bold', new Uint8Array(b), `${p.label} Bold`)
}

async function onFontFile(weight, file) {
  if (!file) return
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    await setFont(weight, bytes, `${file.name} (this tab only)`)
    render()
  } catch (e) {
    showMsg('danger', `Could not read ${escapeHtml(file.name)}: ${escapeHtml(e.message || 'unsupported font')}.`)
  }
}

// ------------------------------------------------------------------ logos
async function onLogoFiles(files) {
  for (const f of files) {
    if (logos.length >= MAX_LOGOS) { showMsg('warning', `At most ${MAX_LOGOS} logos.`); break }
    try {
      logos.push(await importLogo(f, (status) => showMsg('info', escapeHtml(status))))
      $('cm-msg').innerHTML = ''
    } catch (e) {
      console.error(e)
      showMsg('danger', `${escapeHtml(f.name)}: ${escapeHtml(e.message || 'could not be read')}.`)
    }
  }
  $('cm-logo-file').value = ''
  renderLogoList()
  save()
  render()
}

function renderLogoList() {
  const el = $('cm-logos')
  el.innerHTML = logos
    .map((l, i) => `
      <div class="cm-logo">
        <img src="${l.preview}" alt="" />
        <span title="${escapeHtml(l.name)}">${escapeHtml(l.name)}</span>
        <button class="btn" type="button" data-act="left" data-i="${i}" aria-label="Move left" ${i === 0 ? 'disabled' : ''}>&lt;</button>
        <button class="btn" type="button" data-act="right" data-i="${i}" aria-label="Move right" ${i === logos.length - 1 ? 'disabled' : ''}>&gt;</button>
        <button class="btn" type="button" data-act="del" data-i="${i}">Remove</button>
      </div>`)
    .join('')
}

$('cm-logos').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]')
  if (!b) return
  const i = +b.dataset.i
  if (b.dataset.act === 'del') logos.splice(i, 1)
  if (b.dataset.act === 'left' && i > 0) [logos[i - 1], logos[i]] = [logos[i], logos[i - 1]]
  if (b.dataset.act === 'right' && i < logos.length - 1) [logos[i + 1], logos[i]] = [logos[i], logos[i + 1]]
  renderLogoList()
  save()
  render()
})

// ------------------------------------------------------------------ names
function parseNames(text) {
  return text.split(/\r?\n/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

let table = null
function fillFromTable() {
  const col = $('cm-col').value
  const list = table.rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '').map(String)
  if (table.headerIsData) list.unshift(col)
  $('cm-names').value = list.join('\n')
  syncNames()
}

async function onTableFile(files) {
  const f = files[0]
  if (!f) return
  try {
    const t = await parseTableFile(f)
    if (!t.columns.length) throw new Error('the file is empty')
    const pick = t.columns.findIndex((c) => /jm[eé]no|name|účastn|ucastn|participant/i.test(c))
    table = { ...t, headerIsData: pick < 0 }
    const sel = $('cm-col')
    sel.innerHTML = ''
    t.columns.forEach((c, i) => {
      const o = document.createElement('option')
      o.value = c
      o.textContent = c
      if (i === Math.max(0, pick)) o.selected = true
      sel.appendChild(o)
    })
    $('cm-col-field').hidden = t.columns.length < 2
    fillFromTable()
  } catch (e) {
    showMsg('danger', `Could not read ${escapeHtml(f.name)}: ${escapeHtml(e.message || 'unknown format')}.`)
  }
  $('cm-file').value = ''
}

function syncNames() {
  names = parseNames($('cm-names').value)
  $('cm-count').textContent = names.length === 1 ? '1 certificate' : `${names.length} certificates`
  const sel = $('cm-which')
  const prev = sel.value
  sel.innerHTML = ''
  const add = (v, label) => {
    const o = document.createElement('option')
    o.value = v
    o.textContent = label
    sel.appendChild(o)
  }
  if (!names.length) add('placeholder', 'Preview with a sample name')
  names.forEach((n, i) => add(String(i), `${i + 1}. ${n}`))
  add('blank', 'Blank (no name)')
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev
  render()
}

// ------------------------------------------------------------- form <-> tpl
const motifSel = $('cm-motif')
for (const [v, label] of Object.entries(MOTIFS)) {
  const o = document.createElement('option')
  o.value = v
  o.textContent = label
  motifSel.appendChild(o)
}
const fields = [...document.querySelectorAll('[data-key]')]

function writeForm() {
  $('cm-preset').value = tpl.lang
  $('cm-font-preset').value = tpl.fontPreset
  for (const el of fields) {
    const v = tpl[el.dataset.key]
    if (el.type === 'checkbox') el.checked = v !== false
    else el.value = v ?? ''
  }
  for (const k of ['primary', 'accent', 'textColor']) $(`cm-${k}-picker`).value = normHex(tpl[k]) || '#000000'
}

function normHex(v) {
  const s = String(v || '').trim()
  return /^#?[0-9a-f]{6}$/i.test(s) ? (s.startsWith('#') ? s : '#' + s).toUpperCase() : null
}

for (const el of fields) {
  el.addEventListener('input', () => {
    const k = el.dataset.key
    if (el.type === 'checkbox') tpl[k] = el.checked
    else if (el.type === 'number') tpl[k] = Math.min(20, Math.max(6, Number(el.value) || 12))
    else if (['primary', 'accent', 'textColor'].includes(k)) {
      const h = normHex(el.value)
      if (!h) return
      tpl[k] = h
      $(`cm-${k}-picker`).value = h
    } else tpl[k] = el.value
    save()
    schedule()
  })
}
for (const k of ['primary', 'accent', 'textColor']) {
  $(`cm-${k}-picker`).addEventListener('input', (e) => {
    tpl[k] = e.target.value.toUpperCase()
    $(`cm-${k}`).value = tpl[k]
    save()
    schedule()
  })
}

$('cm-preset').addEventListener('change', (e) => {
  const lang = e.target.value
  const look = Object.fromEntries(Object.keys(DEFAULT_LOOK).map((k) => [k, tpl[k]]))
  tpl = { ...defaults(lang), ...look }
  writeForm()
  save()
  render()
})

// ------------------------------------------------------------------ render
function fonts() {
  return { regular: font.regular?.fk, bold: font.bold?.fk }
}

function currentName() {
  const v = $('cm-which').value
  if (v === 'blank') return ''
  if (v === 'placeholder' || v === '') return NAME_PLACEHOLDER[tpl.lang] || NAME_PLACEHOLDER.cs
  return names[+v] ?? ''
}

function showMsg(kind, html) {
  $('cm-msg').innerHTML = `<div class="alert alert-${kind}">${html}</div>`
}

let timer = 0
function schedule() {
  clearTimeout(timer)
  timer = setTimeout(render, 80)
}

function textStrings() {
  const regular = ['nameCaption', 'eventSubtitle', 'eventDetails', 'program', 'placeDate', 'sig1Role', 'sig2Role', 'footer2']
  const bold = ['heading', 'subheading', 'eventLabel', 'eventTitle', 'programLabel', 'sig1Name', 'sig2Name', 'footer1']
  return [...regular.map((k) => ['regular', tpl[k]]), ...bold.map((k) => ['bold', tpl[k]]), ...names.map((n) => ['bold', n])]
}

function render() {
  if (!font.regular || !font.bold) return
  const fk = fonts()
  const { items, warnings } = layoutCertificate(tpl, fk, logos, currentName())
  const v = $('cm-which').value
  $('cm-sheet').innerHTML = toSvg(items, logos, { regular: font.regular.family, bold: font.bold.family }, { nameBox: v === 'blank' })
  const missing = missingGlyphs(fk, textStrings())
  const msgs = [...warnings.map(escapeHtml)]
  if (missing.length) msgs.push(`The selected font cannot draw: <span class="mono">${escapeHtml(missing.join(' '))}</span>. Load a font that covers them.`)
  $('cm-msg').innerHTML = msgs.length ? `<div class="alert alert-warning">${msgs.join('<br>')}</div>` : ''
}

// -------------------------------------------------------------- download
async function download(list, { fillable = false } = {}) {
  if (!font.regular || !font.bold) return
  const fk = fonts()
  const btns = [$('cm-generate'), $('cm-blank')]
  btns.forEach((b) => (b.disabled = true))
  try {
    const long = []
    let field = null
    const pages = list.map((n) => {
      const r = layoutCertificate(tpl, fk, logos, n)
      field = r.nameField
      if (r.warnings.some((w) => w.includes('overflows'))) long.push(n)
      return r.items
    })
    const bytes = await buildPdf(pages, logos, { regular: font.regular.bytes, bold: font.bold.bytes }, fk, { title: tpl.eventTitle || 'Certificates', field: fillable ? field : null })
    let fn = ($('cm-filename').value || 'certificates.pdf').trim()
    if (!/\.pdf$/i.test(fn)) fn += '.pdf'
    if (fillable) fn = fn.replace(/\.pdf$/i, '_fillable.pdf')
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), fn)
    showMsg(long.length ? 'warning' : 'success',
      `${list.length} ${list.length === 1 ? 'page' : 'pages'} saved to ${escapeHtml(fn)}.` +
      (long.length ? `<br>Too long for the line: ${long.map(escapeHtml).join(', ')}.` : ''))
  } catch (e) {
    console.error(e)
    showMsg('danger', `PDF could not be created: ${escapeHtml(e.message || String(e))}`)
  } finally {
    btns.forEach((b) => (b.disabled = false))
  }
}

$('cm-generate').addEventListener('click', () => {
  if (!names.length) { showMsg('warning', 'Add at least one name first, or use Blank PDF for a certificate to fill in by hand.'); return }
  download(names)
})
$('cm-blank').addEventListener('click', () => download([''], { fillable: true }))

// --------------------------------------------------------------- template
$('cm-export').addEventListener('click', () => {
  const data = { kind: 'lab-tools-certificate-template', version: 1, template: tpl, logos: logos.map(({ name, mime, src, preview, w, h }) => ({ name, mime, src, preview: mime === 'application/pdf' ? preview : undefined, w, h })) }
  downloadText(JSON.stringify(data, null, 2), 'certificate-template.json', 'application/json')
})
$('cm-import-btn').addEventListener('click', () => $('cm-import').click())
$('cm-import').addEventListener('change', async (e) => {
  const f = e.target.files[0]
  e.target.value = ''
  if (!f) return
  try {
    applyData(JSON.parse(await f.text()))
    writeForm()
    renderLogoList()
    save()
    await loadDefaultFonts()
    render()
    showMsg('success', `Template ${escapeHtml(f.name)} loaded.`)
  } catch (err) {
    showMsg('danger', `Could not load ${escapeHtml(f.name)}: ${escapeHtml(err.message || 'invalid file')}.`)
  }
})
$('cm-reset').addEventListener('click', async () => {
  tpl = defaults(tpl.lang)
  logos = []
  writeForm()
  renderLogoList()
  save()
  await loadDefaultFonts()
  render()
})

// ------------------------------------------------------------------- init
initDropzone($('cm-drop'), $('cm-file'), onTableFile)
initDropzone($('cm-logo-drop'), $('cm-logo-file'), onLogoFiles)
$('cm-col').addEventListener('change', fillFromTable)
$('cm-names').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(syncNames, 150) })
$('cm-which').addEventListener('change', render)
$('cm-font-reg').addEventListener('change', (e) => onFontFile('regular', e.target.files[0]))
$('cm-font-bold').addEventListener('change', (e) => onFontFile('bold', e.target.files[0]))
$('cm-font-preset').addEventListener('change', async (e) => {
  tpl.fontPreset = e.target.value
  $('cm-font-reg').value = ''
  $('cm-font-bold').value = ''
  save()
  await loadDefaultFonts()
  render()
})

load()
writeForm()
renderLogoList()
syncNames()
loadDefaultFonts()
  .then(render)
  .catch(() => showMsg('danger', 'The default font could not be loaded.'))

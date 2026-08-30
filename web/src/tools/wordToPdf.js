import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { escapeHtml } from '../shared/dom.js'

initChrome('word-to-pdf')

const dropzone = document.getElementById('wtp-dropzone')
const fileInput = document.getElementById('wtp-file-input')
const filenameEl = document.getElementById('wtp-filename')
const alertsEl = document.getElementById('wtp-alerts')
const emptyEl = document.getElementById('wtp-empty')
const resultEl = document.getElementById('wtp-result')
const pageEl = document.getElementById('wtp-page')
const printBtn = document.getElementById('wtp-print-btn')

initDropzone(dropzone, fileInput, (files) => {
  const file = files[0]
  if (!file) return
  loadDocx(file)
})

printBtn.addEventListener('click', () => window.print())

async function loadDocx(file) {
  alertsEl.innerHTML = ''
  filenameEl.textContent = `Converting ${file.name}…`

  try {
    // mammoth base64-encodes each image's original bytes straight out of
    // word/media/ — it does not re-encode or downsample them, which is the
    // whole reason this avoids Word's own lossy PDF export.
    const mammoth = await import('mammoth')
    const arrayBuffer = await file.arrayBuffer()
    const result = await mammoth.convertToHtml({ arrayBuffer })

    pageEl.innerHTML = result.value
    resultEl.style.display = ''
    emptyEl.style.display = 'none'
    filenameEl.textContent = `Loaded ${file.name}`

    if (result.messages && result.messages.length) {
      const items = result.messages
        .slice(0, 10)
        .map((m) => `<li>${escapeHtml(m.message)}</li>`)
        .join('')
      alertsEl.innerHTML = `
        <div class="alert alert-info">
          Converted with ${result.messages.length} note(s) (formatting only, images are unaffected):
          <ul style="margin: 0.4rem 0 0; padding-left: 1.2rem;">${items}</ul>
        </div>`
    } else {
      alertsEl.innerHTML = `<div class="alert alert-success">Converted ${escapeHtml(file.name)}. Review the preview below, then print it to PDF.</div>`
    }
  } catch (err) {
    resultEl.style.display = 'none'
    emptyEl.style.display = ''
    filenameEl.textContent = ''
    alertsEl.innerHTML = `<div class="alert alert-danger">Could not convert ${escapeHtml(file.name)}: ${escapeHtml(err.message || String(err))}</div>`
  }
}

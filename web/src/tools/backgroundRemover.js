import { initChrome } from '../shared/nav.js'
import { initDropzone } from '../shared/dropzone.js'
import { downloadBlob } from '../shared/download.js'

initChrome('background-remover')

const dropzone = document.getElementById('dropzone')
const fileInput = document.getElementById('file-input')
const removeBtn = document.getElementById('remove-btn')
const alertSlot = document.getElementById('alert-slot')
const statusLine = document.getElementById('status-line')
const statusText = document.getElementById('status-text')
const emptyState = document.getElementById('empty-state')
const compare = document.getElementById('compare')
const originalImg = document.getElementById('original-img')
const resultImg = document.getElementById('result-img')
const downloadSlot = document.getElementById('download-slot')

let currentFile = null
let originalUrl = null
let resultUrl = null
let resultBlob = null

function showAlert(kind, message) {
  alertSlot.innerHTML = message ? `<div class="alert alert-${kind}">${escapeHtml(message)}</div>` : ''
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

function baseName(name) {
  return name.replace(/\.[^./\\]+$/, '')
}

function setBusy(busy, label) {
  removeBtn.disabled = busy || !currentFile
  statusLine.hidden = !busy
  if (busy) statusText.textContent = label || 'Working…'
}

initDropzone(dropzone, fileInput, (files) => {
  const file = files[0]
  if (!file || !file.type.startsWith('image/')) {
    showAlert('danger', 'Please choose an image file.')
    return
  }

  currentFile = file
  showAlert(null)
  downloadSlot.innerHTML = ''

  if (originalUrl) URL.revokeObjectURL(originalUrl)
  if (resultUrl) URL.revokeObjectURL(resultUrl)
  resultUrl = null
  resultBlob = null

  originalUrl = URL.createObjectURL(file)
  originalImg.src = originalUrl
  resultImg.removeAttribute('src')

  emptyState.hidden = true
  compare.hidden = false
  removeBtn.disabled = false
})

removeBtn.addEventListener('click', async () => {
  if (!currentFile) return

  showAlert(null)
  setBusy(true, 'Starting…')

  try {
    const { removeBackground } = await import('@imgly/background-removal')

    const blob = await removeBackground(currentFile, {
      progress: (key, current, total) => {
        if (total) {
          const pct = Math.round((current / total) * 100)
          setBusy(true, `${key}: ${pct}%`)
        } else {
          setBusy(true, `${key}…`)
        }
      },
    })

    resultBlob = blob
    if (resultUrl) URL.revokeObjectURL(resultUrl)
    resultUrl = URL.createObjectURL(blob)
    resultImg.src = resultUrl

    showAlert('success', 'Background removed.')

    downloadSlot.innerHTML = ''
    const dlBtn = document.createElement('button')
    dlBtn.className = 'btn btn-primary'
    dlBtn.textContent = 'Download PNG'
    dlBtn.addEventListener('click', () => {
      downloadBlob(resultBlob, `no-bg_${baseName(currentFile.name)}.png`)
    })
    downloadSlot.appendChild(dlBtn)
  } catch (err) {
    console.error(err)
    showAlert(
      'danger',
      `Could not remove the background (${err?.message || err}). Try a smaller image, ` +
        'a different browser, or check your network connection (the model has to download on first use).'
    )
  } finally {
    setBusy(false)
    removeBtn.disabled = !currentFile
  }
})

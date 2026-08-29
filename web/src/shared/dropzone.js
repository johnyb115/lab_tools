// Wires up a `.dropzone` element (containing a hidden <input type="file">)
// for click-to-browse and drag-and-drop. Calls onFiles(FileList) either way.

export function initDropzone(zoneEl, inputEl, onFiles) {
  zoneEl.addEventListener('click', () => inputEl.click())

  inputEl.addEventListener('change', () => {
    if (inputEl.files && inputEl.files.length) onFiles(inputEl.files)
  })
  ;['dragenter', 'dragover'].forEach((evt) =>
    zoneEl.addEventListener(evt, (e) => {
      e.preventDefault()
      zoneEl.classList.add('is-dragover')
    })
  )
  ;['dragleave', 'drop'].forEach((evt) =>
    zoneEl.addEventListener(evt, (e) => {
      e.preventDefault()
      zoneEl.classList.remove('is-dragover')
    })
  )
  zoneEl.addEventListener('drop', (e) => {
    const files = e.dataTransfer?.files
    if (files && files.length) onFiles(files)
  })
}

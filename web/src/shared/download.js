// Small helpers for triggering client-side file downloads.

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadText(text, filename, mime = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([text], { type: mime }), filename)
}

export function downloadCSV(rows, filename) {
  downloadText(rows, filename, 'text/csv;charset=utf-8')
}

// rows: array of objects (or array of arrays with a header array passed separately)
export function toCSV(headers, dataRows) {
  const esc = (v) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.map(esc).join(',')]
  for (const row of dataRows) lines.push(row.map(esc).join(','))
  return lines.join('\n')
}

export function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

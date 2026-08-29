// Tiny escaping helpers for interpolating user-provided text (filenames,
// typed labels, etc.) into innerHTML template strings safely.

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

export function escapeAttr(s) {
  return escapeHtml(s)
}

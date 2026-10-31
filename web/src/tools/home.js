import { initChrome } from '../shared/nav.js'
import { CATEGORIES, TOOLS, matchesQuery } from '../shared/tools.js'
import { glyph } from '../shared/glyphs.js'
import { escapeHtml } from '../shared/dom.js'

initChrome('home')

const index = document.getElementById('tool-index')
const searchInput = document.getElementById('tool-search')
const catFilter = document.getElementById('cat-filter')
const empty = document.getElementById('tool-empty')
const emptyQ = document.getElementById('tool-empty-q')

document.getElementById('tool-total').textContent = TOOLS.length

index.innerHTML = CATEGORIES.map(
  (cat) => `
    <section class="cat-row" data-cat="${cat.id}" aria-labelledby="cat-${cat.id}">
      <div class="cat-row__label">
        <span class="cat-row__key" aria-hidden="true">${cat.letter}</span>
        <h2 id="cat-${cat.id}">${escapeHtml(cat.name)}</h2>
        <span class="cat-row__count">${cat.tools.length} tool${cat.tools.length === 1 ? '' : 's'}</span>
      </div>
      <div class="dies">
        ${cat.tools
          .map(
            (t) => `
            <a class="die" href="${t.href}" data-tool="${t.id}">
              <span class="die__head"><span class="die__code">${t.code}</span><span class="die__xy">${t.die}</span></span>
              <span class="die__glyph">${glyph(t.glyph)}</span>
              <span class="die__name">${escapeHtml(t.label)}</span>
              <span class="die__summary">${escapeHtml(t.summary)}</span>
              <span class="die__fmt">${escapeHtml(t.formats)}</span>
            </a>`
          )
          .join('')}
      </div>
    </section>`
).join('')

catFilter.innerHTML = [
  `<button type="button" data-cat="all" aria-pressed="true">All</button>`,
  ...CATEGORIES.map(
    (c) => `<button type="button" data-cat="${c.id}" aria-pressed="false"><span class="cat-key" aria-hidden="true">${c.letter}</span>${escapeHtml(c.name)}</button>`
  ),
].join('')

let activeCat = 'all'

function apply() {
  const q = searchInput.value.trim()
  let shown = 0
  CATEGORIES.forEach((cat) => {
    const row = index.querySelector(`.cat-row[data-cat="${cat.id}"]`)
    let rowShown = 0
    cat.tools.forEach((t) => {
      const ok = (activeCat === 'all' || activeCat === cat.id) && matchesQuery(t, q)
      row.querySelector(`[data-tool="${t.id}"]`).hidden = !ok
      if (ok) rowShown++
    })
    row.hidden = rowShown === 0
    shown += rowShown
  })
  empty.hidden = shown > 0
  emptyQ.textContent = q
}

searchInput.addEventListener('input', apply)
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const first = index.querySelector('.die:not([hidden])')
    if (first) window.location.href = first.href
  } else if (e.key === 'Escape') {
    searchInput.value = ''
    apply()
  }
})

catFilter.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-cat]')
  if (!btn) return
  activeCat = btn.dataset.cat
  catFilter.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)))
  apply()
})

document.getElementById('tool-reset').addEventListener('click', () => {
  searchInput.value = ''
  activeCat = 'all'
  catFilter.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === 'all')))
  apply()
  searchInput.focus()
})

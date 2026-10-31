import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import { CATEGORIES, TOOLS, findTool, matchesQuery } from './tools.js'
import { glyph } from './glyphs.js'
import { escapeHtml } from './dom.js'

export { CATEGORIES }
export const NAV_ITEMS = TOOLS

const SEARCH_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="6.5" cy="6.5" r="5"/><path d="m10 10 4.5 4.5"/></svg>`

const GITHUB_SVG = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`

const SUN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>`

const MOON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/></svg>`

// Reticle mark: a die with an alignment cross.
const BRAND_SVG = `<svg class="site-brand__mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2.75" y="2.75" width="18.5" height="18.5"/><path d="M12 6v12M6 12h12"/></svg>`

function isTypingTarget(el) {
  return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}

function menuHtml(activeId) {
  return CATEGORIES.map(
    (cat) => `
      <div class="nav-category" data-cat="${cat.id}">
        <div class="nav-category__title"><span class="cat-key">${cat.letter}</span>${escapeHtml(cat.name)}</div>
        ${cat.tools
          .map(
            (t) => `
            <a class="nav-tool-link${t.id === activeId ? ' is-active' : ''}" href="${t.href}" data-tool="${t.id}"${t.id === activeId ? ' aria-current="page"' : ''}>
              <span class="nav-tool-link__code">${t.code}</span>
              <span class="nav-tool-link__label">${escapeHtml(t.label)}</span>
            </a>`
          )
          .join('')}
      </div>`
  ).join('')
}

// Tool pages: kicker (die + category), drawing of the output, emoji-free title.
function decoratePageHeader(tool) {
  const ph = document.querySelector('.page-header')
  if (!ph || ph.dataset.decorated) return
  ph.dataset.decorated = '1'

  const h1 = ph.querySelector('h1')
  if (h1) {
    const first = h1.firstChild
    if (first && first.nodeType === Node.TEXT_NODE) {
      first.textContent = first.textContent.replace(/^[\s\p{Extended_Pictographic}\p{So}‍️]+/u, '')
    }
  }

  const body = document.createElement('div')
  body.className = 'page-header__body'
  while (ph.firstChild) body.appendChild(ph.firstChild)

  const kicker = document.createElement('div')
  kicker.className = 'page-header__kicker'
  kicker.innerHTML = `<span class="cat-key">${tool.category.letter}</span><span class="mono">${tool.die}</span><span>${escapeHtml(tool.category.name)}</span>`
  body.prepend(kicker)

  const fig = document.createElement('div')
  fig.className = 'page-header__glyph'
  fig.innerHTML = `${glyph(tool.glyph)}<span class="mono">${tool.code}</span>`

  ph.append(body, fig)
}

export function initChrome(activeId) {
  const header = document.getElementById('site-header')
  const footer = document.getElementById('site-footer')
  const tool = findTool(activeId)
  const isHome = activeId === 'home'

  if (tool) document.documentElement.dataset.cat = tool.category.id

  if (header) {
    const crumb = tool
      ? `<nav class="site-breadcrumb" aria-label="Breadcrumb">
           <span class="site-breadcrumb__cat">${escapeHtml(tool.category.name)}</span>
           <span class="site-breadcrumb__sep" aria-hidden="true">/</span>
           <span class="site-breadcrumb__current" aria-current="page">${escapeHtml(tool.label)}</span>
         </nav>`
      : ''

    header.innerHTML = `
      <div class="site-header__inner">
        <a class="site-brand" href="./index.html">${BRAND_SVG}<span>Lab Tools</span></a>
        ${crumb}
        <div class="site-header__spacer"></div>
        <button class="nav-toggle" id="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-dropdown">
          ${SEARCH_SVG}<span>${isHome ? 'All tools' : 'Find a tool'}</span><kbd>/</kbd>
        </button>
        <button class="icon-btn theme-toggle" id="theme-toggle" type="button" aria-label="Switch colour theme">
          <span class="theme-toggle__sun">${SUN_SVG}</span><span class="theme-toggle__moon">${MOON_SVG}</span>
        </button>
        <a class="icon-btn" href="https://github.com/johnyb115/lab_tools" target="_blank" rel="noopener" aria-label="Source on GitHub">${GITHUB_SVG}</a>
      </div>
      <div class="nav-dropdown" id="nav-dropdown" hidden>
        <div class="nav-dropdown__inner">
          <label class="nav-filter">
            ${SEARCH_SVG}
            <span class="sr-only">Filter tools</span>
            <input type="search" id="nav-filter" placeholder="Type a tool, code or format…" autocomplete="off" spellcheck="false" />
            <kbd>Esc</kbd>
          </label>
          <div class="nav-dropdown__grid">${menuHtml(activeId)}</div>
          <p class="nav-dropdown__empty" hidden>No tool matches that. Try a format like “xlsx” or a method like “fit”.</p>
        </div>
      </div>
    `

    const backdrop = document.createElement('div')
    backdrop.className = 'nav-backdrop'
    document.body.appendChild(backdrop)

    const toggle = header.querySelector('#nav-toggle')
    const dropdown = header.querySelector('#nav-dropdown')
    const filter = header.querySelector('#nav-filter')
    const empty = header.querySelector('.nav-dropdown__empty')
    const links = [...dropdown.querySelectorAll('.nav-tool-link')]

    const applyFilter = () => {
      const q = filter.value.trim()
      let shown = 0
      links.forEach((a) => {
        const ok = matchesQuery(findTool(a.dataset.tool), q)
        a.hidden = !ok
        if (ok) shown++
      })
      dropdown.querySelectorAll('.nav-category').forEach((c) => {
        c.hidden = !c.querySelector('.nav-tool-link:not([hidden])')
      })
      empty.hidden = shown > 0
    }

    const isOpen = () => !dropdown.hidden
    function openNav() {
      dropdown.hidden = false
      toggle.setAttribute('aria-expanded', 'true')
      backdrop.classList.add('is-visible')
      filter.focus()
    }
    function closeNav({ restoreFocus = true } = {}) {
      dropdown.hidden = true
      toggle.setAttribute('aria-expanded', 'false')
      backdrop.classList.remove('is-visible')
      filter.value = ''
      applyFilter()
      if (restoreFocus) toggle.focus()
    }

    toggle.addEventListener('click', () => (isOpen() ? closeNav() : openNav()))
    backdrop.addEventListener('click', () => closeNav({ restoreFocus: false }))
    filter.addEventListener('input', applyFilter)
    filter.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = links.find((a) => !a.hidden)
        if (first) window.location.href = first.href
      }
    })

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) {
        closeNav()
        return
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(document.activeElement)) {
        const homeSearch = document.getElementById('tool-search')
        e.preventDefault()
        if (homeSearch) homeSearch.focus()
        else if (!isOpen()) openNav()
      }
    })

    header.querySelector('#theme-toggle').addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'
      document.documentElement.dataset.theme = next
      try { localStorage.setItem('lab-tools-theme', next) } catch {}
      document.dispatchEvent(new CustomEvent('labtools:themechange', { detail: { theme: next } }))
    })
  }

  if (tool) decoratePageHeader(tool)

  if (footer) {
    footer.innerHTML = `
      <div class="site-footer__inner">
        <span class="site-footer__brand">${BRAND_SVG}Lab Tools</span>
        <span>Runs in your browser. Nothing you open here is uploaded.</span>
        <span class="site-footer__links"><a href="./privacy.html">Privacy &amp; security</a><a href="https://github.com/johnyb115/lab_tools" target="_blank" rel="noopener">Source on GitHub</a></span>
      </div>
    `
  }
}

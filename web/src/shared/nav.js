export const CATEGORIES = [
  {
    name: 'Electrochemistry',
    icon: '⚡',
    tools: [
      { id: 'voltammetry', label: 'Voltammetry (CV/DPV)', href: './voltammetry.html', icon: '⚡' },
      { id: 'eis-plotter', label: 'EIS Plotter', href: './eis-plotter.html', icon: '🌀' },
      { id: 'four-point-probe', label: 'Four-Point Probe', href: './four-point-probe.html', icon: '🧮' },
      { id: 'peak-integrator', label: 'Peak Integrator', href: './peak-integrator.html', icon: '⛰️' },
    ],
  },
  {
    name: 'Data & Analysis',
    icon: '📊',
    tools: [
      { id: 'universal-plotter', label: 'Universal Plotter', href: './universal-plotter.html', icon: '📈' },
      { id: 'curve-fit', label: 'Curve Fitting', href: './curve-fit.html', icon: '📐' },
      { id: 'data-smoother', label: 'Data Smoother', href: './data-smoother.html', icon: '〰️' },
      { id: 'stats-calculator', label: 'Uncertainty & Stats', href: './stats-calculator.html', icon: '🎯' },
      { id: 'linspace', label: 'Linspace Generator', href: './linspace.html', icon: '🔢' },
    ],
  },
  {
    name: 'Image & Figures',
    icon: '🖼️',
    tools: [
      { id: 'figure-composer', label: 'Figure Panel Composer', href: './figure-composer.html', icon: '🖼️' },
      { id: 'plot-digitizer', label: 'Plot Digitizer', href: './plot-digitizer.html', icon: '🖼️' },
      { id: 'auto-crop', label: 'Image Auto-Crop', href: './auto-crop.html', icon: '✂️' },
      { id: 'background-remover', label: 'Background Remover', href: './background-remover.html', icon: '🪄' },
      { id: 'scale-bar', label: 'Scale Bar Calibration', href: './scale-bar.html', icon: '📏' },
      { id: 'pdf-image-extractor', label: 'PDF Image Extractor', href: './pdf-image-extractor.html', icon: '📤' },
    ],
  },
  {
    name: 'Converters & Utilities',
    icon: '🔧',
    tools: [
      { id: 'table-converter', label: 'Table Format Converter', href: './table-converter.html', icon: '🔁' },
      { id: 'unit-converter', label: 'Lab Unit Converter', href: './unit-converter.html', icon: '🔬' },
      { id: 'color-checker', label: 'Color Palette Checker', href: './color-checker.html', icon: '🎨' },
      { id: 'pcb-qr', label: 'PCB QR Generator', href: './pcb-qr.html', icon: '🔲' },
    ],
  },
]

export const NAV_ITEMS = CATEGORIES.flatMap((c) => c.tools)

function findTool(activeId) {
  for (const cat of CATEGORIES) {
    const tool = cat.tools.find((t) => t.id === activeId)
    if (tool) return tool
  }
  return null
}

const GRID_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>`

const GITHUB_SVG = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`

export function initChrome(activeId) {
  const header = document.getElementById('site-header')
  const footer = document.getElementById('site-footer')
  const activeTool = findTool(activeId)
  const isHome = activeId === 'home'

  if (header) {
    const breadcrumbHtml = !isHome && activeTool
      ? `<div class="site-breadcrumb">
           <span class="site-breadcrumb__sep">/</span>
           <span class="site-breadcrumb__current">${activeTool.icon} ${activeTool.label}</span>
         </div>`
      : ''

    const dropdownHtml = CATEGORIES.map(
      (cat) => `
        <div class="nav-category">
          <div class="nav-category__title">
            <span class="nav-category__title-icon">${cat.icon}</span> ${cat.name}
          </div>
          ${cat.tools
            .map(
              (t) => `
              <a class="nav-tool-link${t.id === activeId ? ' is-active' : ''}" href="${t.href}">
                <span class="nav-tool-link__icon">${t.icon}</span>
                ${t.label}
              </a>`
            )
            .join('')}
        </div>`
    ).join('')

    header.innerHTML = `
      <div class="site-header__inner">
        <a class="site-brand" href="./index.html">
          <span class="site-brand__icon">🧪</span>
          <span>Lab Tools</span>
        </a>
        ${breadcrumbHtml}
        <div class="site-header__spacer"></div>
        <div class="site-header__right">
          <button class="nav-toggle" id="nav-toggle" type="button" aria-expanded="false">
            <span class="nav-toggle__icon">${GRID_SVG}</span>
            <span>All Tools</span>
          </button>
          <a class="site-header__link" href="https://github.com/johnyb115/lab_tools" target="_blank" rel="noopener" aria-label="GitHub">
            ${GITHUB_SVG}
          </a>
        </div>
      </div>
      <div class="nav-dropdown" id="nav-dropdown">
        <div class="nav-dropdown__inner">
          ${dropdownHtml}
        </div>
      </div>
    `

    const backdrop = document.createElement('div')
    backdrop.className = 'nav-backdrop'
    backdrop.id = 'nav-backdrop'
    document.body.appendChild(backdrop)

    const toggle = document.getElementById('nav-toggle')
    const dropdown = document.getElementById('nav-dropdown')

    function openNav() {
      toggle.classList.add('is-active')
      toggle.setAttribute('aria-expanded', 'true')
      dropdown.classList.add('is-open')
      backdrop.classList.add('is-visible')
    }

    function closeNav() {
      toggle.classList.remove('is-active')
      toggle.setAttribute('aria-expanded', 'false')
      dropdown.classList.remove('is-open')
      backdrop.classList.remove('is-visible')
    }

    toggle.addEventListener('click', () => {
      const isOpen = dropdown.classList.contains('is-open')
      if (isOpen) closeNav()
      else openNav()
    })

    backdrop.addEventListener('click', closeNav)

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dropdown.classList.contains('is-open')) closeNav()
    })
  }

  if (footer) {
    footer.innerHTML = `
      Lab Tools — client-side research utilities. Nothing you upload leaves your browser.
      <br><a href="./privacy.html">Privacy & Security</a> · <a href="https://github.com/johnyb115/lab_tools">Source on GitHub</a>
    `
  }
}

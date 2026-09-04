// Shared site header/nav + footer, injected into every page.
// Contract: each HTML page has <div id="site-header"></div> and
// <div id="site-footer"></div> placeholders; call initChrome('<id>') once
// on load, where <id> matches one of NAV_ITEMS[].id.

export const NAV_ITEMS = [
  { id: 'home', label: 'Home', href: './index.html', icon: '🏠' },
  { id: 'voltammetry', label: 'Voltammetry (CV/DPV)', href: './voltammetry.html', icon: '⚡' },
  { id: 'universal-plotter', label: 'Universal Plotter', href: './universal-plotter.html', icon: '📈' },
  { id: 'plot-digitizer', label: 'Plot Digitizer', href: './plot-digitizer.html', icon: '🖼️' },
  { id: 'four-point-probe', label: 'Four-Point Probe', href: './four-point-probe.html', icon: '🧮' },
  { id: 'linspace', label: 'Linspace Generator', href: './linspace.html', icon: '🔢' },
  { id: 'auto-crop', label: 'Image Auto-Crop', href: './auto-crop.html', icon: '✂️' },
  { id: 'background-remover', label: 'Background Remover', href: './background-remover.html', icon: '🪄' },
  { id: 'eis-plotter', label: 'EIS Plotter', href: './eis-plotter.html', icon: '🌀' },
  { id: 'peak-integrator', label: 'Peak Integrator', href: './peak-integrator.html', icon: '⛰️' },
  { id: 'scale-bar', label: 'Scale Bar Calibration', href: './scale-bar.html', icon: '📏' },
  { id: 'stats-calculator', label: 'Uncertainty & Stats', href: './stats-calculator.html', icon: '🎯' },
  { id: 'table-converter', label: 'Table Format Converter', href: './table-converter.html', icon: '🔁' },
  // { id: 'word-to-pdf', label: 'Word → High-Quality PDF', href: './word-to-pdf.html', icon: '📝' },
  { id: 'pdf-image-extractor', label: 'PDF Image Extractor', href: './pdf-image-extractor.html', icon: '📤' },
  { id: 'pcb-qr', label: 'PCB QR Generator', href: './pcb-qr.html', icon: '🔲' },
]

export function initChrome(activeId) {
  const header = document.getElementById('site-header')
  const footer = document.getElementById('site-footer')

  if (header) {
    header.innerHTML = `
      <div class="site-header__inner">
        <a class="site-brand" href="./index.html">
          <span class="site-brand__mark">🧪</span>
          <span>Lab Tools</span>
        </a>
        <nav class="site-nav">
          ${NAV_ITEMS.filter((i) => i.id !== 'home')
            .map(
              (item) => `
            <a class="site-nav__link${item.id === activeId ? ' is-active' : ''}" href="${item.href}">
              ${item.icon} ${item.label}
            </a>`
            )
            .join('')}
        </nav>
      </div>
    `
  }

  if (footer) {
    footer.innerHTML = `
      Lab Tools — a set of client-side research utilities. Nothing you upload leaves your browser.
      <br /><a href="./privacy.html">Privacy &amp; Security</a> · <a href="https://github.com/johnyb115/lab_tools">Source on GitHub</a>
    `
  }
}

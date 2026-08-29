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
    `
  }
}

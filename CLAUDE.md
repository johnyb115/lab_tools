# Lab Tools

Client-side research utilities at **labtools.top**. Static site hosted on GitHub Pages from `johnyb115/lab_tools`. Everything runs in the browser — no backend.

## Quick start

```bash
cd web
npm install
npm run dev        # → http://localhost:5173
npm run build      # production build into web/dist/
```

## Project structure

```
web/
├── index.html                   # Home page shell (index rendered from tools.js)
├── <tool-name>.html             # One HTML page per tool
├── privacy.html                 # Privacy & security disclosure
├── vite.config.js               # Vite multi-page config (rollup inputs)
├── package.json
└── src/
    ├── style.css                # Shared design system (light + dark), see DESIGN.md
    ├── shared/
    │   ├── tools.js             # Tool registry: categories, codes, summaries, formats
    │   ├── glyphs.js            # Line drawings of each tool's output (120×60 SVG)
    │   ├── nav.js               # Header, tool finder, page-header decoration, footer
    │   ├── dropzone.js          # Drag-and-drop file upload helper
    │   ├── download.js          # Client-side download helpers (blob, CSV, text)
    │   ├── dom.js               # HTML escaping utilities
    │   ├── parseTable.js        # CSV/XLSX/ASCII table parser
    │   └── plotlySetup.js       # Shared Plotly theme-aware config
    └── tools/
        └── <tool-name>.js       # One JS module per tool
```

## Design system

"Mask Set": full spec in `/DESIGN.md`. Tokens are CSS variables in `web/src/style.css`. Light and dark themes are set on `<html data-theme>`.

- `--bg`, `--bg-elev`, `--bg-elev-2/3`, `--border`, `--text`, `--text-dim`, `--text-muted`: neutrals
- `--ox-e/d/i/c/s`: one oxide colour per category. On a tool page `--cat` (and `--accent`) is that page's category colour, set by `initChrome` through `data-cat`.
- `--amber`: only for `.btn-primary` and focus. Selected toggles use `.btn.is-active` (ink fill).
- Fonts: Geist and Geist Mono, self-hosted through `@fontsource-variable` (no Google Fonts).

**Layout**: most tools use `layout-sidebar` (320px aside + 1fr content area). The sidebar holds controls in `.panel` sections; the content area shows the canvas/output (`.plot-area`).

**Components**: `.btn`, `.btn-primary`, `.btn-danger`, `.dropzone`, `.field`, `.field-row`, `.alert`, `.empty-state`, `.category-header`. No emoji in titles, buttons or dropzones.

## How to add a new tool

Every tool is three touch-points plus one optional:

### 1. Create `web/<tool-name>.html`

Follow the pattern in `linspace.html` (simplest example):

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tool Name — Lab Tools</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="/src/style.css" />
</head>
<body>
  <header id="site-header" class="site-header"></header>
  <main class="site-main">
    <div class="page-header">
      <h1>Tool Name</h1>
      <p>One-line description.</p>
    </div>
    <div class="layout-sidebar">
      <aside>
        <div class="panel">
          <!-- controls here -->
        </div>
      </aside>
      <section>
        <!-- output/canvas here -->
      </section>
    </div>
  </main>
  <footer id="site-footer" class="site-footer"></footer>
  <script type="module" src="/src/tools/<tool-name>.js"></script>
</body>
</html>
```

### 2. Create `web/src/tools/<tool-name>.js`

Must import and call `initChrome`:

```js
import { initChrome } from '../shared/nav.js'
initChrome('<tool-id>')
```

Use shared helpers: `initDropzone` for file upload, `downloadBlob`/`downloadCSV` for exports, `escapeHtml` for user text in innerHTML.

### 3. Register the tool in two places

1. **`web/src/shared/tools.js`**: add an entry to its category (`id`, `code`, `label`, `href`, `glyph`, `summary` (verb-first, what you get out), `formats`, `keywords`). The home index, the tool finder and the page header kicker/glyph are all rendered from this.
2. **`web/vite.config.js`**: add to `rollupOptions.input`: `toolName: page('<tool-name>.html')`

Then add a drawing of the tool's output to `web/src/shared/glyphs.js` (120×60 viewBox, `currentColor`, `.g-ax` for axes/guides, `.g-soft` for fills) and reference it by `glyph`.

### 4. (If needed) Add npm dependencies

```bash
cd web && npm install <package>
```

Prefer client-side libraries. The only tool that makes external requests is Background Remover (downloads ONNX model from `staticimgly.com`). All others must be fully offline.

## Conventions

- **No backend.** All processing happens client-side. Files never leave the browser.
- **Vanilla JS modules.** No framework (React, Vue, etc.). Each tool is a self-contained ES module.
- **Plotly** for interactive charts (`plotly.js-dist-min`). Configure via `plotlySetup.js`.
- **Canvas API** for image processing tools (auto-crop, scale bar, plot digitizer).
- Page-specific `<style>` blocks in the HTML are fine for tool-specific layout.
- IDs use prefix matching the tool (e.g. `sb-` for scale bar, `pd-` for plot digitizer).
- Downloads use `downloadBlob()` / `downloadCSV()` from `shared/download.js`.

## Deployment

Push to `main` → GitHub Pages auto-deploys. Custom domain: `labtools.top` (CNAME file in repo root). HTTPS via GitHub Pages.

## Privacy rule

If a new tool must fetch external resources at runtime, document it on `web/privacy.html` in the per-tool disclosure section.

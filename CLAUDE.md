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
├── index.html                   # Home page with tool cards
├── <tool-name>.html             # One HTML page per tool
├── privacy.html                 # Privacy & security disclosure
├── vite.config.js               # Vite multi-page config (rollup inputs)
├── package.json
└── src/
    ├── style.css                # Single shared dark-theme design system
    ├── shared/
    │   ├── nav.js               # Header + footer injection (NAV_ITEMS array)
    │   ├── dropzone.js          # Drag-and-drop file upload helper
    │   ├── download.js          # Client-side download helpers (blob, CSV, text)
    │   ├── dom.js               # HTML escaping utilities
    │   ├── parseTable.js        # CSV/XLSX/ASCII table parser
    │   └── plotlySetup.js       # Shared Plotly dark-theme config
    └── tools/
        └── <tool-name>.js       # One JS module per tool
```

## Design system

Single dark theme using CSS variables defined in `web/src/style.css`:

- `--bg`, `--bg-elev`, `--bg-elev-2` — background layers
- `--border`, `--text`, `--text-dim` — chrome
- `--accent` (#4c9aff), `--accent-2`, `--danger`, `--warning` — semantic colors
- `--radius`, `--radius-sm` — corner radii

**Layout**: most tools use `layout-sidebar` (320px aside + 1fr content area). Sidebar holds controls in `.panel` sections; content area shows canvas/output.

**Components**: `.btn`, `.btn-primary`, `.btn-danger`, `.dropzone`, `.field`, `.field-row`, `.alert`, `.empty-state`, `.tool-card`.

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
      <h1>ICON Tool Name</h1>
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

### 3. Register the tool in three places

1. **`web/src/shared/nav.js`** — add entry to `NAV_ITEMS` array (id, label, href, icon)
2. **`web/vite.config.js`** — add to `rollupOptions.input`: `toolName: page('<tool-name>.html')`
3. **`web/index.html`** — add a `<a class="tool-card">` block in the `.card-grid`

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

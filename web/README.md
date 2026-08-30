# Lab Tools (Web)

A static, client-side replacement for the group's old Streamlit apps
([rgumelmicromachines.streamlit.app](https://rgumelmicromachines.streamlit.app/),
[mycsvplotter.streamlit.app](https://mycsvplotter.streamlit.app/)). Everything
runs in the visitor's browser — there is no backend, and no uploaded file ever
leaves the machine it was opened on.

## Tools

| Tool | Page | Notes |
|---|---|---|
| Voltammetry (CV/DPV) Plotter | `voltammetry.html` | Ports `csv_streamlit/app.py` — Autolab/NOVA CV & DPV exports, scan-range filter, batch ZIP export |
| Universal Data Plotter | `universal-plotter.html` | CSV/ASCII/XLSX, per-file X/Y column pickers, per-trace visibility + color |
| Plot Digitizer | `plot-digitizer.html` | Click-calibrated axes + color-based curve extraction from a graph image |
| Four-Point Probe | `four-point-probe.html` | Ports `lab_app/pages/02_FourPointProbe.py` — sheet resistance + Ossila rectangular correction |
| Linspace Generator | `linspace.html` | Ports `lab_app/pages/01_Linspace_Generator.py` |
| Image Auto-Crop | `auto-crop.html` | Trims uniform background margins around an image |
| Background Remover | `background-remover.html` | In-browser background removal via `@imgly/background-removal` (WASM) |
| Word → High-Quality PDF | `word-to-pdf.html` | Renders a `.docx` via `mammoth` (original image bytes, no recompression) and prints it through the browser's own PDF engine |
| EIS Plotter | `eis-plotter.html` | Nyquist + Bode plots from impedance data (Re/Im or Mag/Phase input), multi-file overlay |
| Peak Integrator | `peak-integrator.html` | Click two baseline points on a curve to get peak height + trapezoidal peak area |
| PDF Image Extractor | `pdf-image-extractor.html` | Pulls embedded raster images back out of a PDF at native resolution via `pdfjs-dist` |
| Scale Bar Calibration | `scale-bar.html` | Click-calibrate a known distance on a micrograph/photo and burn a scale bar into a full-res copy |
| Table Format Converter | `table-converter.html` | Converts between CSV, TSV, XLSX and JSON |
| Uncertainty & Stats | `stats-calculator.html` | Mean/SD/SEM/CI for one dataset, or a Welch's t-test comparing two |

## Develop

```bash
npm install
npm run dev
```

Opens a dev server (default `http://localhost:5173`) with hot reload for every
page listed above.

## Build

```bash
npm run build
```

Produces a fully static `dist/` folder — every page, plus all JS/CSS/wasm
assets, with relative asset paths (`base: './'` in `vite.config.js`), so it
works whether it's served from a domain root or a sub-path (e.g. a GitHub
Pages project site).

```bash
npm run preview   # serve dist/ locally to sanity-check the production build
```

Note: the background-remover page pulls in an ONNX Runtime WASM build
(~24 MB) as part of its own lazy-loaded chunk. It is not fetched by any other
page and is only downloaded by a visitor's browser the first time they
actually click "Remove Background" on that one page.

Note: similarly, the PDF Image Extractor page bundles `pdfjs-dist` (including
a ~1.3 MB PDF worker script) into its own chunk — only fetched by visitors of
that one page.

## Deploy (free, static hosting)

Any static host works since this is plain `dist/` output. A few options that
match the group's previous free-tier Streamlit Cloud setup:

- **GitHub Pages** (already wired up) — `.github/workflows/deploy-pages.yml`
  builds `web/` and publishes `web/dist` to Pages on every push to `main`
  that touches `web/**`. One-time manual step required: in the repo's
  **Settings → Pages**, set **Source** to **GitHub Actions** (Pages is off by
  default even with the workflow file present). After that, pushing to
  `main` deploys automatically — no build step to run or files to copy by
  hand. `vite.config.js` uses `base: './'`, so it works whether Pages serves
  this at the domain root or a project sub-path
  (`https://<user>.github.io/lab_tools/`).
- **Netlify / Vercel** — point either at this repo with build command
  `npm run build` (working directory `web/`) and publish directory
  `web/dist`; both have generous free tiers and auto-deploy on every push.

## Project layout

```
web/
  index.html, voltammetry.html, ...   one entry HTML per tool
  src/
    style.css                         shared dark-theme design system
    shared/                           nav, dropzone, file parsing, Plotly setup, download/escape helpers
    tools/                            one JS module per tool page
  vite.config.js                      multi-page build config (base: './')
```


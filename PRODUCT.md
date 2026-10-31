# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Members of one research group (micromachines / electrochemistry lab), plus occasional outside visitors. They arrive mid-task: a measurement export, a micrograph, or a figure in hand, needing one specific transformation (plot it, fit it, crop it, convert it) and then back to their own work. Repeat visitors who know which tool they want.

## Product Purpose

Lab Tools (labtools.top) is a static collection of browser-based research utilities that replaced the group's older Streamlit apps. Success: a group member gets from "I have this file" to the plot, number, or cleaned image they need in seconds, without installing anything or uploading data anywhere.

## Positioning

Everything runs client-side; files never leave the browser. The tools are built around the group's actual instruments and exports (Autolab/NOVA CV/DPV, four-point probe with Ossila correction, EIS, anodic bonding), not generic converters.

## Operating Context

Used on lab and office desktops beside instrument software, spreadsheets, and figure-making tools; occasionally on laptops. Inputs are CSV/ASCII/XLSX exports, images (micrographs, plots), PDFs, and DOCX. Outputs are interactive Plotly charts, downloaded CSV/ZIP/PNG/PDF files, and computed values.

## Capabilities and Constraints

- 24 tools in five categories: Electrochemistry, Data & Analysis, Image & Figures, Converters & Utilities, Simulators.
- Static multi-page Vite site, vanilla JS ES modules, no framework, no backend. Deployed to GitHub Pages on push to `main`.
- Shared design system in `web/src/style.css`; shared header/footer injected by `web/src/shared/nav.js`; Plotly theming in `web/src/shared/plotlySetup.js`.
- Only the Background Remover fetches external resources at runtime; all other tools must work offline.

## Brand Commitments

- Name: "Lab Tools", domain labtools.top.
- Both light and dark themes with a user toggle must remain.

## Evidence on Hand

No testimonials, usage statistics, or publications on hand; do not invent any. Real content is the tools themselves and their descriptions.

## Product Principles

- The tool is the page: controls and output come first, chrome stays out of the way.
- Privacy is structural, not a feature claim: no uploads, no tracking.
- Fit the group's real instruments and file formats before generic cases.
- Fast to re-find: a returning user locates their tool in one glance or one keystroke.

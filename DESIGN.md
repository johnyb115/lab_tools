---
name: Lab Tools — Mask Set
description: Browser-based research utilities drawn as dies on a photomask reticle.
colors:
  quartz: "#eceee9"
  die: "#fbfbf9"
  surface-2: "#f2f3ef"
  lane: "#d2d5ce"
  lane-strong: "#aeb2ab"
  ink: "#15171a"
  ink-dim: "#4d5258"
  ink-muted: "#5f656b"
  input: "#ffffff"
  chrome: "#15171a"
  chrome-line: "#34383e"
  chrome-text: "#eceee9"
  amber: "#f0b400"
  amber-hover: "#ffc61f"
  amber-press: "#d9a200"
  oxide-electrochemistry: "#2f54c9"
  oxide-data: "#0e7f7b"
  oxide-image: "#bf3a72"
  oxide-converters: "#b95c17"
  oxide-simulators: "#7a3a97"
  success: "#2a8a46"
  warning: "#a86f00"
  danger: "#c7322a"
  dark-quartz: "#0f1113"
  dark-die: "#171a1d"
  dark-lane: "#2b3035"
  dark-ink: "#e8eae5"
  dark-ink-dim: "#a6acb1"
  dark-oxide-electrochemistry: "#7895f2"
  dark-oxide-data: "#3fbdb5"
  dark-oxide-image: "#ee76a8"
  dark-oxide-converters: "#ef9550"
  dark-oxide-simulators: "#b886d6"
typography:
  display:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.9rem, 1.3rem + 2vw, 3rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.6rem, 1.2rem + 1.1vw, 2.15rem)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Geist Mono Variable, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.08em"
  code:
    fontFamily: "Geist Mono Variable, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 600
rounded:
  sm: "2px"
  md: "3px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "16px"
  lg: "24px"
  gutter: "clamp(16px, 3.3vw, 48px)"
components:
  button-primary:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.amber-hover}"
  button:
    backgroundColor: "{colors.die}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
    height: "38px"
  button-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.quartz}"
  input:
    backgroundColor: "{colors.input}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "7px 10px"
    height: "36px"
  panel:
    backgroundColor: "{colors.die}"
    rounded: "{rounded.sm}"
    padding: "16px"
  die:
    backgroundColor: "{colors.die}"
    textColor: "{colors.ink}"
    padding: "14px 16px"
  header:
    backgroundColor: "{colors.chrome}"
    textColor: "{colors.chrome-text}"
    height: "56px"
---

# Lab Tools — Mask Set

## Overview

The site is drawn like a photomask reticle. Each tool is a **die**: a tile that butts against its neighbours across one-pixel scribe lanes. It carries a short die code (`CV`, `EIS`, `4PP`), a die coordinate (`E·01`) and a line drawing of what the tool produces. Categories use colours from the thermal-oxide thickness chart pinned up in cleanrooms, and each colour stands for exactly one category. Yellow-room amber is kept for things you can press. The shell (header, footer) is chrome black in both themes. Content sits on quartz (light) or near-black (dark).

The mode is Operate. People come with a file in hand and want one transformation. Controls and output come first, and the world only shows through type, palette, density and one signature move: **exposure**. Hovering or focusing a die floods it with its category colour.

## Colors

- **Neutrals**: three ink values (`ink`, `ink-dim`, `ink-muted`) on `quartz`, with `die` as the raised surface and `lane` for every rule. Dark mode mirrors them (`dark-*`).
- **Oxide inks**: `oxide-electrochemistry` (royal blue), `oxide-data` (teal), `oxide-image` (carnation), `oxide-converters` (melon), `oxide-simulators` (red-violet). On a tool page the category colour becomes `--cat`, which also feeds the legacy `--accent` token. It colours the glyph, panel heading markers, range/checkbox accents, info alerts and the active nav item, and nothing else.
- **Amber** belongs only to primary buttons, focus rings and the focused search field. It is never used for a selected state; selected toggles fill with ink.
- `success` / `warning` / `danger` appear only where they carry meaning.
- Plot series use the separate palette in `src/shared/plotlySetup.js`.

## Typography

Geist and Geist Mono, self-hosted through `@fontsource-variable` (no external font requests). Mono covers die codes, coordinates, file formats, panel headings (uppercase, tracked 0.08em), numeric inputs, table headers and readouts. Sans covers everything else. Headings are weight 600 with negative tracking. There is no italic display type and no serif.

## Layout

- Max width 1440px, gutter `clamp(16px, 3.3vw, 48px)`.
- Home: an intro row (headline left, finder right), then the reticle. Each category row has a 200px label column holding the wall-chart key (a solid oxide square with the category letter), and a die grid (`auto-fill, minmax(232px, 1fr)`). On phones the dies drop to two columns. Alignment crosses mark the reticle's four corners.
- Tool pages: a page header (kicker, title, description, glyph box on the right; the glyph is hidden under 720px), then `layout-sidebar` with a 320px control column and an output column. The output (`.plot-area`) carries registration marks at its corners.

## Elevation & Depth

Flat. Depth comes from the quartz/die value step and the lanes, not from shadows. The only shadow is on the tool finder dropdown.

## Shapes

Square. Radii are 2–3px at most. Category keys and glyph boxes are hard squares. Rules are one pixel.

## Components

- **Die** (`.die`): code + coordinate, a glyph on a 7% category tint, name, verb-first summary, formats. Hover/focus is "exposure": a full category fill with white content (dark ink in dark mode).
- **Glyphs** (`src/shared/glyphs.js`): 120×60 line drawings in `currentColor`, with a non-scaling 1.6px stroke. `.g-ax` marks axes and guides, `.g-soft` marks tinted fills. Each drawing shows the tool's output (CV loop, Nyquist arc, peak area…), never an abstract icon.
- **Tool finder**: the header button (`/` opens it) brings up a filterable list of all tools by code. Enter jumps to the first match.
- **Panel**: a die surface. Its heading is mono uppercase with a small category square.
- **Buttons**: `.btn` is outlined; `.btn-primary` is amber; `.btn.is-active` / `[aria-pressed=true]` is ink-filled.
- **Alerts**: tinted with their tone, with a full 1px tone border and no side stripe.

## Do's and Don'ts

- Do give every new tool an entry in `src/shared/tools.js`, with a code, a verb-first summary, its formats and a glyph that draws its output.
- Do keep each oxide colour tied to its category.
- Don't use amber for anything that can't be pressed.
- Don't add emoji icons, gradients, glows or rounded cards.
- Don't add colour-stripe borders on one side of a card.

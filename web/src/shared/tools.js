// Single source of truth for every tool: the home index, the "All tools"
// menu and each tool page's header are all rendered from this list.
//
// code     — short die code shown on the tile and matched by search
// summary  — verb-first one-liner: what you get out of the tool
// glyph    — key into GLYPHS (src/shared/glyphs.js), a drawing of the output

export const CATEGORIES = [
  {
    id: 'electrochemistry',
    letter: 'E',
    name: 'Electrochemistry',
    tools: [
      {
        id: 'voltammetry', code: 'CV', label: 'Voltammetry (CV/DPV)', href: './voltammetry.html', glyph: 'cv',
        summary: 'Plot CV and DPV scans from Autolab/NOVA',
        formats: 'CSV · TXT',
        keywords: 'voltammetry cv dpv autolab nova scan cyclic differential pulse zip',
      },
      {
        id: 'eis-plotter', code: 'EIS', label: 'EIS Plotter', href: './eis-plotter.html', glyph: 'eis',
        summary: 'Nyquist and Bode plots from impedance data',
        formats: 'CSV · ASCII · XLSX',
        keywords: 'eis impedance spectroscopy nyquist bode overlay',
      },
      {
        id: 'four-point-probe', code: '4PP', label: 'Four-Point Probe', href: './four-point-probe.html', glyph: 'fpp',
        summary: 'Sheet resistance from I–V sweeps',
        formats: 'ASC · CSV · TXT',
        keywords: 'four point probe sheet resistance resistivity iv sweep ossila correction',
      },
      {
        id: 'peak-integrator', code: 'PK', label: 'Peak Integrator', href: './peak-integrator.html', glyph: 'peak',
        summary: 'Measure peak height and area',
        formats: 'CSV · ASCII · XLSX',
        keywords: 'peak integrate area height baseline chromatography',
      },
    ],
  },
  {
    id: 'data-analysis',
    letter: 'D',
    name: 'Data & Analysis',
    tools: [
      {
        id: 'universal-plotter', code: 'XY', label: 'Universal Data Plotter', href: './universal-plotter.html', glyph: 'plot',
        summary: 'Plot any table, choose X and Y',
        formats: 'CSV · ASCII · XLSX',
        keywords: 'universal plotter plot chart graph csv xlsx ascii xy traces',
      },
      {
        id: 'curve-fit', code: 'FIT', label: 'Curve Fitting', href: './curve-fit.html', glyph: 'fit',
        summary: 'Fit a model and get its parameters',
        formats: 'CSV · TXT · XLSX',
        keywords: 'curve fit fitting linear polynomial exponential gaussian power logarithmic arrhenius levenberg marquardt regression',
      },
      {
        id: 'data-smoother', code: 'SM', label: 'Data Smoother', href: './data-smoother.html', glyph: 'smooth',
        summary: 'Filter noise out of a signal',
        formats: 'CSV · TXT · XLSX',
        keywords: 'smooth data savitzky golay moving average gaussian median exponential filter noise',
      },
      {
        id: 'stats-calculator', code: 'SD', label: 'Uncertainty & Stats', href: './stats-calculator.html', glyph: 'stats',
        summary: 'Mean, SD, confidence intervals, t-tests',
        formats: 'Paste values',
        keywords: 'statistics mean standard deviation sem confidence interval t-test welch uncertainty error',
      },
      {
        id: 'linspace', code: 'LIN', label: 'Linspace Generator', href: './linspace.html', glyph: 'linspace',
        summary: 'Generate evenly spaced values',
        formats: 'Outputs CSV',
        keywords: 'linspace generate evenly spaced numbers sequence range',
      },
      {
        id: 'baseline-correction', code: 'BL', label: 'Baseline Correction', href: './baseline-correction.html', glyph: 'baseline',
        summary: 'Remove baseline drift from a curve',
        formats: 'CSV · TXT · XLSX',
        keywords: 'baseline correction subtract polynomial als rubber band convex hull drift',
      },
      {
        id: 'data-normalizer', code: 'NRM', label: 'Data Normalizer', href: './data-normalizer.html', glyph: 'normalize',
        summary: 'Scale curves so they can be compared',
        formats: 'CSV · TXT · XLSX',
        keywords: 'normalize normalise min-max z-score area custom range scale',
      },
      {
        id: 'interpolation', code: 'INT', label: 'Interpolation & Resampling', href: './interpolation.html', glyph: 'interp',
        summary: 'Resample data onto a uniform grid',
        formats: 'CSV · TXT · XLSX',
        keywords: 'interpolation resample cubic spline linear nearest neighbor upsample downsample grid',
      },
    ],
  },
  {
    id: 'image-figures',
    letter: 'I',
    name: 'Image & Figures',
    tools: [
      {
        id: 'figure-composer', code: 'FIG', label: 'Figure Panel Composer', href: './figure-composer.html', glyph: 'figure',
        summary: 'Assemble labelled (a)(b)(c) figure panels',
        formats: 'PNG · JPG to PNG · SVG · PPTX',
        keywords: 'figure panel composer arrange label publication grid image pptx',
      },
      {
        id: 'arrow-generator', code: 'ARW', label: 'Arrow & Annotation Generator', href: './arrow-generator.html', glyph: 'arrow',
        summary: 'Draw arrows that survive into PowerPoint',
        formats: 'Outputs SVG · PNG · PPTX',
        keywords: 'arrow annotation generator svg pptx powerpoint reaction equilibrium curved elbow scientific illustration',
      },
      {
        id: 'plot-digitizer', code: 'DIG', label: 'Plot Digitizer', href: './plot-digitizer.html', glyph: 'digitize',
        summary: 'Pull data points out of a graph image',
        formats: 'PNG · JPG to CSV',
        keywords: 'plot digitizer extract data points image graph screenshot',
      },
      {
        id: 'auto-crop', code: 'CRP', label: 'Image Crop & Resize', href: './auto-crop.html', glyph: 'crop',
        summary: 'Trim white margins and scale big images down',
        formats: 'PNG · JPG · WebP',
        keywords: 'auto crop trim whitespace margin image resize scale downscale shrink compress file size percentage pixels jpeg webp',
      },
      {
        id: 'background-remover', code: 'BG', label: 'Background Remover', href: './background-remover.html', glyph: 'cutout',
        summary: 'Cut the background out of a photo',
        formats: 'PNG · JPG to PNG',
        keywords: 'background remove cut transparent png photo',
      },
      {
        id: 'scale-bar', code: 'SB', label: 'Scale Bar Calibration', href: './scale-bar.html', glyph: 'scalebar',
        summary: 'Burn a calibrated scale bar into a micrograph',
        formats: 'PNG · JPG',
        keywords: 'scale bar calibration micrograph measure distance sem microscope',
      },
      {
        id: 'pdf-image-extractor', code: 'PDF', label: 'PDF Image Extractor', href: './pdf-image-extractor.html', glyph: 'pdf',
        summary: 'Extract figures from a PDF at full resolution',
        formats: 'PDF to PNG',
        keywords: 'pdf image extract figure pull embedded png',
      },
    ],
  },
  {
    id: 'converters',
    letter: 'C',
    name: 'Converters & Utilities',
    tools: [
      {
        id: 'table-converter', code: 'TBL', label: 'Table Format Converter', href: './table-converter.html', glyph: 'table',
        summary: 'Convert between CSV, TSV, XLSX and JSON',
        formats: 'CSV · TSV · XLSX · JSON',
        keywords: 'table format converter csv tsv xlsx json convert',
      },
      {
        id: 'unit-converter', code: 'UNT', label: 'Lab Unit Converter', href: './unit-converter.html', glyph: 'units',
        summary: 'Electrode potentials, dilutions, units',
        formats: 'Calculator',
        keywords: 'unit converter reference electrode agcl sce rhe dilution molarity energy pressure temperature sheet resistance',
      },
      {
        id: 'color-checker', code: 'CLR', label: 'Color Palette Checker', href: './color-checker.html', glyph: 'colors',
        summary: 'Check figure colours for colour-blind readers',
        formats: 'Hex palette',
        keywords: 'color colour palette checker colorblind simulation wcag contrast accessibility',
      },
      {
        id: 'pcb-qr', code: 'QR', label: 'PCB QR Generator', href: './pcb-qr.html', glyph: 'qr',
        summary: 'QR codes drawn as PCB traces and vias',
        formats: 'Outputs SVG',
        keywords: 'pcb qr code generator traces vias circuit board svg',
      },
      {
        id: 'certificate-maker', code: 'CRT', label: 'Certificate Maker', href: './certificate-maker.html', glyph: 'cert',
        summary: 'Print certificates for a list of names as one PDF',
        formats: 'XLSX · CSV → PDF',
        keywords: 'certificate certifikat participation diploma attendance names list print pdf mail merge workshop course',
      },
    ],
  },
  {
    id: 'simulators',
    letter: 'S',
    name: 'Simulators',
    tools: [
      {
        id: 'anodic-bonding', code: 'AB', label: 'Anodic Bonding Simulator', href: './anodic-bonding.html', glyph: 'bonding',
        summary: 'Watch a bond front spread across a glass/Si stack',
        formats: 'Simulation',
        keywords: 'anodic bonding simulator glass silicon pyrex wafer bond front point electrode plate electrode sodium depletion field assisted mems',
      },
    ],
  },
]

CATEGORIES.forEach((cat) => {
  cat.tools.forEach((tool, i) => {
    tool.category = cat
    tool.die = `${cat.letter}·${String(i + 1).padStart(2, '0')}`
  })
})

export const TOOLS = CATEGORIES.flatMap((c) => c.tools)

export function findTool(id) {
  return TOOLS.find((t) => t.id === id) || null
}

export function matchesQuery(tool, q) {
  if (!q) return true
  const hay = `${tool.code} ${tool.label} ${tool.summary} ${tool.formats} ${tool.keywords} ${tool.category.name}`.toLowerCase()
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))
}

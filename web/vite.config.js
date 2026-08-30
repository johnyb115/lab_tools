import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const page = (name) => resolve(import.meta.dirname, name)

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        home: page('index.html'),
        voltammetry: page('voltammetry.html'),
        universalPlotter: page('universal-plotter.html'),
        plotDigitizer: page('plot-digitizer.html'),
        linspace: page('linspace.html'),
        fourPointProbe: page('four-point-probe.html'),
        autoCrop: page('auto-crop.html'),
        backgroundRemover: page('background-remover.html'),
        wordToPdf: page('word-to-pdf.html'),
        eisPlotter: page('eis-plotter.html'),
        peakIntegrator: page('peak-integrator.html'),
        pdfImageExtractor: page('pdf-image-extractor.html'),
        scaleBar: page('scale-bar.html'),
        tableConverter: page('table-converter.html'),
        statsCalculator: page('stats-calculator.html'),
      },
    },
  },
})

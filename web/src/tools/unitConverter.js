import { initChrome } from '../shared/nav.js'
initChrome('unit-converter')

const REF_VS_SHE = {
  she: 0,
  agcl_sat: 0.197,
  agcl_3m: 0.210,
  sce: 0.241,
  mse: 0.640,
}

function fmt(n) {
  if (n === 0) return '0'
  const abs = Math.abs(n)
  if (abs >= 1e6 || abs < 1e-3) return n.toExponential(6)
  if (abs < 0.01) return n.toPrecision(6)
  const decimals = abs >= 100 ? 3 : abs >= 1 ? 5 : 6
  return parseFloat(n.toFixed(decimals)).toString()
}

// Reference electrode
const refVal = document.getElementById('uc-ref-val')
const refFrom = document.getElementById('uc-ref-from')
const refTo = document.getElementById('uc-ref-to')
const refPh = document.getElementById('uc-ref-ph')
const refPhField = document.getElementById('uc-ref-ph-field')
const refResult = document.getElementById('uc-ref-result')

function calcRef() {
  refPhField.hidden = refTo.value !== 'rhe'
  const v = parseFloat(refVal.value)
  if (isNaN(v)) { refResult.textContent = ''; return }
  const fromOffset = REF_VS_SHE[refFrom.value] ?? 0
  const vShe = v + fromOffset
  if (refTo.value === 'rhe') {
    const pH = parseFloat(refPh.value) || 0
    refResult.textContent = `${fmt(vShe + 0.0592 * pH)} V vs RHE`
  } else {
    const toOffset = REF_VS_SHE[refTo.value] ?? 0
    refResult.textContent = `${fmt(vShe - toOffset)} V vs ${refTo.options[refTo.selectedIndex].text}`
  }
}
;[refVal, refFrom, refTo, refPh].forEach(el => el.addEventListener('input', calcRef))
calcRef()

// Dilution
const dilC1 = document.getElementById('uc-dil-c1')
const dilV1 = document.getElementById('uc-dil-v1')
const dilC2 = document.getElementById('uc-dil-c2')
const dilV2 = document.getElementById('uc-dil-v2')
const dilResult = document.getElementById('uc-dil-result')

function calcDil() {
  const c1 = dilC1.value !== '' ? parseFloat(dilC1.value) : null
  const v1 = dilV1.value !== '' ? parseFloat(dilV1.value) : null
  const c2 = dilC2.value !== '' ? parseFloat(dilC2.value) : null
  const v2 = dilV2.value !== '' ? parseFloat(dilV2.value) : null

  const filled = [c1, v1, c2, v2].filter(x => x !== null)
  if (filled.length < 3) { dilResult.textContent = 'Fill 3 of 4 fields'; return }
  if (filled.some(x => isNaN(x))) { dilResult.textContent = ''; return }

  if (c1 === null) dilResult.textContent = `C₁ = ${fmt(c2 * v2 / v1)}`
  else if (v1 === null) dilResult.textContent = `V₁ = ${fmt(c2 * v2 / c1)}`
  else if (c2 === null) dilResult.textContent = `C₂ = ${fmt(c1 * v1 / v2)}`
  else dilResult.textContent = `V₂ = ${fmt(c1 * v1 / c2)}`
}
;[dilC1, dilV1, dilC2, dilV2].forEach(el => el.addEventListener('input', calcDil))
calcDil()

// Sheet resistance / resistivity
const srRs = document.getElementById('uc-sr-rs')
const srT = document.getElementById('uc-sr-t')
const srUnit = document.getElementById('uc-sr-unit')
const srResult = document.getElementById('uc-sr-result')

const THICKNESS_TO_CM = { nm: 1e-7, um: 1e-4, mm: 0.1, cm: 1 }

function calcSR() {
  const rs = srRs.value !== '' ? parseFloat(srRs.value) : null
  const t = srT.value !== '' ? parseFloat(srT.value) : null
  const factor = THICKNESS_TO_CM[srUnit.value]

  if (rs !== null && t !== null && !isNaN(rs) && !isNaN(t)) {
    const rho = rs * t * factor
    srResult.textContent = `ρ = ${fmt(rho)} Ω·cm`
  } else {
    srResult.textContent = 'Enter sheet resistance and thickness'
  }
}
;[srRs, srT, srUnit].forEach(el => el.addEventListener('input', calcSR))
calcSR()

// Molarity
const molMass = document.getElementById('uc-mol-mass')
const molMW = document.getElementById('uc-mol-mw')
const molVol = document.getElementById('uc-mol-vol')
const molResult = document.getElementById('uc-mol-result')

function calcMol() {
  const m = molMass.value !== '' ? parseFloat(molMass.value) : null
  const mw = molMW.value !== '' ? parseFloat(molMW.value) : null
  const v = molVol.value !== '' ? parseFloat(molVol.value) : null

  const filled = [m, mw, v].filter(x => x !== null)
  if (filled.length < 2) { molResult.textContent = 'Fill 2 of 3 fields'; return }
  if (filled.some(x => isNaN(x) || x <= 0)) { molResult.textContent = ''; return }

  if (m === null) {
    const conc = mw !== null && v !== null ? 0 : 0
    molResult.textContent = 'Need mass or two other values'
  }

  if (m !== null && mw !== null && v !== null) {
    molResult.textContent = `Concentration = ${fmt(m / (mw * v / 1000))} mol/L (M)`
  } else if (m === null) {
    molResult.textContent = 'Cannot solve: need at least mass'
  } else if (mw === null) {
    molResult.textContent = 'Cannot solve: need molar mass'
  } else {
    const conc = m / (mw * v / 1000)
    molResult.textContent = `Concentration = ${fmt(conc)} mol/L (M)`
  }

  if (m !== null && mw !== null && v === null) {
    molResult.textContent = 'Enter volume to compute concentration, or enter C to find volume'
  }
  if (m !== null && v !== null && mw === null) {
    molResult.textContent = 'Enter molar mass to compute concentration'
  }
  if (mw !== null && v !== null && m === null) {
    molResult.textContent = 'Enter mass to compute concentration'
  }
  if (m !== null && mw !== null && v !== null) {
    const conc = m / (mw * (v / 1000))
    molResult.textContent = `Concentration = ${fmt(conc)} mol/L (M)`
  }
}
;[molMass, molMW, molVol].forEach(el => el.addEventListener('input', calcMol))
calcMol()

// Simple unit conversions (length, energy, pressure)
function setupSimpleConversion(prefix) {
  const valEl = document.getElementById(`uc-${prefix}-val`)
  const fromEl = document.getElementById(`uc-${prefix}-from`)
  const toEl = document.getElementById(`uc-${prefix}-to`)
  const resultEl = document.getElementById(`uc-${prefix}-result`)

  function calc() {
    const v = parseFloat(valEl.value)
    if (isNaN(v)) { resultEl.textContent = ''; return }
    const fromFactor = parseFloat(fromEl.value)
    const toFactor = parseFloat(toEl.value)
    const result = v * fromFactor / toFactor
    const toLabel = toEl.options[toEl.selectedIndex].text
    resultEl.textContent = `${fmt(result)} ${toLabel}`
  }

  ;[valEl, fromEl, toEl].forEach(el => el.addEventListener('input', calc))
  calc()
}

setupSimpleConversion('len')
setupSimpleConversion('en')
setupSimpleConversion('pr')

// Temperature
const tempVal = document.getElementById('uc-temp-val')
const tempFrom = document.getElementById('uc-temp-from')
const tempTo = document.getElementById('uc-temp-to')
const tempResult = document.getElementById('uc-temp-result')

function toKelvin(v, unit) {
  if (unit === 'K') return v
  if (unit === 'C') return v + 273.15
  return (v - 32) * 5 / 9 + 273.15
}

function fromKelvin(k, unit) {
  if (unit === 'K') return k
  if (unit === 'C') return k - 273.15
  return (k - 273.15) * 9 / 5 + 32
}

function calcTemp() {
  const v = parseFloat(tempVal.value)
  if (isNaN(v)) { tempResult.textContent = ''; return }
  const k = toKelvin(v, tempFrom.value)
  const result = fromKelvin(k, tempTo.value)
  const label = tempTo.options[tempTo.selectedIndex].text
  tempResult.textContent = `${fmt(result)} ${label}`
}

;[tempVal, tempFrom, tempTo].forEach(el => el.addEventListener('input', calcTemp))
calcTemp()

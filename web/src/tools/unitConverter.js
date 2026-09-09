import { initChrome } from '../shared/nav.js'

initChrome('unit-converter')

// ---------------------------------------------------------------------------
// Scientific-notation parser: handles 10^-6, 2.5*10^-3, 1e-6, plain numbers
// ---------------------------------------------------------------------------
function parseNum(s) {
  if (typeof s === 'number') return s
  s = String(s).trim().replace(/\s/g, '')
  if (!s) return NaN

  const mulPow = s.match(/^([+-]?\d+\.?\d*)\s*[*×]\s*10\^([+-]?\d+\.?\d*)$/)
  if (mulPow) return parseFloat(mulPow[1]) * Math.pow(10, parseFloat(mulPow[2]))

  const pow = s.match(/^([+-]?)10\^([+-]?\d+\.?\d*)$/)
  if (pow) return (pow[1] === '-' ? -1 : 1) * Math.pow(10, parseFloat(pow[2]))

  return parseFloat(s)
}

function fmt(n) {
  if (n == null || isNaN(n)) return '—'
  const abs = Math.abs(n)
  if (abs === 0) return '0'
  if (abs >= 1e6 || abs < 1e-3) return n.toExponential(6)
  if (Number.isInteger(n)) return n.toString()
  return parseFloat(n.toPrecision(8)).toString()
}

// ---------------------------------------------------------------------------
// Reference electrode conversion
// ---------------------------------------------------------------------------
const REF_VS_SHE = { she: 0, agcl_sat: 0.197, agcl_3m: 0.210, sce: 0.241, mse: 0.640 }

const refVal  = document.getElementById('uc-ref-val')
const refFrom = document.getElementById('uc-ref-from')
const refTo   = document.getElementById('uc-ref-to')
const refPh   = document.getElementById('uc-ref-ph')
const refPhField = document.getElementById('uc-ref-ph-field')
const refResult  = document.getElementById('uc-ref-result')

function calcRef() {
  refPhField.hidden = refTo.value !== 'rhe'
  const v = parseNum(refVal.value)
  if (isNaN(v)) { refResult.textContent = '—'; return }

  const vShe = v + REF_VS_SHE[refFrom.value]

  if (refTo.value === 'rhe') {
    const pH = parseNum(refPh.value)
    if (isNaN(pH)) { refResult.textContent = 'Enter valid pH'; return }
    refResult.textContent = `${fmt(vShe + 0.0592 * pH)} V vs RHE (pH ${fmt(pH)})`
  } else {
    const out = vShe - REF_VS_SHE[refTo.value]
    refResult.textContent = `${fmt(out)} V vs ${refTo.options[refTo.selectedIndex].text}`
  }
}

for (const el of [refVal, refFrom, refTo, refPh]) el.addEventListener('input', calcRef)
refTo.addEventListener('change', calcRef)
calcRef()

// ---------------------------------------------------------------------------
// Sheet resistance / resistivity
// ---------------------------------------------------------------------------
const srRs     = document.getElementById('uc-sr-rs')
const srT      = document.getElementById('uc-sr-t')
const srUnit   = document.getElementById('uc-sr-unit')
const srResult = document.getElementById('uc-sr-result')

const THICKNESS_TO_CM = { nm: 1e-7, um: 1e-4, mm: 0.1, cm: 1 }

function calcSR() {
  const rs = parseNum(srRs.value)
  const t  = parseNum(srT.value)
  if (isNaN(rs) || isNaN(t) || t === 0) { srResult.textContent = '—'; return }
  srResult.textContent = `ρ = ${fmt(rs * t * THICKNESS_TO_CM[srUnit.value])} Ω·cm`
}

for (const el of [srRs, srT]) el.addEventListener('input', calcSR)
srUnit.addEventListener('change', calcSR)

// ---------------------------------------------------------------------------
// Dilution (C₁V₁ = C₂V₂)
// ---------------------------------------------------------------------------
const dilC1 = document.getElementById('uc-dil-c1')
const dilV1 = document.getElementById('uc-dil-v1')
const dilC2 = document.getElementById('uc-dil-c2')
const dilV2 = document.getElementById('uc-dil-v2')
const dilResult = document.getElementById('uc-dil-result')

function calcDil() {
  const c1 = parseNum(dilC1.value)
  const v1 = parseNum(dilV1.value)
  const c2 = parseNum(dilC2.value)
  const v2 = parseNum(dilV2.value)

  const empty = [isNaN(c1), isNaN(v1), isNaN(c2), isNaN(v2)]
  const emptyCount = empty.filter(Boolean).length

  if (emptyCount === 0) {
    dilResult.textContent = Math.abs(c1 * v1 - c2 * v2) < 1e-10
      ? 'C₁V₁ = C₂V₂ ✓'
      : `C₁V₁ = ${fmt(c1 * v1)}, C₂V₂ = ${fmt(c2 * v2)}`
    return
  }
  if (emptyCount !== 1) { dilResult.textContent = 'Fill in exactly 3 of the 4 fields'; return }

  if (empty[0]) dilResult.textContent = `C₁ = ${fmt(c2 * v2 / v1)}`
  else if (empty[1]) dilResult.textContent = `V₁ = ${fmt(c2 * v2 / c1)}`
  else if (empty[2]) dilResult.textContent = `C₂ = ${fmt(c1 * v1 / v2)}`
  else dilResult.textContent = `V₂ = ${fmt(c1 * v1 / c2)}`
}

for (const el of [dilC1, dilV1, dilC2, dilV2]) el.addEventListener('input', calcDil)

// ---------------------------------------------------------------------------
// Molarity / Concentration — C = m / (MW × V_L)
// ---------------------------------------------------------------------------
const molMass   = document.getElementById('uc-mol-mass')
const molMW     = document.getElementById('uc-mol-mw')
const molVol    = document.getElementById('uc-mol-vol')
const molConc   = document.getElementById('uc-mol-conc')
const molResult = document.getElementById('uc-mol-result')

function calcMol() {
  const m    = parseNum(molMass.value)
  const mw   = parseNum(molMW.value)
  const vMl  = parseNum(molVol.value)
  const conc = parseNum(molConc.value)

  const has = [!isNaN(m), !isNaN(mw), !isNaN(vMl), !isNaN(conc)]
  const filled = has.filter(Boolean).length

  if (filled < 3) { molResult.textContent = 'Fill in 3 of the 4 fields'; return }

  if (filled === 4) {
    const vL = vMl / 1000
    const cCalc = (mw !== 0 && vL !== 0) ? m / (mw * vL) : NaN
    molResult.textContent = isNaN(cCalc) ? '—' : `C(calc) = ${fmt(cCalc)} mol/L vs ${fmt(conc)} entered`
    return
  }

  if (!has[3]) {
    const vL = vMl / 1000
    if (mw === 0 || vL === 0) { molResult.textContent = '—'; return }
    molResult.textContent = `C = ${fmt(m / (mw * vL))} mol/L`
  } else if (!has[0]) {
    molResult.textContent = `Mass = ${fmt(conc * mw * (vMl / 1000))} g`
  } else if (!has[1]) {
    const vL = vMl / 1000
    if (conc === 0 || vL === 0) { molResult.textContent = '—'; return }
    molResult.textContent = `MW = ${fmt(m / (conc * vL))} g/mol`
  } else {
    if (conc === 0 || mw === 0) { molResult.textContent = '—'; return }
    molResult.textContent = `Volume = ${fmt((m / (mw * conc)) * 1000)} mL`
  }
}

for (const el of [molMass, molMW, molVol, molConc]) el.addEventListener('input', calcMol)

// ---------------------------------------------------------------------------
// Simple unit conversion (length, energy, pressure)
// ---------------------------------------------------------------------------
function setupSimple(prefix) {
  const valEl  = document.getElementById(`uc-${prefix}-val`)
  const fromEl = document.getElementById(`uc-${prefix}-from`)
  const toEl   = document.getElementById(`uc-${prefix}-to`)
  const swapEl = document.getElementById(`uc-${prefix}-swap`)
  const resEl  = document.getElementById(`uc-${prefix}-result`)

  function calc() {
    const v = parseNum(valEl.value)
    if (isNaN(v)) { resEl.textContent = '—'; return }
    const result = v * parseFloat(fromEl.value) / parseFloat(toEl.value)
    const fromLabel = fromEl.options[fromEl.selectedIndex].text
    const toLabel   = toEl.options[toEl.selectedIndex].text
    resEl.textContent = `${fmt(v)} ${fromLabel} = ${fmt(result)} ${toLabel}`
  }

  valEl.addEventListener('input', calc)
  fromEl.addEventListener('change', calc)
  toEl.addEventListener('change', calc)
  swapEl.addEventListener('click', () => {
    const tmp = fromEl.value
    fromEl.value = toEl.value
    toEl.value = tmp
    calc()
  })
  calc()
}

setupSimple('len')
setupSimple('en')
setupSimple('pr')

// ---------------------------------------------------------------------------
// Temperature (not ratio-based)
// ---------------------------------------------------------------------------
const tempVal    = document.getElementById('uc-temp-val')
const tempFrom   = document.getElementById('uc-temp-from')
const tempTo     = document.getElementById('uc-temp-to')
const tempSwap   = document.getElementById('uc-temp-swap')
const tempResult = document.getElementById('uc-temp-result')

function toKelvin(v, u) {
  if (u === 'K') return v
  if (u === 'C') return v + 273.15
  return (v - 32) * 5 / 9 + 273.15
}

function fromKelvin(k, u) {
  if (u === 'K') return k
  if (u === 'C') return k - 273.15
  return (k - 273.15) * 9 / 5 + 32
}

function calcTemp() {
  const v = parseNum(tempVal.value)
  if (isNaN(v)) { tempResult.textContent = '—'; return }
  const out = fromKelvin(toKelvin(v, tempFrom.value), tempTo.value)
  const fL = tempFrom.options[tempFrom.selectedIndex].text
  const tL = tempTo.options[tempTo.selectedIndex].text
  tempResult.textContent = `${fmt(v)} ${fL} = ${fmt(out)} ${tL}`
}

tempVal.addEventListener('input', calcTemp)
tempFrom.addEventListener('change', calcTemp)
tempTo.addEventListener('change', calcTemp)
tempSwap.addEventListener('click', () => {
  const tmp = tempFrom.value
  tempFrom.value = tempTo.value
  tempTo.value = tmp
  calcTemp()
})
calcTemp()

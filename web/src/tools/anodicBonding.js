import { initChrome } from '../shared/nav.js'

initChrome('anodic-bonding')

/*
 * Anodic bonding simulator (radial, 4" wafer).
 *
 * The glass is a resistive sheet (lateral resistance rho/t). Where it touches the Si, current flows
 * down through the bulk glass (rho*t) and charges a Na+-depleted space-charge layer whose voltage is
 * Vi = Q^2 / (2*eps*e*N). Once Vi reaches the local glass potential, that spot stops conducting.
 * Beyond the bond front the glass is lifted off and floats at the front's potential; the gap closes
 * quasi-statically wherever that potential exceeds the gap-closing voltage. No rate constants are fitted.
 */

const $ = (id) => document.getElementById(id)

// ---------- physics ----------
// Pyrex 7740 volume resistivity: Arrhenius fit through log10(ohm*cm) = 8.1 @ 250 C and 6.6 @ 350 C. Returns ohm*m.
function rhoPyrex(tempC) {
  const T = tempC + 273.15
  return Math.pow(10, 6.6 + 4888 * (1 / T - 1 / 623.15)) / 100
}
const EPS = 4.6 * 8.854e-12 // Pyrex permittivity, F/m
const EN = 1.602e-19 * 1.73e27 // Na+ charge density, C/m^3 (4 wt% Na2O, 2.23 g/cm^3)
const KSC = 1 / (2 * EPS * EN) // depleted layer: Vi = KSC * Q^2
const N = 220
const R = 0.05
const dr = R / N
const TMAX = 4 * 3600
const ALPHA = 0.05 // time step as a fraction of the fresh-contact charging time
const r = new Float64Array(N)
const area = new Float64Array(N)
for (let i = 0; i < N; i++) {
  r[i] = (i + 0.5) * dr
  area[i] = 2 * Math.PI * r[i] * dr
}
const SPEEDS = [
  [10, '10 s'],
  [30, '30 s'],
  [60, '1 min'],
  [120, '2 min'],
  [300, '5 min'],
  [600, '10 min'],
]

const P = { T: 300, V: 800, th: 0.5e-3, elec: 'pin', plateR: 0.0425, Ilim: 0.05, Vth: 50 }
let S
let speed = 60
let rho = 1
let a = 1
function setRho() {
  rho = rhoPyrex(P.T)
  a = rho * P.th
}
const A = new Float64Array(N)
const B = new Float64Array(N)
const C = new Float64Array(N)
const D = new Float64Array(N)

function newSim() {
  const elecR = P.elec === 'plate' ? P.plateR : 0.003
  S = {
    isE: new Uint8Array(N),
    c: new Float64Array(N), // contact fraction of each ring
    Q: new Float64Array(N), // depleted-layer charge per contacted area, C/m^2
    u: new Float64Array(N), // |potential| in the glass, V
    jd: new Float64Array(N), // downward current density, A/m^2
    chg: new Uint8Array(N),
    time: 0,
    I: 0,
    V: P.V,
    cc: false,
    histT: [],
    histF: [],
    histI: [],
    lastHist: -1,
    elecR,
  }
  for (let i = 0; i < N; i++) {
    if (r[i] <= elecR) {
      S.isE[i] = 1
      S.c[i] = 1
    }
  }
  setRho()
  solveNow()
  closeFront()
  pushHist(true)
}

const Vi = (i) => KSC * S.Q[i] * S.Q[i]

function solveOnce(Vs) {
  const rs = rho / P.th
  const c = S.c
  const u = S.u
  for (let i = 0; i < N; i++) {
    const g = c[i] > 0 && S.chg[i] ? (c[i] * area[i]) / a : 0
    if (S.isE[i]) {
      A[i] = 0
      C[i] = 0
      B[i] = 1
      D[i] = Vs
      continue
    }
    const cw = i > 0 ? (2 * Math.PI * (r[i] - dr / 2)) / (rs * dr) : 0
    const ce = i < N - 1 ? (2 * Math.PI * (r[i] + dr / 2)) / (rs * dr) : 0
    A[i] = -cw
    C[i] = -ce
    B[i] = cw + ce + g
    D[i] = g * Vi(i)
  }
  for (let i = 1; i < N; i++) {
    const m = A[i] / B[i - 1]
    B[i] -= m * C[i - 1]
    D[i] -= m * D[i - 1]
  }
  u[N - 1] = D[N - 1] / B[N - 1]
  for (let i = N - 2; i >= 0; i--) u[i] = (D[i] - C[i] * u[i + 1]) / B[i]
}

// Spots charge only while the glass is above their depleted-layer voltage (no discharge).
function solve(Vs) {
  for (let it = 0; it < 4; it++) {
    solveOnce(Vs)
    let changed = false
    for (let i = 0; i < N; i++) {
      const s = S.c[i] > 0 && S.u[i] > Vi(i) + 1e-9 ? 1 : 0
      if (s !== S.chg[i]) {
        S.chg[i] = s
        changed = true
      }
    }
    if (!changed) break
  }
  let I = 0
  for (let i = 0; i < N; i++) {
    S.jd[i] = S.c[i] > 0 && S.chg[i] ? (S.u[i] - Vi(i)) / a : 0
    I += S.jd[i] * S.c[i] * area[i]
  }
  return I
}

function solveNow() {
  for (let i = 0; i < N; i++) S.chg[i] = S.c[i] > 0 ? 1 : 0
  let V = P.V
  let I = solve(V)
  S.cc = false
  if (I > P.Ilim) {
    // constant-current mode: lower the voltage until I = limit
    let lo = 0
    let Ilo = 0
    let hi = V
    let Ihi = I
    for (let k = 0; k < 8; k++) {
      let m = lo + ((P.Ilim - Ilo) * (hi - lo)) / (Ihi - Ilo)
      if (!(m > lo && m < hi)) m = 0.5 * (lo + hi)
      const Im = solve(m)
      V = m
      I = Im
      if (Math.abs(Im - P.Ilim) < 0.003 * P.Ilim) break
      if (Im > P.Ilim) {
        hi = m
        Ihi = Im
      } else {
        lo = m
        Ilo = Im
      }
    }
    S.cc = true
  }
  S.I = I
  S.V = V
}

function frontIdx() {
  let f = 0
  while (f < N && S.c[f] >= 1) f++
  return f
}
function frontR() {
  const f = frontIdx()
  return (f + (f < N ? S.c[f] : 0)) * dr
}
// Newly touching glass starts uncharged.
function setC(f, cn, c0, Q0) {
  S.c[f] = cn
  S.Q[f] = cn > 0 ? (Q0 * c0) / cn : 0
}
// The gap closes until the lifted glass is at the gap-closing voltage.
function closeFront() {
  for (let guard = 0; guard < N; guard++) {
    const f = frontIdx()
    if (f >= N) return
    if (S.u[f] <= P.Vth) return
    const c0 = S.c[f]
    const Q0 = S.Q[f]
    setC(f, 1, c0, Q0)
    solveNow()
    if (S.u[f] > P.Vth) continue
    let lo = c0
    let hi = 1
    let ghi = S.u[f] - P.Vth
    setC(f, c0, c0, Q0)
    solveNow()
    let glo = S.u[f] - P.Vth
    for (let k = 0; k < 14; k++) {
      let cm = hi - (ghi * (hi - lo)) / (ghi - glo)
      if (!(cm > lo && cm < hi)) cm = 0.5 * (lo + hi)
      setC(f, cm, c0, Q0)
      solveNow()
      const g = S.u[f] - P.Vth
      if (Math.abs(g) < 0.1) break
      if (g > 0) {
        lo = cm
        glo = g
        ghi *= 0.5
      } else {
        hi = cm
        ghi = g
        glo *= 0.5
      }
    }
    return
  }
}

function maxDt() {
  const tau = a / Math.sqrt(Math.max(P.Vth, 5) * KSC)
  return Math.max(1e-4, Math.min(2, 0.01 + 0.05 * S.time, ALPHA * tau))
}

function substep(dt) {
  // exact charging of each touching spot for a fixed glass potential over dt
  for (let i = 0; i < N; i++) {
    const ui = S.u[i]
    if (S.c[i] > 0 && ui > Vi(i)) {
      const qi = Math.sqrt(ui / KSC)
      const s = Math.sqrt(ui * KSC) / a
      const x = Math.min(S.Q[i] / qi, 0.999999999)
      S.Q[i] = qi * Math.tanh(s * dt + Math.atanh(x))
    }
  }
  S.time += dt
  solveNow()
  closeFront()
}

function advance(simSec, budgetMs) {
  const target = Math.min(TMAX, S.time + simSec)
  const t0 = performance.now()
  while (S.time < target - 1e-9 && performance.now() - t0 < budgetMs) {
    substep(Math.min(maxDt(), target - S.time))
  }
  pushHist(false)
}

function pushHist(force) {
  if (force || S.time - S.lastHist >= Math.max(0.02, S.time * 0.003)) {
    S.histT.push(S.time)
    S.histF.push(frontR())
    S.histI.push(S.I)
    S.lastHist = S.time
  }
}

// ---------- drawing ----------
const STOPS = [
  [0, [13, 8, 41]],
  [0.25, [74, 17, 112]],
  [0.5, [168, 50, 94]],
  [0.75, [239, 123, 43]],
  [1, [251, 228, 106]],
]
function cmap(x) {
  x = Math.max(0, Math.min(1, x))
  for (let k = 1; k < STOPS.length; k++) {
    if (x <= STOPS[k][0]) {
      const [p0, c0] = STOPS[k - 1]
      const [p1, c1] = STOPS[k]
      const w = (x - p0) / (p1 - p0)
      return [c0[0] + (c1[0] - c0[0]) * w, c0[1] + (c1[1] - c0[1]) * w, c0[2] + (c1[2] - c0[2]) * w]
    }
  }
  return STOPS[4][1]
}
const Tk = {}
function readTokens() {
  const cs = getComputedStyle(document.documentElement)
  for (const k of ['--text', '--text-dim', '--text-muted', '--border', '--accent', '--accent-2', '--bg', '--bg-elev-3']) {
    Tk[k] = cs.getPropertyValue(k).trim()
  }
}
const MONO = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const LABEL = '600 12px Inter, ui-sans-serif, system-ui, sans-serif'
function fmtI(x) {
  if (x >= 1e-3) return +(x * 1e3).toPrecision(2) + ' mA'
  if (x >= 1e-6) return +(x * 1e6).toPrecision(2) + ' µA'
  if (x >= 1e-9) return +(x * 1e9).toPrecision(2) + ' nA'
  return +(x * 1e12).toPrecision(2) + ' pA'
}

const topCanvas = $('ab-top')
const tctx = topCanvas.getContext('2d')
const TW = topCanvas.width
const TC = TW / 2
const TS = (TW / 2 - 14) / R
const img = tctx.createImageData(TW, TW)
const idxMap = new Int16Array(TW * TW)
{
  const flatY = Math.sqrt(R * R - (0.0325 / 2) ** 2) // 4" wafer primary flat, 32.5 mm
  for (let y = 0; y < TW; y++) {
    for (let x = 0; x < TW; x++) {
      const dx = (x - TC) / TS
      const dy = (y - TC) / TS
      const rr = Math.hypot(dx, dy)
      idxMap[y * TW + x] = rr < R && dy < flatY ? Math.min(N - 1, Math.floor(rr / dr)) : -1
    }
  }
}
function drawTop() {
  const d = img.data
  const rf = frontR()
  for (let p = 0; p < TW * TW; p++) {
    const k = idxMap[p]
    const o = p * 4
    if (k < 0) {
      d[o + 3] = 0
      continue
    }
    const col = cmap(S.u[k] / P.V)
    const sh = 0.62 + 0.38 * Math.min(1, S.c[k])
    d[o] = col[0] * sh
    d[o + 1] = col[1] * sh
    d[o + 2] = col[2] * sh
    d[o + 3] = 255
  }
  tctx.clearRect(0, 0, TW, TW)
  tctx.putImageData(img, 0, 0)
  tctx.strokeStyle = Tk['--text-dim']
  tctx.lineWidth = 1.5
  tctx.beginPath()
  const ang = Math.asin(0.01625 / R)
  tctx.arc(TC, TC, R * TS, Math.PI / 2 + ang, Math.PI / 2 - ang + 2 * Math.PI)
  tctx.closePath()
  tctx.stroke()
  if (rf < R - 1e-4) {
    tctx.setLineDash([6, 5])
    tctx.strokeStyle = '#ffffff'
    tctx.lineWidth = 2
    tctx.beginPath()
    tctx.arc(TC, TC, rf * TS, 0, 2 * Math.PI)
    tctx.stroke()
    tctx.setLineDash([])
  }
  tctx.strokeStyle = '#ffffff'
  tctx.lineWidth = 2
  tctx.beginPath()
  tctx.arc(TC, TC, S.elecR * TS, 0, 2 * Math.PI)
  tctx.stroke()
  tctx.fillStyle = '#ffffff'
  tctx.font = LABEL
  tctx.textAlign = 'center'
  tctx.fillText(P.elec === 'pin' ? 'pin' : 'plate', TC, TC - S.elecR * TS - 6)
  tctx.fillStyle = Tk['--text-dim']
  tctx.fillText('primary flat', TC, TW - 2)
}

function axes(ctx, W, H, m, xr, yr, xl, yl, ylog, xt, yt) {
  ctx.clearRect(0, 0, W, H)
  ctx.font = MONO
  ctx.fillStyle = Tk['--text-dim']
  ctx.strokeStyle = Tk['--border']
  ctx.lineWidth = 1
  const X = (v) => m.l + ((v - xr[0]) / (xr[1] - xr[0])) * (W - m.l - m.r)
  const Y = ylog
    ? (v) => {
        const l0 = Math.log10(yr[0])
        const l1 = Math.log10(yr[1])
        return H - m.b - ((Math.log10(Math.max(v, yr[0])) - l0) / (l1 - l0)) * (H - m.t - m.b)
      }
    : (v) => H - m.b - ((v - yr[0]) / (yr[1] - yr[0])) * (H - m.t - m.b)
  ctx.textAlign = 'center'
  for (const v of xt) {
    const x = X(v)
    ctx.beginPath()
    ctx.moveTo(x, m.t)
    ctx.lineTo(x, H - m.b)
    ctx.stroke()
    ctx.fillText(v, x, H - m.b + 16)
  }
  ctx.textAlign = 'right'
  for (const v of yt) {
    const y = Y(v)
    ctx.beginPath()
    ctx.moveTo(m.l, y)
    ctx.lineTo(W - m.r, y)
    ctx.stroke()
    ctx.fillText(ylog ? fmtI(v) : v, m.l - 6, y + 4)
  }
  ctx.textAlign = 'center'
  ctx.fillText(xl, (m.l + W - m.r) / 2, H - 4)
  ctx.save()
  ctx.translate(12, (m.t + H - m.b) / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.fillText(yl, 0, 0)
  ctx.restore()
  return { X, Y }
}

const profCanvas = $('ab-prof')
const pctx = profCanvas.getContext('2d')
function drawProf() {
  const W = profCanvas.width
  const H = profCanvas.height
  const m = { l: 58, r: 14, t: 14, b: 40 }
  const ymax = Math.max(P.V, 400)
  const vt = []
  for (let v = 0; v <= ymax + 1; v += 200) vt.push(v)
  const { X, Y } = axes(pctx, W, H, m, [0, 50], [0, ymax], 'radius from centre (mm)', '|potential| (V)', false, [0, 10, 20, 30, 40, 50], vt)
  const rf = frontR()
  const f = frontIdx()
  pctx.fillStyle = Tk['--border']
  pctx.globalAlpha = 0.5
  pctx.fillRect(X(0), m.t, X(rf * 1e3) - X(0), H - m.t - m.b)
  pctx.globalAlpha = 1
  pctx.setLineDash([2, 4])
  pctx.strokeStyle = Tk['--text-muted']
  pctx.lineWidth = 1.5
  pctx.beginPath()
  pctx.moveTo(X(0), Y(P.Vth))
  pctx.lineTo(X(50), Y(P.Vth))
  pctx.stroke()
  pctx.setLineDash([])
  pctx.strokeStyle = Tk['--accent']
  pctx.lineWidth = 2.5
  pctx.beginPath()
  for (let i = 0; i < N; i++) {
    const x = X(r[i] * 1e3)
    const y = Y(S.u[i])
    if (i) pctx.lineTo(x, y)
    else pctx.moveTo(x, y)
  }
  pctx.stroke()
  pctx.setLineDash([6, 4])
  pctx.strokeStyle = Tk['--accent-2']
  pctx.lineWidth = 2
  pctx.beginPath()
  for (let i = 0; i < N; i++) {
    if (S.c[i] <= 0) break
    const x = X(r[i] * 1e3)
    const y = Y(Vi(i))
    if (i) pctx.lineTo(x, y)
    else pctx.moveTo(x, y)
  }
  pctx.stroke()
  pctx.setLineDash([])
  if (f < N) {
    const vy = Y(S.u[f])
    pctx.fillStyle = Tk['--text']
    pctx.beginPath()
    pctx.arc(X(rf * 1e3), vy, 4.5, 0, 7)
    pctx.fill()
    const right = rf > 0.04
    pctx.textAlign = right ? 'right' : 'left'
    pctx.fillText('front', X(rf * 1e3) + (right ? -8 : 8), vy - 8)
  }
  pctx.fillStyle = Tk['--text-dim']
  pctx.textAlign = 'left'
  pctx.fillText('bonded zone', X(0) + 6, H - m.b - 8)
}

const secCanvas = $('ab-sec')
const sctx = secCanvas.getContext('2d')
function drawSec() {
  const W = secCanvas.width
  const H = secCanvas.height
  const cx = W / 2
  const sx = (W / 2 - 20) / R
  sctx.clearRect(0, 0, W, H)
  const yG = 70
  const gH = 46
  const gap = 8
  const siH = 28
  const yC = yG + gH + gap + siH
  const rf = frontR()
  const qfull = Math.sqrt(Math.max(S.V, 1) / KSC)
  let jmax = 1e-30
  for (let i = 0; i < N; i++) jmax = Math.max(jmax, S.jd[i])
  const w = Math.ceil(dr * sx) + 1
  for (let i = 0; i < N; i++) {
    for (const sgn of [-1, 1]) {
      const x = sgn > 0 ? cx + i * dr * sx : cx - (i + 1) * dr * sx
      const col = cmap(S.u[i] / P.V)
      sctx.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`
      const down = S.c[i] >= 0.5
      sctx.fillRect(x, yG + (down ? gap : 0), w, gH)
      if (down && S.Q[i] > 0) {
        const dep = 2 + 12 * Math.min(1, S.Q[i] / qfull)
        sctx.fillStyle = 'rgba(10,10,20,.75)'
        sctx.fillRect(x, yG + gap + gH - dep, w, dep)
      }
      if (down && i % 4 === 0 && S.jd[i] > 0) {
        const al = Math.max(0, 1 + Math.log10(S.jd[i] / jmax) / 4)
        if (al > 0) {
          sctx.strokeStyle = Tk['--accent']
          sctx.globalAlpha = al
          sctx.lineWidth = 1.5
          sctx.beginPath()
          sctx.moveTo(x + w / 2, yG + gap + 6)
          sctx.lineTo(x + w / 2, yG + gap + gH - 16)
          sctx.stroke()
          sctx.globalAlpha = 1
        }
      }
    }
  }
  sctx.fillStyle = Tk['--text-muted']
  sctx.fillRect(cx - R * sx, yG + gH + gap, 2 * R * sx, siH)
  sctx.fillStyle = Tk['--bg-elev-3']
  sctx.fillRect(cx - R * sx - 10, yC, 2 * R * sx + 20, H - yC - 24)
  sctx.fillStyle = Tk['--text']
  if (P.elec === 'pin') {
    sctx.fillRect(cx - 0.003 * sx, 8, 0.006 * sx, yG - 8)
  } else {
    sctx.fillRect(cx - P.plateR * sx, yG - 14, 2 * P.plateR * sx, 14)
    sctx.fillRect(cx - 6, 8, 12, yG - 22)
  }
  sctx.font = LABEL
  sctx.textAlign = 'left'
  sctx.fillStyle = Tk['--text']
  sctx.fillText('−' + Math.round(S.V) + ' V', cx + (P.elec === 'pin' ? 0.003 * sx : 6) + 8, 22)
  sctx.fillStyle = '#ffffff'
  sctx.fillText('Pyrex', cx - R * sx + 8, yG + 20 + (S.c[N - 1] >= 0.5 ? gap : 0))
  sctx.fillStyle = Tk['--bg']
  sctx.fillText('Si wafer', cx - R * sx + 8, yG + gH + gap + 19)
  sctx.fillStyle = Tk['--text']
  sctx.fillText('chuck  0 V', cx - R * sx, H - 8)
  if (rf < R - 0.004) {
    sctx.fillStyle = Tk['--text-dim']
    sctx.textAlign = 'center'
    sctx.fillText('↓ gap', cx + (rf + (R - rf) / 2) * sx, yG - 6)
  }
}

const histFront = $('ab-hist-front')
const fctx = histFront.getContext('2d')
const histCurrent = $('ab-hist-current')
const ictx = histCurrent.getContext('2d')
function timeAxis(t) {
  if (t < 120) {
    for (const o of [5, 10, 20, 30, 60, 120]) {
      if (t <= o) return { max: o, div: 1, unit: 's', step: o <= 10 ? 1 : o <= 30 ? 5 : o <= 60 ? 10 : 20 }
    }
  }
  const mins = t / 60
  for (const o of [5, 10, 20, 30, 60, 90, 120, 180, 240]) {
    if (mins <= o) return { max: o, div: 60, unit: 'min', step: o <= 10 ? 1 : o <= 30 ? 5 : o <= 60 ? 10 : o <= 120 ? 20 : 30 }
  }
  return { max: 240, div: 60, unit: 'min', step: 30 }
}
function drawHist() {
  const ta = timeAxis(S.time)
  const xt = []
  for (let v = 0; v <= ta.max + 1e-9; v += ta.step) xt.push(v)
  let m = { l: 52, r: 14, t: 12, b: 40 }
  let ax = axes(fctx, histFront.width, histFront.height, m, [0, ta.max], [0, 50], `time (${ta.unit})`, 'front radius (mm)', false, xt, [0, 10, 20, 30, 40, 50])
  fctx.strokeStyle = Tk['--accent-2']
  fctx.lineWidth = 2.5
  fctx.beginPath()
  S.histT.forEach((t, i) => {
    const x = ax.X(t / ta.div)
    const y = ax.Y(S.histF[i] * 1e3)
    if (i) fctx.lineTo(x, y)
    else fctx.moveTo(x, y)
  })
  fctx.stroke()
  m = { l: 70, r: 14, t: 12, b: 40 }
  let mx = 1e-12
  for (const v of S.histI) mx = Math.max(mx, v)
  const hi = Math.pow(10, Math.ceil(Math.log10(mx)))
  const lo = hi / 1e4
  const yt = []
  for (let v = lo; v <= hi * 1.01; v *= 10) yt.push(v)
  ax = axes(ictx, histCurrent.width, histCurrent.height, m, [0, ta.max], [lo, hi], `time (${ta.unit})`, 'current', true, xt, yt)
  ictx.strokeStyle = Tk['--accent']
  ictx.lineWidth = 2
  ictx.beginPath()
  S.histI.forEach((v, i) => {
    const x = ax.X(S.histT[i] / ta.div)
    const y = ax.Y(v)
    if (i) ictx.lineTo(x, y)
    else ictx.moveTo(x, y)
  })
  ictx.stroke()
}

const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' }
// front speed in mm/min over a recent window
function frontSpeed() {
  const n = S.histT.length
  if (n < 2) return 0
  const win = Math.max(2, 0.05 * S.time)
  let k = n - 1
  while (k > 0 && S.time - S.histT[k] < win) k--
  const dt = S.time - S.histT[k]
  if (dt <= 0) return 0
  return ((frontR() - S.histF[k]) * 1e3) / (dt / 60)
}
function readouts() {
  const rf = frontR()
  const t = Math.round(S.time)
  const done = rf >= R - 1e-4
  $('ab-r-time').textContent = `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
  $('ab-r-front').textContent = done ? '50 mm (edge)' : `${(rf * 1e3).toFixed(1)} mm`
  $('ab-ro-front').classList.toggle('is-done', done)
  $('ab-r-area').textContent = `${Math.min(100, (rf / R) ** 2 * 100).toFixed(0)} %`
  const v = frontSpeed()
  $('ab-r-speed').textContent = done ? 'complete' : `${v >= 1 ? v.toFixed(1) : v.toFixed(2)} mm/min`
  $('ab-r-current').textContent = fmtI(S.I)
  $('ab-r-volt').textContent = `−${Math.round(S.V)} V`
  $('ab-ro-volt').classList.toggle('is-cc', S.cc)
  $('ab-r-volt-label').textContent = S.cc ? 'current-limited (CC)' : 'voltage at electrode'
  $('ab-legend-max').textContent = `${P.V} V`
}
function drawAll() {
  readTokens()
  drawTop()
  drawProf()
  drawSec()
  drawHist()
  readouts()
}

// ---------- run loop (time-based, independent of screen refresh rate) ----------
let running = true
let lastTs = null
function updPlay() {
  $('ab-play').textContent = running ? 'Pause' : S.time >= TMAX ? 'Run again' : 'Play'
}
function frame(ts) {
  if (lastTs === null) lastTs = ts
  const dtReal = Math.min(0.1, Math.max(0, (ts - lastTs) / 1000))
  lastTs = ts
  if (running) {
    advance(speed * dtReal, 10)
    if (S.time >= TMAX) {
      running = false
      updPlay()
    }
    drawAll()
  }
  requestAnimationFrame(frame)
}
function restart() {
  newSim()
  drawAll()
}

// ---------- controls ----------
function sync() {
  P.T = +$('ab-temp').value
  P.V = +$('ab-volt').value
  P.th = +$('ab-thick').value * 1e-3
  P.Vth = +$('ab-gap').value
  P.plateR = +$('ab-plate-d').value / 2e3
  P.Ilim = +$('ab-ilim').value * 1e-3
  speed = SPEEDS[+$('ab-speed').value][0]
  setRho()
  $('ab-temp-out').textContent = `${P.T} °C`
  $('ab-volt-out').textContent = `−${P.V} V`
  $('ab-thick-out').textContent = `${(+$('ab-thick').value).toFixed(2)} mm`
  $('ab-gap-out').textContent = `${P.Vth} V`
  $('ab-plate-out').textContent = `Ø${$('ab-plate-d').value} mm`
  $('ab-ilim-out').textContent = `${$('ab-ilim').value} mA`
  $('ab-speed-out').textContent = SPEEDS[+$('ab-speed').value][1]
  const [mant, ex] = (rho * 100).toExponential(1).split('e+')
  $('ab-rho').textContent = `${mant}×10${ex.split('').map((ch) => SUP[ch]).join('')} Ω·cm`
  $('ab-plate-field').hidden = P.elec !== 'plate'
  $('ab-pin').classList.toggle('is-active', P.elec === 'pin')
  $('ab-plate').classList.toggle('is-active', P.elec === 'plate')
  $('ab-pin').setAttribute('aria-pressed', P.elec === 'pin')
  $('ab-plate').setAttribute('aria-pressed', P.elec === 'plate')
}
function resume() {
  running = true
  lastTs = null
  updPlay()
}

for (const id of ['ab-temp', 'ab-volt', 'ab-thick', 'ab-ilim', 'ab-gap']) {
  $(id).addEventListener('input', () => {
    sync()
    solveNow()
    closeFront()
    drawAll()
  })
}
$('ab-speed').addEventListener('input', sync)
$('ab-plate-d').addEventListener('input', sync)
$('ab-plate-d').addEventListener('change', () => {
  sync()
  restart()
})
$('ab-pin').addEventListener('click', () => {
  P.elec = 'pin'
  sync()
  restart()
})
$('ab-plate').addEventListener('click', () => {
  P.elec = 'plate'
  sync()
  restart()
})
$('ab-reset').addEventListener('click', () => {
  restart()
  resume()
})
$('ab-play').addEventListener('click', () => {
  if (S.time >= TMAX) {
    restart()
    running = true
  } else {
    running = !running
  }
  lastTs = null
  updPlay()
})
document.querySelectorAll('[data-preset]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const [t, e] = btn.dataset.preset.split(',')
    $('ab-temp').value = t
    $('ab-volt').value = 800
    $('ab-thick').value = 0.5
    $('ab-gap').value = 50
    $('ab-ilim').value = 50
    $('ab-plate-d').value = 85
    P.elec = e
    sync()
    restart()
    resume()
  })
})
document.addEventListener('labtools:themechange', drawAll)

sync()
newSim()
if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
  running = false
  advance(600, 3000)
}
updPlay()
drawAll()
requestAnimationFrame(frame)

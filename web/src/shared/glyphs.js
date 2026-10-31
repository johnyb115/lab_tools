// Small line drawings of what each tool produces, so a tile says what the
// tool is for before its name is read. All share a 120×60 viewBox and draw
// in currentColor; `.g-ax` (axes, guides) and `.g-soft` (fills, raw data)
// are toned down in CSS.

const AX = '<path class="g-ax" d="M10 6V54H112"/>'

const G = {
  cv: `${AX}
    <path d="M14 34C36 33 46 30 54 21C58 16 63 14 67 19C71 24 80 25 108 23C92 30 82 34 74 41C68 47 63 48 59 43C55 38 40 36 14 34Z"/>`,

  eis: `${AX}
    <path d="M16 52A26 26 0 0 1 68 52L100 18"/>
    <g class="g-dot"><circle cx="16" cy="52" r="1.8"/><circle cx="23.6" cy="33.6" r="1.8"/><circle cx="42" cy="26" r="1.8"/><circle cx="60.4" cy="33.6" r="1.8"/><circle cx="76" cy="44" r="1.8"/><circle cx="88" cy="31" r="1.8"/><circle cx="100" cy="18" r="1.8"/></g>`,

  fpp: `<rect class="g-soft" x="10" y="42" width="100" height="10"/>
    <path d="M26 12V42M48 12V42M72 12V42M94 12V42"/>
    <path class="g-ax" d="M48 22C52 14 68 14 72 22" stroke-dasharray="3 3"/>
    <text x="60" y="12" text-anchor="middle">V</text>
    <text x="16" y="24">I</text>`,

  peak: `${AX}
    <path class="g-soft" d="M14 48C40 47 46 46 52 30C56 16 60 14 64 26C68 40 74 45 108 44Z"/>
    <path d="M14 48C40 47 46 46 52 30C56 16 60 14 64 26C68 40 74 45 108 44"/>
    <path class="g-ax" d="M14 48L108 44" stroke-dasharray="3 3"/>
    <path d="M58 17V46" stroke-dasharray="2 2"/>`,

  plot: `${AX}
    <path d="M14 46C34 40 48 20 70 24S96 36 108 16"/>
    <path class="g-ax" d="M14 51C40 49 56 36 76 40S100 44 108 34" stroke-dasharray="4 3"/>`,

  fit: `${AX}
    <g class="g-dot"><circle cx="16" cy="48" r="1.8"/><circle cx="26" cy="45" r="1.8"/><circle cx="35" cy="47" r="1.8"/><circle cx="44" cy="42" r="1.8"/><circle cx="53" cy="41" r="1.8"/><circle cx="61" cy="35" r="1.8"/><circle cx="70" cy="33" r="1.8"/><circle cx="79" cy="26" r="1.8"/><circle cx="88" cy="23" r="1.8"/><circle cx="97" cy="14" r="1.8"/><circle cx="105" cy="11" r="1.8"/></g>
    <path d="M12 49C52 45 80 30 108 8"/>`,

  smooth: `${AX}
    <path class="g-ax" d="M12 40L16 33L20 42L24 29L28 38L32 25L36 34L40 21L44 30L48 19L52 28L56 21L60 30L64 23L68 34L72 27L76 38L80 31L84 42L88 35L92 45L96 38L100 46L104 40L108 46"/>
    <path d="M12 38C32 30 44 22 56 24C70 26 86 40 108 44"/>`,

  stats: `${AX}
    <path class="g-soft" d="M12 52C34 52 42 14 60 14C78 14 86 52 108 52Z"/>
    <path d="M12 52C34 52 42 14 60 14C78 14 86 52 108 52"/>
    <path d="M60 14V52" stroke-dasharray="2 2"/>
    <path d="M42 33H78M42 29V37M78 29V37"/>`,

  linspace: `<path class="g-ax" d="M12 36H108"/>
    <g class="g-dot"><circle cx="12" cy="36" r="2.6"/><circle cx="24" cy="36" r="2.6"/><circle cx="36" cy="36" r="2.6"/><circle cx="48" cy="36" r="2.6"/><circle cx="60" cy="36" r="2.6"/><circle cx="72" cy="36" r="2.6"/><circle cx="84" cy="36" r="2.6"/><circle cx="96" cy="36" r="2.6"/><circle cx="108" cy="36" r="2.6"/></g>
    <path d="M12 20V26M108 20V26M12 23H108"/>
    <path class="g-ax" d="M24 44V48M36 44V48"/>
    <text x="30" y="56" text-anchor="middle">Δ</text>`,

  baseline: `${AX}
    <path d="M14 47C30 44 36 41 42 27C46 18 50 30 56 35C64 33 70 30 76 20C80 13 84 28 90 28C98 26 104 25 108 23"/>
    <path class="g-ax" d="M14 47L108 23" stroke-dasharray="3 3"/>`,

  normalize: `${AX}
    <path class="g-ax" d="M10 14H112" stroke-dasharray="3 3"/>
    <path class="g-ax" d="M14 52C40 52 50 40 60 40C70 40 80 52 106 52" stroke-dasharray="4 3"/>
    <path d="M14 52C38 52 48 14 60 14C72 14 82 52 106 52"/>
    <path d="M60 37V22M56 26L60 21L64 26"/>
    <text x="114" y="17">1</text>`,

  interp: `${AX}
    <path class="g-ax" d="M14 44C30 20 50 16 64 30S96 50 108 22"/>
    <g class="g-ring"><circle cx="14" cy="44" r="3"/><circle cx="38" cy="22" r="3"/><circle cx="64" cy="30" r="3"/><circle cx="88" cy="44" r="3"/><circle cx="108" cy="22" r="3"/></g>
    <path d="M14 51V55M20 51V55M26 51V55M32 51V55M38 51V55M44 51V55M50 51V55M56 51V55M62 51V55M68 51V55M74 51V55M80 51V55M86 51V55M92 51V55M98 51V55M104 51V55"/>`,

  figure: `<rect x="16" y="5" width="42" height="23"/><rect x="62" y="5" width="42" height="23"/>
    <rect x="16" y="32" width="42" height="23"/><rect x="62" y="32" width="42" height="23"/>
    <text x="19.5" y="13">a</text><text x="65.5" y="13">b</text><text x="19.5" y="40">c</text><text x="65.5" y="40">d</text>
    <path class="g-ax" d="M28 24C34 22 38 12 54 12M74 24V18M82 24V12M90 24V16M98 24V20M66 51C76 44 88 44 100 37"/>
    <circle class="g-ax" cx="40" cy="45" r="6"/>`,

  arrow: `<path d="M12 44H52"/><path class="g-fill" d="M60 44L50 39.5V48.5Z"/>
    <path d="M70 48C72 20 92 10 103 25"/><path class="g-fill" d="M106 33L98 25.5L107 22.5Z"/>
    <path class="g-ax" d="M12 20H46M46 20V30" />`,

  digitize: `${AX}
    <path class="g-band" d="M14 48C36 46 50 24 70 20S100 14 108 12"/>
    <g class="g-sq"><rect x="23" y="44.5" width="4" height="4"/><rect x="42" y="33" width="4" height="4"/><rect x="88" y="14.5" width="4" height="4"/></g>
    <path d="M56 20H84M70 8V32"/><circle cx="70" cy="20" r="5"/>`,

  crop: `<rect class="g-ax" x="10" y="5" width="100" height="50" stroke-dasharray="3 3"/>
    <rect class="g-soft" x="36" y="17" width="48" height="26"/>
    <path d="M40 39L52 27L60 34L66 29L80 39"/>
    <path d="M30 23V12H41M79 12H90V23M90 37V48H79M41 48H30V37"/>`,

  cutout: `<g class="g-chk"><rect x="22" y="6" width="8" height="8"/><rect x="38" y="6" width="8" height="8"/><rect x="74" y="6" width="8" height="8"/><rect x="90" y="6" width="8" height="8"/><rect x="30" y="14" width="8" height="8"/><rect x="82" y="14" width="8" height="8"/><rect x="22" y="22" width="8" height="8"/><rect x="90" y="22" width="8" height="8"/><rect x="30" y="30" width="8" height="8"/><rect x="82" y="30" width="8" height="8"/><rect x="22" y="38" width="8" height="8"/><rect x="90" y="38" width="8" height="8"/><rect x="30" y="46" width="8" height="8"/><rect x="82" y="46" width="8" height="8"/></g>
    <rect class="g-ax" x="22" y="6" width="76" height="48"/>
    <path class="g-fill" d="M54 9H66V12H64V24L78 50H42L56 24V12H54Z"/>`,

  scalebar: `<rect class="g-soft" x="10" y="5" width="100" height="50"/>
    <g class="g-ax"><circle cx="30" cy="20" r="7"/><circle cx="52" cy="32" r="5"/><circle cx="72" cy="16" r="6"/><circle cx="38" cy="42" r="4"/><circle cx="90" cy="28" r="5"/></g>
    <path class="g-bar" d="M74 47H102"/>
    <text x="88" y="42" text-anchor="middle">10 µm</text>`,

  pdf: `<path d="M14 5H44L52 13V55H14Z"/><path class="g-ax" d="M44 5V13H52"/>
    <path class="g-ax" d="M20 14H38M20 19H46M20 44H46M20 49H40"/>
    <rect class="g-soft" x="20" y="24" width="26" height="15"/>
    <path d="M56 32H70M65 27L70 32L65 37"/>
    <rect x="76" y="17" width="34" height="30"/><path d="M80 42L90 31L96 37L100 33L106 42"/>`,

  table: `<rect x="12" y="10" width="40" height="40"/><path class="g-ax" d="M12 20H52M12 30H52M12 40H52M25 10V50M39 10V50"/>
    <path d="M58 25H76M71 20L76 25L71 30M76 37H58M63 32L58 37L63 42"/>
    <text x="96" y="37" text-anchor="middle" class="g-big">{ }</text>`,

  units: `<text x="28" y="30" text-anchor="middle" class="g-big">mM</text>
    <text x="92" y="30" text-anchor="middle" class="g-big">g/L</text>
    <path d="M48 22H72M67 17L72 22L67 27M72 33H48M53 28L48 33L53 38"/>
    <path class="g-ax" d="M10 46H110" stroke-dasharray="3 3"/>
    <text x="60" y="56" text-anchor="middle">Ag/AgCl → RHE</text>`,

  colors: `<g class="g-swatch"><rect x="12" y="10" width="16" height="16" fill="#e15759"/><rect x="32" y="10" width="16" height="16" fill="#f28e2b"/><rect x="52" y="10" width="16" height="16" fill="#59a14f"/><rect x="72" y="10" width="16" height="16" fill="#4e79a7"/><rect x="92" y="10" width="16" height="16" fill="#b07aa1"/>
    <rect x="12" y="34" width="16" height="16" fill="#8e8a5a"/><rect x="32" y="34" width="16" height="16" fill="#b9a64a"/><rect x="52" y="34" width="16" height="16" fill="#949054"/><rect x="72" y="34" width="16" height="16" fill="#5d76a8"/><rect x="92" y="34" width="16" height="16" fill="#8384a4"/></g>`,

  qr: `<g class="g-fill"><path d="M38 4H52V18H38ZM41 7V15H49V7Z" fill-rule="evenodd"/><path d="M68 4H82V18H68ZM71 7V15H79V7Z" fill-rule="evenodd"/><path d="M38 42H52V56H38ZM41 45V53H49V45Z" fill-rule="evenodd"/>
    <rect x="56" y="6" width="4" height="4"/><rect x="60" y="14" width="4" height="4"/><rect x="56" y="22" width="4" height="4"/><rect x="40" y="24" width="4" height="4"/><rect x="48" y="28" width="4" height="4"/><rect x="64" y="26" width="4" height="4"/><rect x="72" y="24" width="4" height="4"/><rect x="78" y="32" width="4" height="4"/><rect x="58" y="36" width="4" height="4"/><rect x="68" y="40" width="4" height="4"/><rect x="56" y="48" width="4" height="4"/><rect x="74" y="50" width="4" height="4"/></g>
    <path d="M8 12H30L36 18M8 30H34M8 48H24L30 42"/>
    <path d="M90 22H100L106 16M86 44H112"/>
    <g class="g-ring"><circle cx="8" cy="12" r="2.6"/><circle cx="8" cy="30" r="2.6"/><circle cx="8" cy="48" r="2.6"/><circle cx="106" cy="16" r="2.6"/><circle cx="112" cy="44" r="2.6"/></g>`,

  bonding: `<rect class="g-soft" x="12" y="16" width="96" height="16"/><rect x="12" y="16" width="96" height="16"/>
    <rect class="g-fill" x="12" y="32" width="96" height="11"/>
    <path d="M60 3V16"/><path class="g-bar" d="M22 50H98"/>
    <path class="g-ax" d="M60 32C52 32 46 28 44 24M60 32C68 32 74 28 76 24M60 32C44 32 34 26 30 20M60 32C76 32 86 26 90 20" stroke-dasharray="2 2"/>
    <text x="68" y="10">−</text><text x="104" y="58">+</text>`,
}

export function glyph(name, className = 'glyph') {
  const body = G[name]
  if (!body) return ''
  return `<svg class="${className}" viewBox="0 0 120 60" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">${body}</svg>`
}

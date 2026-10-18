// The app's engraving, drawn from parametric curves so it stays crisp at every
// size: the rosette medallions, the engraved border band used as a 9-slice
// border-image and the hatched ground behind engraved panels. Bottle green only.
// Locket's mark is the approved logo in public/brand/mark.svg, not drawn here.
// Run: node scripts/guilloche.mjs (writes public/brand/*.svg).
import { writeFile } from 'node:fs/promises'

const GREEN = '#2F5A40', TINT = '#DCE8D8'
const out = new URL('../public/brand/', import.meta.url)
let precision = 10
const f = n => (Math.round(n * precision) / precision).toString()
const TAU = Math.PI * 2

/** A closed polar curve ρ(θ), sampled about eight times per lobe, as one compact path. */
function polar(cx, cy, rho, steps) {
  let d = '', px = 0, py = 0
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * TAU, r = rho(t)
    const x = Number(f(cx + r * Math.cos(t))), y = Number(f(cy + r * Math.sin(t)))
    d += i ? `l${f(x - px)} ${f(y - py)}` : `M${x} ${y}`
    px = x; py = y
  }
  return d.replace(/ -/g, '-') + 'z'
}

/** A closed parametric curve, sampled `steps` times, as one compact relative path. */
function curve(point, steps) {
  let d = '', px = 0, py = 0
  for (let i = 0; i < steps; i++) {
    const [x0, y0] = point((i / steps) * TAU), x = Number(f(x0)), y = Number(f(y0))
    d += i ? `l${f(x - px)} ${f(y - py)}` : `M${x} ${y}`
    px = x; py = y
  }
  return d.replace(/ -/g, '-') + 'z'
}

/** Guilloché rosette: looped strands (epitrochoids) crossing in a lattice, a scalloped rim and an open eye. */
function rosette(cx, cy, size, { petals = 48, strands = 6, width = 0.6, eye = true, rings = true, ring = 0.64, loop = 0.18 } = {}) {
  const R = size / 2, paths = []
  // Scalloped rim: 16 lobes in three close strokes.
  for (let k = 0; k < 3; k++) paths.push(polar(cx, cy, t => R * (0.88 - k * 0.025 + 0.08 * Math.abs(Math.sin(8 * t))), 16 * 10))
  // The lattice: each strand runs round the ring in `petals / 2` small loops; strands are phase shifted so they cross.
  const loops = petals / 2
  for (let k = 0; k < strands; k++) {
    const phase = (k * TAU) / strands / loops
    paths.push(curve(t => { const a = t + phase, b = loops * t; return [cx + R * ring * Math.cos(a) + R * loop * Math.cos(a + b), cy + R * ring * Math.sin(a) + R * loop * Math.sin(a + b)] }, loops * 14))
  }
  // Inner wavy rings and the eye (a corner medallion keeps its lattice to the centre instead).
  if (rings) for (let k = 0; k < 2; k++) paths.push(polar(cx, cy, t => R * (0.43 + 0.025 * Math.sin(petals * t + k * Math.PI)), petals * 6))
  if (eye) paths.push(polar(cx, cy, () => R * 0.39, 96))
  return `<g fill="none" stroke="${GREEN}" stroke-width="${width}">${paths.map(d => `<path d="${d}"/>`).join('')}</g>`
}

const svg = (w, h, body, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"${extra}>${body}</svg>\n`

/**
 * One straight edge of the border, `slice` deep and tiling every `tile` along its length: a paper margin, a
 * `BAND`-deep band of two interlaced ribbons between rope edges, then a fine inner rule over the ground.
 */
const SLICE = 32, MARGIN = 4, BAND = 16, PAPER = '#FFFFFD'
function edge(length, tile) {
  const top = MARGIN, bottom = MARGIN + BAND, mid = (top + bottom) / 2
  const sine = (offset, phase) => {
    let d = ''
    for (let x = 0; x <= length; x++) d += `${x ? 'L' : 'M'}${f(x)} ${f(mid + offset + 4.2 * Math.sin((TAU * x) / tile + phase))}`
    return d
  }
  let hatch = ''
  for (let x = 0; x < length; x += 2.4) hatch += `M${f(x)} ${f(top + 0.9)}l1.4 1.6M${f(x)} ${f(bottom - 2.5)}l1.4 1.6`
  const ribbons = [0, Math.PI].flatMap(phase => [sine(-1.1, phase), sine(1.1, phase)])
  return `<rect width="${length}" height="${MARGIN}" fill="${PAPER}"/><rect y="${top}" width="${length}" height="${BAND}" fill="${TINT}" fill-opacity=".55"/>`
    + `<g fill="none" stroke="${GREEN}"><path stroke-width=".7" d="M0 ${f(top + 0.4)}H${length}M0 ${f(bottom - 0.4)}H${length}"/><path stroke-width=".45" d="${hatch}"/>`
    + `<path stroke-width=".8" d="${ribbons.join('')}"/><path stroke-width=".55" stroke-opacity=".55" d="M0 ${bottom + 3}H${length}"/></g>`
}

/** The 9-slice border: each edge drawn once and reused, rosette medallions filling the rounded corners. */
function border(tile = 48) {
  const S = SLICE * 2 + tile, r = SLICE / 2
  const outline = `M${r} 0H${S - r}A${r} ${r} 0 0 1 ${S} ${r}V${S - r}A${r} ${r} 0 0 1 ${S - r} ${S}H${r}A${r} ${r} 0 0 1 0 ${S - r}V${r}A${r} ${r} 0 0 1 ${r} 0z`
  // A corner runs both bands in under its medallion, so the ribbons meet the rosette without a gap.
  const corner = `<g clip-path="url(#q)"><use href="#e" transform="translate(${r} 0)"/><use href="#e" transform="translate(0 ${r + tile}) rotate(-90)"/></g>`
    + `<circle cx="${r}" cy="${r}" r="${r - 0.3}" fill="${PAPER}"/>` + rosette(r, r, SLICE - 1, { petals: 16, strands: 3, width: 0.45, eye: false, rings: false, ring: 0.42, loop: 0.36 }) + `<circle cx="${r}" cy="${r}" r="1.6" fill="${GREEN}"/>`
  const body = `<defs><clipPath id="k"><path d="${outline}"/></clipPath><clipPath id="q"><rect width="${SLICE}" height="${SLICE}"/></clipPath><g id="e">${edge(tile, tile)}</g><g id="c">${corner}</g></defs><g clip-path="url(#k)">`
    + `<use href="#e" transform="translate(${SLICE} 0)"/><use href="#e" transform="translate(${SLICE} ${S}) scale(1 -1)"/>`
    + `<use href="#e" transform="translate(0 ${SLICE + tile}) rotate(-90)"/><use href="#e" transform="translate(${S} ${SLICE}) rotate(90)"/>`
    + ['', `translate(${S} 0) scale(-1 1)`, `translate(0 ${S}) scale(1 -1)`, `translate(${S} ${S}) scale(-1 -1)`].map(t => `<use href="#c"${t ? ` transform="${t}"` : ''}/>`).join('') + '</g>'
  return svg(S, S, body)
}

/** A tile of fine hatched waves for the ground behind engraved panels. */
function ground(w = 160, h = 40) {
  let d = ''
  for (let y = 0; y <= h; y += 4) {
    for (let i = 0; i <= w; i += 2) d += `${i ? 'L' : 'M'}${i} ${f(y + 1.4 * Math.sin((TAU * i) / w * 2 + y / 6))}`
  }
  return svg(w, h, `<path d="${d}" fill="none" stroke="${GREEN}" stroke-opacity=".3" stroke-width=".5"/>`)
}

const files = {
  'rosette.svg': svg(120, 120, rosette(60, 60, 118, { petals: 48, strands: 5, width: 0.5 })),
  'guilloche-border.svg': border(),
  'ground.svg': ground(),
}
for (const [name, body] of Object.entries(files)) await writeFile(new URL(name, out), body)
console.log(`Wrote ${Object.keys(files).join(', ')} to public/brand/`)

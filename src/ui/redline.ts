// A version's text laid out as the workspace's page: headings and numbered
// clauses grouped into sections, with the changes from the earlier version as
// tracked insertions and deletions down to the word. Locket's line comparison
// finds the changed lines; a word comparison inside each changed pair shows
// exactly what moved. Offsets are the version text's own, so cited findings and
// quoted comments land on their words.
import { diffLines, type DiffLine } from '../locket/diff'

export type Op = DiffLine['op']
export interface Segment { op: Op; text: string; start: number }
export interface Paragraph { kind: 'heading' | 'clause' | 'text'; number: string; segments: Segment[]; start: number; end: number; changed: boolean }
export interface Section { number: string; title: string; paragraphs: Paragraph[] }
export interface Redline { sections: Section[]; changes: number }

// Words, spaces and sentence punctuation, so "fees." to "unlimited." changes the word and keeps the period.
const tokens = (line: string) => line.match(/\s+|[^\s.,;:!?]+|[.,;:!?]/g) ?? []

/** Word-level changes inside one changed line: each run of changes reads as one deletion then one insertion. */
function words(before: string, after: string): { op: Op; text: string }[] {
  const raw = diffLines(tokens(before).join('\n'), tokens(after).join('\n'))
  const out: { op: Op; text: string }[] = []
  let pending: { del: string; add: string } | null = null
  const flush = () => { if (pending) { if (pending.del) out.push({ op: 'del', text: pending.del }); if (pending.add) out.push({ op: 'add', text: pending.add }); pending = null } }
  raw.forEach((piece, i) => {
    // A space between two changes belongs to the change, so "thirty (30)" reads as one deletion.
    const next = raw.slice(i + 1).find(p => p.op !== 'same' || !/^\s+$/.test(p.text))
    const between = piece.op === 'same' && /^\s+$/.test(piece.text) && pending !== null && next !== undefined && next.op !== 'same'
    if (piece.op === 'same' && !between) { flush(); out.push({ op: 'same', text: piece.text }); return }
    pending ??= { del: '', add: '' }
    if (piece.op !== 'add') pending.del += piece.text
    if (piece.op !== 'del') pending.add += piece.text
  })
  flush()
  return out.filter(p => p.text)
}

const similar = (a: string, b: string) => {
  const same = words(a, b).filter(p => p.op === 'same').reduce((n, p) => n + p.text.length, 0)
  return same / Math.max(a.length, b.length, 1) >= 0.5
}

function paragraph(segments: Segment[], start: number, end: number): Paragraph {
  const text = segments.map(s => s.text).join('')
  const clause = text.match(/^(\d+\.\d+)\s+/), heading = !clause && text.match(/^(\d+)\.\s+\S/)
  const number = clause?.[1] ?? (heading ? heading[1] : '')
  // The clause number sits in the gutter, so it leaves the running text.
  let skip = clause ? clause[0].length : 0
  const shown: Segment[] = []
  for (const s of segments) {
    if (skip >= s.text.length) { skip -= s.text.length; continue }
    shown.push({ ...s, text: s.text.slice(skip), start: s.start + (s.op === 'del' ? 0 : skip) })
    skip = 0
  }
  return { kind: clause ? 'clause' : heading ? 'heading' : 'text', number, segments: shown, start, end, changed: segments.some(s => s.op !== 'same') }
}

/** The page for `text`, marked against `before` when there is one. */
export function redline(before: string | null, text: string): Redline {
  const lines = before === null ? text.split('\n').map(t => ({ op: 'same' as Op, text: t })) : diffLines(before, text)
  const paragraphs: Paragraph[] = []
  let offset = 0, changes = 0, i = 0
  const keep = (line: string, op: Op) => {
    const start = offset
    offset += line.length + 1
    if (op === 'add') changes++
    return paragraph([{ op, text: line, start }], start, start + line.length)
  }
  while (i < lines.length) {
    if (lines[i].op === 'same') { paragraphs.push(keep(lines[i].text, 'same')); i++; continue }
    const dels: string[] = [], adds: string[] = []
    while (i < lines.length && lines[i].op !== 'same') { (lines[i].op === 'del' ? dels : adds).push(lines[i].text); i++ }
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      const gone = dels[k], line = adds[k]
      if (gone !== undefined && line !== undefined && similar(gone, line)) {
        const start = offset
        let at = start
        const segments = words(gone, line).map(p => { const s = { ...p, start: at }; if (p.op !== 'del') at += p.text.length; return s })
        changes += segments.filter((s, n) => s.op !== 'same' && (n === 0 || segments[n - 1].op === 'same')).length
        offset += line.length + 1
        paragraphs.push(paragraph(segments, start, start + line.length))
        continue
      }
      if (gone !== undefined) { changes++; paragraphs.push(paragraph([{ op: 'del', text: gone, start: offset }], offset, offset)) }
      if (line !== undefined) paragraphs.push(keep(line, 'add'))
    }
  }
  const sections: Section[] = [{ number: '', title: '', paragraphs: [] }]
  for (const p of paragraphs) {
    if (p.kind === 'heading') sections.push({ number: p.number, title: p.segments.map(s => (s.op === 'del' ? '' : s.text)).join('').replace(/^\d+\.\s+/, ''), paragraphs: [] })
    sections[sections.length - 1].paragraphs.push(p)
  }
  return { sections: sections.filter(s => s.paragraphs.length), changes }
}

/** Splits a paragraph's segments at the given offsets, so a cited passage can be marked on its own words. */
export function cut(segments: Segment[], at: number[]): Segment[] {
  const out: Segment[] = []
  for (const s of segments) {
    if (s.op === 'del') { out.push(s); continue }
    let rest = s
    for (const point of [...at].sort((a, b) => a - b)) {
      if (point > rest.start && point < rest.start + rest.text.length) {
        out.push({ ...rest, text: rest.text.slice(0, point - rest.start) })
        rest = { ...rest, text: rest.text.slice(point - rest.start), start: point }
      }
    }
    out.push(rest)
  }
  return out
}

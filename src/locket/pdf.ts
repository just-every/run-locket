// A deterministic, text-only A4 PDF for agreement text produced inside Locket
// (template versions). Same text in, same bytes out. Uploaded PDFs are never
// re-rendered: they go to signature exactly as approved.

const PAGE_W = 595, PAGE_H = 842, MARGIN = 56, SIZE = 10, LEADING = 14
const WIDTH = 92 // characters per line at 10pt Helvetica within the margins (conservative)
const LINES = Math.floor((PAGE_H - MARGIN * 2) / LEADING)

function wrap(text: string): string[] {
  const out: string[] = []
  for (const raw of text.replace(/\t/g, '    ').split('\n')) {
    let line = raw
    if (!line) { out.push(''); continue }
    while (line.length > WIDTH) {
      let cut = line.lastIndexOf(' ', WIDTH)
      if (cut <= 0) cut = WIDTH
      out.push(line.slice(0, cut))
      line = line.slice(cut).replace(/^ /, '')
    }
    out.push(line)
  }
  return out
}
// WinAnsi-safe text: keep printable Latin-1, replace anything else visibly.
const pdfString = (s: string) => '(' + [...s].map(ch => (ch.charCodeAt(0) > 255 ? '?' : ch)).join('').replace(/[\\()]/g, m => '\\' + m) + ')'

export function textPdf(title: string, body: string, footer: string): Uint8Array {
  const lines = wrap(`${title}\n\n${body}`)
  const pages: string[][] = []
  for (let i = 0; i < lines.length; i += LINES) pages.push(lines.slice(i, i + LINES))
  if (!pages.length) pages.push([''])
  const objects: string[] = []
  const font = 3
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[font] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  const kids: number[] = []
  pages.forEach((page, index) => {
    const pageObj = 4 + index * 2, contentObj = pageObj + 1
    kids.push(pageObj)
    const ops = [`BT /F1 ${SIZE} Tf ${LEADING} TL ${MARGIN} ${PAGE_H - MARGIN} Td`]
    for (const line of page) ops.push(`${pdfString(line)} Tj T*`)
    ops.push('ET', `BT /F1 8 Tf ${MARGIN} 28 Td ${pdfString(`${footer} - page ${index + 1} of ${pages.length}`)} Tj ET`)
    const stream = ops.join('\n')
    objects[contentObj] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    objects[pageObj] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentObj} 0 R >>`
  })
  objects[2] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = out.length
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let i = 1; i < objects.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  const bytes = new Uint8Array(out.length)
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff
  return bytes
}

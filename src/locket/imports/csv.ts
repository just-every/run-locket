// RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF, optional UTF-8 BOM.
import { fail } from '../model'

export function parseCsv(text: string): { header: string[]; rows: Record<string, string>[] } {
  const input = text.replace(/^﻿/, '')
  const records: string[][] = []
  let field = '', row: string[] = [], quoted = false
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(x => x !== '')) records.push(row)
      row = []
    } else field += ch
  }
  if (quoted) fail('CSV', 'The manifest has an unterminated quoted field.')
  row.push(field)
  if (row.some(x => x !== '')) records.push(row)
  if (!records.length) fail('CSV', 'The manifest is empty.')
  const header = records[0].map(h => h.trim())
  const rows = records.slice(1).map((r, n) => {
    if (r.length !== header.length) fail('CSV', `Manifest row ${n + 2} has ${r.length} fields; the header has ${header.length}.`)
    return Object.fromEntries(header.map((h, i) => [h, r[i].trim()]))
  })
  return { header, rows }
}

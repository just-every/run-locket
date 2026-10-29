// Bounded OOXML table reader. Originals remain in the import journal.
import { inflateRawSync } from 'node:zlib'
import { DOMParser } from '@xmldom/xmldom'
import { fail } from '../model'
import { parseCsv } from './csv'

function xml(bytes: Uint8Array) {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) fail('XLSX', 'External entities are not supported.')
  return new DOMParser({ errorHandler: { warning: () => {}, error: () => { fail('XLSX', 'The workbook XML is damaged.') }, fatalError: () => { fail('XLSX', 'The workbook XML is damaged.') } } }).parseFromString(source, 'application/xml')
}
export function workbookEntries(bytes: Uint8Array) {
  const bad = () => fail('XLSX', 'Use a valid, unencrypted XLSX workbook smaller than 6 MB expanded.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const n = (p: number, size: number) => p < 0 || p + size > bytes.length ? bad() : size === 2 ? view.getUint16(p, true) : view.getUint32(p, true)
  let end = -1
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) if (n(p, 4) === 0x06054b50 && p + 22 + n(p + 20, 2) === bytes.length) { end = p; break }
  if (end < 0 || n(end + 4, 2) || n(end + 6, 2) || n(end + 10, 2) > 1000) bad()
  let offset = n(end + 16, 4), total = 0
  if (offset + n(end + 12, 4) !== end) bad()
  const entries = new Map<string, Uint8Array>(), ranges: [number, number][] = []
  for (let i = 0; i < n(end + 10, 2); i++) {
    if (n(offset, 4) !== 0x02014b50) bad()
    const flags = n(offset + 8, 2), method = n(offset + 10, 2), packed = n(offset + 20, 4), length = n(offset + 24, 4), local = n(offset + 42, 4)
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + n(offset + 28, 2)))
    if (flags & 1 || ![0, 8].includes(method) || name.startsWith('/') || /[\\\x00-\x1f]/.test(name) || name.split('/').includes('..') || entries.has(name)) bad()
    if (n(local, 4) !== 0x04034b50 || n(local + 8, 2) !== method) bad()
    const start = local + 30 + n(local + 26, 2) + n(local + 28, 2), stop = start + packed
    total += length
    if (total > 6 * 1024 * 1024 || stop > n(end + 16, 4) || ranges.some(([a, b]) => local < b && stop > a)) bad()
    ranges.push([local, stop])
    const content = method === 0 ? bytes.slice(start, stop) : inflateRawSync(bytes.subarray(start, stop), { maxOutputLength: Math.max(1, length) })
    let crc = 0xffffffff
    for (const byte of content) { crc ^= byte; for (let j = 0; j < 8; j++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1 }
    if (content.length !== length || ((crc ^ 0xffffffff) >>> 0) !== n(offset + 16, 4)) bad()
    entries.set(name, content)
    offset += 46 + n(offset + 28, 2) + n(offset + 30, 2) + n(offset + 32, 2)
  }
  if (offset !== end) bad()
  return entries
}
export function readTable(filename: string, bytes: Uint8Array) {
  if (/\.csv$/i.test(filename)) return parseCsv(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (!/\.xlsx$/i.test(filename)) fail('MANIFEST', 'Choose CSV or Excel XLSX; save older XLS workbooks as XLSX.')
  const entries = workbookEntries(bytes)
  const get = (name: string) => { const b = entries.get(name); if (!b) fail('XLSX', `The workbook lacks ${name}.`); return xml(b) }
  const strings = entries.has('xl/sharedStrings.xml') ? Array.from(get('xl/sharedStrings.xml').getElementsByTagName('si')).map(s => s.textContent ?? '') : []
  const first = get('xl/workbook.xml').getElementsByTagName('sheet')[0]?.getAttribute('r:id')
  const target = Array.from(get('xl/_rels/workbook.xml.rels').getElementsByTagName('Relationship')).find(r => r.getAttribute('Id') === first)?.getAttribute('Target')
  if (!target || target.includes('..')) fail('XLSX', 'The first worksheet is unavailable.')
  const rows = Array.from(get(target.startsWith('/') ? target.slice(1) : 'xl/' + target).getElementsByTagName('row')).map(row => {
    const values: string[] = []
    for (const cell of Array.from(row.getElementsByTagName('c'))) {
      const ref = cell.getAttribute('r')?.match(/^([A-Z]+)\d+$/)?.[1]
      if (!ref) fail('XLSX', 'A cell has no column reference.')
      let column = 0; for (const c of ref) column = column * 26 + c.charCodeAt(0) - 64
      if (column > 250) fail('XLSX', 'Use at most 250 metadata columns.')
      if (cell.getElementsByTagName('f').length) fail('XLSX', 'Export values instead of formulas before importing.')
      const value = cell.getElementsByTagName('v')[0]?.textContent ?? ''
      values[column - 1] = cell.getAttribute('t') === 's' ? strings[Number(value)] ?? '' : cell.getAttribute('t') === 'inlineStr' ? cell.getElementsByTagName('is')[0]?.textContent ?? '' : value
    }
    return values
  }).filter(r => r.some(v => v))
  const header = Array.from({ length: rows[0]?.length ?? 0 }, (_, i) => rows[0][i]?.trim() ?? '')
  if (!header.length || header.some(h => !h) || new Set(header).size !== header.length) fail('MANIFEST_COLUMNS', 'Use distinct nonempty column headings.')
  return { header, rows: rows.slice(1).map(row => Object.fromEntries(header.map((h, i) => [h, row[i]?.trim() ?? '']))) }
}

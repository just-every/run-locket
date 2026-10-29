import { fail } from '../model'

export const IMPORT_LIMIT = 6 * 1024 * 1024

/** Bounded, CRC-checked ZIP reader. Never writes archive paths to the filesystem. */
export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const invalid = (): never => fail('IMPORT_ZIP', 'Use a plain, unencrypted ZIP with distinct relative paths and at most 6 MB expanded files.')
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (o: number) => o >= 0 && o + 2 <= bytes.length ? v.getUint16(o, true) : invalid()
  const u32 = (o: number) => o >= 0 && o + 4 <= bytes.length ? v.getUint32(o, true) : invalid()
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === bytes.length) { end = i; break }
  if (end < 0 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) invalid()
  const count = u16(end + 10), directory = u32(end + 16)
  if (count > 1000 || directory + u32(end + 12) !== end) invalid()
  const files = new Map<string, Uint8Array>(), ranges: [number, number][] = []
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let offset = directory, expanded = 0
  try {
    for (let i = 0; i < count; i++) {
      if (offset + 46 > end || u32(offset) !== 0x02014b50) invalid()
      const flags = u16(offset + 8), method = u16(offset + 10), packed = u32(offset + 20), size = u32(offset + 24), local = u32(offset + 42)
      const n = u16(offset + 28), next = offset + 46 + n + u16(offset + 30) + u16(offset + 32)
      if (next > end || flags & 1 || ![0, 8].includes(method) || size > IMPORT_LIMIT || local + 30 > directory) invalid()
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + n))
      if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || /[\\\u0000-\u001f]/.test(name) || name.replace(/\/$/, '').split('/').some(p => !p || p === '.' || p === '..') || files.has(name)) invalid()
      if (u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method) invalid()
      const start = local + 30 + u16(local + 26) + u16(local + 28), stop = start + packed
      if (stop > directory || ranges.some(([a, b]) => local < b && stop > a) || decoder.decode(bytes.subarray(local + 30, local + 30 + u16(local + 26))) !== name) invalid()
      ranges.push([local, stop]); expanded += size
      if (expanded > IMPORT_LIMIT) invalid()
      const compressed = bytes.subarray(start, stop), data = method === 0 ? compressed : await inflate(compressed, size)
      let crc = 0xffffffff
      for (const byte of data) { crc ^= byte; for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1 }
      if (data.length !== size || ((crc ^ 0xffffffff) >>> 0) !== u32(offset + 16)) invalid()
      if (!name.endsWith('/')) files.set(name, data)
      offset = next
    }
    if (offset !== end) invalid()
  } catch { invalid() }
  return files
}

async function inflate(bytes: Uint8Array, declared: number) {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const chunks: Uint8Array[] = []; let total=0
  for (;;) {
    const {value,done}=await reader.read(); if(done) break
    total+=value.length
    if(total>declared){await reader.cancel();fail('IMPORT_ZIP','A ZIP member exceeds its declared size.')}
    chunks.push(value)
  }
  const out=new Uint8Array(total);let at=0
  for(const chunk of chunks){out.set(chunk,at);at+=chunk.length}
  return out
}

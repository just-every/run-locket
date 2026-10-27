import { inflateRawSync } from 'node:zlib'
import { MAX_FILE_BYTES } from './artifacts'

/** Select explicit owner-named originals without rewriting or extracting to disk. */
export function executionArchive(bytes: Uint8Array, signedName: string, certificateName: string) {
  const invalid = () => { throw Error('provider_archive_invalid') }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (offset: number) => offset >= 0 && offset + 2 <= bytes.length ? view.getUint16(offset, true) : invalid()
  const u32 = (offset: number) => offset >= 0 && offset + 4 <= bytes.length ? view.getUint32(offset, true) : invalid()
  const decoder = new TextDecoder('utf-8', {fatal:true})
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === bytes.length) { end = i; break }
  }
  if (end < 0 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== 2 || u16(end + 10) !== 2) invalid()
  const directory = u32(end + 16)
  if (directory + u32(end + 12) !== end) invalid()
  const files = new Map<string, Uint8Array>(), ranges: [number,number][] = []
  let offset = directory
  for (let i = 0; i < 2; i++) {
    if (offset + 46 > end || u32(offset) !== 0x02014b50) invalid()
    const flags=u16(offset+8), method=u16(offset+10), packed=u32(offset+20), length=u32(offset+24)
    const nameLength=u16(offset+28), extra=u16(offset+30), comment=u16(offset+32), local=u32(offset+42)
    const next=offset+46+nameLength+extra+comment
    if (next > end || flags & 1 || ![0,8].includes(method) || !length || length > MAX_FILE_BYTES || local+30 > directory) invalid()
    const name=decoder.decode(bytes.subarray(offset+46,offset+46+nameLength))
    if (![signedName,certificateName].includes(name) || files.has(name) || u32(local)!==0x04034b50 || u16(local+6)!==flags || u16(local+8)!==method) invalid()
    const start=local+30+u16(local+26)+u16(local+28), stop=start+packed
    if (stop > directory || ranges.some(([from,to])=>local<to&&stop>from) || decoder.decode(bytes.subarray(local+30,local+30+u16(local+26)))!==name) invalid()
    ranges.push([local,stop])
    const compressed=bytes.subarray(start,stop)
    const data=method===0?compressed:inflateRawSync(compressed,{maxOutputLength:length})
    let crc=0xffffffff
    for (const byte of data) { crc^=byte; for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1 }
    if (data.length!==length || ((crc^0xffffffff)>>>0)!==u32(offset+16) || decoder.decode(data.subarray(0,5))!=='%PDF-') invalid()
    files.set(name,data);offset=next
  }
  if (offset!==end || !files.has(signedName) || !files.has(certificateName)) invalid()
  return {signed:files.get(signedName)!,certificate:files.get(certificateName)!}
}

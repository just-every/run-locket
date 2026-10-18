// A minimal Word document for the demo's sample files: one paragraph per line,
// in a stored (uncompressed) ZIP that Word and Locket's DOCX reader both open.

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff
  for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const parts = (text: string): [string, string][] => [
  ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
  ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
  ['word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text.split('\n').map(line => `<w:p><w:r><w:t xml:space="preserve">${escape(line)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`],
]

export function textDocx(text: string): Uint8Array {
  const encoder = new TextEncoder(), local: Uint8Array[] = [], central: Uint8Array[] = []
  let offset = 0
  for (const [name, content] of parts(text)) {
    const nameBytes = encoder.encode(name), data = encoder.encode(content), crc = crc32(data)
    const head = new DataView(new ArrayBuffer(30))
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint32(14, crc, true); head.setUint32(18, data.length, true); head.setUint32(22, data.length, true); head.setUint16(26, nameBytes.length, true)
    const dir = new DataView(new ArrayBuffer(46))
    dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint32(16, crc, true); dir.setUint32(20, data.length, true); dir.setUint32(24, data.length, true); dir.setUint16(28, nameBytes.length, true); dir.setUint32(42, offset, true)
    local.push(new Uint8Array(head.buffer), nameBytes, data)
    central.push(new Uint8Array(dir.buffer), nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const size = central.reduce((n, b) => n + b.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, 3, true); end.setUint16(10, 3, true); end.setUint32(12, size, true); end.setUint32(16, offset, true)
  const all = [...local, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((n, b) => n + b.length, 0))
  let at = 0
  for (const b of all) { out.set(b, at); at += b.length }
  return out
}

// A deliberately plain external rendition. No source ZIP entries, properties,
// hidden text, internal comments, tracked deletions or attachments are copied.
// The caller must explicitly approve sharing the selected version's visible text.
const escapeXml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
const crc = (bytes: Uint8Array) => {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}
function zip(entries: Record<string, string>): Uint8Array {
  const local: Uint8Array[] = [], central: Uint8Array[] = []
  let offset = 0, centralSize = 0
  const encoder = new TextEncoder()
  for (const [path, text] of Object.entries(entries)) {
    const name = encoder.encode(path), data = encoder.encode(text), checksum = crc(data)
    const header = new Uint8Array(30 + name.length), h = new DataView(header.buffer)
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, checksum, true)
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); header.set(name, 30)
    const directory = new Uint8Array(46 + name.length), d = new DataView(directory.buffer)
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint32(16, checksum, true)
    d.setUint32(20, data.length, true); d.setUint32(24, data.length, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true); directory.set(name, 46)
    local.push(header, data); central.push(directory); offset += header.length + data.length; centralSize += directory.length
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, central.length, true); e.setUint16(10, central.length, true); e.setUint32(12, centralSize, true); e.setUint32(16, offset, true)
  const out = new Uint8Array(offset + centralSize + 22)
  let cursor = 0
  for (const part of [...local, ...central, end]) { out.set(part, cursor); cursor += part.length }
  return out
}
export interface ExternalComment { id: string; body: string; quote: string | null }
export function externalDocx(body: string, comments: ExternalComment[]): Uint8Array {
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const paragraphs = body.split('\n').map(line => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`).join('')
  const commentReferences = comments.map((_, i) => `<w:p><w:commentRangeStart w:id="${i}"/><w:r><w:t>External comment ${i + 1}</w:t></w:r><w:commentRangeEnd w:id="${i}"/><w:r><w:commentReference w:id="${i}"/></w:r></w:p>`).join('')
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="${w}"><w:body>${paragraphs}${commentReferences}<w:sectPr/></w:body></w:document>`,
    'word/_rels/document.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="comments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>',
    'word/comments.xml': `<?xml version="1.0"?><w:comments xmlns:w="${w}">${comments.map((c, i) => `<w:comment w:id="${i}" w:author="External"><w:p><w:r><w:t xml:space="preserve">${escapeXml(c.quote ? c.quote + '\n' + c.body : c.body)}</w:t></w:r></w:p></w:comment>`).join('')}</w:comments>`,
  })
}

import type { PdfRendition } from './pdf-renditions'
import type { PdfTextAnchor } from './pdf-text-geometry'
// Literal, case-insensitive matches keep offsets in the original immutable text.
export interface SearchPassage { versionId: string; version: number; start: number; end: number; quote: string; excerpt: string; renditionId?:string; artifactId?:string; sourceSha256?:string; versionDigest?:string; page?:number; position?:PdfTextAnchor }
export function searchPassages(versions: { id: string; number: number; text: string | null }[], query: string): SearchPassage[] {
  if (!query) return []
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const results: SearchPassage[] = []
  for (const version of versions) {
    if (!version.text) continue
    const expression = new RegExp(escaped, 'giu')
    // One link per matching paragraph, including older versions.
    let lastParagraph = -1
    for (const hit of version.text.matchAll(expression)) {
      const start = hit.index!, end = start + hit[0].length
      const paragraph = version.text.lastIndexOf('\n', start - 1) + 1
      if (paragraph === lastParagraph) continue
      lastParagraph = paragraph
      results.push({ versionId: version.id, version: version.number, start, end, quote: hit[0], excerpt: version.text.slice(Math.max(paragraph, start - 60), Math.min(version.text.indexOf('\n', end) < 0 ? version.text.length : version.text.indexOf('\n', end), end + 100)) })
    }
  }
  return results
}

/** A rendition has its own offsets; the version's approval-pinned text stays intact. */
export function pdfSearchPassages(renditions:PdfRendition[],versions:{id:string;number:number}[],query:string):SearchPassage[] {
 return renditions.filter(r=>['ready','partial'].includes(r.status)).flatMap(r=>{
  const version=versions.find(v=>v.id===r.version_id)
  if(!version)return []
  return searchPassages([{...version,text:r.text}],query).flatMap(hit=>{
   const page=r.pages.find(p=>p.status==='available'&&hit.start>=p.start&&hit.end<=p.end)
   const position=page?.anchors.find(a=>a.start<=hit.start&&a.end>=hit.end)
   return page&&position?[{...hit,renditionId:r.id,artifactId:r.artifact_id,sourceSha256:r.source_sha256,versionDigest:r.version_digest,page:page.page,position}]:[]
  })
 })
}

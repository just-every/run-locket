// Literal, case-insensitive matches keep offsets in the original immutable text.
export interface SearchPassage { versionId: string; version: number; start: number; end: number; quote: string; excerpt: string }
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

import type { PdfComparison } from '../locket/execution-comparison'

// Keep both readings visible, with the differing span marked in context.
function passage(own: string, other: string) {
  let start = 0, end = own.length, otherEnd = other.length
  while (start < end && start < otherEnd && own[start] === other[start]) start++
  while (end > start && otherEnd > start && own[end - 1] === other[otherEnd - 1]) { end--; otherEnd-- }
  return own ? <>{own.slice(0, start)}<mark>{own.slice(start, end)}</mark>{own.slice(end)}</> : 'No readable text on this page.'
}

export function ExecutionComparison({ comparison }: { comparison: PdfComparison }) {
  return <section className="lk-execution-comparison" aria-label="Signed document comparison">
    <h3>PDF text comparison</h3>
    <p className="lk-muted">Compared with the exact approved package. Whitespace is ignored; punctuation, case, numbers and page order are compared. Signatures, initials and visual changes need human review.</p>
    <p>Pages: approved {comparison.approvedPages ?? 'unreadable'} · returned {comparison.signedPages ?? 'unreadable'}</p>
    {comparison.differences.map(d => <details key={d.page} open>
      <summary>Page {d.page} differs</summary>
      <strong>Approved page {d.page}</strong><blockquote>{passage(d.approved, d.signed)}</blockquote>
      <strong>Returned page {d.page}</strong><blockquote>{passage(d.signed, d.approved)}</blockquote>
    </details>)}
  </section>
}

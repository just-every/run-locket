// AGENT-006: compare the actual packaged and returned PDF text, never a
// recorder's assertion. This is text evidence, not signature validation or OCR.
import { getDocumentProxy } from 'unpdf'

export interface PdfComparison {
  status: 'matched' | 'changed' | 'unreadable'
  approvedPages: number | null
  signedPages: number | null
  differences: { page: number; approved: string; signed: string }[]
  reason?: string
}

async function pages(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(bytes.slice(), {
    useWasm: false, useSystemFonts: false,
    disableFontFace: true, stopAtErrors: true, verbosity: 0,
  })
  try {
    const result: string[] = []
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent({ disableNormalization: true })
      result.push(content.items.flatMap(item => 'str' in item ? [item.str + (item.hasEOL ? '\n' : '')] : []).join(''))
    }
    return result
  } finally { await pdf.loadingTask.destroy() }
}

const normalized = (text: string) => text.replace(/\s+/gu, ' ').trim()

export async function compareExecutionPdf(approved: Uint8Array, signed: Uint8Array): Promise<PdfComparison> {
  const out: PdfComparison = { status: 'unreadable', approvedPages: null, signedPages: null, differences: [] }
  let before: string[], after: string[]
  try { before = await pages(approved); out.approvedPages = before.length }
  catch { return { ...out, reason: 'The approved PDF could not be read. Review the original files; no text match is claimed.' } }
  try { after = await pages(signed); out.signedPages = after.length }
  catch { return { ...out, reason: 'The returned PDF could not be read. Review the original files; no text match is claimed.' } }
  for (let index = 0; index < Math.max(before.length, after.length); index++) {
    if (normalized(before[index] ?? '') !== normalized(after[index] ?? '') || index >= before.length || index >= after.length)
      out.differences.push({ page: index + 1, approved: before[index] ?? '', signed: after[index] ?? '' })
  }
  if (before.some(page => !normalized(page)) || after.some(page => !normalized(page)))
    return { ...out, reason: 'At least one PDF page has no readable text. OCR and visual signature/initial checks are not available; review the files.' }
  return { ...out, status: out.differences.length ? 'changed' : 'matched' }
}

export function comparisonCheck(comparison: PdfComparison) {
  return {
    check: 'text', ok: comparison.status === 'matched', comparison,
    detail: comparison.status === 'matched'
      ? 'PDF text matches the approved package on every page (whitespace ignored). This does not verify signatures, initials or visual content.'
      : comparison.status === 'unreadable' ? comparison.reason!
        : `Returned PDF text or page count differs from the approved package on page${comparison.differences.length === 1 ? '' : 's'} ${comparison.differences.map(d => d.page).join(', ')}. Review the passages below.`,
  }
}

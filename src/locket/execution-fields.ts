// AGENT-006: structural presence evidence only. Never validates a signature,
// identifies its signer, renders a mark, or changes the uploaded PDF.
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFSignature, PDFString, PDFTextField } from 'pdf-lib'

export interface ExecutionField {
  name: string
  kind: 'signature' | 'initials'
  page: number | null
  state: 'present' | 'empty' | 'missing' | 'unreadable'
}
export interface ExecutionFields {
  status: 'present' | 'incomplete' | 'unavailable' | 'not_detected'
  fields: ExecutionField[]
}
type ReadField = ExecutionField & { required: boolean }

async function fields(bytes: Uint8Array): Promise<ReadField[]> {
  const pdf = await PDFDocument.load(bytes.slice(), { updateMetadata: false, throwOnInvalidObject: true })
  const acroForm = pdf.catalog.lookup(PDFName.of('AcroForm'))
  if (acroForm instanceof PDFDict && acroForm.has(PDFName.of('XFA'))) throw Error('Unsupported XFA form')
  const form = pdf.getForm()
  const pages = pdf.getPages(), names = new Set<string>(), result: ReadField[] = []
  for (const field of form.getFields()) {
    const name = field.getName()
    // Duplicate fully qualified names are ambiguous, including a different
    // field type that might otherwise conceal an expected field.
    if (names.has(name)) throw Error('Ambiguous field name')
    names.add(name)
    const tooltip = field.acroField.dict.lookup(PDFName.of('TU'))
    const label = name + ' ' + (tooltip instanceof PDFString || tooltip instanceof PDFHexString ? tooltip.decodeText() : '')
    const initials = field instanceof PDFTextField && /\binitials\b/i.test(label.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.-]/g, ' '))
    if (!(field instanceof PDFSignature) && !initials) continue
    const widget = field.acroField.getWidgets()[0]
    const pageIndex = pages.findIndex(p => p.ref === widget?.P())
    let state: ExecutionField['state'] = 'empty'
    if (field instanceof PDFTextField) state = field.getText()?.trim() ? 'present' : 'empty'
    else {
      const value = field.acroField.V()
      if (value !== undefined) {
        state = 'unreadable'
        if (value instanceof PDFDict) {
          const content = value.lookup(PDFName.of('Contents')), range = value.lookup(PDFName.of('ByteRange'))
          if (content instanceof PDFHexString || content instanceof PDFString) {
            if (!content.asBytes().some(b => b !== 0)) state = 'empty'
            else if (range instanceof PDFArray && range.size() === 4) {
              const numbers = range.asArray().map(v => pdf.context.lookup(v)).map(v => v instanceof PDFNumber ? v.asNumber() : NaN)
              const [start, first, second, last] = numbers
              if (numbers.every(n => Number.isSafeInteger(n) && n >= 0) && start === 0 && first > 0 && second > first && last > 0 && second + last <= bytes.length)
                state = 'present'
            }
          }
        }
      }
    }
    result.push({ name, kind: field instanceof PDFSignature ? 'signature' : 'initials', page: pageIndex < 0 ? null : pageIndex + 1, state, required: field.isRequired() })
  }
  return result
}

export async function inspectExecutionFields(approved: Uint8Array, returned: Uint8Array): Promise<ExecutionFields> {
  let before: ReadField[], after: ReadField[]
  try { before = await fields(approved); after = await fields(returned) }
  catch { return { status: 'unavailable', fields: [] } }
  // Keep requirements from the approved document even if the returned PDF
  // removes a field or clears its required flag. Also inspect new required fields.
  const expected = new Map<string, ReadField>()
  for (const field of [...before, ...after]) if (field.required && !expected.has(field.name)) expected.set(field.name, field)
  const checked = [...expected.values()].map(field => {
    const actual = after.find(f => f.name === field.name && f.kind === field.kind)
    return { name: field.name, kind: field.kind, page: field.page, state: actual?.state ?? 'missing' } satisfies ExecutionField
  })
  return { status: !checked.length ? 'not_detected' : checked.every(f => f.state === 'present') ? 'present' : 'incomplete', fields: checked }
}

export function executionFieldsCheck(inspection: ExecutionFields) {
  return {
    check: 'signature_fields', ok: ['present', 'not_detected'].includes(inspection.status), inspection,
    detail: inspection.status === 'unavailable'
      ? 'PDF signature/initial form fields could not be read. Review the files; no field-presence check is claimed.'
      : inspection.status === 'not_detected'
        ? 'No required signature or initials form fields detected. Flattened and visual marks are not checked.'
        : inspection.status === 'present'
          ? 'Required signature/initial form fields contain values. Signature validity, signer identity and visual marks are not verified.'
          : 'Required signature/initial form fields are empty, missing or unreadable. Review the field evidence before accepting execution.',
  }
}

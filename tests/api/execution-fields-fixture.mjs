// Invented structured PDF fields. Nonzero signature bytes are deliberately
// synthetic: they prove presence inspection only, never signing or trust.
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib'
import { pdf } from './files.mjs'

export async function executionFieldsPdf(text, { signature = 'empty', initials = '', required = true, xfa = false, duplicate = false, objectStreams = true } = {}) {
  const document = await PDFDocument.load(pdf(text), { updateMetadata: false })
  const form = document.getForm(), context = document.context, page = document.getPages()[0]
  if (signature !== null) {
    const field = context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('Customer.signature'), Ff: required ? 2 : 0, Rect: [40, 40, 180, 60], P: page.ref })
    if (signature === 'present' || signature === 'malformed' || signature === 'zero') {
      field.set(PDFName.of('V'), context.register(context.obj({ Type: 'Sig', Contents: PDFHexString.of(signature === 'zero' ? '00000000' : '01020300'), ByteRange: signature === 'malformed' ? [0, 10, 5, 10] : [0, 10, 20, 10] })))
    }
    const ref = context.register(field)
    form.acroForm.addField(ref)
    page.node.addAnnot(ref)
  }
  if (initials !== null) {
    const field = form.createTextField('Customer.initials')
    if (required) field.enableRequired()
    field.addToPage(page, { x: 40, y: 80, width: 100, height: 20 })
    if (initials) field.setText(initials)
    if (duplicate) {
      const copy = context.register(context.obj({ FT: 'Tx', T: PDFString.of('initials'), Parent: field.acroField.getParent().ref, Ff: 2 }))
      // A second field with the exact same fully qualified name is ambiguous.
      const parent = field.acroField.getParent()
      parent.setKids([...parent.Kids().asArray(), copy])
    }
  }
  if (xfa) form.acroForm.dict.set(PDFName.of('XFA'), context.obj([PDFString.of('template'), context.register(context.flateStream('<template/>'))]))
  return Buffer.from(await document.save({ useObjectStreams: objectStreams, updateFieldAppearances: false }))
}

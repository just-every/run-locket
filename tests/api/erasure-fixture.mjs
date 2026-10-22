import { file, pdf } from './files.mjs'

export const erasureSubject = { name: 'Ann', email: 'morgan@example.test' }
export const erasureRequest = (email = erasureSubject.email) => ({ email, verified: true, method: 'established_channel', receivedOn: '2026-10-20', reason: 'privacy_request' })
export const erasureConfirmation = (preview, email, draftDispositions) => ({ previewId: preview.id, fingerprint: preview.fingerprint, email, draftDispositions })

// Real public commands build the same contact, held comment and named-file
// discovery case for the API and both browser widths.
export async function erasureFixture(h) {
  const party = await h.owner.command('party.save', { name: 'Cardinal Systems', kind: 'supplier', email: erasureSubject.email, contacts: [erasureSubject] })
  const heldParty = await h.owner.command('party.save', { name: 'Cardinal Litigation', kind: 'supplier', contacts: [erasureSubject] })
  const create = (title, partyId, contents) => h.owner.command('request.create', { title, type: 'nda', ...(partyId ? { partyId } : { party: { name: 'Independent supplier', kind: 'supplier' } }), file: file(title + '.pdf', pdf(contents)), text: 'Confidentiality terms' })
  const keep = await create('Cardinal confidentiality draft', party.id, 'Ann reviews the Annual confidentiality terms')
  const held = await create('Litigation confidentiality draft', heldParty.id, 'Ann litigation confidentiality terms')
  // Only the PDF bytes name Ann: its party, title, filename and extracted text do not.
  const remove = await create('Unexecuted supplier draft', null, 'Ann reviews this separate draft')
  const state = await h.owner.state()
  const comment = await h.owner.command('comment.add', { agreementId: keep.id, versionId: keep.versionId, body: 'Ann reviews the Annual terms; morgan@example.test confirms.' })
  const heldComment = await h.owner.command('comment.add', { agreementId: held.id, versionId: held.versionId, body: 'Ann · morgan@example.test · preserve this comment exactly.' })
  return {
    party, heldParty, keep, held, remove, comment, heldComment,
    rows: Object.fromEntries([keep, held, remove].map(a => [a.id, state.agreements.find(r => r.id === a.id)])),
    files: Object.fromEntries([keep, held, remove].map(a => [a.id, state.artifacts.filter(f => f.agreement_id === a.id)])),
    dispositions: [
      { agreementId: keep.id, action: 'retain', reason: 'business_retention' },
      { agreementId: held.id, action: 'retain', reason: 'legal_hold' },
      { agreementId: remove.id, action: 'delete', reason: 'request_scope' },
    ],
  }
}

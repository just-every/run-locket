// The demo's used workspace, driven through Locket's own commands: one approved
// agreement goes out for signature, one is executed with its terms, renewal and
// an obligation, and a small DocuSign archive is moved in. Each step checks the
// record first, so a resumed seed continues where it stopped.
import type { Bindings } from '../auth.server'
import { handlers } from '../locket/api'
import { runCommand } from '../locket/commands'
import { day, writtenDay } from '../locket/display'
import type { Actor, Role } from '../locket/model'
import { textPdf } from '../locket/pdf'
import { team } from './examples'

const base64 = (bytes: Uint8Array) => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''))
const sample = (filename: string, title: string, body: string, footer: string) => ({ filename, base64: base64(textPdf(title, body, footer)) })

export async function seedJourneys(env: Bindings, ownerId: string, now: Date) {
  const at = now.getTime(), dayMs = 86_400_000
  const date = (offset: number) => new Date(at + offset * dayMs).toISOString().slice(0, 10)
  const sessions: string[] = []
  // Short-lived sessions whose tokens are never issued: commands re-check them in SQL.
  async function actor(id: string, role: Role): Promise<Actor> {
    const o = await env.DB.prepare('SELECT display_name, email, version FROM oa_operators WHERE id=?').bind(id).first<{ display_name: string; email: string; version: number }>()
    if (!o) throw new Error(`Demo operator ${id} is not ready`)
    const sessionId = crypto.randomUUID()
    await env.DB.prepare("INSERT INTO oa_sessions(id, token_hash, operator_id, operator_version, kind, created_at, expires_at) VALUES (?,?,?,?, 'native', ?, ?)")
      .bind(sessionId, `demo-seed-${crypto.randomUUID()}`, id, o.version, at, at + 600_000).run()
    sessions.push(sessionId)
    return { id, name: o.display_name, email: o.email, role, sessionId, operatorVersion: o.version }
  }
  const run = (as: Actor, type: string, payload: Record<string, unknown>) => runCommand(env, as, { commandId: crypto.randomUUID(), type, payload }, handlers) as Promise<any>
  const agreement = (id: string) => env.DB.prepare('SELECT status, version FROM lk_agreements WHERE id=?').bind(id).first<{ status: string; version: number }>()
  const member = (key: string) => team.find(([id]) => id === key)!
  try {
    const owner = await actor(ownerId, 'owner')
    const jenna = await actor('demo-operations', 'requester'), marcus = await actor('demo-commercial', 'approver')
    const signers = (name: string, email: string) => [{ name, email, action: 'sign' }, { name: member('demo-commercial')[1], email: member('demo-commercial')[2], action: 'sign' }]

    // Pinecrest: prepared and handed to DocuSign, waiting on the client's signature.
    let a = await agreement('demo-pinecrest')
    if (a?.status === 'approved') {
      const pkg = await run(jenna, 'package.prepare', { agreementId: 'demo-pinecrest', version: a.version, provider: 'docusign', recipients: signers('Maya Collins', 'maya.collins@pinecrest.example') })
      a = await agreement('demo-pinecrest')
      await run(jenna, 'package.sent', { agreementId: 'demo-pinecrest', version: a!.version, packageId: pkg.packageId, envelopeId: '4E8B2C61-7A3D-4F90-B1E2-5C6D7E8F9A01' })
    }

    // Summit Ridge: signed and returned, reconciled, with confirmed terms feeding a renewal.
    const envelope = '9B3F1D24-6C5E-4A87-8D90-1E2F3A4B5C62', end = date(48)
    const people = signers('Noah Brennan', 'noah.brennan@summitridge.example')
    a = await agreement('demo-summit')
    if (a?.status === 'approved') {
      const pkg = await run(jenna, 'package.prepare', { agreementId: 'demo-summit', version: a.version, provider: 'docusign', recipients: people })
      a = await agreement('demo-summit')
      await run(jenna, 'package.sent', { agreementId: 'demo-summit', version: a!.version, packageId: pkg.packageId, envelopeId: envelope })
      a = await agreement('demo-summit')
    }
    if (a?.status === 'out_for_signature') {
      const note = 'Fictional demo sample - not a real signature or certificate'
      await run(jenna, 'execution.record', {
        agreementId: 'demo-summit', version: a.version, envelopeId: envelope, executedOn: date(0), documentConfirmed: true,
        signers: people.map(({ name, email }) => ({ name, email })),
        signed: sample('Platform subscription MSA - signed.pdf', 'Platform subscription MSA', `SAMPLE ONLY - fictional executed copy\nBetween Fieldstone Software, Inc. and Summit Ridge Health.\nTerm ends on ${writtenDay(end)}. Give 30 days notice before the end date.\nSigned for both parties through the demo's fictional envelope ${envelope}.`, note),
        certificate: sample('Summary.pdf', 'Certificate of Completion (fictional)', `SAMPLE ONLY - fictional completion summary for envelope ${envelope}.\nSigners: ${people.map(p => p.name).join(', ')}.`, note),
      })
      for (const [key, value, quote] of [['end_date', end, `Term ends on ${writtenDay(end)}.`], ['notice_days', '30', 'Give 30 days notice before the end date.']]) {
        const term = await run(owner, 'term.propose', { agreementId: 'demo-summit', key, value, citation: { quote } })
        await run(marcus, 'term.decide', { agreementId: 'demo-summit', termId: term.id, decision: 'confirm' })
      }
      await run(owner, 'obligation.add', { agreementId: 'demo-summit', description: 'Send the quarterly service review', ownerId: 'demo-onboarding', dueDate: date(24), recurrence: 'quarterly', citation: { quote: 'Scope: Platform subscription MSA.' } })
    }

    // A small DocuSign archive moved in by the owner: dry run, then apply exactly that.
    if (!(await env.DB.prepare('SELECT 1 AS ok FROM lk_import_batches LIMIT 1').first())) {
      const rows = [
        ['2C7E9A41-3B5D-4F6A-8C1E-0D2F4A6B8C93', 'Kestrel Print Co', 'Print production agreement', 'Supplier', date(-210), date(155), '60', 'Ryan Doyle', 'ryan@kestrel.example'],
        ['6A1F3C85-9D2B-4E7C-A0F4-3B5D7E9F1A24', 'Orchard Lane Studios', 'Mutual confidentiality agreement', 'NDA', date(-150), '', '', 'Elena Ruiz', 'elena@orchardlane.example'],
      ]
      const header = 'Envelope ID,Subject,Status,Recipient Name,Recipient Email,Completed On,Counterparty,Agreement Type,End Date,Notice Days'
      const csv = [header, ...rows.map(([id, party, title, type, done, endDate, notice, name, email]) => [id, `Please DocuSign: ${title}`, 'Completed', `${name}; Jenna Hart`, `${email}; jenna@fieldstone.example`, `${done} 10:00:00`, party, type, endDate, notice].join(','))].join('\n') + '\n'
      const files = rows.flatMap(([id, party, title, , done]) => [
        { path: `${id}/${title}.pdf`, base64: base64(textPdf(title, `SAMPLE ONLY - fictional signed copy\nBetween Fieldstone Software, Inc. and ${party}.\nCompleted ${done}.`, 'Fictional demo sample - not a real signature')) },
        { path: `${id}/Summary.pdf`, base64: base64(textPdf('Certificate of Completion (fictional)', `SAMPLE ONLY - fictional summary for envelope ${id}.`, 'Fictional demo sample - not a real certificate')) },
      ])
      const dry = await run(owner, 'import.preview', { kit: 'docusign-archive', label: `DocuSign archive to ${day(date(-30))}`, dateFormat: 'iso', manifest: { filename: 'envelopes.csv', base64: base64(new TextEncoder().encode(csv)) }, files })
      const batch = await env.DB.prepare('SELECT version, fingerprint FROM lk_import_batches WHERE id=?').bind(dry.batchId).first<{ version: number; fingerprint: string }>()
      await run(owner, 'import.apply', { batchId: dry.batchId, version: batch!.version, fingerprint: batch!.fingerprint })
    }
  } finally {
    for (const id of sessions) await env.DB.prepare('UPDATE oa_sessions SET revoked_at=? WHERE id=?').bind(Date.now(), id).run()
  }
}

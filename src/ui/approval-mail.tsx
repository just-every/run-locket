import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Empty, Field, Form, value } from './controls'
import { can, currentVersion } from './format'
import { liveApprovals } from './summary'

export function ApprovalMail({ state, a, locket }: { state: LocketState; a: Row; locket: Locket }) {
  const v = currentVersion(state, a)
  if (!v || a.status !== 'in_review' || !can(state, 'owner', 'counsel', 'approver', 'requester') || liveApprovals(state, a).some(d => d.kind === 'commercial')) return null
  const recipients = state.operators.filter(p => p.status === 'active' && ['owner', 'approver'].includes(p.role) && (p.role === 'owner' || p.id !== a.requester_id) && (!a.restricted || p.role === 'owner' || p.id === a.owner_id || state.access.some(g => g.agreement_id === a.id && g.operator_id === p.id)))
  return <section className="lk-panel" aria-label="Email approval link">
    <div className="lk-panel-head"><h2>Email approval link</h2></div>
    <p className="lk-muted">Send a sign-in link to a commercial approver. They review the current version in Locket before deciding.</p>
    {recipients.length === 0 ? <Empty>No active commercial approver has access to this agreement.</Empty> : <Form busy={locket.busy} submit="Email approval link" onSubmit={async data => {
      const sent = await locket.run('approval.email', { agreementId: a.id, version: a.version, versionId: v.id, recipientId: value(data, 'recipientId') })
      if (!sent) return
      const message: Record<string, string> = {
        accepted: 'The mail provider accepted the approval email. Mailbox delivery is unconfirmed.',
        suppressed: 'Email suppressed in local development or demo. No email was sent.',
        queued: 'The approval email is queued. Sending has not been confirmed.',
        sending: 'The approval email is in progress or its outcome is unknown. This request will not be sent again automatically.',
        uncertain: 'The mail provider outcome is unknown. This request will not be sent again automatically.',
        rejected: 'The mail provider did not accept the approval email.',
        rate_limited: 'The mail provider rate limited the approval email. No acceptance is confirmed.',
        cancelled: 'The approval email was cancelled because access or the agreement changed. Reload before trying again.',
      }
      locket.setNotice(message[sent.mailReceipt?.status] ?? 'Approval email acceptance has not been confirmed.')
    }}>
      <Field label="Approval email recipient"><select name="recipientId" required>{recipients.map(p => <option key={p.id} value={p.id}>{p.name}{p.email ? ` (${p.email})` : ''}</option>)}</select></Field>
    </Form>}
  </section>
}

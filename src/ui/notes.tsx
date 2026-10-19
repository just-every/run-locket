// The workspace's margin notes: a playbook finding (by Locket's agent or a
// person) with its rule, the suggested wording and, while its exception is
// open, the decision; and an internal comment on the passage it quotes. A
// settled finding (met, accepted or rejected) folds to its head and outcome.
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Avatar, Icon } from './controls'
import { can, currentVersion, isAgent, personName, roleLabel, stamp } from './format'
import { liveApprovals } from './summary'

export type Tone = 'met' | 'accepted' | 'breach' | 'open' | 'internal' | 'unsure'
export interface Note { id: string; kind: 'finding' | 'comment'; tone: Tone; start: number; end: number; row: Row }

/** A finding's state: met, its breach accepted (exception approved) or rejected, or still open. An accepted breach
 * is still a breach, never "met". */
export function findingTone(state: LocketState, a: Row, d: Row): Tone {
  if (d.result === 'met') return 'met'
  const decided = liveApprovals(state, a).find(x => x.kind === 'exception' && x.deviation_id === d.id)
  if (decided?.decision === 'approved') return 'accepted'
  if (d.result === 'undetermined' && !decided) return 'unsure'
  return decided ? 'breach' : 'open'
}

const pill: Record<Tone, string> = { met: 'Rule met', accepted: 'Accepted', breach: 'Rejected', open: 'Needs decision', internal: 'Internal', unsure: 'Cannot determine' }
const settled = (tone: Tone) => tone === 'met' || tone === 'accepted' || tone === 'breach'

/** How an exception decision reads wherever it is shown: "Exception approved by …" or "Rejected by …". */
export const decisionLine = (state: LocketState, a: Row, decided: Row) => `${decided.decision === 'approved' ? 'Exception approved' : 'Rejected'} by ${personName(state, decided.actor_id)} · ${stamp(decided.at, { zone: a.timezone })}`

export function NoteCard({ note, clause, state, a, locket }: { note: Note; clause: string; state: LocketState; a: Row; locket: Locket }) {
  return note.kind === 'finding' ? <FindingCard note={note} clause={clause} state={state} a={a} locket={locket} /> : <CommentCard note={note} state={state} zone={a.timezone} />
}

function FindingCard({ note, clause, state, a, locket }: { note: Note; clause: string; state: LocketState; a: Row; locket: Locket }) {
  const d = note.row
  const playbook = state.playbooks.find(p => p.id === d.playbook_version_id)
  const rule = (playbook ? JSON.parse(playbook.rules) : []).find((r: any) => r.key === d.clause_key)
  const decided = liveApprovals(state, a).find(x => x.kind === 'exception' && x.deviation_id === d.id)
  const proposal = d.proposal_id ? state.proposals.find(p => p.id === d.proposal_id) : null
  const author = proposal?.prepared_by ?? d.created_by
  const step = (state.routes[a.id] ?? []).find(s => s.kind === 'exception' && s.deviationId === d.id)
  const mayDecide = !!step && !decided && a.status === 'in_review' && d.version_id === currentVersion(state, a)?.id && step.roles.includes(state.actor.role) && (state.actor.role === 'owner' || a.requester_id !== state.actor.id)
  const decide = (decision: 'approved' | 'rejected') => void locket.run('approval.decide', { agreementId: a.id, version: a.version, versionId: d.version_id, kind: 'exception', deviationId: d.id, decision })
  const tone = note.tone
  const label = `${clause ? `§${clause} ` : ''}${rule?.title ?? d.clause_key}: ${pill[tone]}`
  const head = (
    <div className="lk-note-head">
      <span className="lk-dot" aria-hidden="true" />
      <h3>{clause && <span>§{clause} </span>}{rule?.title ?? d.clause_key}</h3>
      <span className="lk-note-pill">{pill[tone]}{tone === 'met' || tone === 'accepted' ? ' ✓' : ''}</span>
    </div>
  )
  const ruleLine = <strong>{d.result === 'met' ? 'Playbook' : 'Breaches'} {d.clause_key}</strong>
  const by = (
    <div className="lk-note-by">
      <Avatar name={personName(state, author)} agent={isAgent(state, author)} />
      <span><strong>{personName(state, author)}</strong> <span className="lk-muted">{isAgent(state, author) ? `Agent · playbook v${playbook?.number ?? '–'}` : roleLabel[state.operators.find(o => o.id === author)?.role ?? ''] ?? ''}</span></span>
      <time>{stamp(proposal?.prepared_at ?? d.created_at, { zone: a.timezone })}</time>
    </div>
  )
  // Settled: the head and its outcome in one line; the rule, the reasoning and the author open on demand.
  if (settled(tone)) return (
    <article className={`lk-note-card lk-note-settled lk-tone-${tone}`} aria-label={label}>
      <details>
        <summary>
          {head}
          <p className="lk-note-rule">{ruleLine} · {decided ? decisionLine(state, a, decided) : d.explanation}</p>
        </summary>
        <div className="lk-note-context"><Icon name="book" /><div>
          {rule?.preferred && <p className="lk-note-rule">{rule.preferred}</p>}
          {decided && <p className="lk-note-why">{d.explanation}</p>}
        </div></div>
        {by}
      </details>
    </article>
  )
  return (
    <article className={`lk-note-card lk-tone-${tone}`} aria-label={label}>
      {head}
      <div className="lk-note-context"><Icon name="book" /><div>
      <p className="lk-note-rule">{ruleLine}{rule?.preferred ? ` · ${rule.preferred}` : ''}</p>
      <p className="lk-note-why">{d.explanation}</p>
      </div></div>
      {d.proposed_wording && d.result !== 'met' && (
        <div className="lk-note-edit"><span>Suggested edit</span><mark>{d.proposed_wording}</mark></div>
      )}
      {mayDecide && (
        <div className="lk-note-actions">
          <button type="button" className="lk-primary" disabled={locket.busy} onClick={() => decide('rejected')}>Reject change</button>
          <button type="button" disabled={locket.busy} onClick={() => decide('approved')}>Approve exception</button>
        </div>
      )}
      {!mayDecide && step && !decided && <p className="lk-note-why">Decided by {step.roles.map(r => roleLabel[r]).join(' or ')}.</p>}
      {by}
    </article>
  )
}

function CommentCard({ note, state, zone }: { note: Note; state: LocketState; zone: string }) {
  const c = note.row
  const role = state.operators.find(o => o.id === c.author_id)?.role
  return (
    <article className="lk-note-card lk-tone-internal" aria-label={`Internal comment by ${personName(state, c.author_id)}`}>
      <div className="lk-note-head">
        <span className="lk-dot" aria-hidden="true" />
        <h3>Internal</h3>
        <time>{stamp(c.at, { zone })}</time>
      </div>
      <div className="lk-note-by lk-note-by-top">
        <Avatar name={personName(state, c.author_id)} />
        <span><strong>{personName(state, c.author_id)}</strong> <span className="lk-muted">{role ? roleLabel[role] : ''}</span></span>
      </div>
      <p className="lk-note-quote">{c.body}</p>
    </article>
  )
}

import type { Locket } from './app'
import type { LocketState, Row } from './api'
import { Field, Form, value } from './controls'
import { can, personName, stamp } from './format'

export function CommentThread({ root, state, a, locket }: { root: Row; state: LocketState; a: Row; locket: Locket }) {
  const replies = state.comments.filter(c => c.parent_id === root.id)
  const editable = can(state, 'owner', 'counsel', 'approver', 'requester')
  return <li data-thread={root.id}>
    <strong>{root.external_author_name??personName(state, root.author_id)}</strong><small>{state.commentAudiences.some(side=>side.id===root.id&&side.audience==='external')?'External':'Internal'} · {stamp(root.at, { zone: a.timezone })}</small>
    {root.quote && <q>{root.quote}</q>}<p>{root.body}</p>
    {replies.length > 0 && <ol className="lk-comments" aria-label="Thread replies">{replies.map(reply => <li key={reply.id} style={{overflowWrap:'anywhere',minWidth:0}}><strong>{reply.external_author_name??personName(state, reply.author_id)}</strong><small>{state.commentAudiences.some(side=>side.id===reply.id&&side.audience==='external')?'External':'Internal'} · {stamp(reply.at, { zone: a.timezone })}</small><p>{reply.body}</p></li>)}</ol>}
    {root.resolved_at ? <p className="lk-muted">Resolved by {personName(state, root.resolved_by)} · {stamp(root.resolved_at, { zone: a.timezone })}</p> : editable && <>
      <Form busy={locket.busy} submit="Reply" onSubmit={async (data, form) => { if (await locket.run('comment.add', { agreementId: a.id, versionId: root.version_id, parentId: root.id, body: value(data, 'reply') })) form.reset() }}>
        <Field label="Reply to thread"><textarea name="reply" rows={2} required /></Field>
      </Form>
      <button type="button" disabled={locket.busy} onClick={() => void locket.run('comment.resolve', { agreementId: a.id, commentId: root.id, revision: root.revision })}>Resolve thread</button>
    </>}
  </li>
}

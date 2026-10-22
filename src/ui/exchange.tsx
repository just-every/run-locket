import { useEffect, useRef, useState } from 'react'
import type { LocketState, Row } from './api'
import { fetchJson } from './api'
import type { Locket } from './app'
import { Badge, Field, Form, When, value } from './controls'

interface ExchangeView {rows:Row[];versions:{id:string;audience:string}[];comments:{id:string;audience:string}[]}
function newToken(){return [...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('')}
/** Deliberate disclosure controls are available only to owner/counsel. */
export function ExchangePanel({state,a,locket}:{state:LocketState;a:Row;locket:Locket}){
  const [view,setView]=useState<ExchangeView|null>(null),[error,setError]=useState(''),[link,setLink]=useState('')
  const pending=useRef<{signature:string;token:string;payload:Record<string,unknown>}|null>(null)
  const allowed=['owner','counsel'].includes(state.actor.role)&&!state.fieldAccess?.documentsWithheld
  const refresh=()=>fetchJson<ExchangeView>('/api/locket/exchanges?agreementId='+encodeURIComponent(a.id)).then(setView).catch(cause=>setError(cause.message))
  useEffect(()=>{if(allowed)void refresh()},[a.id,a.version,allowed])
  if(!allowed)return null
  const version=state.versions.find(v=>v.id===a.current_version_id),party=state.parties.find(p=>p.id===a.party_id)
  const contacts:{name:string;email:string}[]=typeof party?.contacts==='string'?JSON.parse(party.contacts):party?.contacts??[]
  const external=view?.versions.find(v=>v.id===version?.id)?.audience==='external'
  const comments=state.comments.filter(c=>c.version_id===version?.id)
  return <section className="lk-panel" aria-label="Counterparty exchange">
    <div className="lk-panel-head"><h2>Counterparty exchange</h2></div>
    {error&&<p role="alert">{error}</p>}
    <p className="lk-muted">Share a plain Word rendition with a recorded counterparty contact. Anyone holding the expiring link or the reply address can view, download, comment and return a markup without signing in. The reply address carries the same capability as the link; forwarding or copying it exposes that access. Possession and the sender address do not verify identity. Access ends when your sending session expires or you sign out, or when your role or agreement access ends.</p>
    {version&&['draft','in_review','approved','imported'].includes(a.status)&&<>
      <p>Version {version.number}: <strong>{external?'External':'Internal'}</strong></p>
      <details className="lk-disclosure"><summary>Review sharing permissions</summary>
        <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{version.text??'No readable text is available.'}</p>
        <Form busy={locket.busy} submit={external?'Make version internal':'Mark version external'} onSubmit={async data=>{
          const saved=await locket.run('version.audience',{agreementId:a.id,version:a.version,versionId:version.id,audience:external?'internal':'external',confirmExternal:data.get('consent')==='on'})
          if(saved){setLink('');await refresh()}
        }}>{!external&&<Field label="I reviewed this version’s text and permit disclosure to the counterparty"><input type="checkbox" name="consent" required /></Field>}</Form>
        {comments.map(comment=>{
          const shared=view?.comments.find(c=>c.id===comment.id)?.audience==='external'
          return <div className="lk-card" key={comment.id}><p>{comment.body}</p><p>{shared?'External comment':'Internal comment'}</p>
            <Form busy={locket.busy} submit={shared?'Make comment internal':'Share comment externally'} onSubmit={async data=>{
              const saved=await locket.run('comment.audience',{agreementId:a.id,version:a.version,commentId:comment.id,audience:shared?'internal':'external',confirmExternal:data.get('consent')==='on'})
              if(saved){setLink('');await refresh()}
            }}>{!shared&&<Field label="I permit this comment and its quotation to be shared externally"><input type="checkbox" name="consent" required /></Field>}</Form>
          </div>
        })}
      </details>
      {external&&contacts.length>0&&<Form busy={locket.busy} submit="Share external version" onSubmit={async data=>{
        const channel=value(data,'channel'),chosen={agreementId:a.id,version:a.version,versionId:version.id,recipientEmail:value(data,'recipientEmail'),channel,contactConsent:value(data,'contactConsent'),confirmCleanRendition:data.get('clean')==='on'},signature=JSON.stringify({...chosen,hours:value(data,'hours')})
        if(pending.current?.signature!==signature){const token=newToken();pending.current={signature,token,payload:{...chosen,token,expiresAt:Date.now()+Number(value(data,'hours'))*3600_000}}}
        const staged=pending.current,result=await locket.run('exchange.send',staged.payload)
        if(result){pending.current=null;setLink(`${window.location.origin}/exchange#${staged.token}`);await refresh();locket.setNotice(channel==='link'?'Secure link ready. Share it only with the selected contact.':result.mailReceipt?.status==='accepted'?'Postmark accepted the email. Mailbox delivery is unconfirmed.':`Email status: ${result.mailReceipt?.status??'queued'}.`)}
      }}>
        <Field label="Counterparty contact"><select required name="recipientEmail">{contacts.map(c=><option key={c.email} value={c.email}>{c.name} ({c.email})</option>)}</select></Field>
        <Field label="Share by"><select name="channel"><option value="link">Secure link</option><option value="email">Postmark email</option></select></Field>
        <Field label="Link expires after"><select name="hours" defaultValue="24"><option value="1">1 hour</option><option value="24">24 hours</option><option value="168">7 days</option></select></Field>
        <Field label="Why this contact is authorized to receive this version"><textarea name="contactConsent" required maxLength={1000} /></Field>
        <p role="note">The outgoing DOCX is rebuilt from the text shown above. Source formatting, embedded comments, tracked edits and document metadata are removed. Only comments explicitly marked external in Locket are included. Review the rendition before sharing.</p>
        <Field label="I approve this clean plain rendition and explicit disclosure to the selected contact"><input type="checkbox" name="clean" required /></Field>
      </Form>}
      {!contacts.length&&<p>Add a counterparty contact before sharing.</p>}
    </>}
    {link&&<p style={{overflowWrap:'anywhere'}}><a href={link} target="_blank" rel="noreferrer">Open secure counterparty link</a><br/><span>{link}</span></p>}
    <ul className="lk-clean-list">{view?.rows.map(row=><li key={row.id} style={{overflowWrap:'anywhere'}}><p>{row.recipient_name} · {row.recipient_email} · <Badge value={row.revoked_at?'revoked':row.status}/></p><p>Access depends on the sender’s active session, role and agreement access. The link and reply address grant the same access; sender identity is not verified.</p><p>Expires <When at={row.expires_at}/>{row.opened_at&&<> · Opened <When at={row.opened_at}/></>}</p>
      {!row.revoked_at&&<Form busy={locket.busy} submit="Revoke exchange" onSubmit={async data=>{if(await locket.run('exchange.revoke',{agreementId:a.id,version:a.version,exchangeId:row.id,reason:value(data,'reason')})){setLink('');await refresh()}}}><Field label="Reason to revoke"><input name="reason" required maxLength={1000}/></Field></Form>}
    </li>)}</ul>
  </section>
}

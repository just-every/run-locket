import { useEffect, useState } from 'react'
import type { LocketState } from './api'
import type { Locket } from './app'
import { Field } from './controls'
import { personName, stamp } from './format'

type Answer = Awaited<ReturnType<typeof import('../locket/repository-questions').readRepositoryQuestion>>
const examples = ["Which supplier agreements auto-renew next quarter with more than 60 days' notice?", 'What is our liability cap with Acme?']
export function RepositoryQuestions({state,locket,id}:{state:LocketState;locket:Locket;id:string}) {
 const workspace=state.questions
 const [question,setQuestion]=useState(''),[consent,setConsent]=useState(false),[answer,setAnswer]=useState<Answer|null>(null),[error,setError]=useState('')
 useEffect(()=>{
  let active=true
  setAnswer(null);setError('')
  if(id)void fetch('/api/locket/questions/'+encodeURIComponent(id),{credentials:'same-origin',cache:'no-store'}).then(async response=>{
   if(!response.ok)throw Error('This answer is unavailable under your current access. Ask a new question.')
   return response.json() as Promise<Answer>
  }).then(record=>{if(active)setAnswer(record)}).catch(e=>{if(active)setError(e.message)})
  return()=>{active=false}
 },[id,state])
 const ask=async(simulated=false)=>{
  const result=await locket.run('question.ask',{question,consent,simulated})
  if(result){setConsent(false);window.location.hash='questions/'+result.id}
 }
 return <div className="lk-tab-page lk-questions" style={{overflowWrap:'anywhere'}}>
  <div className="lk-titlebar"><h1>Ask the repository</h1></div>
  <section className="lk-panel" aria-label="Repository question">
   <h2>Find an answer in your agreements</h2>
   <p>Ask in plain English. Answers cite the exact document version and distinguish confirmed terms from proposed values. Only readable agreements you can access with AI enabled are sent.</p>
   <Field label="Your question"><textarea value={question} maxLength={2000} rows={3} onChange={e=>{setQuestion(e.target.value);setConsent(false)}} placeholder={examples[0]}/></Field>
   <div className="lk-form-actions" style={{flexWrap:'wrap'}}>{examples.map(example=><button type="button" key={example} onClick={()=>{setQuestion(example);setConsent(false)}}>{example}</button>)}</div>
   <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I approve sending this question and my accessible, AI-enabled documents for this request</label>
   {workspace.reason&&<p role="status">{workspace.reason}</p>}
   {state.fieldAccess.documentsWithheld&&<p>Documents are withheld under your field permissions, so repository questions are unavailable.</p>}
   <div className="lk-form-actions" style={{flexWrap:'wrap'}}>
    <button type="button" className="lk-primary" disabled={locket.busy||!question.trim()||!consent||!workspace.available} onClick={()=>void ask()}>Ask question</button>
    {workspace.simulationAvailable&&<button type="button" disabled={locket.busy||!question.trim()||!consent} onClick={()=>void ask(true)}>Simulate question</button>}
    {state.actor.role==='owner'&&<a href="#settings">Model settings</a>}
   </div>
   {workspace.simulationAvailable&&<p>Provider simulation is for this test installation. It supplies no live accuracy evidence.</p>}
   {locket.busy&&<p role="status">Preparing your cited answer…</p>}
  </section>
  {error&&<p role="alert">{error}</p>}
  {answer&&<section className="lk-panel" aria-label="Repository answer">
   <h2>{answer.question}</h2>
   <p>{answer.simulated?'Provider simulation':'Live provider'} · {answer.status} · {answer.stale?'Stale sources — ask again for current terms':'Pinned source versions'}</p>
   {answer.status==='uncertain'&&<p>The provider outcome is unknown or its reply could not be supported by the sources. No answer was retained. This request will not be sent again automatically.</p>}
   {answer.status==='queued'&&<p>This request has not completed. Repeating its command cannot send the provider request twice.</p>}
   {answer.content&&<>
    <p>{answer.content.matches.length} matching agreement{answer.content.matches.length===1?'':'s'}. This answer is a proposed interpretation; accepting its record never confirms terms or changes deadlines.</p>
    {!answer.content.matches.length&&<p>No supported matches were returned from the accessible, AI-enabled sources. This does not establish that a term or agreement is absent.</p>}
    {answer.content.matches.map(match=><article key={match.agreementId} aria-label={match.title}>
     <h3><a href={`#agreement/${match.agreementId}/review`}>{match.reference} · {match.title}</a></h3>
     <p>{match.value}</p>
     {match.reliesOnProposed&&<p><strong>Relies on proposed, unconfirmed values.</strong></p>}
     {match.citations.map((citation,i)=><div key={i}>
      <p>{citation.key?`${citation.key.replaceAll('_',' ')}: ${citation.value} · ${citation.status}`:'Proposed interpretation of the cited clause'} · v{citation.versionNumber}</p>
      <blockquote><a href={`#agreement/${match.agreementId}/document/${citation.versionId}/${citation.start}/${citation.end}`}>{citation.quote}</a></blockquote>
     </div>)}
    </article>)}
   </>}
   <details><summary>Model and source record</summary><dl>
    <dt>Provider and model</dt><dd>{answer.provider} · {answer.model}</dd>
    <dt>Prompt SHA-256</dt><dd>{answer.prompt_version}</dd>
    <dt>Playbook version</dt><dd>Not used: repository questions cite document versions and recorded terms.</dd>
    <dt>Input digests and question date</dt><dd><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(JSON.parse(answer.input_digests),null,2)}</pre></dd>
    <dt>Estimated cost</dt><dd>{answer.estimated_usd_micros===null?'Unknown':`${(answer.estimated_usd_micros/1000000).toFixed(6)} USD`}</dd>
    <dt>Accepted by</dt><dd>{answer.accepted_by?personName(state,answer.accepted_by):'Not accepted'}</dd>
   </dl></details>
   {answer.status==='proposed'&&!answer.stale&&<button type="button" disabled={locket.busy} onClick={()=>locket.run('question.accept',{id:answer.id})}>Accept answer record</button>}
  </section>}
  <section className="lk-panel" aria-label="Your previous questions"><h2>Your previous questions</h2>
   {!workspace.records.length&&<p>No repository questions recorded.</p>}
   <ul>{workspace.records.map(r=><li key={r.id}><a href={'#questions/'+r.id}>{r.question}</a> · {r.status} · {stamp(r.created_at,{year:true})}</li>)}</ul>
  </section>
 </div>
}

import { randomUUID } from 'node:crypto'
import { file,docx } from './files.mjs'
export const reviewParagraphs=['1. Payment','Invoices are due within 60 days.','2. Liability','Liability is capped at $100,000.','3. Confidentiality','Confidentiality lasts one year.']
export async function reviewRedlinesFixture(h,{decide=true}={}){
 const actor=h.owner,book=await actor.command('playbook.draft',{rules:[['payment','Invoices are due within 30 days.'],['liability','Liability is capped at $200,000.'],['confidentiality','Confidentiality lasts three years.']].map(([key,preferred])=>({key,title:key,preferred,alternatives:[],authority:'counsel'}))})
 await actor.command('playbook.activate',{id:book.id})
 const bytes=docx([...reviewParagraphs,'Reference '+randomUUID()]),a=await actor.command('request.create',{title:'Northwind counsel review',type:'nda',party:{name:'Northwind Technology',kind:'supplier'},file:file('northwind.docx',bytes)})
 const state=await actor.state(),v=state.versions.find(row=>row.id===a.versionId)
 const findings=[['payment',reviewParagraphs[1],'Invoices are due within 30 days.'],['liability',reviewParagraphs[3],'Liability is capped at $200,000.'],['confidentiality',reviewParagraphs[5],'Confidentiality lasts three years.']].map(([clauseKey,quote,proposedWording])=>({clauseKey,quote,proposedWording,start:v.text.indexOf(quote),end:v.text.indexOf(quote)+quote.length,result:'breached',explanation:'Match the accepted supplier playbook for '+clauseKey,questions:[]}))
 const provenance={provider:'externally supplied review',model:'synthetic-locket-91',promptVersion:'supplier-review-v1'}
 const proposal=await actor.command('proposal.prepare',{kind:'review',payload:{agreementId:a.id,versionId:v.id,findings,provenance},evidence:['Exact source document and counsel-approved supplier playbook.']})
 if(decide)await actor.command('proposal.decide',{proposalId:proposal.id,decision:'approve'})
 const current=await actor.state(),rows=current.deviations.filter(d=>d.proposal_id===proposal.id)
 return {a,v,bytes,proposal,findings:rows,provenance,changes:rows.map(d=>({findingId:d.id,wording:d.clause_key==='payment'?'Invoices are due within 45 days.':d.proposed_wording,reason:d.clause_key==='liability'?'Counsel reviewed the higher cap for this scope.':d.explanation,external:d.clause_key==='confidentiality'})),current:async()=>(await actor.state()).agreements.find(row=>row.id===a.id)}
}

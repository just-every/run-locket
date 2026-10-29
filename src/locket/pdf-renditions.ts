// Native text extraction has no provider, model, inferred wording or OCR fallback.
import { getDocumentProxy } from 'unpdf'
import type { Bindings } from '../auth.server'
import { readArtifactBytes } from './artifacts'
import { guardSql } from './commands'
import { pdfTextPage, type PdfTextPage } from './pdf-text-geometry'
import { json, sha256, sql, type Sql } from './model'

export interface PdfRendition {
 id:string; agreement_id:string; version_id:string; artifact_id:string; source_sha256:string; version_digest:string
 status:string; processed_pages:number; total_pages:number|null; text:string; pages:PdfTextPage[]; error:string|null; revision:number
}
type Stored = Omit<PdfRendition,'pages'> & {pages:string}
const source = `EXISTS(SELECT 1 FROM lk_artifacts f JOIN lk_versions v ON v.id=f.version_id
 WHERE f.id=r.artifact_id AND f.agreement_id=r.agreement_id AND v.agreement_id=r.agreement_id
 AND f.sha256=r.source_sha256 AND v.digest=r.version_digest)`
export function queuePdfRendition(agreementId:string,versionId:string,artifactId:string,digest:string,versionDigest:string,at:number):Sql {
 return sql('INSERT INTO lk_pdf_renditions(id,agreement_id,version_id,artifact_id,source_sha256,version_digest,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',crypto.randomUUID(),agreementId,versionId,artifactId,digest,versionDigest,at,at)
}
export async function pdfRenditions(db:D1Database,ids:Set<string>):Promise<PdfRendition[]> {
 const rows=(await db.prepare(`SELECT r.*,CASE WHEN ${source} THEN 1 ELSE 0 END AS source_current FROM lk_pdf_renditions r`).all<Stored & {source_current:number}>()).results
 return rows.filter(r=>ids.has(r.agreement_id)).map(r=>{
  const {source_current,...row}=r
  return source_current?{...row,pages:JSON.parse(row.pages)}:{...row,status:'stale',text:'',pages:[],error:'The source changed; this rendition is unavailable.'}
 })
}
export const usablePdfText=(r:PdfRendition)=>['ready','partial'].includes(r.status)

/** Bounded durable work. Each page is saved behind its original source and revision.
 * An interrupted job resumes on the next minute trigger; concurrent ticks cannot
 * overwrite an erasure, source change or another worker's progress. */
export async function runPdfRenditions(env:Bindings,now:number) {
 const db=env.DB
 const jobs=(await db.prepare("SELECT * FROM lk_pdf_renditions WHERE status IN ('queued','processing') ORDER BY created_at LIMIT 3").all<Stored>()).results
 for(const job of jobs){
  let revision=job.revision
  const save=async(set:string,...values:unknown[])=>{
   const guard=crypto.randomUUID()
   try{
    await db.batch([
     guardSql(guard,[sql(`EXISTS(SELECT 1 FROM lk_pdf_renditions r WHERE r.id=? AND r.revision=? AND r.status IN ('queued','processing') AND ${source})`,job.id,revision)]),
     sql(`UPDATE lk_pdf_renditions SET ${set},revision=revision+1,updated_at=? WHERE id=?`,...values,now,job.id),sql('DELETE FROM lk_guard WHERE id=?',guard),
    ].map(s=>db.prepare(s.sql).bind(...s.params)))
    revision++;return true
   }catch(error){if(String(error).includes('LOCKET_GUARD')||String(error).includes('CHECK constraint'))return false;throw error}
  }
  const current=await db.prepare(`SELECT 1 FROM lk_pdf_renditions r WHERE r.id=? AND ${source}`).bind(job.id).first()
  if(!current){await db.prepare("UPDATE lk_pdf_renditions SET status='stale',text='',pages='[]',error='The source changed; this rendition is unavailable.',revision=revision+1 WHERE id=? AND revision=?").bind(job.id,revision).run();continue}
  let pdf:Awaited<ReturnType<typeof getDocumentProxy>>|undefined
  try{
   const bytes=await readArtifactBytes(db,job.artifact_id)
   if(await sha256(bytes)!==job.source_sha256){await save("status='failed',text='',pages='[]',error='The stored file digest does not match the source.'");continue}
   pdf=await getDocumentProxy(bytes.slice(),{useWasm:false,useSystemFonts:false,disableFontFace:true,stopAtErrors:true,verbosity:0})
   if(!await save("status='processing',total_pages=?,error=NULL",pdf.numPages))continue
   const pages:PdfTextPage[]=JSON.parse(job.pages)
   for(let n=job.processed_pages+1;n<=Math.min(pdf.numPages,job.processed_pages+20);n++){
    let page:PdfTextPage
    try{page=await pdfTextPage(await pdf.getPage(n),n)}
    catch{page={page:n,width:null,height:null,start:0,end:0,text:'',anchors:[],status:'unavailable',reason:'This page could not be read. OCR is unavailable.'}}
    const start=pages.reduce((sum,p)=>sum+p.text.length+1,0)
    page={...page,start,end:start+page.text.length,anchors:page.anchors.map(a=>({...a,start:a.start+start,end:a.end+start}))}
    pages.push(page)
    const done=n===pdf.numPages,status=done?(pages.every(p=>p.status==='available')?'ready':'partial'):'processing'
    if(!await save('status=?,processed_pages=?,text=?,pages=?',status,n,pages.map(p=>p.text).join('\n'),json(pages)))break
   }
  }catch{await save("status='failed',text='',pages='[]',error='This PDF could not be read. Original bytes are retained; OCR is unavailable.'")}
  finally{await pdf?.loadingTask.destroy()}
 }
}

import { useEffect, useRef, useState } from 'react'
import { fileToPayload } from './api'
import { Field, Form, value } from './controls'
import './style'

interface SharedVersion {version:{number:number;text:string;digest:string};comments:{id:string;body:string;quote:string|null}[];expiresAt:number}
export function PublicExchange(){
  const [shared,setShared]=useState<SharedVersion|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
  const token=useRef(''),pending=useRef<{signature:string;id:string}|null>(null)
  async function request(action:string,body:unknown={}){
    return fetch('/api/locket/exchange/'+action,{method:'POST',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',headers:{'content-type':'application/json',authorization:'Bearer '+token.current},body:JSON.stringify(body)})
  }
  async function read<T>(response:Response):Promise<T>{
    const body=await response.json() as T & {ok?:boolean;error?:{message?:string}}
    if(!response.ok||body.ok===false)throw new Error(body.error?.message??'This exchange is unavailable.')
    return body
  }
  const refresh=async()=>setShared(await read<SharedVersion>(await request('open')))
  useEffect(()=>{
    token.current=window.location.hash.slice(1)
    if(!/^[a-f0-9]{64}$/.test(token.current)){setError('This exchange link is incomplete. Ask the sender for a new link.');return}
    void refresh().catch(cause=>setError(cause.message))
  },[])
  async function command<T>(action:string,payload:object):Promise<{result:T}>{
    const signature=JSON.stringify({action,payload})
    if(pending.current?.signature!==signature)pending.current={signature,id:crypto.randomUUID()}
    const response=await request(action,{commandId:pending.current.id,payload})
    if(response.status<500)pending.current=null
    return read<{result:T}>(response)
  }
  const act=async(work:()=>Promise<void>)=>{
    setBusy(true);setError('');setNotice('')
    try{await work()}catch(cause){setError((cause as Error).message)}finally{setBusy(false)}
  }
  return <main className="lk-app lk-clickwrap" style={{display:'block',maxWidth:900,width:'100%',boxSizing:'border-box',margin:'0 auto',padding:20,overflowWrap:'anywhere'}}>
    <h1>Document review</h1>
    <p>Secure counterparty exchange</p>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!shared&&!error&&<p>Opening the shared version…</p>}
    {shared&&<>
      <p>Version {shared.version.number} · Link expires {new Date(shared.expiresAt).toLocaleString()}</p>
      <p className="lk-muted">This link gives access to this shared version. Keep it private. Comments and returned markups are attributed to the contact the sender selected; holding the link does not verify identity.</p>
      <button className="lk-primary" disabled={busy} onClick={()=>void act(async()=>{
        const response=await request('download')
        if(!response.ok){await read(response);return}
        const url=URL.createObjectURL(await response.blob()),anchor=document.createElement('a')
        anchor.href=url;anchor.download=`external-v${shared.version.number}.docx`;anchor.click();URL.revokeObjectURL(url)
        setNotice('External Word rendition downloaded.')
      })}>Download external Word rendition</button>
      <section className="lk-panel" aria-label="Shared document"><h2>Version {shared.version.number}</h2><div style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{shared.version.text}</div></section>
      <section className="lk-panel" aria-label="External comments"><h2>External comments</h2>
        {!shared.comments.length&&<p>No external comments yet.</p>}
        <ul className="lk-clean-list">{shared.comments.map(comment=><li key={comment.id}>{comment.quote&&<blockquote>{comment.quote}</blockquote>}<p>{comment.body}</p></li>)}</ul>
        <Form busy={busy} submit="Add external comment" onSubmit={async(data,form)=>act(async()=>{
          await command('comment',{body:value(data,'body'),quote:value(data,'quote')});form.reset();setNotice('External comment saved.');await refresh()
        })}><Field label="Quoted passage (optional)"><textarea name="quote" maxLength={2000}/></Field><Field label="External comment"><textarea name="body" required maxLength={4000}/></Field></Form>
      </section>
      <section className="lk-panel" aria-label="Return a markup"><h2>Return a markup</h2><p>Upload a PDF or Word document. Your exact file becomes the next counterparty version. If a newer version has arrived, ask the sender for a fresh link.</p>
        <Form busy={busy} submit="Upload counterparty markup" onSubmit={async(data,form)=>act(async()=>{
          const file=data.get('markup');if(!(file instanceof File)||!file.size)throw new Error('Choose a PDF or DOCX markup.')
          const body=await command<{number:number;artifactDigest:string}>('upload',{file:await fileToPayload(file)})
          form.reset();setNotice(`Counterparty version ${body.result.number} received. SHA-256 ${body.result.artifactDigest}`)
        })}><Field label="Counterparty markup file"><input name="markup" type="file" required accept=".docx,.pdf"/></Field></Form>
      </section>
    </>}
  </main>
}

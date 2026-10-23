import { useEffect,useRef,useState } from 'react'

/** Render the retained PDF itself; browser download frames cannot place fields. */
export function SignaturePdfPreview({artifactId,page,onReady}:{artifactId:string;page:number;onReady:(ready:boolean)=>void}){
 const canvas=useRef<HTMLCanvasElement>(null),[error,setError]=useState(''),[rendered,setRendered]=useState(false)
 useEffect(()=>{
  const abort=new AbortController();let closed=false,pdf:any,render:any
  onReady(false);setRendered(false);setError('')
  void(async()=>{
   try{
    const response=await fetch(`/api/locket/files/${encodeURIComponent(artifactId)}`,{signal:abort.signal,credentials:'same-origin'})
    if(!response.ok)throw new Error('The retained PDF is unavailable under your current access.')
    const {getDocumentProxy}=await import('unpdf')
    pdf=await getDocumentProxy(new Uint8Array(await response.arrayBuffer()),{useWasm:false,useSystemFonts:true,stopAtErrors:true,verbosity:0})
    if(closed){await pdf.loadingTask.destroy();return}
    const documentPage=await pdf.getPage(page),viewport=documentPage.getViewport({scale:Math.min(window.devicePixelRatio||1,2)}),element=canvas.current
    if(!element||closed)return
    element.width=Math.ceil(viewport.width);element.height=Math.ceil(viewport.height)
    render=documentPage.render({canvas:element,canvasContext:element.getContext('2d')!,viewport})
    await render.promise
    if(!closed){setRendered(true);onReady(true)}
   }catch(e){if(!closed)setError(e instanceof Error?e.message:'The retained PDF page could not be rendered.')}
  })()
  return()=>{closed=true;abort.abort();render?.cancel();if(pdf)void pdf.loadingTask.destroy()}
 },[artifactId,page,onReady])
 return <><canvas ref={canvas} role="img" aria-label={`Signing PDF page ${page}`} aria-busy={!rendered&&!error} data-rendered={String(rendered)} style={{width:'100%',height:'100%',display:'block'}} />{error&&<p role="alert" style={{position:'absolute',inset:8,background:'white',padding:8}}>{error}</p>}</>
}

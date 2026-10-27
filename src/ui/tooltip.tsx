import { cloneElement, useId, useRef, useState, useEffect, type ReactElement } from 'react'
import { createPortal } from 'react-dom'

/** Icon controls describe themselves immediately on focus, after 300 ms on hover. */
export function Tooltip({label,children}:{label:string;children:ReactElement<any>}){
 const id=useId(),timer=useRef<ReturnType<typeof setTimeout>|null>(null),[box,setBox]=useState<{left:number;top:number}|null>(null)
 const hide=()=>{if(timer.current)clearTimeout(timer.current);timer.current=null;setBox(null)}
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[])
 const show=(element:HTMLElement)=>{const rect=element.getBoundingClientRect();setBox({left:Math.max(8,Math.min(window.innerWidth-180,rect.left)),top:Math.max(8,rect.top-34)})}
 return <>{cloneElement(children,{title:undefined,'aria-describedby':box?id:children.props['aria-describedby'],onPointerEnter:(event:any)=>{children.props.onPointerEnter?.(event);const element=event.currentTarget;timer.current=setTimeout(()=>show(element),300)},onPointerLeave:(event:any)=>{children.props.onPointerLeave?.(event);hide()},onFocus:(event:any)=>{children.props.onFocus?.(event);show(event.currentTarget)},onBlur:(event:any)=>{children.props.onBlur?.(event);hide()},onClick:(event:any)=>{hide();children.props.onClick?.(event)}})}{box&&createPortal(<span id={id} role="tooltip" style={{position:'fixed',left:box.left,top:box.top,zIndex:1000,background:'var(--lk-ink)',color:'white',padding:'4px 8px',borderRadius:4,fontSize:13,pointerEvents:'none',maxWidth:180}}>{label}</span>,document.body)}</>
}

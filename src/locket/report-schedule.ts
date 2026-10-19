import { addDays, zonedInstant } from './dates'

export function localMinute(at:number, zone:string){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(at).map(p=>[p.type,p.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}
/** Earlier occurrence when clocks repeat; shift a missing wall time forward by its gap. */
export function reportInstant(local:string,zone:string){
  const [date,time]=local.split('T')
  let instant=zonedInstant(date,time+':00',zone)
  const projected=localMinute(instant,zone)
  if(projected<local)instant+=Date.parse(local+'Z')-Date.parse(projected+'Z')
  return instant
}
export function nextReport(r:{first_local:string;timezone:string;frequency:'weekly'|'monthly'},now:number){
  const first=r.first_local.slice(0,10),time=r.first_local.slice(11),today=localMinute(now,r.timezone).slice(0,10)
  if(reportInstant(r.first_local,r.timezone)>now)return reportInstant(r.first_local,r.timezone)
  if(r.frequency==='weekly'){
    let weeks=Math.max(0,Math.floor((Date.parse(today)-Date.parse(first))/604800000))
    let at=reportInstant(addDays(first,weeks*7)+'T'+time,r.timezone)
    while(at<=now){weeks++;at=reportInstant(addDays(first,weeks*7)+'T'+time,r.timezone)}
    return at
  }
  const y=Number(first.slice(0,4)),m=Number(first.slice(5,7))-1,d=Number(first.slice(8,10))
  let months=(Number(today.slice(0,4))-y)*12+Number(today.slice(5,7))-1-m
  const at=(n:number)=>{
    const date=new Date(Date.UTC(y,m+n,Math.min(d,new Date(Date.UTC(y,m+n+1,0)).getUTCDate()))).toISOString().slice(0,10)
    return reportInstant(date+'T'+time,r.timezone)
  }
  while(at(months)<=now)months++
  return at(months)
}

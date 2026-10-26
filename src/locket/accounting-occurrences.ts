import { fail, integer } from './model'
import { providerDate } from './accounting-records'

export function occurrenceDate(day:string,months:number){
 const [year,month,date]=day.split('-').map(Number),target=new Date(Date.UTC(year,month-1+months,1)),last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate()
 target.setUTCDate(Math.min(date,last))
 return providerDate(target.toISOString().slice(0,10))
}
export function paymentOccurrences(p:Record<string,unknown>,recurrence:string,dueDate:string,billDate:string){
 const count=p.occurrences===undefined?1:integer(p,'occurrences',1,120),step=recurrence==='monthly'?1:recurrence==='quarterly'?3:recurrence==='annually'?12:0
 if(!step&&count!==1)fail('OBLIGATION','A nonrecurring obligation has exactly one occurrence.',409)
 return Array.from({length:count},(_,index)=>({dueDate:occurrenceDate(dueDate,index*step),billDate:occurrenceDate(billDate,index*step)}))
}

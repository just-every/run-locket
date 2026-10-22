import { createFileRoute } from '@tanstack/react-router'
import { HydrationUnit } from '../base/hydration/unit'
import { PublicExchange } from '../ui/exchange-public'

export const Route = createFileRoute('/exchange')({
  head:()=>({meta:[{title:'Locket — document review'},{name:'referrer',content:'no-referrer'},{name:'robots',content:'noindex, nofollow'}]}),
  component:()=> <HydrationUnit><PublicExchange/></HydrationUnit>,
})

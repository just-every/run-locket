import { file, pdf } from './files.mjs'
export const reportView={query:'Reporting',filters:[],sort:{field:'title',direction:'asc'},columns:['title','counterparty','value','notice_deadline']}
export async function reportFixture(owner){
  for(const [title,value,restricted] of [['Reporting public A','100.25',false],['Reporting public B','200.50',false],['Reporting confidential','9000',true]]){
    const a=await owner.command('legacy.import',{title,type:'supplier',party:{name:title+' vendor',kind:'supplier'},value,restricted,sourceSystem:'Archive',sourceId:title,file:file(title+'.pdf',pdf(title)),text:'Effective January 1, 2026. Ends December 31, 2026; no auto-renewal; notice 30 days.',signed:true})
    for(const [key,value] of [['effective_date','2026-01-01'],['end_date','2026-12-31'],['auto_renew','no'],['notice_days','30']]){
      const t=await owner.command('term.propose',{agreementId:a.id,key,value,citation:{quote:'Effective January 1, 2026. Ends December 31, 2026; no auto-renewal; notice 30 days.'}})
      await owner.command('term.decide',{agreementId:a.id,termId:t.id,decision:'confirm'})
    }
  }
}

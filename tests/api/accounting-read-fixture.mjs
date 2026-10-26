export const netsuiteBindings={NETSUITE_ACCOUNT_ID:'1234567_SB1',NETSUITE_ACCESS_TOKEN:'synthetic-locket-9'}
export function accountingReadFake(provider,customer,calls,mode=()=> 'ok'){
 const recordId='42',document={id:'synthetic-locket-10',date:'2026-11-01',due:'2026-11-01',amount:125050},second={id:'synthetic-locket-11',date:'2026-12-01',due:'2026-12-01',amount:200000}
 return async request=>{
  const url=new URL(request.url),body=request.method==='POST'?await request.json():null
  calls.push({url:request.url,method:request.method,body,authorization:request.headers.get('Authorization'),prefer:request.headers.get('Prefer')})
  if(mode()==='failure')return Response.json({error:'synthetic-locket-12'},{status:503})
  if(provider==='quickbooks'){
   const query=url.searchParams.get('query'),kind=query.match(/FROM (\w+)/)[1],payment=kind==='Payment'||kind==='BillPayment',prefix=customer?'CustomerRef':'VendorRef'
   return Response.json({QueryResponse:{[kind]:payment?[{Id:'synthetic-locket-13',TxnDate:'2026-11-01',TotalAmt:500,[prefix]:{value:recordId},CurrencyRef:{value:'USD'},Line:[{Amount:500,LinkedTxn:[{TxnId:document.id,TxnType:customer?'Invoice':'Bill'}]}]}]:[document,second].map(d=>({Id:d.id,TxnDate:d.date,DueDate:d.due,TotalAmt:d.amount/100,Balance:(d.amount-50000)/100,[prefix]:{value:mode()==='counterparty'?'43':recordId},CurrencyRef:{value:mode()==='currency'?'GBP':'USD'}}))}})
  }
  if(provider==='netsuite')return Response.json({offset:0,count:3,hasMore:mode()==='incomplete',items:[...([document,second].map(d=>({id:d.id,type:customer?'CustInvc':'VendBill',entity:mode()==='counterparty'?'43':recordId,transaction_date:d.date,due_date:d.due,total:String(d.amount/100),currency:mode()==='currency'?'GBP':'USD'}))),{id:'synthetic-locket-13',type:customer?'CustPymt':'VendPymt',entity:recordId,transaction_date:'2026-11-01',total:'500.00',currency:'USD'}]})
  if(url.pathname.endsWith('/payments'))return Response.json({payments:[{id:'synthetic-locket-13',contact_id:recordId,payment_date:'2026-11-01',direction:customer?'received':'paid',amount_cents:50000,reversal_id:null,allocations:[{target_kind:customer?'invoice':'bill',target_id:document.id,amount_cents:50000}]},{id:'synthetic-locket-14',contact_id:recordId,payment_date:'2026-11-01',direction:customer?'received':'paid',amount_cents:10000,reversal_id:'synthetic-locket-15',allocations:[]},{id:'synthetic-locket-16',contact_id:'43',payment_date:'2026-11-01',direction:customer?'received':'paid',amount_cents:900000,allocations:[]}],nextCursor:null})
  const key=customer?'invoices':'bills',page=url.searchParams.get('cursor'),items=page?[second]:[document]
  return Response.json({[key]:items.map(d=>({id:d.id,[customer?'customer_id':'vendor_id']:mode()==='counterparty'?'43':recordId,[customer?'issue_date':'bill_date']:d.date,due_date:d.due,status:customer?'issued':'posted',kind:'invoice',total_cents:d.amount,open_cents:d.amount-50000})),nextCursor:mode()==='incomplete'?'synthetic-locket-17':page?null:'synthetic-locket-17'})
 }
}

import { PDFDocument, StandardFonts } from 'pdf-lib'
export const pdfClause='Aurora escrow ends on 2028-12-31 with 45 days notice.'
export async function embeddedPdf(label='synthetic-locket-1',{blankPage=false,pageCount=20}={}){
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica)
 const image=blankPage?await pdf.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6XR8AAAAASUVORK5CYII=','base64')):null
 for(let n=1;n<=pageCount;n++){
  const page=pdf.addPage([612,792])
  if(image&&n===20){page.drawImage(image,{x:50,y:50,width:500,height:680});continue}
  page.drawText(`${label} page ${n}`,{x:50,y:740,size:12,font})
  page.drawText(n===14?pdfClause:`Ordinary provision ${n} keeps its original wording.`,{x:50,y:700,size:12,font})
 }
 return Buffer.from(await pdf.save({useObjectStreams:true}))
}
export const nativePdfImport=(bytes,label='synthetic-locket-1')=>({title:label,type:'other',party:{name:label,kind:'supplier'},sourceSystem:'synthetic-locket',sourceId:label,signed:true,file:{filename:label+'.pdf',base64:bytes.toString('base64')}})

// A stored-entry ZIP streams one immutable artifact at a time; originals are
// neither recompressed nor rewritten. Central headers retain their CRC and size.
const encoder=new TextEncoder()
const table=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0})
const crc=(b:Uint8Array)=>{let c=0xffffffff;for(const n of b)c=table[(c^n)&255]^(c>>>8);return (c^0xffffffff)>>>0}
const header=(length:number)=>{const b=new Uint8Array(length);return {b,v:new DataView(b.buffer)}}
export interface ZipEntry {name:string;bytes:()=>Promise<Uint8Array>}
export function storedZip(entries:ZipEntry[]):ReadableStream<Uint8Array>{
 async function* chunks(){
  let offset=0;const central:Uint8Array[]=[]
  for(const entry of entries){
   const bytes=await entry.bytes(),name=encoder.encode(entry.name),checksum=crc(bytes)
   if(offset+bytes.length+name.length+30>0xffffffff)throw new Error('ZIP exceeds its supported 4 GB size.')
   const local=header(30),directory=header(46)
   local.v.setUint32(0,0x04034b50,true);local.v.setUint16(4,20,true);local.v.setUint16(6,0x800,true)
   local.v.setUint32(14,checksum,true);local.v.setUint32(18,bytes.length,true);local.v.setUint32(22,bytes.length,true);local.v.setUint16(26,name.length,true)
   directory.v.setUint32(0,0x02014b50,true);directory.v.setUint16(4,20,true);directory.v.setUint16(6,20,true);directory.v.setUint16(8,0x800,true)
   directory.v.setUint32(16,checksum,true);directory.v.setUint32(20,bytes.length,true);directory.v.setUint32(24,bytes.length,true);directory.v.setUint16(28,name.length,true);directory.v.setUint32(42,offset,true)
   central.push(directory.b,name);offset+=30+name.length+bytes.length
   yield local.b;yield name;yield bytes
  }
  const size=central.reduce((n,b)=>n+b.length,0),end=header(22)
  if(entries.length>65535||offset+size>0xffffffff)throw new Error('ZIP exceeds its supported size.')
  end.v.setUint32(0,0x06054b50,true);end.v.setUint16(8,entries.length,true);end.v.setUint16(10,entries.length,true);end.v.setUint32(12,size,true);end.v.setUint32(16,offset,true)
  for(const b of central)yield b
  yield end.b
 }
 const iterator=chunks()
 return new ReadableStream({async pull(controller){try{const result=await iterator.next();if(result.done)controller.close();else controller.enqueue(result.value)}catch(error){controller.error(error)}},async cancel(){await iterator.return(undefined)}})
}

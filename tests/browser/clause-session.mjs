import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { productPage } from './product-harness.mjs'
export async function clauseSession(page,width,options={}){
 if(!process.env.LOCKET_CAMPAIGN_LIVE)return productPage(page,{width,...options})
 const origin=process.env.LOCKET_BASE_URL
 await page.setViewportSize({width,height:1000})
 await page.goto(process.env.LOCKET_OPEN)
 await page.waitForURL(url=>!url.hash.includes('rer-dev')&&['/app','/setup'].includes(url.pathname))
 if(new URL(page.url()).pathname==='/setup'){await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Finish setup',exact:true}).click();await page.waitForURL(url=>url.pathname==='/app')}
 const owner={
  async command(type,payload){const response=await page.request.post(origin+'/api/locket/commands',{headers:{origin},data:{type,payload,commandId:randomUUID()}}),body=await response.json();assert.equal(body.ok,true,JSON.stringify(body.error));return body.result},
  async state(){return(await page.request.get(origin+'/api/locket/state')).json()},
  request(path,opts){return page.request.get(origin+path,opts)},
 }
 return {origin,owner,close:async()=>{}}
}

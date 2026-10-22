// Static host for the real public component; all capability requests use D1.
import { build } from 'esbuild'
let built
export async function hostExchange(page,origin){
  built??=build({stdin:{contents:"import React from 'react';import {createRoot} from 'react-dom/client';import {PublicExchange} from './src/ui/exchange-public';createRoot(document.getElementById('root')).render(React.createElement(PublicExchange));",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',outdir:'/test-exchange',entryNames:'public',define:{'process.env.NODE_ENV':'"production"'},loader:{'.svg':'dataurl'},logLevel:'silent'})
  const output=await built,script=output.outputFiles.find(f=>f.path.endsWith('.js')).text,css=output.outputFiles.find(f=>f.path.endsWith('.css'))?.text??''
  const matcher=url=>url.origin===origin&&['/exchange','/test-exchange.js','/test-exchange.css'].includes(url.pathname)
  const handler=route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/test-exchange.js')return route.fulfill({contentType:'text/javascript',body:script})
    if(path==='/test-exchange.css')return route.fulfill({contentType:'text/css',body:css})
    return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><link rel="stylesheet" href="/rer-theme.css"><link rel="stylesheet" href="/test-exchange.css"></head><body><div id="root"></div><script type="module" src="/test-exchange.js"></script></body></html>'})
  }
  await page.route(matcher,handler)
  return ()=>page.unroute(matcher,handler)
}

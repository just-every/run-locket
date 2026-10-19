// Deliberately a top-level hosted review, with a fresh unchecked consent control.
// The assertion arrives only in a fragment, is removed immediately, and is kept
// in memory for Authorization requests. No analytics or external requests.
const script = `
const token = new URLSearchParams(location.hash.slice(1)).get('identity');
history.replaceState(null,'',location.pathname);
const termsId = decodeURIComponent(location.pathname.split('/').pop());
const status = document.querySelector('[role=status]'), consent = document.querySelector('#consent'), button = document.querySelector('button');
let shown;
const commandId=crypto.randomUUID();
const headers = {'content-type':'application/json',...(token ? {authorization:'Bearer '+token} : {})};
async function call(action, body) {
 const response = await fetch('/api/locket/clickwrap/'+action,{method:'POST',credentials:token?'omit':'same-origin',headers,body:JSON.stringify(body)});
 const data = await response.json();
 if(response.status===401 && !token) {location.assign('/signin?returnTo='+encodeURIComponent(location.pathname));throw Error('Sign in to review and accept these terms.');}
 if(!response.ok) throw Error(data.error?.message || 'The request could not be completed.');
 return data;
}
consent.addEventListener('change',()=>{button.disabled=!consent.checked || !shown || !shown.required});
async function load() {
 try {
  shown=await call('show',{termsId});
  document.querySelector('h1').textContent=shown.terms.name;
  document.querySelector('#version').textContent='Version '+shown.terms.number+' · SHA-256 '+shown.terms.digest;
  document.querySelector('#body').textContent=shown.terms.body;
  document.querySelector('#identity').textContent=shown.identity.label+': '+shown.identity.account+' ('+shown.identity.email+')';
  status.textContent=shown.required?'Review this version, then select the checkbox and press Accept.':'You have already accepted the required terms. No acceptance is needed.';
  document.querySelector('form').hidden=!shown.required;
 } catch(error) { status.textContent=error.message; }
}
document.querySelector('form').addEventListener('submit',async event=>{
 event.preventDefault(); if(!consent.checked || !shown) return;
 button.disabled=true;
 try {
  const result=await call('accept',{termsId,versionId:shown.terms.version_id,digest:shown.terms.digest,accepted:true,commandId});
  status.textContent='Accepted version '+shown.terms.number+'. Receipt '+result.result.id+'.';
  document.querySelector('form').hidden=true;
 } catch(error) {status.textContent=error.message; consent.checked=false;}
});
if(window.top===window.self) load(); else status.textContent='Open this review in its own window to accept.';
`

export function acceptancePage(): Response {
  const nonce = crypto.randomUUID()
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review published terms · Locket</title><link rel="stylesheet" href="/rer-theme.css"><style>body{margin:0;background:var(--rer-bg,#f5f4f3);color:var(--rer-text,#24252a);font:16px/1.6 system-ui,sans-serif}main{max-width:850px;margin:32px auto;padding:24px;overflow-wrap:anywhere}pre{white-space:pre-wrap;font:inherit;background:white;padding:24px;border:1px solid #ddd;border-radius:12px}h1{line-height:1.2}button{display:block;margin-top:20px;background:#24252a;color:white;border:0;border-radius:10px;padding:14px 24px;font:inherit}button:disabled{opacity:.5}input{width:18px;height:18px;vertical-align:middle}#version{font-size:12px}label{display:block}form{padding:20px 0}@media(max-width:600px){main{margin:0;padding:20px 16px}pre{padding:16px}}</style></head><body><main><a href="/app#clickwrap">Locket · Published terms</a><h1>Review terms</h1><p id="version"></p><p id="identity"></p><pre id="body"></pre><p role="status">Loading the published terms…</p><form hidden><label><input type="checkbox" id="consent" required> I have read and agree to the exact terms version shown above.</label><button disabled>Accept</button></form></main><script nonce="${nonce}">${script}</script></body></html>`, { headers: {
    'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer',
    'x-frame-options':'DENY','x-content-type-options':'nosniff',
    'content-security-policy':`default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
  } })
}

export const embedScript = `(()=>{
const installation = new URL(document.currentScript.src).origin;
window.LocketClickwrap={mount(element, options){
 if(!element || !options.termsId) throw Error('Choose the terms to show.');
 const link=document.createElement('a');
 link.textContent=options.label || 'Review and accept terms';
 const page=new URL('/api/locket/clickwrap/terms/'+encodeURIComponent(options.termsId),installation);
 if(options.identity) page.hash=new URLSearchParams({identity:options.identity}).toString();
 link.href=page.href;link.target='_blank';link.rel='noopener noreferrer';
 element.replaceChildren(link);return link;
}};
})();`

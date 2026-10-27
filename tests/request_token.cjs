const test=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {resolve}=require('node:path');
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
const expired=()=>json({error:'Rejected before execution',code:'reader_token_expired'},403);
const post=(token='old',extra={})=>({method:'POST',headers:{'Content-Type':'application/json','X-Reader-Token':token},body:'{"action":"start"}',...extra});
async function harness(fetcher){
 const {createTokenFetch}=await import(pathToFileURL(resolve('src/reader_mcp/web_ui/request.mjs')));
 let token='old';const calls=[];
 const request=createTokenFetch({getToken:()=>token,setToken:value=>{token=value;},fetcher:async(path,options={})=>{
  calls.push({path,options});return fetcher(path,options,()=>{token='new';});
 }});
 return {request,calls,token:()=>token};
}
test('a rejected preflight refreshes and retries the identical JSON write once',async()=>{
 const signal=new AbortController().signal;
 const h=await harness((path,options)=>path==='/api/token'?json({token:'new'}):new Headers(options.headers).get('X-Reader-Token')==='new'?json({started:true}):expired());
 assert.deepEqual(await(await h.request('/api/inbox',post('old',{signal,keepalive:true}))).json(),{started:true});
 assert.deepEqual(h.calls.map(c=>c.path),['/api/inbox','/api/token','/api/inbox']);
 assert.equal(h.token(),'new');assert.equal(h.calls[1].options.cache,'no-store');
 const retry=h.calls[2].options;
 assert.equal(retry.body,h.calls[0].options.body);assert.equal(retry.signal,signal);assert.equal(retry.keepalive,true);
 assert.equal(new Headers(retry.headers).get('Content-Type'),'application/json');
});
for(const status of [400,403,429,500])test(`an ordinary ${status} never refreshes or replays`,async()=>{
 const h=await harness(()=>json({error:'Unrelated refusal'},status));
 assert.equal((await h.request('/api/inbox',post())).status,status);assert.equal(h.calls.length,1);
});
test('GETs and successful POSTs never refresh',async()=>{
 const h=await harness(()=>json({ok:true}));
 await h.request('/api/inbox');await h.request('/api/inbox',post());assert.equal(h.calls.length,2);
});
test('a second token rejection is returned without a retry loop',async()=>{
 const h=await harness(path=>path==='/api/token'?json({token:'new'}):expired());
 assert.equal((await h.request('/api/inbox',post())).status,403);assert.equal(h.calls.length,3);
});
test('an uncertain network failure never replays an action',async()=>{
 const h=await harness(()=>{throw new TypeError('Network failed after send');});
 await assert.rejects(h.request('/api/inbox',post()),/Network failed/);assert.equal(h.calls.length,1);
});
for(const [label,refresh] of [['access revoked',()=>json({error:'Access revoked'},403)],['missing token',()=>json({token:null})],['invalid JSON',()=>new Response('invalid')]])test(`an invalid refresh cannot authorize a replay: ${label}`,async()=>{
 const h=await harness(path=>path==='/api/token'?refresh():expired());
 assert.equal((await h.request('/api/inbox',post())).status,403);assert.equal(h.calls.length,2);assert.equal(h.token(),'old');
});
test('concurrent rejected writes share one token refresh',async()=>{
 let finish;
 const h=await harness((path,options)=>path==='/api/token'?new Promise(resolve=>{finish=()=>resolve(json({token:'new'}));}):new Headers(options.headers).get('X-Reader-Token')==='new'?json({ok:true}):expired());
 const first=h.request('/api/inbox',post()),second=h.request('/api/bookmark',post());
 await new Promise(setImmediate);assert.equal(h.calls.filter(c=>c.path==='/api/token').length,1);finish();
 assert.deepEqual((await Promise.all([first,second])).map(r=>r.status),[200,200]);
 assert.equal(h.calls.length,5);
});
test('a token already refreshed by another request is reused',async()=>{
 const h=await harness((path,options,rotate)=>{if(new Headers(options.headers).get('X-Reader-Token')==='new')return json({ok:true});rotate();return expired();});
 assert.equal((await h.request('/api/inbox',post())).status,200);assert.equal(h.calls.length,2);
});
test('cancelling while refresh is pending prevents the action retry',async()=>{
 let finish;const controller=new AbortController();
 const h=await harness(path=>path==='/api/token'?new Promise(resolve=>{finish=()=>resolve(json({token:'new'}));}):expired());
 const result=h.request('/api/inbox',post('old',{signal:controller.signal}));
 await new Promise(setImmediate);controller.abort();finish();
 await assert.rejects(result,{name:'AbortError'});assert.equal(h.calls.length,2);
});

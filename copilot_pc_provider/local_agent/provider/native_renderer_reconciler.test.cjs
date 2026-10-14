'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {reconcileRendererRequest}=require('./native_renderer_reconciler.cjs');
async function box(fn){const root=await fs.mkdtemp(path.join(os.tmpdir(),'local-rea-reconcile-'));try{await fn(root)}finally{await fs.rm(root,{recursive:true,force:true})}}
const writeRows=(p,rows)=>fs.writeFile(p,rows.map(x=>JSON.stringify(x)).join('\n')+'\n','utf8');
test('reconciles only the exact request after renderer and provider terminal evidence',async()=>box(async root=>{
 const renderer=path.join(root,'renderer.jsonl'),provider=path.join(root,'provider.jsonl'),t=Date.now();
 await writeRows(renderer,[{at:t-10,request_id:'v11req_exact',kind:'snapshot'},{at:t,request_id:'v11req_exact',kind:'error',code:'native_stream_error'}]);
 await writeRows(provider,[{at:new Date(t+50).toISOString(),stage:'request.fail',errorCode:'LOCAL_AGENT_SHARED_ADMISSION_DELIVERY_UNKNOWN_DO_NOT_REPLAY'}]);
 const owner={token:'owner-token',fingerprint:'a'.repeat(64),phase:'DISPATCHING',requestId:'v11req_exact',dispatchedAt:new Date(t-100).toISOString()};
 const evidence=await reconcileRendererRequest(owner,{rendererAudit:renderer,providerAudit:provider,now:t+100});
 assert.equal(evidence.requestId,'v11req_exact');assert.equal(evidence.ownerFingerprint,owner.fingerprint);
 assert.equal(evidence.terminalKind,'error');assert.equal(evidence.outcome,'RECOVERED_TERMINAL_ERROR');
}));
test('does not reconcile without both terminal and provider failure receipts',async()=>box(async root=>{
 const renderer=path.join(root,'renderer.jsonl'),provider=path.join(root,'provider.jsonl'),t=Date.now();
 await writeRows(renderer,[{at:t,request_id:'v11req_exact',kind:'error',code:'native_stream_error'}]);
 await writeRows(provider,[{at:new Date(t+50).toISOString(),stage:'request.fail',errorCode:'LOCAL_AGENT_SHARED_ADMISSION_WAIT_EXPIRED_NOT_DISPATCHED'}]);
 const owner={token:'owner-token',fingerprint:'a'.repeat(64),phase:'DISPATCHING',requestId:'v11req_exact'};
 assert.equal(await reconcileRendererRequest(owner,{rendererAudit:renderer,providerAudit:provider,now:t+100}),null);
}));
test('legacy owner recovers only with one terminal candidate paired to provider unknown',async()=>box(async root=>{
 const renderer=path.join(root,'renderer.jsonl'),provider=path.join(root,'provider.jsonl'),t=Date.now();
 await writeRows(renderer,[{at:t,request_id:'v11req_legacy',kind:'error',code:'unknown_session_or_capacity'}]);
 await writeRows(provider,[{at:new Date(t+200).toISOString(),stage:'request.fail',errorCode:'LOCAL_AGENT_SHARED_ADMISSION_DELIVERY_UNKNOWN_DO_NOT_REPLAY'}]);
 const owner={token:'owner-token',fingerprint:'b'.repeat(64),phase:'DISPATCHING',dispatchedAt:new Date(t-100).toISOString()};
 const evidence=await reconcileRendererRequest(owner,{rendererAudit:renderer,providerAudit:provider,now:t+250});
 assert.equal(evidence.requestId,'v11req_legacy');assert.equal(evidence.receipt.correlation,'UNIQUE_DISPATCH_WINDOW_AND_PROVIDER_FAILURE');
 await writeRows(renderer,[{at:t,request_id:'v11req_legacy',kind:'error',code:'unknown_session_or_capacity'},{at:t+1,request_id:'v11req_other',kind:'error',code:'unknown'}]);
 assert.equal(await reconcileRendererRequest(owner,{rendererAudit:renderer,providerAudit:provider,now:t+250}),null);
}));

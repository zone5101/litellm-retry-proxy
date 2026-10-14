'use strict';
const fs=require('node:fs/promises'),crypto=require('node:crypto');
const RENDERER_AUDIT=process.env.CHATGPT_PC_RENDERER_AUDIT||'C:\\Users\\Z One\\AppData\\Local\\Temp\\chatgpt_renderer_isolation_20261013\\scope-probe-v11-app\\renderer-bridge-audit.jsonl';
const PROVIDER_AUDIT=process.env.CHATGPT_PC_PROVIDER_AUDIT||'C:\\Users\\Z One\\AppData\\Local\\Temp\\chatgpt_renderer_isolation_20261013\\copilot-provider-events.jsonl';
const TERMINAL=new Set(['terminal','error']);
async function rows(file){try{return (await fs.readFile(file,'utf8')).split(/\r?\n/).filter(Boolean).map(raw=>({raw,value:JSON.parse(raw)}))}catch(e){if(e?.code==='ENOENT')return[];throw e}}
function evidence(owner,row,correlation){
 const event=row.value;
 return {ownerToken:owner.token,ownerFingerprint:owner.fingerprint,requestId:event.request_id,
  terminalKind:event.kind,terminalCode:event.code??null,outcome:'RECOVERED_TERMINAL_ERROR',
  receipt:{schema:'livingos.renderer-terminal-receipt.v1',source:'renderer-bridge-audit',
   eventSha256:crypto.createHash('sha256').update(row.raw).digest('hex'),at:event.at,
   requestId:event.request_id,terminalKind:event.kind,correlation}};
}
async function reconcileRendererRequest(owner,{rendererAudit=RENDERER_AUDIT,providerAudit=PROVIDER_AUDIT,now=Date.now()}={}){
 if(!owner||owner.phase!=='DISPATCHING'||typeof owner.token!=='string'||typeof owner.fingerprint!=='string')return null;
 const renderer=await rows(rendererAudit),provider=await rows(providerAudit);
 const providerFailureAfter=event=>provider.find(p=>p.value.stage==='request.fail'&&
  String(p.value.errorCode||'').includes('UNKNOWN_DO_NOT_REPLAY')&&
  Number.isFinite(Date.parse(p.value.at))&&Date.parse(p.value.at)>event.at&&Date.parse(p.value.at)-event.at<=5000);
 if(typeof owner.requestId==='string'){
  const matches=renderer.filter(r=>r.value.request_id===owner.requestId);
  if(!matches.length)return null;
  const last=matches[matches.length-1];
  if(!TERMINAL.has(last.value.kind)||!Number.isFinite(last.value.at)||last.value.at>now||!providerFailureAfter(last.value))return null;
  const result=evidence(owner,last,'REQUEST_ID');result.receipt.providerFailureSha256=crypto.createHash('sha256').update(providerFailureAfter(last.value).raw).digest('hex');return result;
 }
 // Legacy owners did not persist request_id. Correlate only a unique renderer
 // terminal with a provider UNKNOWN event immediately following it. The
 // cross-process admission invariant guarantees there was one dispatched turn.
 const dispatched=Date.parse(owner.dispatchedAt||'');
 if(!Number.isFinite(dispatched))return null;
 const candidates=renderer.filter(r=>TERMINAL.has(r.value.kind)&&Number.isFinite(r.value.at)&&
  r.value.at>=dispatched&&r.value.at<=now&&typeof r.value.request_id==='string'&&
  providerFailureAfter(r.value));
 if(candidates.length!==1)return null;
 const result=evidence(owner,candidates[0],'UNIQUE_DISPATCH_WINDOW_AND_PROVIDER_FAILURE');
 result.receipt.providerFailureSha256=crypto.createHash('sha256').update(providerFailureAfter(candidates[0].value).raw).digest('hex');
 return result;
}
module.exports={reconcileRendererRequest,RENDERER_AUDIT,PROVIDER_AUDIT};

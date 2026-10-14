'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const DEFAULT_LOCK_DIR=path.join(os.tmpdir(),'chatgpt_renderer_isolation_20261013','local-agent-native-renderer-admission.lock');
class AdmissionError extends Error{constructor(code,cause){super('LOCAL_AGENT_SHARED_ADMISSION_'+code,{cause});this.name='AdmissionError';this.code=code;}}
const cancelled=t=>t?.isCancellationRequested===true||t?.aborted===true;
function subscribeCancel(token,fn){
 if(typeof token?.onCancellationRequested==='function')return token.onCancellationRequested(fn);
 if(typeof token?.addEventListener==='function'){token.addEventListener('abort',fn,{once:true});return{dispose:()=>token.removeEventListener?.('abort',fn)}}
 return{dispose(){}};
}
function pause(ms,token){return new Promise((resolve,reject)=>{
 if(cancelled(token))return reject(new AdmissionError('CANCELLED_NOT_DISPATCHED'));
 let done=false,timer,sub;
 const finish=e=>{if(done)return;done=true;clearTimeout(timer);sub?.dispose?.();e?reject(e):resolve()};
 timer=setTimeout(()=>finish(),ms);
 sub=subscribeCancel(token,()=>finish(new AdmissionError('CANCELLED_NOT_DISPATCHED')));
});}
function fingerprintNativePrompt(route,conversationId,prompt){
 if(typeof route!=='string'||!route||conversationId!==null&&typeof conversationId!=='string'||typeof prompt!=='string'||!prompt.trim())
   throw new AdmissionError('FINGERPRINT_INPUT_INVALID');
 return crypto.createHash('sha256').update(JSON.stringify({route,conversationId:conversationId??null,prompt})).digest('hex');
}
const isNotDispatched=e=>/_NOT_DISPATCHED(?:$|_)/.test(String(e?.code||e?.message||e));
class SharedNativeAdmission{
 constructor({lockDir=DEFAULT_LOCK_DIR,maxWaitMs=95000,retryMs=120}={}){
  if(typeof lockDir!=='string'||!path.isAbsolute(lockDir)||!Number.isInteger(maxWaitMs)||maxWaitMs<1||!Number.isInteger(retryMs)||retryMs<1)
    throw new AdmissionError('CONFIG_INVALID');
  this.lockDir=lockDir;this.ownerPath=path.join(lockDir,'owner.json');this.maxWaitMs=maxWaitMs;this.retryMs=retryMs;
 }
 async acquire({fingerprint,token}={}){
  if(typeof fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(fingerprint))throw new AdmissionError('FINGERPRINT_INVALID');
  if(cancelled(token))throw new AdmissionError('CANCELLED_NOT_DISPATCHED');
  await fs.mkdir(path.dirname(this.lockDir),{recursive:true});
  const started=Date.now();
  for(;;){
   let elected=false;
   try{await fs.mkdir(this.lockDir);elected=true}catch(e){if(e?.code!=='EEXIST')throw new AdmissionError('LOCK_DIRECTORY_UNAVAILABLE',e)}
   if(elected){
    const handle={token:crypto.randomUUID(),fingerprint};
    const owner={schema:'livingos.local-native-admission.v1',...handle,pid:process.pid,phase:'CLAIMED',acquiredAt:new Date().toISOString()};
    try{await fs.writeFile(this.ownerPath,JSON.stringify(owner),{flag:'wx',mode:0o600})}
    catch(e){throw new AdmissionError('OWNER_WRITE_UNKNOWN_DO_NOT_REPLAY',e)}
    return handle;
   }
   let owner=null;
   try{owner=JSON.parse(await fs.readFile(this.ownerPath,'utf8'))}catch(e){if(e?.code!=='ENOENT')throw new AdmissionError('OWNER_UNVERIFIED_DO_NOT_REPLAY',e)}
   if(owner!==null){
    if(typeof owner.token!=='string'||typeof owner.fingerprint!=='string'||typeof owner.phase!=='string')
      throw new AdmissionError('OWNER_UNVERIFIED_DO_NOT_REPLAY');
    if(owner.fingerprint===fingerprint)throw new AdmissionError('DUPLICATE_INFLIGHT_NOT_DISPATCHED');
   }
   const elapsed=Date.now()-started;
   if(elapsed>=this.maxWaitMs)throw new AdmissionError('WAIT_EXPIRED_NOT_DISPATCHED');
   await pause(Math.min(this.retryMs,Math.max(1,this.maxWaitMs-elapsed)),token);
  }
 }
 async markDispatch(handle){
  let owner;
  try{owner=JSON.parse(await fs.readFile(this.ownerPath,'utf8'))}catch(e){throw new AdmissionError('OWNER_UNVERIFIED_DO_NOT_REPLAY',e)}
  if(owner.token!==handle.token||owner.fingerprint!==handle.fingerprint||owner.phase!=='CLAIMED')
    throw new AdmissionError('OWNER_MISMATCH_DO_NOT_REPLAY');
  owner.phase='DISPATCHING';owner.dispatchedAt=new Date().toISOString();
  try{await fs.writeFile(this.ownerPath,JSON.stringify(owner),{flag:'w',mode:0o600})}
  catch(e){throw new AdmissionError('DISPATCH_MARK_UNKNOWN_DO_NOT_REPLAY',e)}
 }
 async releaseSuccess(handle){
  let owner;
  try{owner=JSON.parse(await fs.readFile(this.ownerPath,'utf8'))}catch(e){throw new AdmissionError('RELEASE_OWNER_UNKNOWN',e)}
  if(owner.token!==handle.token||owner.fingerprint!==handle.fingerprint||owner.phase!=='DISPATCHING')
    throw new AdmissionError('RELEASE_OWNER_MISMATCH');
  await fs.unlink(this.ownerPath);await fs.rmdir(this.lockDir);
 }
 async run({fingerprint,token,dispatch}){
  if(typeof dispatch!=='function')throw new AdmissionError('DISPATCH_INVALID');
  const handle=await this.acquire({fingerprint,token});
  await this.markDispatch(handle);
  let result;
  try{result=await dispatch()}catch(e){throw new AdmissionError('DELIVERY_UNKNOWN_DO_NOT_REPLAY',e)}
  await this.releaseSuccess(handle);
  return result;
 }
}
module.exports={SharedNativeAdmission,AdmissionError,DEFAULT_LOCK_DIR,fingerprintNativePrompt,isNotDispatched};

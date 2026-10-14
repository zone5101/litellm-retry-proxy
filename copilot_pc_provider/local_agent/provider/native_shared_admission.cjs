'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const DEFAULT_ROOT=path.join(os.tmpdir(),'chatgpt_renderer_isolation_20261013');
const DEFAULT_LOCK_DIR=path.join(DEFAULT_ROOT,'local-agent-native-renderer-admission.lock');
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
 constructor({lockDir=DEFAULT_LOCK_DIR,outcomeLog,maxWaitMs=95000,retryMs=120}={}){
  if(typeof lockDir!=='string'||!path.isAbsolute(lockDir)||!Number.isInteger(maxWaitMs)||maxWaitMs<1||!Number.isInteger(retryMs)||retryMs<1)
    throw new AdmissionError('CONFIG_INVALID');
  outcomeLog=outcomeLog||path.join(path.dirname(lockDir),'local-agent-native-renderer-outcomes.jsonl');
  if(typeof outcomeLog!=='string'||!path.isAbsolute(outcomeLog))throw new AdmissionError('CONFIG_INVALID');
  this.lockDir=lockDir;this.ownerPath=path.join(lockDir,'owner.json');this.recoveryPath=path.join(lockDir,'recovery.json');this.outcomeLog=outcomeLog;this.maxWaitMs=maxWaitMs;this.retryMs=retryMs;
 }
 async writeOutcome(owner,outcome){
  const record={schema:'livingos.local-native-request-outcome.v1',at:new Date().toISOString(),ownerToken:owner.token,
   requestId:owner.requestId??null,route:owner.route??null,sessionId:owner.sessionId??null,
   conversationId:owner.conversationId??null,fingerprint:owner.fingerprint,
   outcome:outcome.outcome,terminalKind:outcome.terminalKind??null,
   terminalCode:outcome.terminalCode??null,result:outcome.result??null,
   receipt:outcome.receipt??null};
  await fs.mkdir(path.dirname(this.outcomeLog),{recursive:true});
  await fs.appendFile(this.outcomeLog,JSON.stringify(record)+'\n',{encoding:'utf8',mode:0o600});
 }
 async releaseTerminal(owner,outcome){
  if(!owner||outcome?.ownerToken!==owner.token||outcome?.ownerFingerprint!==owner.fingerprint||
     typeof outcome?.requestId!=='string'||!['terminal','error'].includes(outcome?.terminalKind)||
     outcome?.receipt?.schema!=='livingos.renderer-terminal-receipt.v1'||
     outcome?.receipt?.source!=='renderer-bridge-audit'||outcome?.receipt?.requestId!==outcome?.requestId||
     outcome?.receipt?.terminalKind!==outcome?.terminalKind||!/^[a-f0-9]{64}$/.test(outcome?.receipt?.eventSha256||''))
    throw new AdmissionError('RECOVERY_EVIDENCE_INVALID_DO_NOT_REPLAY');
  const claim={schema:'livingos.local-native-recovery-claim.v1',ownerToken:owner.token,
   ownerFingerprint:owner.fingerprint,pid:process.pid,requestId:outcome.requestId,
   receiptSha256:outcome.receipt.eventSha256,createdAt:new Date().toISOString()};
  try{await fs.writeFile(this.recoveryPath,JSON.stringify(claim),{flag:'wx',mode:0o600})}
  catch(e){if(e?.code==='EEXIST'||e?.code==='ENOENT')return false;throw new AdmissionError('RECOVERY_CLAIM_UNAVAILABLE_DO_NOT_REPLAY',e)}
  let ownerRemoved=false;
  try{
  let current;
  try{current=JSON.parse(await fs.readFile(this.ownerPath,'utf8'))}catch(e){throw new AdmissionError('RECOVERY_OWNER_UNKNOWN_DO_NOT_REPLAY',e)}
  if(current.token!==owner.token||current.fingerprint!==owner.fingerprint||current.phase!=='DISPATCHING')
    throw new AdmissionError('RECOVERY_OWNER_MISMATCH_DO_NOT_REPLAY');
  await this.writeOutcome({...owner,requestId:outcome.requestId},outcome);
  await fs.unlink(this.ownerPath);ownerRemoved=true;
  await fs.unlink(this.recoveryPath);await fs.rmdir(this.lockDir);
  return true;
  }catch(e){
   if(!ownerRemoved){try{const claimNow=JSON.parse(await fs.readFile(this.recoveryPath,'utf8'));if(claimNow.ownerToken===owner.token&&claimNow.pid===process.pid)await fs.unlink(this.recoveryPath)}catch{}}
   throw e;
  }
 }
 async finishInterruptedRecovery(){
  let claim;try{claim=JSON.parse(await fs.readFile(this.recoveryPath,'utf8'))}catch(e){if(e?.code==='ENOENT')return false;throw new AdmissionError('RECOVERY_CLAIM_UNVERIFIED_DO_NOT_REPLAY',e)}
  if(claim.schema!=='livingos.local-native-recovery-claim.v1'||typeof claim.ownerToken!=='string'||typeof claim.ownerFingerprint!=='string'||!Number.isInteger(claim.pid)||claim.pid<=0)
   throw new AdmissionError('RECOVERY_CLAIM_UNVERIFIED_DO_NOT_REPLAY');
  let current=null;try{current=JSON.parse(await fs.readFile(this.ownerPath,'utf8'))}catch(e){if(e?.code!=='ENOENT')throw new AdmissionError('RECOVERY_OWNER_UNVERIFIED_DO_NOT_REPLAY',e)}
  if(current===null){
   let records=[];try{records=(await fs.readFile(this.outcomeLog,'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse)}catch(e){if(e?.code!=='ENOENT')throw new AdmissionError('RECOVERY_OUTCOME_UNVERIFIED_DO_NOT_REPLAY',e)}
   const committed=records.some(r=>r.ownerToken===claim.ownerToken&&r.fingerprint===claim.ownerFingerprint&&r.requestId===claim.requestId&&r.receipt?.eventSha256===claim.receiptSha256);
   if(!committed)throw new AdmissionError('RECOVERY_COMMIT_MISSING_DO_NOT_REPLAY');
   await fs.unlink(this.recoveryPath);await fs.rmdir(this.lockDir);return true;
  }
  if(current.token!==claim.ownerToken||current.fingerprint!==claim.ownerFingerprint)
   throw new AdmissionError('RECOVERY_CLAIM_OWNER_MISMATCH_DO_NOT_REPLAY');
  let alive=true;try{process.kill(claim.pid,0)}catch(e){if(e?.code==='ESRCH')alive=false;else if(e?.code!=='EPERM')throw new AdmissionError('RECOVERY_CLAIM_PROCESS_UNVERIFIED_DO_NOT_REPLAY',e)}
  if(alive)return true;
  await fs.unlink(this.recoveryPath);return false;
 }
 async acquire({fingerprint,token,requestId,route,sessionId,conversationId,reconcile}={}){
  if(typeof fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(fingerprint))throw new AdmissionError('FINGERPRINT_INVALID');
  if(cancelled(token))throw new AdmissionError('CANCELLED_NOT_DISPATCHED');
  await fs.mkdir(path.dirname(this.lockDir),{recursive:true});
  const started=Date.now();let lastRecoveryCheck=0;
  for(;;){
   const recovering=await this.finishInterruptedRecovery();
   if(recovering){
    const elapsed=Date.now()-started;if(elapsed>=this.maxWaitMs)throw new AdmissionError('WAIT_EXPIRED_NOT_DISPATCHED');
    await pause(Math.min(this.retryMs,Math.max(1,this.maxWaitMs-elapsed)),token);continue;
   }
   let elected=false;
   try{await fs.mkdir(this.lockDir);elected=true}catch(e){if(e?.code!=='EEXIST')throw new AdmissionError('LOCK_DIRECTORY_UNAVAILABLE',e)}
   if(elected){
    const handle={token:crypto.randomUUID(),fingerprint};
    const owner={schema:'livingos.local-native-admission.v1',...handle,pid:process.pid,phase:'CLAIMED',acquiredAt:new Date().toISOString(),
     requestId:requestId??null,route:route??null,sessionId:sessionId??null,conversationId:conversationId??null};
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
    if(owner.phase==='DISPATCHING'&&typeof reconcile==='function'&&Date.now()-lastRecoveryCheck>=Math.max(250,this.retryMs*2)){
     lastRecoveryCheck=Date.now();
     let evidence=null;try{evidence=await reconcile(owner)}catch(e){throw new AdmissionError('RECONCILIATION_UNAVAILABLE_DO_NOT_REPLAY',e)}
     if(evidence){
      await this.releaseTerminal(owner,evidence);
      if(owner.fingerprint===fingerprint)throw new AdmissionError('TERMINAL_REQUEST_DO_NOT_REPLAY');
      continue;
     }
    }
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
 async releaseSuccess(handle,result){
  let owner;
  try{owner=JSON.parse(await fs.readFile(this.ownerPath,'utf8'))}catch(e){throw new AdmissionError('RELEASE_OWNER_UNKNOWN',e)}
  if(owner.token!==handle.token||owner.fingerprint!==handle.fingerprint||owner.phase!=='DISPATCHING')
    throw new AdmissionError('RELEASE_OWNER_MISMATCH');
  await this.writeOutcome(owner,{outcome:'SUCCEEDED',terminalKind:'terminal',result,
   receipt:{schema:'local-native-dispatch.v1',verified:true,requestId:owner.requestId??null}});
  await fs.unlink(this.ownerPath);await fs.rmdir(this.lockDir);
 }
 async run({fingerprint,token,dispatch,requestId,route,sessionId,conversationId,reconcile}){
  if(typeof dispatch!=='function')throw new AdmissionError('DISPATCH_INVALID');
  const handle=await this.acquire({fingerprint,token,requestId,route,sessionId,conversationId,reconcile});
  await this.markDispatch(handle);
  let result;
  try{result=await dispatch()}catch(e){throw new AdmissionError('DELIVERY_UNKNOWN_DO_NOT_REPLAY',e)}
  await this.releaseSuccess(handle,result);
  return result;
 }
}
module.exports={SharedNativeAdmission,AdmissionError,DEFAULT_LOCK_DIR,fingerprintNativePrompt,isNotDispatched};

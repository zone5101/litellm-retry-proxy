'use strict';
// Shared native renderer gate across separate VS Code extension hosts.
// Atomic directory creation selects one owner; age never grants lock recovery.
// Unknown delivery keeps the lock for explicit reconciliation, with no replay.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const DEFAULT_LOCK_DIR = path.join(os.tmpdir(),
  'chatgpt_renderer_isolation_20261013', 'local-agent-native-renderer-admission.lock');

class AdmissionError extends Error {
  constructor(code, cause) {
    super('LOCAL_AGENT_SHARED_ADMISSION_' + code, {cause});
    this.name = 'AdmissionError';
    this.code = code;
  }
}

const isCancelled=signal=>signal?.aborted===true||signal?.isCancellationRequested===true;
function subscribeCancel(signal,handler){
  if(typeof signal?.addEventListener==='function'){
    signal.addEventListener('abort',handler,{once:true});
    return ()=>signal.removeEventListener?.('abort',handler);
  }
  if(typeof signal?.onCancellationRequested==='function'){
    const disposable=signal.onCancellationRequested(handler);
    return ()=>disposable?.dispose?.();
  }
  return ()=>{};
}
function pause(ms, signal) {
  return new Promise((resolve,reject)=>{
    if(isCancelled(signal))return reject(new AdmissionError('CANCELLED_NOT_DISPATCHED'));
    let cleanup=()=>{};
    const cancel=()=>{clearTimeout(timer);cleanup();reject(new AdmissionError('CANCELLED_NOT_DISPATCHED'));};
    const timer=setTimeout(()=>{cleanup();resolve();},ms);
    cleanup=subscribeCancel(signal,cancel);
  });
}

class SharedNativeAdmission {
  constructor({lockDir=DEFAULT_LOCK_DIR,maxWaitMs=95000,retryMs=120}={}) {
    if(typeof lockDir!=='string'||!path.isAbsolute(lockDir)||
       !Number.isInteger(maxWaitMs)||maxWaitMs<1||
       !Number.isInteger(retryMs)||retryMs<1) throw new AdmissionError('CONFIG_INVALID');
    this.lockDir=lockDir;
    this.ownerPath=path.join(lockDir,'owner.json');
    this.maxWaitMs=maxWaitMs;
    this.retryMs=retryMs;
  }

  async acquire({fingerprint,signal}={}) {
    if(typeof fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(fingerprint))
      throw new AdmissionError('FINGERPRINT_INVALID');
    if(isCancelled(signal)) throw new AdmissionError('CANCELLED_NOT_DISPATCHED');
    const start=Date.now();
    for(;;) {
      let elected=false;
      try { await fs.mkdir(this.lockDir); elected=true; }
      catch(err) {
        if(err?.code!=='EEXIST') throw new AdmissionError('LOCK_DIRECTORY_UNAVAILABLE',err);
      }
      if(elected) {
        const token=crypto.randomUUID();
        const owner={schema:'livingos.local-native-admission.v1',token,fingerprint,
          pid:process.pid,acquiredAt:new Date().toISOString()};
        try {
          await fs.writeFile(this.ownerPath,JSON.stringify(owner),{flag:'wx',mode:0o600});
        } catch(err) {
          // No cleanup: cannot prove whether lock ownership was established.
          throw new AdmissionError('OWNER_WRITE_UNKNOWN_DO_NOT_REPLAY',err);
        }
        return {token,fingerprint};
      }

      // A missing owner file can be a short election race, not a free lock.
      let owner=null;
      try {owner=JSON.parse(await fs.readFile(this.ownerPath,'utf8'));}
      catch(err) {
        if(err?.code!=='ENOENT') throw new AdmissionError('OWNER_UNVERIFIED_DO_NOT_REPLAY',err);
      }
      if(owner!==null) {
        if(typeof owner.token!=='string'||!/^[a-f0-9-]{36}$/.test(owner.token)||
           typeof owner.fingerprint!=='string')
          throw new AdmissionError('OWNER_UNVERIFIED_DO_NOT_REPLAY');
        if(owner.fingerprint===fingerprint) throw new AdmissionError('DUPLICATE_INFLIGHT_NOT_DISPATCHED');
      }
      const elapsed=Date.now()-start;
      if(elapsed>=this.maxWaitMs) throw new AdmissionError('WAIT_EXPIRED_NOT_DISPATCHED');
      await pause(Math.min(this.retryMs,Math.max(1,this.maxWaitMs-elapsed)),signal);
    }
  }

  async releaseSuccess(handle) {
    if(!handle||typeof handle.token!=='string') throw new AdmissionError('INVALID_RELEASE_HANDLE');
    let owner;
    try {owner=JSON.parse(await fs.readFile(this.ownerPath,'utf8'));}
    catch(err) {throw new AdmissionError('RELEASE_OWNER_UNKNOWN',err);}
    if(owner.token!==handle.token||owner.fingerprint!==handle.fingerprint)
      throw new AdmissionError('RELEASE_OWNER_MISMATCH');
    try { await fs.unlink(this.ownerPath); await fs.rmdir(this.lockDir); }
    catch(err) {throw new AdmissionError('RELEASE_INCOMPLETE_RECONCILE_REQUIRED',err);}
  }

  // Dispatch must cover native terminal ACK plus child shutdown, not just request send.
  // Any dispatch error is UNKNOWN; preserve lock, never auto-reclaim by elapsed time.
  async run({fingerprint,signal,dispatch}) {
    if(typeof dispatch!=='function') throw new AdmissionError('DISPATCH_INVALID');
    const handle=await this.acquire({fingerprint,signal});
    let completed=false,result;
    try {result=await dispatch();completed=true;}
    catch(err) {throw new AdmissionError('DELIVERY_UNKNOWN_DO_NOT_REPLAY',err);}
    finally {if(completed) await this.releaseSuccess(handle);}
    return result;
  }
}
module.exports={SharedNativeAdmission,AdmissionError,DEFAULT_LOCK_DIR};

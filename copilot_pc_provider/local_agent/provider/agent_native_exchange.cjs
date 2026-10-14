'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const cp=require('node:child_process');
const rl=require('node:readline');
const {SharedNativeAdmission,fingerprintNativePrompt}=require('./native_shared_admission.cjs');
const {reconcileRendererRequest}=require('./native_renderer_reconciler.cjs');
const sharedNativeAdmission=new SharedNativeAdmission();
const runtime=path.join(os.tmpdir(),'chatgpt_renderer_isolation_20261013','scope-probe-v11-app','renderer-bridge-runtime.json');
const client=path.join(__dirname,'chatgpt_pc_pipe_probe_v11.cjs');
const fail=reason=>{throw Error('REA_NATIVE_EXCHANGE_'+reason)};
async function exchangeUnlocked({requestId,sessionId,conversationId=null,prompt,token}){
 if(!sessionId||typeof sessionId!=='string'||!/^agent\.[a-f0-9]{24}$/.test(sessionId)||
    conversationId!==null&&(typeof conversationId!=='string'||conversationId.length>128)||
    typeof prompt!=='string'||!prompt.trim()||Buffer.byteLength(prompt)>8192)
   fail('INPUT_REJECTED');
 if(!fs.existsSync(runtime)||!fs.existsSync(client))fail('RUNTIME_MISSING');
 requestId=requestId||'v11req_'+crypto.randomBytes(12).toString('hex');
 const child=cp.spawn(process.execPath,[client],{windowsHide:true,env:{...process.env,CHATGPT_PC_BRIDGE_RUNTIME:runtime},stdio:['pipe','pipe','pipe']});
 const onCancel=token?.onCancellationRequested?.(()=>child.kill());
 let bound=null,body='',terminal=null,unexpectedStderr=false,spawnError=null,toolSeen=false;
 child.once('error',e=>{spawnError=String(e.code||'SPAWN_FAILED')});
 child.stderr.on('data',()=>unexpectedStderr=true);
 const closed=new Promise(resolve=>child.once('close',code=>resolve(code)));
 child.stdin.end(JSON.stringify({request_id:requestId,session_id:sessionId,conversation_id:conversationId,prompt})+'\n');
 try{
   const lines=rl.createInterface({input:child.stdout,crlfDelay:Infinity});
   for await(const line of lines){
     let event;
     try{event=JSON.parse(line)}catch{fail('FRAME_INVALID')}
     if(event.kind==='conversation_bound'){
       if(bound!==null||typeof event.conversation_id!=='string'||event.conversation_id.length>128||
         event.reused!==(conversationId!==null)||conversationId!==null&&conversationId!==event.conversation_id)
         fail('CONVERSATION_MISMATCH');
       bound=event.conversation_id;
     }else if(event.kind==='delta'){
       if(!bound||typeof event.text!=='string')fail('DELTA_UNBOUND');
       body+=event.text;
       if(Buffer.byteLength(body)>262144)fail('RESPONSE_SIZE_EXCEEDED');
     }else if(event.kind==='native_tool_seen'){
       toolSeen=true;
       fail('UNSUPPORTED_NATIVE_TOOL_INTENT_DO_NOT_REPLAY');
     }else if(event.kind==='ywi_submitted'){
       fail('UNAUTHORIZED_CONTINUATION_DO_NOT_REPLAY');
     }else if(event.kind==='finished'){
       if(!bound||terminal!==null||event.conversation_id!==bound||
         event.reused!==(conversationId!==null)||event.host_tool_executed!==false||
         event.ywi_continuation===true)fail('TERMINAL_INVALID');
       terminal=event;
     }else if(event.kind==='error'){
       fail('UPSTREAM_'+String(event.code||'UNKNOWN').slice(0,100));
     }else fail('UNRECOGNIZED_FRAME');
   }
   const exitCode=await closed;
   if(spawnError||unexpectedStderr||exitCode!==0||!terminal||!body.trim()||toolSeen)
     fail('UNKNOWN_DO_NOT_REPLAY');
   return {conversationId:bound,text:body,reused:terminal.reused};
 }catch(error){
   child.kill();
   throw error;
 }finally{onCancel?.dispose?.()}
}
async function exchange(args){
 const {sessionId,conversationId=null,prompt,token}=args||{};
 if(!sessionId||typeof sessionId!=='string'||!/^agent\.[a-f0-9]{24}$/.test(sessionId)||conversationId!==null&&(typeof conversationId!=='string'||conversationId.length>128)||typeof prompt!=='string'||!prompt.trim()||Buffer.byteLength(prompt)>8192)fail('INPUT_REJECTED');
 if(!fs.existsSync(runtime)||!fs.existsSync(client))fail('RUNTIME_MISSING');
 const requestId='v11req_'+crypto.randomBytes(12).toString('hex');
 return sharedNativeAdmission.run({fingerprint:fingerprintNativePrompt('agent',conversationId,prompt),token,
  requestId,route:'agent',sessionId,conversationId,reconcile:reconcileRendererRequest,
  dispatch:()=>exchangeUnlocked({...args,requestId})});
}
module.exports={exchange};

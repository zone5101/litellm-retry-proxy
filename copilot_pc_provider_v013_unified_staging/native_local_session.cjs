'use strict';
const vscode=require('vscode'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),rl=require('node:readline');
const {makePrompt}=require('./protocol.cjs');
const {DurableSessionBinding}=require('./durable_session_binding.cjs');
const {SharedNativeAdmission,fingerprintNativePrompt,isNotDispatched}=require('./native_shared_admission.cjs');
const {reconcileRendererRequest}=require('./native_renderer_reconciler.cjs');
const sharedNativeAdmission=new SharedNativeAdmission();
let registry;
function initSessionJournal(storeDir){if(registry)return;registry=new DurableSessionBinding({storeDir,maxSessions:16});}
function closeSessionJournal(){registry?.close();registry=null;}
const runtime=path.join(os.tmpdir(),'chatgpt_renderer_isolation_20261013','scope-probe-v11-app','renderer-bridge-runtime.json');
const client=path.join(__dirname,'chatgpt_pc_pipe_probe_v11.cjs');
const makeError=x=>Error('REA_V6_SESSION_'+x);
let auditSink=()=>{};function audit(stage,detail=''){auditSink('native.'+stage,{detail})}
async function runClient(turn,progress,token){
 if(!fs.existsSync(runtime)||!fs.existsSync(client))throw makeError('ISOLATED_V11_RUNTIME_NOT_READY');
 const d=JSON.parse(fs.readFileSync(runtime,'utf8'));
 if(!d||typeof d.pipe!=='string'||!Number.isInteger(d.pid)||d.pid<=0)throw makeError('DESCRIPTOR_INVALID');
 const child=cp.spawn(process.execPath,[client],{windowsHide:true,env:{...process.env,CHATGPT_PC_BRIDGE_RUNTIME:runtime},stdio:['pipe','pipe','pipe']});
 let bound=null,terminal=null,body='',sawError=null,hadStderr=false;
 const onCancel=token?.onCancellationRequested?.(()=>{child.kill();});
 const exit=new Promise(resolve=>child.once('close',code=>resolve(code)));
 child.once('error',e=>{sawError='CLIENT_SPAWN_'+String(e.code||'failed')});
 child.stderr.on('data',()=>{hadStderr=true}); // Never print runtime descriptor, prompt, or secrets.
 child.stdin.end(JSON.stringify({request_id:turn.requestId,session_id:turn.sessionId,
    conversation_id:turn.conversationId,prompt:turn.prompt})+'\n');
 try{
  const lines=rl.createInterface({input:child.stdout,crlfDelay:Infinity});
  for await(const line of lines){
   let f;try{f=JSON.parse(line)}catch{throw makeError('BAD_FRAME')}
   if(f.kind==='conversation_bound'){
    if(bound||typeof f.conversation_id!=='string'||
       turn.conversationId!=null&&f.conversation_id!==turn.conversationId||
       f.reused!==(turn.conversationId!=null))throw makeError('CONVERSATION_ID_MISMATCH');
    registry.recordBound(turn,f.conversation_id);
    bound=f.conversation_id;
   }else if(f.kind==='delta'){
    if(!bound||typeof f.text!=='string')throw makeError('UNBOUND_TEXT');
    registry.recordDelta(turn,f.text); // durable journal BEFORE Copilot UI display
    body+=f.text;if(Buffer.byteLength(body)>262144)throw makeError('RESPONSE_TOO_BIG');
    progress.report(new vscode.LanguageModelTextPart(f.text));
   }else if(f.kind==='finished'){
    if(terminal||!bound||f.conversation_id!==bound||f.host_tool_executed!==false)
      throw makeError('TERMINAL_INVALID');
    terminal=f;
   }else if(f.kind==='error'){
    throw makeError('NATIVE_'+String(f.code||'unknown'));
   }else if(f.kind==='native_tool_seen'||f.kind==='ywi_submitted'){
    // Diagnostic only. NEVER translate this into a host ToolCallPart.
   }else throw makeError('FRAME_UNKNOWN');
  }
  const code=await exit;
  if(sawError||code!==0||hadStderr||!terminal||!body.trim())throw makeError('INCOMPLETE_UNKNOWN_DO_NOT_REPLAY');
  registry.complete(turn,bound,body);
  audit('session.turn.pass',`reused=${String(terminal.reused)}; chars=${body.length}`);
 }catch(e){
  registry.unknown(turn);child.kill();audit('session.turn.fail','UNKNOWN_DO_NOT_REPLAY');throw e;
 }finally{onCancel?.dispose?.()}
}
async function provideLocal(messages,options,progress,token,logger){
 if(!registry)throw makeError('JOURNAL_NOT_INITIALIZED');
 auditSink=logger;
 if(options?.tools?.length||options?.toolMode?.kind==='required')throw makeError('LOCAL_TOOLS_UNSUPPORTED');
 if(token?.isCancellationRequested)throw makeError('CANCELLED_BEFORE_DISPATCH');
 const turn=registry.admit(messages);
 if(turn.conversationId===null)turn.prompt=makePrompt(messages);
 audit('request.admitted','reused='+(turn.conversationId!==null));
 try{await sharedNativeAdmission.run({fingerprint:fingerprintNativePrompt('text',turn.conversationId,turn.prompt),token,
  requestId:turn.requestId,route:'text',sessionId:turn.sessionId,conversationId:turn.conversationId,
  reconcile:reconcileRendererRequest,dispatch:()=>runClient(turn,progress,token)});}catch(error){if(isNotDispatched(error))registry.notDispatched(turn);throw error;}
}
module.exports={provideLocal,initSessionJournal,closeSessionJournal};

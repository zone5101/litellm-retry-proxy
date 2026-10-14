'use strict';
// Isolated Copilot provider. This never changes production ChatGPT or LiteLLM :4000.
// Native tools/agent continuation are NOT advertised until independently verified.
const vscode = require('vscode');
const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
const net = require('node:net'), crypto = require('node:crypto'), cp = require('node:child_process');
const {makePrompt, readSSE} = require('./protocol.cjs');
const {provideLocal}=require('./native_local_session.cjs');
const {LocalAgentBridge}=require('./agent_provider.cjs');
const localAgentBridge=new LocalAgentBridge();
const {SharedNativeAdmission}=require('./native_shared_admission.cjs');
const nativeAdmission=new SharedNativeAdmission();
function nativeFingerprint(messages,options){
  const payload={
    messages:Array.isArray(messages)?messages.map(m=>({
      role:m?.role,
      name:typeof m?.name==='string'?m.name:null,
      content:Array.isArray(m?.content)?m.content.map(p=>({
        text:typeof p?.value==='string'?p.value:null,
        callId:typeof p?.callId==='string'?p.callId:null,
        toolName:typeof p?.name==='string'?p.name:null,
        input:p?.input&&typeof p.input==='object'?p.input:null
      })):[]
    })):[],
    tools:Array.isArray(options?.tools)?options.tools.map(t=>t?.name):[],
    toolMode:options?.toolMode?.kind??null
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
const {validateReferences, countOmittedHistory} = require('./participant-context.cjs');
const PORT = 19493, VENDOR = 'chatgpt-pc-isolated', MODEL = 'chatgpt-pc-chat';
const SOURCE_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ROOT = path.join(os.homedir(), '.litellm-retry-proxy.worktrees', 'chatgpt-pc-chat-adapter-20261013');
const CONFIGURED_ROOT = vscode.workspace.getConfiguration('chatgptPcStaging').get('repoRoot', '');
const ROOT = CONFIGURED_ROOT || (fs.existsSync(path.join(SOURCE_ROOT,'chatgpt_pc_staging.yaml'))
  ? SOURCE_ROOT : DEFAULT_ROOT);
const RUNTIME = path.join(os.tmpdir(), 'chatgpt_renderer_isolation_20261013', 'scope-probe-v6-app', 'renderer-bridge-runtime.json');
const CLI = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'Scripts', 'litellm.exe');

function tcpReady() {
  return new Promise(resolve => {
    const socket = net.createConnection({host:'127.0.0.1',port:PORT});
    socket.setTimeout(650);
    socket.once('connect',()=>{socket.destroy();resolve(true);});
    socket.once('error',()=>{socket.destroy();resolve(false);});
    socket.once('timeout',()=>{socket.destroy();resolve(false);});
  });
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function abortError() {return new Error('PC_PROVIDER_CANCELLED');}

class StageOwner {
  constructor() {this.child=null;this.key=null;this.starting=null;}
  async start() {
    if (this.child && this.child.exitCode === null && this.key) return this.key;
    if (this.starting) return this.starting;
    this.starting=this._start().finally(()=>this.starting=null);
    return this.starting;
  }
  async _start() {
    if (!fs.existsSync(RUNTIME) || !fs.existsSync(CLI)
        || !fs.existsSync(path.join(ROOT,'chatgpt_pc_staging.yaml'))) throw new Error('PC_PROVIDER_ISOLATED_RUNTIME_MISSING');
    const descriptor=JSON.parse(fs.readFileSync(RUNTIME,'utf8'));
    if (!descriptor.pid || !descriptor.pipe || !descriptor.token) throw new Error('PC_PROVIDER_DESCRIPTOR_INVALID');
    // Never attach to an unknown listener, and never stop a process we did not start.
    if (await tcpReady()) throw new Error('PC_PROVIDER_PORT_ALREADY_OWNED');
    this.key='sk-'+crypto.randomBytes(24).toString('hex');
    const env={...process.env, CHATGPT_PC_BRIDGE_RUNTIME:RUNTIME, LITELLM_MASTER_KEY:this.key,
      PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',NO_COLOR:'1'};
    this.child=cp.spawn(CLI,['--config',path.join(ROOT,'chatgpt_pc_staging.yaml'),'--host','127.0.0.1','--port',String(PORT)],
      {cwd:ROOT,env,windowsHide:true,stdio:'ignore'});
    const pid=this.child.pid;
    try {
      for (let i=0;i<55;i++) {
        if (this.child.exitCode !== null) throw new Error('PC_PROVIDER_STAGE_EXIT_'+this.child.exitCode);
        if (await tcpReady()) {
          try {
            const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),1300);
            let response;
            try {response=await fetch('http://127.0.0.1:'+PORT+'/v1/models',
              {headers:{Authorization:'Bearer '+this.key},signal:ctrl.signal});}
            finally {clearTimeout(timer);}
            if (response.ok) {
              const data=await response.json();
              if (data.data?.some(m=>m.id===MODEL)) return this.key;
            }
          } catch (_) {/* listener alive, wait for readiness */}
        }
        await pause(800);
      }
      throw new Error('PC_PROVIDER_STAGE_START_TIMEOUT');
    } catch(e) {
      this.stop();
      throw e;
    }
  }
  stop() {
    if (this.child && this.child.exitCode === null) this.child.kill();
    this.child=null;this.key=null;
  }
}
const owner=new StageOwner();
let output;
const AUDIT_PATH = path.join(os.tmpdir(), 'chatgpt_renderer_isolation_20261013', 'copilot-provider-events.jsonl');
function audit(stage, data={}) {
  const event = {at:new Date().toISOString(), stage, ...data};
  try {output?.appendLine(JSON.stringify(event));} catch (_) {}
  try {
    fs.mkdirSync(path.dirname(AUDIT_PATH), {recursive:true});
    fs.appendFileSync(AUDIT_PATH, JSON.stringify(event)+'\n', {encoding:'utf8'});
  } catch (_) {}
}
const provider={
 async provideLanguageModelChatInformation() {
   return [{id:MODEL,name:'ChatGPT PC â€” Local Agent preview',family:'chatgpt-pc-text',version:'v6-agent-preview-010',
     detail:'EXPERIMENTAL Local Agent adapter; tool execution not E2E verified',maxInputTokens:2048,maxOutputTokens:1024,
     isBYOK:true,isUserSelectable:true,capabilities:{toolCalling:true,imageInput:false}}];
 },
 async provideTokenCount(_model,text) {
   return Math.max(1,Math.ceil(Buffer.byteLength(typeof text==='string'?text:String(text||''),'utf8')/3));
 },
 async provideLanguageModelChatResponse(_model,messages,options,progress,token) {
   const id=crypto.randomBytes(5).toString('hex');
   audit('request.enter',{id,messageCount:Array.isArray(messages)?messages.length:null,requestedTools:Array.isArray(options?.tools)?options.tools.length:0});
   try {
     await nativeAdmission.run({
       fingerprint:nativeFingerprint(messages,options),
       signal:token,
       dispatch:async()=>{
         if(Array.isArray(options?.tools)&&options.tools.length)
           return localAgentBridge.provide(messages,options,progress,token,vscode);
         return provideLocal(messages,options,progress,token,audit);
       }
     });
     audit('request.pass',{id,transport:'native-session'});
   } catch(error) {
     audit('request.fail',{id,transport:'native-session',errorCode:String(error?.message||error).slice(0,120)});
     throw error;
   }

 }

};
const PARTICIPANT_ID = 'chatgpt-pc-staging-copilot.chatgptpc';
async function handleDirectChat(request, context, stream, token) {
  const id=crypto.randomBytes(5).toString('hex');
  let stage='admission', textParts=0;
  audit('participant.enter',{id, historyTurns:context?.history?.length || 0,
    referenceCount:request?.references?.length || 0});
  try {
    const {omittedReferences} = validateReferences(request);
    const omittedHistory = countOmittedHistory(context);
    if (omittedReferences || omittedHistory) {
      audit('participant.context_omitted',{id,references:omittedReferences,historyTurns:omittedHistory});
      // Stable ChatResponseStream.markdown only. Accessing warning requires the
      // proposed chatParticipantAdditions API and breaks regular VS Code.
      const notice='Only your typed text was sent to ChatGPT PC. ' +
        'VS Code references/attachments and earlier chat history were NOT included.';
      stream.markdown('> **Context omitted:** '+notice+'\n\n');
    }
    if (token?.isCancellationRequested) throw abortError();
    const prompt=makePrompt([{role:1,content:[{value:request?.prompt}]}]);
    audit('participant.admitted',{id,promptBytes:Buffer.byteLength(prompt,'utf8')});
    stage='stage_start';
    const key=await owner.start();
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),70000);
    const cancel=token?.onCancellationRequested?.(()=>controller.abort());
    try {
      stage='http_request';
      const response=await fetch('http://127.0.0.1:'+PORT+'/v1/chat/completions',{
        method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',Accept:'text/event-stream'},
        body:JSON.stringify({model:MODEL,stream:true,messages:[{role:'user',content:prompt}]}),
        signal:controller.signal
      });
      audit('participant.http',{id,status:response.status});
      if(!response.ok) throw new Error('PC_PARTICIPANT_HTTP_'+response.status);
      stage='sse';
      const terminal=await readSSE(response.body,part=>{if(part){textParts++;stream.markdown(part);}});
      audit('participant.pass',{id,textParts,doneCount:terminal.doneCount,finishReason:terminal.finishReason});
      return {metadata:{mode:'isolated-text-only',streamParts:textParts}};
    } finally {
      clearTimeout(timeout);
      cancel?.dispose?.();
    }
  } catch(e) {
    audit('participant.fail',{id,stage,errorCode:String(e?.message||e).slice(0,120)});
    throw e;
  }
}
function activate(context) {
 output=vscode.window.createOutputChannel('ChatGPT PC Staging Provider');
 context.subscriptions.push(output);
 context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(VENDOR,provider));
 context.subscriptions.push(vscode.chat.createChatParticipant(PARTICIPANT_ID,handleDirectChat));
 context.subscriptions.push(vscode.commands.registerCommand('chatgptPcStaging.stop',()=>{
   owner.stop();output.appendLine('Stopped owned staging process');}));
 context.subscriptions.push({dispose(){owner.stop();}});
 output.appendLine('Provider registered: '+VENDOR+'; model '+MODEL+'; experimentalAgent=true; toolCalling=true; E2E_UNPROVEN');
 audit('provider.activated',{vendor:VENDOR,model:MODEL,maxInputTokens:2048,toolCalling:true,agentPreview:true,e2eProven:false});
 audit('participant.registered',{participant:PARTICIPANT_ID,historySupported:false,toolCalling:false});
}
function deactivate(){owner.stop();}
module.exports={activate,deactivate};


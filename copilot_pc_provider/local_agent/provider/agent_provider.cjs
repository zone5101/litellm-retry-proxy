'use strict';
const crypto=require('node:crypto');
const {exchange}=require('./agent_native_exchange.cjs');
const {offeredTools,parseEnvelope,preparePrompt,toolResultPrompt}=require('./agent_tool_envelope.cjs');
const fail=x=>{throw Error('REA_LOCAL_AGENT_'+x)};
const recordKey=x=>JSON.stringify(x);
function normalize(messages){
 if(!Array.isArray(messages)||messages.length<1||messages.length>96)fail('MESSAGE_COUNT');
 return messages.map(m=>{
   if(![1,2,3].includes(m?.role)||!Array.isArray(m.content)||!m.content.length)fail('MESSAGE_ROLE_PARTS');
   const parts=m.content.map(p=>{
     if(typeof p?.value==='string')return {kind:'text',text:p.value};
     if(typeof p?.callId==='string'&&typeof p?.name==='string'&&p?.input&&typeof p.input==='object')
       return {kind:'call',callId:p.callId,name:p.name,input:p.input};
     if(typeof p?.callId==='string'&&Array.isArray(p?.content))
       return {kind:'result',callId:p.callId,content:p.content.map(x=>{
         if(typeof x?.value!=='string')fail('NON_TEXT_RESULT_PART');
         return x.value;
       })};
     fail('UNSUPPORTED_PART');
   });
   return {role:m.role,parts};
 });
}
function messageText(m){return m.parts.filter(p=>p.kind==='text').map(p=>p.text).join('');}
function hasKind(m,k){return m.parts.some(p=>p.kind===k);}
class LocalAgentBridge{
 constructor({nativeExchange=exchange,maxSessions=12}={}){
   this.transport=nativeExchange;
   this.entries=new Map();
   this.busy=new Set();
   this.maxSessions=maxSessions;
 }
 async provide(messages,options,progress,token,vscode){
   if(!progress||typeof progress.report!=='function'||!vscode||
      typeof vscode.LanguageModelTextPart!=='function'||typeof vscode.LanguageModelToolCallPart!=='function')
     fail('HOST_API_UNAVAILABLE');
   const current=normalize(messages);
   const last=current.at(-1);
   if(last.role!==1||token?.isCancellationRequested)fail('CANCELLED_OR_LAST_NOT_USER');
   const lastIsResult=last.parts.length===1&&hasKind(last,'result');
   const lastIsText=last.parts.every(p=>p.kind==='text')&&!lastIsResult;
   if(!lastIsResult&&!lastIsText)fail('LAST_MESSAGE_UNSUPPORTED');
   const prior=current.slice(0,-1);
   let entry,reason,prompt;
   const candidate=[...this.entries.values()].filter(e=>e.expected===recordKey(prior));
   if(candidate.length>1)fail('AMBIGUOUS_HISTORY');
   entry=candidate[0];
   if(!entry){
     if(lastIsResult||prior.some(m=>m.role===2||hasKind(m,'call')||hasKind(m,'result')))
       fail('UNBOUND_HISTORY_DO_NOT_REPLAY');
     if(this.entries.size>=this.maxSessions)fail('CAPACITY');
     const firstKey=recordKey(current);
     if([...this.entries.values()].some(e=>e.firstKey===firstKey))fail('REPLAYED_FIRST_REQUEST');
     entry={sessionId:'agent.'+crypto.randomBytes(12).toString('hex'),conversationId:null,
       state:'NEW',firstKey,expected:null,pending:null,offered:null};
     reason='new';
   }else if(entry.state==='AWAIT_RESULT'){
     if(!lastIsResult||!entry.pending)fail('TOOL_RESULT_REQUIRED');
     const result=last.parts[0];
     if(result.callId!==entry.pending.callId)fail('CALL_ID_MISMATCH');
     const value=result.content.join('\n');
     prompt=toolResultPrompt(result.callId,entry.pending.name,value);
     reason='tool_result';
   }else if(entry.state==='READY'){
     if(!lastIsText)fail('UNEXPECTED_TOOL_RESULT');
     reason='next_user';
   }else fail('BUSY_OR_UNKNOWN_DO_NOT_REPLAY');
   const descriptor=offeredTools(options?.tools||[]);
   if(entry.offered && (entry.offered.size!==descriptor.size||
     [...entry.offered.keys()].some(n=>!descriptor.has(n))))fail('TOOL_CATALOG_CHANGED');
   const offered=entry.offered||descriptor;
   if(!prompt){
     const sys=prior.filter(m=>m.role===3).map(messageText).join('\n');
     prompt=preparePrompt(messageText(last),[...offered.values()],sys);
   }
   if(this.busy.has(entry.sessionId))fail('CONCURRENT_REQUEST');
   const preDispatchState=entry.state;
   if(preDispatchState==='NEW')this.entries.set(entry.sessionId,entry);
   entry.offered=offered;
   entry.state='INFLIGHT';
   this.busy.add(entry.sessionId);
   try{
     const output=await this.transport({sessionId:entry.sessionId,conversationId:entry.conversationId,prompt,token});
     if(entry.conversationId!==null&&entry.conversationId!==output.conversationId||
       output.reused!==(entry.conversationId!==null))fail('SESSION_ID_NOT_CONTINUED');
     const action=parseEnvelope(output.text,offered);
     entry.conversationId=output.conversationId;
     if(action.kind==='tool_call'){
       entry.pending={callId:action.callId,name:action.name,input:action.input};
       entry.expected=recordKey([...current,{role:2,parts:[{kind:'call',callId:action.callId,name:action.name,input:action.input}]}]);
       entry.state='AWAIT_RESULT';
       progress.report(new vscode.LanguageModelToolCallPart(action.callId,action.name,action.input));
     }else{
       entry.pending=null;
       entry.expected=recordKey([...current,{role:2,parts:[{kind:'text',text:action.text}]}]);
       entry.state='READY';
       progress.report(new vscode.LanguageModelTextPart(action.text));
     }
     return {phase:entry.state,reused:output.reused,toolCall:action.kind==='tool_call',reason};
   }catch(error){
     const notDispatched=/_NOT_DISPATCHED(?:$|_)/.test(String(error?.code||error?.message||error));
     if(notDispatched){if(preDispatchState==='NEW')this.entries.delete(entry.sessionId);else entry.state=preDispatchState;}
     else entry.state='UNKNOWN_DO_NOT_REPLAY';
     throw error;
   }finally{this.busy.delete(entry.sessionId)}
 }
}
module.exports={LocalAgentBridge,normalize};

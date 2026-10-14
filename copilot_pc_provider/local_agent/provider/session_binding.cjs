'use strict';
// Preview-only identity binding. Never identify an existing chat by text alone
// unless the VS Code history exactly matches ONE locally recorded transcript.
const crypto=require('node:crypto');
const fail=s=>{throw Error('V11_SESSION_'+s)};
function normalize(messages){
 if(!Array.isArray(messages)||!messages.length||messages.length>80)fail('MESSAGES_INVALID');
 return messages.map(m=>{
  const role=m.role===1?'user':m.role===2?'assistant':m.role===3?'system':null;
  if(!role||!Array.isArray(m.content)||m.content.length===0||
     !m.content.every(p=>p&&typeof p.value==='string'))fail('TEXT_ONLY_REQUIRED');
  return {role,text:m.content.map(p=>p.value).join('')};
 });
}
function historyKey(v){return JSON.stringify(v)}
class SessionBinding {
 constructor({maxSessions=16}={}){this.max=maxSessions;this.entries=new Map()}
 admit(messages){
  const m=normalize(messages),last=m.at(-1);
  if(last.role!=='user'||!last.text.trim()||Buffer.byteLength(last.text)>8192)fail('PROMPT_INVALID');
  const history=m.slice(0,-1);
  let entry;
  const matches=history.length?[...this.entries.values()].filter(e=>e.expected===historyKey(history)):[];
  if(matches.length>1)fail('AMBIGUOUS_HISTORY');
  if(matches.length===1){
   entry=matches[0];
   if(entry.state!=='READY'||!entry.conversationId)fail('NOT_READY_DO_NOT_REPLAY');
  }else if(history.length===0||history.every(m=>m.role==='system')){
   // A first VS Code Local request normally has system context before its user turn.
   // This is not an assistant transcript and does not imply an existing session.
   if(this.entries.size>=this.max)fail('SESSION_CAPACITY');
   entry={sessionId:'v11.'+crypto.randomBytes(16).toString('hex'),conversationId:null,expected:null,state:'NEW'};
   this.entries.set(entry.sessionId,entry);
  }else{
   fail('UNVERIFIED_HISTORY_NO_NEW_CHAT');
  }
  const requestId='v11req_'+crypto.randomBytes(14).toString('hex');
  const previousState=entry.state;
  entry.state='INFLIGHT';entry.requestId=requestId;
  return {sessionId:entry.sessionId,conversationId:entry.conversationId,
    requestId,prompt:last.text,messages:m,entry,previousState};
 }
 complete(turn,conversationId,reply){
  const e=this.entries.get(turn.sessionId);
  if(e!==turn.entry||e.requestId!==turn.requestId||e.state!=='INFLIGHT'||
     typeof conversationId!=='string'||!conversationId||
     e.conversationId&&conversationId!==e.conversationId||
     typeof reply!=='string'||!reply.trim())fail('TERMINAL_IDENTITY_INVALID');
  e.conversationId=conversationId;
  e.expected=historyKey([...turn.messages,{role:'assistant',text:reply}]);
  e.state='READY';e.requestId=null;
 }
 notDispatched(turn){const e=this.entries.get(turn.sessionId);
  if(e!==turn.entry||e.requestId!==turn.requestId||e.state!=='INFLIGHT')fail('NOT_DISPATCHED_IDENTITY_INVALID');
  if(turn.previousState==='NEW')this.entries.delete(turn.sessionId);else{e.state=turn.previousState;e.requestId=null;}
 }
 unknown(turn){const e=this.entries.get(turn.sessionId);
  if(e===turn.entry&&e.requestId===turn.requestId){e.state='UNKNOWN_DO_NOT_REPLAY';e.requestId=null;}}
}
module.exports={SessionBinding,normalize};

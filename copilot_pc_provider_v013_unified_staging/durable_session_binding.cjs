'use strict';
// Isolated Chat Mode session journal. This is the ONLY session identity store;
// it never creates a second ChatGPT conversation or sends a native request.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {SessionBinding,normalize}=require('./session_binding.cjs');
const error=s=>{throw Error('V11_JOURNAL_'+s);};
class DurableSessionBinding extends SessionBinding {
 constructor({storeDir,maxSessions=16}={}){
  super({maxSessions});
  if(typeof storeDir!=='string'||!path.isAbsolute(storeDir))error('ABSOLUTE_STORE_REQUIRED');
  this.storeDir=storeDir;this.closed=false;this.firstPrompts=new Set();
  fs.mkdirSync(storeDir,{recursive:true});
  this.lockPath=path.join(storeDir,'chatmode-session.lock');
  this.journalPath=path.join(storeDir,'chatmode-session.jsonl');
  this.owner=crypto.randomBytes(16).toString('hex');
  try{
   const fd=fs.openSync(this.lockPath,'wx',0o600);
   try{fs.writeSync(fd,JSON.stringify({pid:process.pid,owner:this.owner})+'\n');fs.fsyncSync(fd);}
   finally{fs.closeSync(fd);}
  }catch(e){error('SINGLE_WRITER_LOCK_'+(e?.code||'ERROR'));}
  try{
   this._load();
   this.fd=fs.openSync(this.journalPath,'a',0o600);
  }catch(e){this.close();throw e;}
 }
 _assertOpen(){if(this.closed)error('CLOSED');}
 _append(event){
  this._assertOpen();
  const line=JSON.stringify({v:1,...event})+'\n';
  if(Buffer.byteLength(line)>350000)error('EVENT_TOO_LARGE');
  fs.writeSync(this.fd,line);
  fs.fsyncSync(this.fd); // Persist before UI reporting or native continuation.
 }
 _load(){
  if(!fs.existsSync(this.journalPath))return;
  const data=fs.readFileSync(this.journalPath,'utf8');
  if(data&&!data.endsWith('\n'))error('TORN_JOURNAL_DO_NOT_REPLAY');
  for(const line of data.split('\n')){
   if(!line)continue;
   let e;try{e=JSON.parse(line);}catch{error('CORRUPT_JOURNAL_DO_NOT_REPLAY');}
   if(e.v!==1||typeof e.type!=='string'||typeof e.sessionId!=='string')error('INVALID_EVENT');
   let entry=this.entries.get(e.sessionId);
   if(e.type==='begin'){
    if(!Array.isArray(e.messages)||typeof e.requestId!=='string'||!e.requestId)error('INVALID_BEGIN');
    if(!entry){
     if(this.entries.size>=this.max)error('SESSION_CAPACITY');
     entry={sessionId:e.sessionId,conversationId:e.conversationId??null,expected:null,state:'NEW'};
     this.entries.set(e.sessionId,entry);
    }else if(entry.state!=='READY')error('JOURNAL_TRANSITION_INVALID');
    const m=e.messages;
    if(!m.length||m.at(-1)?.role!=='user'||typeof m.at(-1)?.text!=='string')error('INVALID_MESSAGES');
    if(m.slice(0,-1).every(p=>p.role==='system'))this.firstPrompts.add(JSON.stringify(m));
    entry.previousState=e.previousState;
    entry.state='UNKNOWN_DO_NOT_REPLAY'; // INFLIGHT never re-admitted after crash.
    entry.requestId=e.requestId;entry.lastMessages=m;entry.nativeBound=null;entry.stream='';
   }else if(e.type==='bound'){
    if(!entry||entry.requestId!==e.requestId||typeof e.conversationId!=='string')error('INVALID_BOUND');
    if(entry.conversationId&&entry.conversationId!==e.conversationId)error('CONVERSATION_DRIFT');
    entry.nativeBound=e.conversationId;
   }else if(e.type==='delta'){
    if(!entry||entry.requestId!==e.requestId||typeof e.text!=='string')error('INVALID_DELTA');
    entry.stream+=e.text;
    if(Buffer.byteLength(entry.stream)>262144)error('STREAM_TOO_LARGE');
   }else if(e.type==='complete'){
    if(!entry||entry.requestId!==e.requestId||typeof e.reply!=='string'||!e.reply.trim()||
      entry.nativeBound!==e.conversationId||entry.stream!==e.reply)error('INVALID_TERMINAL');
    entry.conversationId=e.conversationId;
    entry.expected=JSON.stringify([...entry.lastMessages,{role:'assistant',text:e.reply}]);
    entry.state='READY';entry.requestId=null;entry.lastMessages=null;entry.stream='';entry.nativeBound=null;
   }else if(e.type==='not_dispatched'){
    if(!entry||entry.requestId!==e.requestId||entry.nativeBound||entry.stream)error('INVALID_NOT_DISPATCHED');
    if(entry.previousState==='NEW'){this.firstPrompts.delete(JSON.stringify(entry.lastMessages));this.entries.delete(e.sessionId);}
    else{entry.state='READY';entry.requestId=null;entry.lastMessages=null;}
   }else if(e.type==='unknown'){
    if(!entry||entry.requestId!==e.requestId)error('INVALID_UNKNOWN');
    entry.state='UNKNOWN_DO_NOT_REPLAY';entry.requestId=null;
   }else error('EVENT_UNKNOWN');
  }
 }
 admit(messages){
  this._assertOpen();
  const m=normalize(messages);
  if(m.slice(0,-1).every(p=>p.role==='system')&&this.firstPrompts.has(JSON.stringify(m)))error('AMBIGUOUS_FIRST_TURN_DO_NOT_REPLAY');
  const turn=super.admit(messages);
  try{
   this._append({type:'begin',sessionId:turn.sessionId,requestId:turn.requestId,
    conversationId:turn.conversationId,previousState:turn.previousState,messages:m});
   if(m.slice(0,-1).every(p=>p.role==='system'))this.firstPrompts.add(JSON.stringify(m));
   turn.entry.lastMessages=m;turn.entry.stream='';turn.entry.nativeBound=null;
  }catch(e){super.unknown(turn);throw e;}
  return turn;
 }
 recordBound(turn,conversationId){
  const e=this.entries.get(turn.sessionId);
  if(!e||e!==turn.entry||e.state!=='INFLIGHT'||e.requestId!==turn.requestId||
    typeof conversationId!=='string'||!conversationId||e.nativeBound||
    e.conversationId&&e.conversationId!==conversationId)error('BOUND_IDENTITY_INVALID');
  this._append({type:'bound',sessionId:turn.sessionId,requestId:turn.requestId,conversationId});
  e.nativeBound=conversationId;
 }
 recordDelta(turn,text){
  const e=this.entries.get(turn.sessionId);
  if(!e||e!==turn.entry||e.state!=='INFLIGHT'||e.requestId!==turn.requestId||
    !e.nativeBound||typeof text!=='string'||Buffer.byteLength(e.stream+text)>262144)
    error('DELTA_IDENTITY_INVALID');
  this._append({type:'delta',sessionId:turn.sessionId,requestId:turn.requestId,text});
  e.stream+=text;
 }
 complete(turn,conversationId,reply){
  const e=this.entries.get(turn.sessionId);
  if(!e||e!==turn.entry||e.state!=='INFLIGHT'||e.requestId!==turn.requestId||
    !e.nativeBound||e.nativeBound!==conversationId||e.stream!==reply)
    error('TERMINAL_IDENTITY_INVALID');
  this._append({type:'complete',sessionId:turn.sessionId,requestId:turn.requestId,conversationId,reply});
  super.complete(turn,conversationId,reply);
  e.lastMessages=null;e.stream='';e.nativeBound=null;
 }
 notDispatched(turn){
  const e=this.entries.get(turn.sessionId);
  if(!e||e!==turn.entry||e.state!=='INFLIGHT'||e.requestId!==turn.requestId||e.nativeBound||e.stream)error('NOT_DISPATCHED_UNVERIFIED');
  this._append({type:'not_dispatched',sessionId:turn.sessionId,requestId:turn.requestId});
  super.notDispatched(turn);
  if(turn.previousState==='NEW')this.firstPrompts.delete(JSON.stringify(turn.messages));
 }
 unknown(turn){
  const e=this.entries.get(turn.sessionId);
  if(e===turn.entry&&e.requestId===turn.requestId){
   try{this._append({type:'unknown',sessionId:turn.sessionId,requestId:turn.requestId});}
   finally{super.unknown(turn);}
  }
 }
 close(){
  if(this.closed)return;
  this.closed=true;
  if(this.fd!==undefined){fs.closeSync(this.fd);this.fd=undefined;}
  try{
   const lock=JSON.parse(fs.readFileSync(this.lockPath,'utf8'));
   if(lock.owner===this.owner)fs.unlinkSync(this.lockPath);
  }catch{}
 }
}
module.exports={DurableSessionBinding};

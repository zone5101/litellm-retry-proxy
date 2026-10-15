'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DurableSessionBinding}=require('./durable_session_binding.cjs');
const msg=(role,value)=>({role,content:[{value}]});
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v11-chatmode-journal-test-'));return {dir,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};}
test('durable realtime delta journal and same conversation after restart',()=>{
 const f=fixture();let a,b;
 try{
  a=new DurableSessionBinding({storeDir:f.dir});const turn=a.admit([msg(1,'first prompt')]);
  a.recordBound(turn,'conversation.42');a.recordDelta(turn,'Hel');a.recordDelta(turn,'lo');
  let events=fs.readFileSync(path.join(f.dir,'chatmode-session.jsonl'),'utf8');
  assert.match(events,/"type":"delta"/);assert.match(events,/"text":"Hel"/);
  a.complete(turn,'conversation.42','Hello');a.close();a=null;
  b=new DurableSessionBinding({storeDir:f.dir});
  const next=b.admit([msg(1,'first prompt'),msg(2,'Hello'),msg(1,'second prompt')]);
  assert.equal(next.sessionId,turn.sessionId);assert.equal(next.conversationId,'conversation.42');
  b.recordBound(next,'conversation.42');b.recordDelta(next,'World');
  b.complete(next,'conversation.42','World');
  assert.equal(b.entries.size,1);
 }finally{a?.close();b?.close();f.cleanup();}
});
test('inflight after normal close is unknown and cannot be replayed',()=>{
 const f=fixture();let a,b;
 try{
  a=new DurableSessionBinding({storeDir:f.dir});a.admit([msg(1,'repeat')]);a.close();a=null;
  b=new DurableSessionBinding({storeDir:f.dir});
  assert.equal([...b.entries.values()][0].state,'UNKNOWN_DO_NOT_REPLAY');
  assert.throws(()=>b.admit([msg(1,'repeat')]),/AMBIGUOUS_FIRST_TURN_DO_NOT_REPLAY/);
 }finally{a?.close();b?.close();f.cleanup();}
});
test('single-writer fencing prevents concurrent journal mutation',()=>{
 const f=fixture();let a;
 try{
  a=new DurableSessionBinding({storeDir:f.dir});
  assert.throws(()=>new DurableSessionBinding({storeDir:f.dir}),/SINGLE_WRITER_LOCK/);
 }finally{a?.close();f.cleanup();}
});
test('mismatched native conversation rejected before terminal receipt',()=>{
 const f=fixture();let a;
 try{
  a=new DurableSessionBinding({storeDir:f.dir});
  const t=a.admit([msg(1,'test mismatch')]);a.recordBound(t,'c1');
  assert.throws(()=>a.complete(t,'c2','abc'),/TERMINAL_IDENTITY_INVALID/);
  a.unknown(t);assert.equal(t.entry.state,'UNKNOWN_DO_NOT_REPLAY');
  assert.doesNotMatch(fs.readFileSync(a.journalPath,'utf8'),/"type":"complete"/);
 }finally{a?.close();f.cleanup();}
});
test('torn journal never silently restores or dispatches',()=>{
 const f=fixture();let a;
 try{
  fs.writeFileSync(path.join(f.dir,'chatmode-session.jsonl'),'{"v":1,"type":"begin"');
  assert.throws(()=>new DurableSessionBinding({storeDir:f.dir}),/TORN_JOURNAL_DO_NOT_REPLAY/);
 }finally{a?.close();f.cleanup();}
});

test('system-context first turn binds one native conversation across restart',()=>{
 const f=fixture();let a,b;
 try{
  const first=[msg(3,'VS Code Agent system'),msg(1,'start')];
  a=new DurableSessionBinding({storeDir:f.dir});const t=a.admit(first);
  a.recordBound(t,'chat.native.1');a.recordDelta(t,'ACK');a.complete(t,'chat.native.1','ACK');
  a.close();a=null;b=new DurableSessionBinding({storeDir:f.dir});
  const next=b.admit([...first,msg(2,'ACK'),msg(1,'continue')]);
  assert.equal(next.sessionId,t.sessionId);assert.equal(next.conversationId,'chat.native.1');
 }finally{a?.close();b?.close();f.cleanup();}
});
test('not-dispatched first turn restores admission with no native replay',()=>{
 const f=fixture();let a,b;
 try{
  a=new DurableSessionBinding({storeDir:f.dir});
  const first=[msg(3,'system'),msg(1,'queue was full')];
  const t=a.admit(first);a.notDispatched(t);
  assert.equal(a.entries.size,0);
  a.close();a=null;b=new DurableSessionBinding({storeDir:f.dir});
  assert.equal(b.entries.size,0);
  const resubmission=b.admit(first);assert.equal(resubmission.conversationId,null);
 }finally{a?.close();b?.close();f.cleanup();}
});
test('not-dispatched second turn can safely re-admit only recorded history',()=>{
 const f=fixture();let a,b;
 try{
  const first=[msg(1,'hello')];a=new DurableSessionBinding({storeDir:f.dir});
  const t=a.admit(first);a.recordBound(t,'native.one');a.recordDelta(t,'yes');a.complete(t,'native.one','yes');
  const next=[...first,msg(2,'yes'),msg(1,'next')];
  const blocked=a.admit(next);a.notDispatched(blocked);a.close();a=null;
  b=new DurableSessionBinding({storeDir:f.dir});const resumed=b.admit(next);
  assert.equal(resumed.conversationId,'native.one');assert.equal(resumed.sessionId,t.sessionId);
 }finally{a?.close();b?.close();f.cleanup();}
});

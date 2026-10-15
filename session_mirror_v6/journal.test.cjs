'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {SessionJournal} = require('./journal.cjs');

function tmp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'v6-journal-'));
  return {root,dbPath:path.join(root,'events.sqlite'),sourceScope:'chatgpt-pc:isolated-v6-test'};
}
function put(j,request,kind,data={}) { j.record({kind,data},request); }
function finish(j,request,conv,mid,parts) {
  put(j,request,'submitted',{conversation_id:conv});
  for (const text of parts) put(j,request,'snapshot',{message_id:mid,text});
  put(j,request,'terminal',{finish_reason:'stop'});
}
test('two turns, same source conversation, revisions and crash-safe reopening',()=>{
  const p=tmp(); const a = new SessionJournal(p);
  const r1={request_id:'request-0001',prompt:'Hello'};
  put(a,r1,'snapshot',{message_id:'assistant-001',text:'H'});
  put(a,r1,'submitted',{conversation_id:'real-conversation-1'});
  put(a,r1,'snapshot',{message_id:'assistant-001',text:'Hello'});
  put(a,r1,'snapshot',{message_id:'assistant-001',text:'Hello'});
  put(a,r1,'terminal',{finish_reason:'stop'});
  let v=a.projection('real-conversation-1');
  assert.equal(v.messages.length,2);
  assert.equal(v.messages[1].text,'Hello');
  assert.equal(v.messages[1].revision,2);
  assert.equal(v.messages[1].completed,true);
  a.close();
  const b=new SessionJournal(p);
  const r2={request_id:'request-0002',prompt:'Next'};
  finish(b,r2,'real-conversation-1','assistant-002',['first','revised']);
  v=b.projection('real-conversation-1');
  assert.equal(v.messages.length,4);
  assert.deepEqual(v.messages.map(m=>m.text),['Hello','Hello','Next','revised']);
  assert.equal(v.messages[3].completed,true);
  b.close();
  const c=new SessionJournal(p);
  assert.equal(c.projection('real-conversation-1').messages.length,4);
  assert.equal(c.db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='assistant.snapshot'").get().n,4);
  c.close();fs.rmSync(p.root,{recursive:true,force:true});
});
test('reject unknown conversation, bad terminal, mismatched identity, oversized pending',()=>{
  const p=tmp(),j=new SessionJournal(p);
  const r={request_id:'request-0003',prompt:'test'};
  assert.throws(()=>put(j,r,'submitted',{conversation_id:null}),/SOURCE_CONVERSATION_UNAVAILABLE/);
  assert.throws(()=>put(j,r,'terminal',{finish_reason:'stop'}),/TERMINAL_INVALID/);
  assert.throws(()=>put(j,r,'snapshot',{message_id:null,text:'x'}),/SNAPSHOT_INVALID/);
  put(j,r,'submitted',{conversation_id:'verified-conv'});
  assert.throws(()=>put(j,r,'snapshot',{message_id:'m',text:'x'.repeat(262145)}),/SNAPSHOT_INVALID/);
  put(j,r,'snapshot',{message_id:'m',text:'good'});
  assert.throws(()=>put(j,r,'snapshot',{message_id:'other',text:'bad'}),/ASSISTANT_ID_MISMATCH/);
  assert.throws(()=>put(j,{request_id:'request-0004',prompt:'different'},'snapshot',{message_id:'m',text:'x'}),/REQUEST_MISMATCH/);
  put(j,r,'error',{code:'drop'});
  assert.equal(j.db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='turn.interrupted'").get().n,1);
  j.close();fs.rmSync(p.root,{recursive:true,force:true});
});
test('non-prefix correction replaces rendered assistant text, never concatenates',()=>{
  const p=tmp(),j=new SessionJournal(p);
  const r={request_id:'request-0005',prompt:'render'};
  finish(j,r,'conv-revision','assistant-5',['abc','ab','xyz']);
  const v=j.projection('conv-revision');
  assert.equal(v.messages[1].text,'xyz');
  assert.equal(v.messages[1].revision,3);
  j.close();fs.rmSync(p.root,{recursive:true,force:true});
});

// A second browser/app/profile cannot write into the same authoritative journal.
test('journal rejects another native source and any web source; preserves first authority',()=>{
  const p=tmp(),one=new SessionJournal(p);
  one.close();
  assert.throws(()=>new SessionJournal({...p,sourceScope:'browser:chrome-profile'}),/CONFIG_INVALID/);
  assert.throws(()=>new SessionJournal({...p,sourceScope:'chatgpt-pc:different-profile'}),/AUTHORITY_MISMATCH/);
  const reopened=new SessionJournal(p);
  assert.equal(reopened.db.prepare('SELECT source_scope FROM journal_authority').get().source_scope,p.sourceScope);
  reopened.close();fs.rmSync(p.root,{recursive:true,force:true});
});

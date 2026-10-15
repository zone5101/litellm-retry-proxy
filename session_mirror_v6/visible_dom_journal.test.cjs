'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {VisibleDomJournal}=require('./visible_dom_journal.cjs');
const {SessionJournal}=require('./journal.cjs');
const {observe}=require('./web_dom_probe.cjs');
const ID='00000000-0000-4000-8000-000000000000';
const OTHER='00000000-0000-4000-8000-000000000001';
function tmp() {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dom-bridge-test-'));
 return {dbPath:path.join(dir,'events.sqlite'),dir,sourceScope:'browser:synthetic-profile',allowedConversationId:ID};
}
function m(messageId,role,text) {return {conversationId:ID,messageId,role,text};}
function packet(...messages) {return {state:'VISIBLE_ONLY',conversationId:ID,messages};}
function mock(role,id,text) {
 return {getAttribute:k=>k==='data-message-id'?id:k==='data-message-author-role'?role:null,
 querySelector:s=>s===(role==='assistant'?'.markdown':'.whitespace-pre-wrap')?{textContent:text}:null};
}
test('DOM observer to WAL to projection E2E; revisions, duplicate changes and reopen',()=>{
 const p=tmp(),writer=new VisibleDomJournal(p);
 const nodes=[mock('user','message-user-001','hello'),mock('assistant','message-assistant-001','thinking')];
 let callback,queue=[],nextTimer=0;
 class MO {constructor(cb){callback=cb}observe(){}disconnect(){}}
 const win={location:{href:'https://chatgpt.com/c/'+ID},
  setTimeout:fn=>{queue.push(fn);return ++nextTimer;},clearTimeout:()=>{queue=[]}};
 const doc={documentElement:{},querySelectorAll:()=>nodes};
 const delivered=[];
 const stop=observe({win,doc,MutationObserverClass:MO,
  onSnapshot:ev=>{delivered.push(ev.state);if(ev.state==='VISIBLE_ONLY')writer.ingest(ev)}});
 const tick=()=>{const q=queue;queue=[];for(const fn of q)fn()};
 tick();
 assert.deepEqual(writer.projection().messages.map(x=>x.text),['hello','thinking']);
 callback();tick();
 assert.equal(writer.db.prepare('SELECT COUNT(*) n FROM visible_dom_events').get().n,2);
 nodes[1]=mock('assistant','message-assistant-001','final answer');
 callback();tick();stop();
 assert.equal(writer.projection().messages[1].revision,2);
 assert.equal(writer.projection().messages[1].text,'final answer');
 assert.equal(writer.projection().terminalState,'NOT_OBSERVED');
 writer.close();
 const restarted=new VisibleDomJournal(p);
 assert.equal(restarted.ingest(packet(m('message-assistant-001','assistant','final answer'))),0);
 assert.equal(restarted.projection().messages.length,2);
 assert.equal(restarted.db.prepare('PRAGMA journal_mode').get().journal_mode,'wal');
 restarted.close();fs.rmSync(p.dir,{recursive:true,force:true});
});
test('source and role conflicts reject atomic batch; no synthetic terminal',()=>{
 const p=tmp(),j=new VisibleDomJournal(p);
 assert.throws(()=>j.ingest({state:'MESSAGE_IDS_NOT_VERIFIED',conversationId:ID,messages:[]}),/SOURCE_UNVERIFIED/);
 assert.throws(()=>j.ingest({state:'VISIBLE_ONLY',conversationId:OTHER,messages:[m('message-1','user','x')]}),/SOURCE_UNVERIFIED/);
 assert.throws(()=>j.ingest(packet({...m('message-1','user','x'),conversationId:OTHER})),/MESSAGE_INVALID/);
 assert.throws(()=>j.ingest(packet(m('message-1','system','x'))),/MESSAGE_INVALID/);
 assert.throws(()=>j.ingest(packet(m('message-1','user','x'),m('message-1','user','duplicate'))),/MESSAGE_INVALID/);
 assert.equal(j.ingest(packet(m('message-user-001','user','real text'))),1);
 assert.throws(()=>j.ingest(packet(m('message-fresh-001','assistant','new'),m('message-user-001','assistant','role swap'))),/ROLE_CONFLICT/);
 assert.equal(j.projection().messages.length,1);
 assert.equal(j.db.prepare('SELECT COUNT(*) n FROM visible_dom_events').get().n,1);
 assert.equal(j.projection().terminalState,'NOT_OBSERVED');
 j.close();fs.rmSync(p.dir,{recursive:true,force:true});
});
test('native v6 journal and DOM visibility records stay in separate source namespaces',()=>{
 const p=tmp(),native=new SessionJournal({dbPath:p.dbPath,sourceScope:'isolated-v6:canary'});
 const r={request_id:'request-0000',prompt:'hello'};
 native.record({kind:'submitted',data:{conversation_id:ID}},r);
 native.record({kind:'snapshot',data:{message_id:'message-native-001',text:'native'}},r);
 native.record({kind:'terminal',data:{finish_reason:'stop'}},r);
 const dom=new VisibleDomJournal(p);
 dom.ingest(packet(m('message-web-001','assistant','web')));
 assert.equal(native.projection(ID).messages.length,2);
 assert.equal(dom.projection().messages.length,1);
 assert.equal(dom.projection().messages[0].text,'web');
 assert.equal(native.projection(ID).messages[1].text,'native');
 dom.close();native.close();fs.rmSync(p.dir,{recursive:true,force:true});
});

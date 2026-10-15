'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const {conversationId,extract,observe}=require('./web_dom_probe.cjs');
const ID='00000000-0000-4000-8000-000000000000';
function message(role,id,text,hasBody=true) {
  return {
    getAttribute:key=>key==='data-message-id'?id:key==='data-message-author-role'?role:null,
    querySelector:sel=>hasBody && sel===(role==='assistant'?'.markdown':'.whitespace-pre-wrap')?{textContent:text}:null
  };
}
function doc(rows) {return {documentElement:{},querySelectorAll:()=>rows};}
function harness(rows) {
  let onChange;
  class MO {
    constructor(callback){onChange=callback;this.connected=false;}
    observe(){this.connected=true;}
    disconnect(){this.connected=false;}
  }
  let queue=[],next=0;
  const win={location:{href:'https://chatgpt.com/c/'+ID},
    setTimeout:fn=>{queue.push(fn);return ++next;},
    clearTimeout:()=>{queue=[]}};
  const events=[],d=doc(rows);
  const stop=observe({win,doc:d,onSnapshot:ev=>events.push(ev),MutationObserverClass:MO});
  const tick=()=>{const q=queue;queue=[];q.forEach(fn=>fn());};
  return {win,d,events,stop,tick,change:()=>onChange()};
}
test('strict conversation origin/path, rejects fabricated route',()=>{
 assert.equal(conversationId('https://chatgpt.com/c/'+ID),ID);
 for (const u of ['https://evilchatgpt.com/c/'+ID,'https://chatgpt.com/new',
  'https://chatgpt.com/c/NOT_AN_ID','https://chatgpt.com/g/gptname/c/'+ID,
  'javascript:alert(1)']) assert.equal(conversationId(u),null);
});
test('DOM requires source message-id and role; never falls back to generic text',()=>{
 const x=extract(doc([message('assistant','realmsg01','hello'),
   message('user','realmsg02','user text'),message('assistant','', 'no ID'),
   message('system','realmsg04','no'),message('assistant','realmsg03','ignored',false)]),
   'https://chatgpt.com/c/'+ID);
 assert.equal(x.state,'VISIBLE_ONLY');
 assert.deepEqual(x.messages.map(r=>[r.messageId,r.role,r.text]),[
  ['realmsg01','assistant','hello'],['realmsg02','user','user text']]);
 const absent=extract(doc([message('assistant',null,'text')]),'https://chatgpt.com/c/'+ID);
 assert.equal(absent.state,'MESSAGE_IDS_NOT_VERIFIED');
});
test('MutationObserver revisions replace content; duplicate signals do not emit duplicates',()=>{
 const rows=[message('assistant','realmsg01','alpha')],h=harness(rows);
 h.tick();assert.equal(h.events[0].messages[0].revision,1);
 h.change();h.change();h.tick();assert.equal(h.events.length,1);
 rows[0]=message('assistant','realmsg01','omega');
 h.change();h.tick();assert.equal(h.events.length,2);
 assert.equal(h.events[1].messages[0].text,'omega');
 assert.equal(h.events[1].messages[0].revision,2);
 h.stop();h.change();h.tick();assert.equal(h.events.length,2);
});
test('navigate to a different conversation resets identity; unavailable ID fails closed',()=>{
 const rows=[message('assistant','realmsg01','hello')],h=harness(rows);
 h.tick();
 h.win.location.href='https://chatgpt.com/new';
 h.change();h.tick();assert.equal(h.events.at(-1).state,'SOURCE_NOT_AVAILABLE');
 h.win.location.href='https://chatgpt.com/c/00000000-0000-4000-8000-000000000001';
 h.change();h.tick();assert.equal(h.events.at(-1).messages[0].revision,1);
 h.stop();
});
test('same message ID cannot silently switch source role',()=>{
 const rows=[message('assistant','realmsg01','hello')],h=harness(rows);
 h.tick();rows[0]=message('user','realmsg01','changed role');
 h.change();h.tick();assert.equal(h.events.at(-1).state,'MESSAGE_ID_ROLE_CONFLICT');
 h.stop();
});

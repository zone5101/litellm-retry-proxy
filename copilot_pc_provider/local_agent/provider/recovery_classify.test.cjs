'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {classify}=require('./recovery_classify.cjs');
const base={schema:'livingos.local-native-admission.v1',token:crypto.randomUUID(),
 pid:33872,phase:'SUBMITTED',request_id:'v11req_example',
 session_id:'agent.0123456789abcdef01234567',renderer_generation:'renderer-gen-v1'};
const receipt=(kind,changes={})=>({verified:true,ref:'receipt:'+kind,
 request_id:base.request_id,session_id:base.session_id,
 renderer_generation:base.renderer_generation,...changes});
function closed(r){
 assert.equal(r.task_terminal,false);
 assert.equal(r.may_replay,false);
 assert.equal(r.may_release_lock,false);
 assert.equal(r.incident,'PENDING_AUTHORIZED_RECONCILIATION');
}
test('legacy DISPATCHING lock without request ID remains assigned and unresolved',()=>{
 const r=classify({token:base.token,pid:33872,phase:'DISPATCHING',fingerprint:'x'});
 assert.equal(r.classification,'INSTRUMENTATION_GAP');
 assert(r.missing.includes('durable_request_id'));
 closed(r);
});
test('missing owner is never interpreted as safe cleanup',()=>{
 const r=classify(null);
 assert.equal(r.classification,'OWNER_UNVERIFIED');
 closed(r);
});
test('matching submitted, renderer terminal and child closure still require authorized CAS',()=>{
 const r=classify(base,{submit_ack:receipt('submitted'),
   renderer_terminal:receipt('terminal'),child_closed:receipt('child')});
 assert.equal(r.classification,'TERMINAL_EVIDENCE_READY');
 assert.equal(r.evidence_refs.length,3);
 closed(r);
});
test('mismatched request identity cannot prove terminal',()=>{
 const r=classify(base,{submit_ack:receipt('submitted'),
   renderer_terminal:receipt('terminal',{request_id:'other'}),
   child_closed:receipt('child')});
 assert.equal(r.classification,'SUBMITTED_OUTCOME_UNKNOWN');
 assert(r.missing.includes('exact_renderer_terminal'));
 closed(r);
});
test('unverified receipts cannot prove no-send',()=>{
 const r=classify(base,{no_send_proof:receipt('not-sent',{verified:false})});
 assert.equal(r.classification,'DELIVERY_OUTCOME_UNKNOWN');
 closed(r);
});
test('positive no-send evidence permits review, never automatic deletion or replay',()=>{
 const r=classify(base,{no_send_proof:receipt('not-sent')});
 assert.equal(r.classification,'NOT_SUBMITTED_EVIDENCE_READY');
 closed(r);
});
test('contradictory no-send and submitted claims remain uncertain',()=>{
 const r=classify(base,{no_send_proof:receipt('not-sent'),submit_ack:receipt('submitted')});
 assert.equal(r.classification,'SUBMITTED_OUTCOME_UNKNOWN');
 closed(r);
});
test('lost terminal after submit remains unknown, no reset',()=>{
 const r=classify(base,{submit_ack:receipt('submitted')});
 assert.equal(r.classification,'SUBMITTED_OUTCOME_UNKNOWN');
 assert(r.missing.includes('exact_renderer_terminal'));
 closed(r);
});

'use strict';
// Read-only incident classifier. Never releases locks, dispatches, or retries.
// All evidence assertions require an independent authoritative receipt check.
// This classifier only identifies whether such proof is present and ID-matched.
const fs=require('node:fs');
const path=require('node:path');
const UNKNOWN='PENDING_AUTHORIZED_RECONCILIATION';
function matching(ref,owner){
 return ref&&typeof ref==='object'&&ref.verified===true&&
   typeof ref.ref==='string'&&ref.ref.length>0&&
   ref.request_id===owner.request_id&&
   ref.session_id===owner.session_id&&
   typeof ref.renderer_generation==='string'&&
   ref.renderer_generation===owner.renderer_generation;
}
function classify(owner,evidence={}){
 const result={schema:'livingos.local-agent-recovery-classification.v1',
   task_terminal:false,may_replay:false,may_release_lock:false,
   incident:UNKNOWN,owner:'manager',next_action:'',missing:[],evidence_refs:[]};
 if(!owner||typeof owner!=='object'||typeof owner.token!=='string'||!owner.token){
   result.classification='OWNER_UNVERIFIED';
   result.missing=['readable_verified_owner_token'];
   result.next_action='Inspect exact owner record without mutating admission or renderer';
   return result;
 }
 result.owner_token=owner.token;
 result.owner_pid=Number.isInteger(owner.pid)?owner.pid:null;
 result.phase=typeof owner.phase==='string'?owner.phase:'UNVERIFIED';
 if(typeof owner.request_id!=='string'||!owner.request_id||
    typeof owner.session_id!=='string'||!owner.session_id||
    typeof owner.renderer_generation!=='string'||!owner.renderer_generation){
   result.classification='INSTRUMENTATION_GAP';
   result.missing=['durable_request_id','durable_session_id','renderer_generation','exact_native_receipt'];
   result.next_action='Bounded forensic check of original owner time window, then route to authorized reconciliation owner; do not infer no-send from missing ID';
   return result;
 }
 result.request_id=owner.request_id;
 result.session_id=owner.session_id;
 const submitted=matching(evidence.submit_ack,owner);
 const terminal=matching(evidence.renderer_terminal,owner);
 const child=matching(evidence.child_closed,owner);
 const neverSent=matching(evidence.no_send_proof,owner);
 const refs=[evidence.submit_ack,evidence.renderer_terminal,evidence.child_closed,evidence.no_send_proof].filter(x=>matching(x,owner)).map(x=>x.ref);
 result.evidence_refs=[...new Set(refs)];
 if(neverSent&&!submitted&&!terminal){
   result.classification='NOT_SUBMITTED_EVIDENCE_READY';
   result.next_action='Independent authority validates exclusive no-send proof; fenced owner CAS reconciliation is required before any fresh admission';
   return result;
 }
 if(submitted&&terminal&&child){
   result.classification='TERMINAL_EVIDENCE_READY';
   result.next_action='Independently validate renderer terminal and host outcome; reconcile original session exactly once via authorized owner transaction';
   return result;
 }
 result.classification=submitted?'SUBMITTED_OUTCOME_UNKNOWN':'DELIVERY_OUTCOME_UNKNOWN';
 result.missing=[
   ...(!submitted?['exact_submit_ack']:[]),
   ...(!terminal?['exact_renderer_terminal']:[]),
   ...(!child?['exact_child_close']:[])
 ];
 result.next_action='Inspect only original request-correlated evidence; preserve admission lock and original session, then escalate missing authority/telemetry';
 return result;
}
module.exports={classify};
if(require.main===module){
 const dir=process.argv[2];
 if(!dir||!path.isAbsolute(dir)){
   process.stderr.write('usage: node recovery_classify.cjs ABSOLUTE_LOCK_DIR\n');
   process.exitCode=2;
 }else{
   try{
     const owner=JSON.parse(fs.readFileSync(path.join(dir,'owner.json'),'utf8'));
     process.stdout.write(JSON.stringify(classify(owner))+'\n');
   }catch(error){
     process.stdout.write(JSON.stringify(classify(null))+'\n');
     process.exitCode=3;
   }
 }
}

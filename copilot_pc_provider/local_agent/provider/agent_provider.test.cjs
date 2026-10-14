'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {LocalAgentBridge}=require('./agent_provider.cjs');
const {parseEnvelope,offeredTools}=require('./agent_tool_envelope.cjs');
const api={LanguageModelTextPart:class{constructor(value){this.value=value}},
           LanguageModelToolCallPart:class{constructor(callId,name,input){Object.assign(this,{callId,name,input})}}};
const tool={name:'read_only_identity',inputSchema:{type:'object',properties:{pid:{type:'integer'}}}};
const user=text=>({role:1,content:[{value:text}]});
const assistant=part=>({role:2,content:[part]});
const reporter=()=>{const parts=[];return {parts,progress:{report:p=>parts.push(p)}}};
test('exact structured JSON with escaped renderer formatting accepted',()=>{
 const offered=offeredTools([tool]);
 assert.deepEqual(parseEnvelope('<escape>{"kind":"final","text":"YES"}</escape>',offered),{kind:'final',text:'YES'});
 assert.throws(()=>parseEnvelope('Please run read_only_identity',offered),/STRUCTURED_RESPONSE_REQUIRED/);
 assert.throws(()=>parseEnvelope('{"kind":"tool_call","name":"not_offered","input":{}}',offered),/TOOL_CALL_INVALID/);
});
test('VS Code host contract: model tool-part then verified result then native same conversation',async()=>{
 const seen=[];let responses=[
  '{"kind":"tool_call","name":"read_only_identity","input":{"pid":32728}}',
  '<escape>{"kind":"final","text":"Identity verified from host result"}</escape>',
  '{"kind":"final","text":"Still the same native chat"}'
 ];
 const bridge=new LocalAgentBridge({nativeExchange:async arg=>{
  seen.push(arg);
  return {conversationId:'local-chatgpt:single-agent-session',text:responses.shift(),reused:seen.length>1};
 }});
 const first=user('Inspect the identity of PID 32728');
 const a=reporter();
 const r1=await bridge.provide([first],{tools:[tool]},a.progress,{isCancellationRequested:false},api);
 assert.equal(r1.phase,'AWAIT_RESULT');
 const call=a.parts[0];
 assert.equal(call.name,tool.name);
 assert.deepEqual(call.input,{pid:32728});
 const realHostResult={callId:call.callId,content:[{value:'PID 32728 is a running owned process'}]};
 const b=reporter();
 const r2=await bridge.provide([first,assistant(call),userPart(realHostResult)],{tools:[tool]},b.progress,{isCancellationRequested:false},api);
 assert.equal(r2.phase,'READY');assert.equal(r2.reused,true);
 assert.equal(b.parts[0].value,'Identity verified from host result');
 assert.equal(seen[0].conversationId,null);
 assert.equal(seen[1].conversationId,'local-chatgpt:single-agent-session');
 assert(seen[1].prompt.includes('PID 32728 is a running owned process'));
 const c=reporter();
 const result=await bridge.provide([first,assistant(call),userPart(realHostResult),assistant(b.parts[0]),user('Is context still intact?')],
  {tools:[tool]},c.progress,{isCancellationRequested:false},api);
 assert.equal(result.reused,true);
 assert.equal(c.parts[0].value,'Still the same native chat');
 assert.equal(seen[2].conversationId,'local-chatgpt:single-agent-session');
});
function userPart(part){return {role:1,content:[part]}}
test('refuses unoffered tool, mismatched call, replay and incomplete history',async()=>{
 let requests=0;
 const br=new LocalAgentBridge({nativeExchange:async({conversationId})=>{
  requests++;
  return {conversationId:'local-chatgpt:session',text:'{"kind":"tool_call","name":"read_only_identity","input":{"pid":1}}',reused:conversationId!==null};
 }});
 const input=user('Check one process');
 const p=reporter();await br.provide([input],{tools:[tool]},p.progress,null,api);
 const call=p.parts[0];
 await assert.rejects(br.provide([input,assistant(call),userPart({callId:'wrong-id',content:[{value:'fake'}]})],{tools:[tool]},reporter().progress,null,api),/CALL_ID_MISMATCH/);
 assert.equal(requests,1);
 await assert.rejects(br.provide([user('Different old request'),assistant(call),userPart({callId:call.callId,content:[{value:'fake'}]})],
  {tools:[tool]},reporter().progress,null,api),/UNBOUND_HISTORY/);
 assert.equal(requests,1);
});

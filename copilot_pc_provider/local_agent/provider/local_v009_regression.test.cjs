'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {SessionBinding}=require('./session_binding.cjs');
const {LocalAgentBridge}=require('./agent_provider.cjs');
const {offeredTools,parseEnvelope}=require('./agent_tool_envelope.cjs');
const api={
 LanguageModelTextPart:class{constructor(value){this.value=value}},
 LanguageModelToolCallPart:class{constructor(callId,name,input){Object.assign(this,{callId,name,input})}}
};
const M=(role,text)=>({role,content:[{value:text}]});
const report=()=>{const parts=[];return {parts,progress:{report:p=>parts.push(p)}}};
test('Local text: system + user creates first session; exact history resumes same ID',()=>{
 const b=new SessionBinding();
 const sys=M(3,'VS Code system context, not prior chat'),u=M(1,'Hello local');
 const first=b.admit([sys,u]);
 assert.equal(first.conversationId,null);
 assert.equal(first.messages.length,2);
 b.complete(first,'local-chatgpt:positive-session','Hello!');
 const follow=b.admit([sys,u,M(2,'Hello!'),M(1,'Follow up')]);
 assert.equal(follow.conversationId,'local-chatgpt:positive-session');
 b.complete(follow,'local-chatgpt:positive-session','Next');
 assert.throws(()=>b.admit([sys,u,M(2,'different answer'),M(1,'Follow up')]),/UNVERIFIED_HISTORY_NO_NEW_CHAT/);
});
test('Local text: two system context messages allowed; unbound assistant or user history still refused',()=>{
 const b=new SessionBinding();
 const first=b.admit([M(3,'system1'),M(3,'system2'),M(1,'Hi')]);
 assert.equal(first.conversationId,null);
 assert.throws(()=>b.admit([M(1,'old user'),M(1,'new user')]),/UNVERIFIED_HISTORY_NO_NEW_CHAT/);
 assert.throws(()=>b.admit([M(3,'system'),M(2,'old assistant'),M(1,'new user')]),/UNVERIFIED_HISTORY_NO_NEW_CHAT/);
});
test('95 tool descriptors with optional inputSchema accepted, names preserved',async()=>{
 const tools=Array.from({length:95},(_,i)=>({name:'tool_'+i,description:'safe test tool',...(i%3===0?{inputSchema:{type:'object',properties:{id:{type:'integer'}}}}:{})}));
 const normalized=offeredTools(tools);
 assert.equal(normalized.size,95);
 assert.deepEqual(normalized.get('tool_1').inputSchema,{type:'object',properties:{}});
 const seen=[],b=new LocalAgentBridge({nativeExchange:async arg=>{
   seen.push(arg);
   return {conversationId:'local-chatgpt:95-tools',text:JSON.stringify({kind:'final',text:'Hello from local Agent'}),reused:false};
 }});
 const output=report();
 const r=await b.provide([M(3,'VS Code Agent system message'),M(1,'Extra user context'),M(1,'Say hi')],{tools},output.progress,{isCancellationRequested:false},api);
 assert.equal(r.phase,'READY');assert.equal(output.parts[0].value,'Hello from local Agent');
 assert.equal(seen.length,1);assert.equal(seen[0].conversationId,null);
 assert(seen[0].prompt.includes('tool_94'));
});
test('tool index diagnostics identify invalid descriptors without exposing user content',()=>{
 assert.throws(()=>offeredTools([{name:'good'},{name:'\nmalformed'}]),/TOOL_DESCRIPTOR_NAME_INVALID_AT_1/);
 assert.throws(()=>offeredTools([{name:'good'}, {name:'good'}]),/TOOL_DESCRIPTOR_DUPLICATE_AT_1/);
 assert.throws(()=>offeredTools([{name:'good',inputSchema:[]}]),/TOOL_DESCRIPTOR_SCHEMA_INVALID_AT_0/);
 const allowed=offeredTools([{name:'good'}]);
 assert.throws(()=>parseEnvelope('{"kind":"tool_call","name":"not_offered","input":{}}',allowed),/TOOL_CALL_INVALID/);
});

test('SessionBinding not-dispatched rollback permits clean first-turn retry',()=>{const b=new SessionBinding();const messages=[M(3,'system'),M(1,'hello')];const first=b.admit(messages);b.notDispatched(first);const retry=b.admit(messages);assert.equal(retry.conversationId,null);assert.equal(retry.previousState,'NEW');});

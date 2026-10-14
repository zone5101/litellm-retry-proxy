'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {makePrompt,readSSE,LIMIT_BYTES}=require('./protocol.cjs');
const M=(role,text)=>({role,content:[{value:text}]});
test('simple Copilot text becomes a single ChatGPT user turn',()=>{
 assert.equal(makePrompt([M(1,'hello')]),'hello');
});
test('system and history are labeled, non-executable conversation text',()=>{
 const x=makePrompt([M(3,'rules'),M(1,'hello'),M(2,'hi'),M(1,'next')]);
 assert.match(x,/"role":"system"/);assert.match(x,/"role":"assistant"/);
 assert.match(x,/"role":"user","text":"next"/);
});
test('fail closed for tool calls and tool results',()=>{
 assert.throws(()=>makePrompt([{role:2,toolCalls:[{name:'read_file'}],content:[{value:'x'}]},M(1,'x')]),/TOOL_CONTINUATION_UNSUPPORTED/);
 assert.throws(()=>makePrompt([{role:4,content:[{value:'x'}]},M(1,'x')]),/ROLE_UNSUPPORTED/);
 assert.throws(()=>makePrompt([{role:1,content:[{notText:true}]}]),/NON_TEXT_CONTENT_UNSUPPORTED/);
});
test('hard byte and history limits',()=>{
 assert.throws(()=>makePrompt([M(1,'🙂'.repeat(LIMIT_BYTES/2))]),/INPUT_OVER_8192_BYTES/);
 assert.throws(()=>makePrompt(Array.from({length:17},()=>M(1,'hi'))),/HISTORY_TURN_LIMIT/);
});
function stream(...chunks) {
 return new ReadableStream({start(controller){for(const c of chunks)controller.enqueue(new TextEncoder().encode(c));controller.close();}});
}
test('SSE streaming decodes split frames and exact terminal',async()=>{
 const seen=[];
 const r=await readSSE(stream('data: {"choices":[{"delta":{"content":"X"},"finish_reason":null}]}\\n\\n'.replaceAll('\\n','\n').slice(0,31),
 'data: {"choices":[{"delta":{"content":"X"},"finish_reason":null}]}\n\n'.slice(31),
 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
 'data: [DONE]\n\n'),t=>seen.push(t));
 assert.deepEqual(seen,['X']);assert.equal(r.doneCount,1);assert.equal(r.finishReason,'stop');
});
test('SSE rejects missing terminal or tool frames',async()=>{
 await assert.rejects(readSSE(stream('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'),()=>{}),/TERMINAL_NOT_VERIFIED/);
 await assert.rejects(readSSE(stream('data: {"choices":[{"delta":{"tool_calls":[{"id":"x"}]}}]}\n\n'),()=>{}),/UNSUPPORTED_TOOL_FRAME/);
});

test('SSE CRLF separators remain valid when split across network chunks',async()=>{
 const chunks=['data: {"choices":[{"delta":{"content":"A"},"finish_reason":null}]}\r',
   '\n\r','\n','data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\r\n\r\n','data: [DONE]\r\n\r\n'];
 const output=[];const result=await readSSE(stream(...chunks),x=>output.push(x));
 assert.deepEqual(output,['A']);assert.equal(result.doneCount,1);
});

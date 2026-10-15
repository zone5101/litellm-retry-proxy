'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');

test('v6 refuses to invent native continuation before connecting to renderer',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-continuation-gate-'));
 const descriptor=path.join(dir,'runtime.json');
 fs.writeFileSync(descriptor,JSON.stringify({pipe:'\\\\.\\pipe\\nonexistent-v6-test',token:'test-only'}));
 const input={request_id:'testcontinuation_001',prompt:'continue original'};
 try {
   for(const key of ['conversation_id','conversationId','session_id','sessionId','thread_id','threadId']){
     const request={...input,[key]:'00000000-0000-4000-8000-000000000000'};
     const result=cp.spawnSync(process.execPath,[path.join(__dirname,'..','chatgpt_pc_pipe_client.cjs')],{
       input:JSON.stringify(request)+'\n',encoding:'utf8',timeout:4000,
       env:{...process.env,CHATGPT_PC_BRIDGE_RUNTIME:descriptor,CHATMODE_JOURNAL_PATH:'',
         CHATMODE_EXPECT_CONVERSATION_ID:''}});
     assert.notEqual(result.status,0,key);
     assert.match(result.stderr,/V6_CONTINUATION_UNSUPPORTED_DO_NOT_SUBMIT/,key);
     assert.equal(result.stdout,'',key);
   }
   const envResult=cp.spawnSync(process.execPath,[path.join(__dirname,'..','chatgpt_pc_pipe_client.cjs')],{
     input:JSON.stringify(input)+'\n',encoding:'utf8',timeout:4000,
     env:{...process.env,CHATGPT_PC_BRIDGE_RUNTIME:descriptor,CHATMODE_JOURNAL_PATH:'',
       CHATMODE_EXPECT_CONVERSATION_ID:'00000000-0000-4000-8000-000000000000'}});
   assert.notEqual(envResult.status,0);
   assert.match(envResult.stderr,/V6_CONTINUATION_UNSUPPORTED_DO_NOT_SUBMIT/);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

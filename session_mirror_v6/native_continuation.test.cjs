'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const net=require('node:net'),crypto=require('node:crypto'),cp=require('node:child_process');
const {SessionJournal}=require('./journal.cjs');
const ID='local-testabc:00000000-0000-4000-8000-000000000000';
const WRONG='local-testabc:00000000-0000-4000-8000-000000000001';
const SERVER='00000000-0000-4000-8000-000000000002';
const SCOPE='chatgpt-pc:isolated-continuation-test';
function seed(dbPath) {
  const j=new SessionJournal({dbPath,sourceScope:SCOPE});
  const request={request_id:'seed_request_001',prompt:'first turn'};
  j.record({kind:'submitted',data:{conversation_id:ID}},request);
  j.record({kind:'snapshot',data:{message_id:'first-assistant-001',text:'first answer'}},request);
  j.record({kind:'terminal',data:{finish_reason:'stop'}},request);
  j.close();
}
async function trial(kind) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-native-cont-'));
  const dbPath=path.join(dir,'journal.sqlite'), descriptor=path.join(dir,'runtime.json');
  seed(dbPath);
  const pipe='\\\\.\\pipe\\v6-native-cont-'+process.pid+'-'+crypto.randomBytes(7).toString('hex');
  const token=crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(descriptor,JSON.stringify({pipe,token,pid:process.pid}));
  let sentComplete=false,childOutput='',childStderr='',helloCount=0;
  const server=net.createServer(socket=>{
    let buf='';
    socket.setEncoding('utf8');
    socket.on('data',data=>{
      buf+=data;
      for(;;){
        const cut=buf.indexOf('\n');
        if(cut<0)break;
        const line=buf.slice(0,cut);buf=buf.slice(cut+1);
        let msg;try{msg=JSON.parse(line)}catch{socket.destroy();return}
        if(msg.type==='hello'){
          helloCount++;
          assert.equal(msg.token,token);
          socket.write(JSON.stringify({kind:'hello',renderer_ready:true,...(kind==='legacy'?{}:{capabilities:['native_conversation_continue_v1']})})+'\n');
        }else if(msg.type==='complete'){
          sentComplete=true;
          assert.equal(msg.conversation_id,ID);
          assert.equal(msg.prompt,'second turn');
          socket.write(JSON.stringify({kind:'submitted',request_id:msg.request_id,
            data:{conversation_id:kind==='wrong'?WRONG:ID}})+'\n');
          if(kind==='ok'){
            socket.write(JSON.stringify({kind:'server_bound',request_id:msg.request_id,data:{server_conversation_id:SERVER}})+'\n');
            socket.write(JSON.stringify({kind:'snapshot',request_id:msg.request_id,
              data:{message_id:'second-assistant-001',text:'second answer'}})+'\n');
            socket.write(JSON.stringify({kind:'terminal',request_id:msg.request_id,
              data:{finish_reason:'stop'}})+'\n');
          }
        }
      }
    });
    socket.on('error',()=>{});
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(pipe,resolve)});
  try{
    const env={...process.env,CHATGPT_PC_BRIDGE_RUNTIME:descriptor,
      CHATMODE_JOURNAL_PATH:dbPath,CHATMODE_SOURCE_SCOPE:SCOPE,
      CHATMODE_ENABLE_VERIFIED_CONTINUATION:'1',CHATMODE_EXPECT_CONVERSATION_ID:ID};
    const child=cp.spawn(process.execPath,[path.join(__dirname,'..','chatgpt_pc_pipe_client.cjs')],
      {env,stdio:['pipe','pipe','pipe'],windowsHide:true});
    child.stdin.end(JSON.stringify({request_id:'second_request_001',prompt:'second turn',conversation_id:ID})+'\n');
    child.stdout.on('data',b=>{childOutput+=b});
    child.stderr.on('data',b=>{childStderr+=b});
    const code=await Promise.race([
      new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject)}),
      new Promise((_,reject)=>setTimeout(()=>{child.kill();reject(Error('CHILD_TIMEOUT'))},8000))
    ]);
    const j=new SessionJournal({dbPath,sourceScope:SCOPE});
    const projection=j.projection(ID);
    const completed=j.hasCompletedConversation(ID);
    const rows=j.db.prepare("SELECT kind,conversation_id,request_id FROM events WHERE kind='session.bound' ORDER BY seq").all();
    j.close();
    return {code,childOutput,childStderr,projection,completed,rows,sentComplete,helloCount};
  } finally {
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  }
}
test('mock-pipe E2E: two turns share true native conversation ID',async()=>{
  const r=await trial('ok');
  assert.equal(r.code,0,r.childStderr);
  assert.equal(r.helloCount,1);
  assert.equal(r.sentComplete,true);
  assert.match(r.childOutput,/"kind":"finished"/);
  assert.equal(r.projection.messages.length,4);
  assert.deepEqual(r.rows.map(x=>x.conversation_id),[ID,ID]);
  assert.equal(r.projection.serverConversationId,SERVER);
  assert.equal(r.projection.messages[3].text,'second answer');
  assert.equal(r.projection.messages[3].completed,true);
});
test('legacy renderer cannot silently continue',async()=>{
  const r=await trial('legacy');
  assert.notEqual(r.code,0);
  assert.equal(r.sentComplete,false);
  assert.match(r.childOutput,/renderer_continuation_capability_missing/);
  assert.equal(r.rows.length,1);
});
test('wrong native conversation ID fails and does not bind phantom session',async()=>{
  const r=await trial('wrong');
  assert.notEqual(r.code,0);
  assert.equal(r.sentComplete,true);
  assert.match(r.childOutput,/native_conversation_id_mismatch_do_not_replay/);
  assert.equal(r.rows.length,1);
});

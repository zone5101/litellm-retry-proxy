'use strict';
// Native pipe client for an isolated v11 app. One model turn per request;
// conversation identity is bound by the renderer across MANY turns.
// No workspace tool is dispatched from this client.
const fs=require('node:fs'),net=require('node:net');
const rt=process.env.CHATGPT_PC_BRIDGE_RUNTIME;
if(!rt)throw Error('RUNTIME_REQUIRED');
const descriptor=JSON.parse(fs.readFileSync(rt,'utf8'));
if(typeof descriptor.pipe!=='string'||typeof descriptor.token!=='string')throw Error('RUNTIME_INVALID');
const cid=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(x);
const sid=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/.test(x);
let input='';process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{input+=chunk;if(Buffer.byteLength(input)>32768)process.exit(2)});
process.stdin.on('end',()=>{
 const r=JSON.parse(input);
 if(typeof r.request_id!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(r.request_id)||
    !sid(r.session_id)||(r.conversation_id!=null&&!cid(r.conversation_id))||
    typeof r.prompt!=='string'||!r.prompt.trim()||Buffer.byteLength(r.prompt)>8192||r.prompt.includes('\0'))
   throw Error('REQUEST_INVALID');
 run(r);
});
function run(r){
 let buffer='',hello=false,bound=null,reused=false,finished=false,submitted=false,toolDelivered=false;
 let plain='',plainId=null,post='',postId=null;
 const socket=net.connect(descriptor.pipe);
 const timer=setTimeout(()=>fail('timeout_unknown_do_not_replay'),90000);
 const output=x=>process.stdout.write(JSON.stringify(x)+'\n');
 function fail(code){if(finished)return;finished=true;clearTimeout(timer);
  if(submitted&&!socket.destroyed)socket.write(JSON.stringify({type:'cancel',request_id:r.request_id})+'\n');
  output({kind:'error',code});socket.end();process.exitCode=1;}
 socket.on('connect',()=>socket.write(JSON.stringify({type:'hello',token:descriptor.token})+'\n'));
 socket.on('data',chunk=>{
  buffer+=chunk.toString('utf8');if(buffer.length>600000)return fail('frame_overflow');
  for(;;){const cut=buffer.indexOf('\n');if(cut<0)break;
   const line=buffer.slice(0,cut);buffer=buffer.slice(cut+1);let f;
   try{f=JSON.parse(line)}catch{return fail('frame_invalid_json')}
   if(f.kind==='hello'){
    if(hello||f.renderer_ready!==true)return fail('renderer_not_ready');
    hello=true;submitted=true;
    socket.write(JSON.stringify({type:'complete',request_id:r.request_id,
      session_id:r.session_id,conversation_id:r.conversation_id??null,prompt:r.prompt})+'\n');continue;
   }
   if(!hello||!submitted||f.request_id!==r.request_id)return fail('request_identity_mismatch');
   if(f.kind==='conversation_bound'){
    const d=f.data||{};
    if(bound||d.session_id!==r.session_id||!cid(d.conversation_id)||
      d.reused!==(r.conversation_id!=null)||
      (r.conversation_id!=null&&d.conversation_id!==r.conversation_id))return fail('conversation_binding_mismatch');
    bound=d.conversation_id;reused=d.reused;
    output({kind:'conversation_bound',conversation_id:bound,reused});continue;
   }
   if(['response','submitted','transport_complete','diagnostic','native_tool_seen','ywi_submitted'].includes(f.kind)){
    if(f.kind==='ywi_submitted')output({kind:'ywi_submitted'});continue;
   }
   if(f.kind==='native_tool_request'){
    const d=f.data||{};
    if(toolDelivered||!bound||d.conversation_id!==bound||
      d.source!=='chatgpt_internal_connector_not_vscode_admission'||
      typeof d.call_id!=='string'||d.native_path?.split('/').pop()!=='machine_query')
      return fail('native_tool_not_admitted');
    toolDelivered=true;output({kind:'native_tool_seen',path_class:'machine_query'});
    socket.write(JSON.stringify({type:'tool_result',request_id:r.request_id,
     conversation_id:bound,call_id:d.call_id,
     result:{executed:false,error:'VS_CODE_TOOL_NOT_EXECUTED',source:'isolated_v11_probe'}})+'\n');continue;
   }
   if(f.kind==='snapshot'){
    const d=f.data||{};if(!bound||typeof d.message_id!=='string'||typeof d.text!=='string')return fail('snapshot_unbound');
    if(toolDelivered){if(postId!==null&&postId!==d.message_id)return fail('post_tool_message_mismatch');
      postId=d.message_id;if(!d.text.startsWith(post))return fail('post_tool_nonprefix');
      const delta=d.text.slice(post.length);post=d.text;if(delta)output({kind:'delta',text:delta});
    }else{if(plainId!==null&&plainId!==d.message_id)return fail('message_mismatch');
      plainId=d.message_id;if(!d.text.startsWith(plain))return fail('nonprefix');
      const delta=d.text.slice(plain.length);plain=d.text;if(delta)output({kind:'delta',text:delta});}
    continue;
   }
   if(f.kind==='terminal'){
    if(!bound||toolDelivered&&(f.data?.stage!=='ywi_continuation'||!post)||
      !toolDelivered&&(!plain||f.data?.finish_reason!=='stop'))return fail('terminal_unverified');
    finished=true;clearTimeout(timer);
    output({kind:'finished',conversation_id:bound,reused,ywi_continuation:toolDelivered,host_tool_executed:false});
    socket.end();return;
   }
   if(f.kind==='error')return fail(f.data?.code||f.code||'native_error');
   return fail('unknown_frame');
  }
 });
 socket.on('error',e=>fail('pipe_'+(e.code||'error')));
 socket.on('close',()=>{if(!finished)fail('pipe_closed_without_terminal')});
 process.on('SIGTERM',()=>fail('client_cancelled'));
}

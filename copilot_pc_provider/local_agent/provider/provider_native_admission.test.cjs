'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const path=require('node:path');

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const token=()=>({isCancellationRequested:false,onCancellationRequested:()=>({dispose(){}})});

function loadProvider({delayMs=35}={}){
  let provider=null,active=0,maxActive=0,calls=0;
  class TextPart{constructor(value){this.value=value}}
  class ToolPart{constructor(callId,name,input){Object.assign(this,{callId,name,input})}}
  const vscode={
    workspace:{getConfiguration:()=>({get:()=>''})},
    window:{createOutputChannel:()=>({appendLine(){},dispose(){}})},
    lm:{registerLanguageModelChatProvider:(_vendor,p)=>{provider=p;return{dispose(){}}}},
    chat:{createChatParticipant:()=>({dispose(){}})},
    commands:{registerCommand:()=>({dispose(){}})},
    LanguageModelTextPart:TextPart,LanguageModelToolCallPart:ToolPart
  };
  const old=Module._load;
  Module._load=function(request,parent,isMain){
    if(request==='vscode')return vscode;
    if(request==='./native_local_session.cjs'&&path.basename(parent?.filename||'')==='extension.js'){
      return {provideLocal:async(_messages,_options,progress)=>{
        calls++;active++;maxActive=Math.max(maxActive,active);
        try{await wait(delayMs);progress.report(new TextPart('OK'));}finally{active--;}
      }};
    }
    if(request==='./agent_provider.cjs'&&path.basename(parent?.filename||'')==='extension.js'){
      return {LocalAgentBridge:class{async provide(){throw new Error('TOOLS_NOT_EXPECTED')}}};
    }
    return old.apply(this,arguments);
  };
  let ext;
  try{
    delete require.cache[require.resolve('./extension.js')];
    ext=require('./extension.js');
  }finally{Module._load=old}
  ext.activate({subscriptions:[]});
  return {provider,stats:()=>({calls,maxActive}),deactivate:()=>ext.deactivate()};
}

test('extension serializes distinct native text requests at provider boundary',async()=>{
  const h=loadProvider();
  try{
    const out1=[],out2=[];
    const p1=h.provider.provideLanguageModelChatResponse(null,[{role:1,content:[{value:'A'}]}],{tools:[]},{report:x=>out1.push(x)},token());
    await wait(5);
    const p2=h.provider.provideLanguageModelChatResponse(null,[{role:1,content:[{value:'B'}]}],{tools:[]},{report:x=>out2.push(x)},token());
    await Promise.all([p1,p2]);
    assert.equal(h.stats().calls,2);
    assert.equal(h.stats().maxActive,1);
    assert.equal(out1[0].value,'OK');assert.equal(out2[0].value,'OK');
  }finally{h.deactivate()}
});

test('extension rejects duplicate inflight request before second native dispatch',async()=>{
  const h=loadProvider({delayMs:50});
  try{
    const msg=[{role:1,content:[{value:'same request'}]}];
    const first=h.provider.provideLanguageModelChatResponse(null,msg,{tools:[]},{report(){}},token());
    await wait(5);
    await assert.rejects(
      h.provider.provideLanguageModelChatResponse(null,msg,{tools:[]},{report(){}},token()),
      /DUPLICATE_INFLIGHT_NOT_DISPATCHED/
    );
    await first;
    assert.equal(h.stats().calls,1);
  }finally{h.deactivate()}
});

'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('module');
const path=require('path');
test('installed-style extension host dispatches tool requests to Local Agent adapter (shim only)',async()=>{
 let provider=null,called=0;
 class TextPart{constructor(value){this.value=value}}
 class ToolPart{constructor(callId,name,input){Object.assign(this,{callId,name,input})}}
 const v={
  workspace:{getConfiguration:()=>({get:()=>''})},
  window:{createOutputChannel:()=>({appendLine(){},dispose(){}})},
  lm:{registerLanguageModelChatProvider:(vendor,obj)=>{assert.equal(vendor,'chatgpt-pc-isolated');provider=obj;return{dispose(){}}}},
  chat:{createChatParticipant:()=>({dispose(){}})},
  commands:{registerCommand:()=>({dispose(){}})},
  LanguageModelTextPart:TextPart,LanguageModelToolCallPart:ToolPart
 };
 const old=Module._load;
 Module._load=function(request,parent,isMain){
   if(request==='vscode')return v;
   if(request==='./agent_provider.cjs'&&path.basename(parent?.filename||'')==='extension.js'){
     return {LocalAgentBridge:class{async provide(messages,opts,progress,token,vscode){
       called++;assert.equal(opts.tools.length,1);
       progress.report(new vscode.LanguageModelToolCallPart('host-sim-1','read_only_identity',{pid:32728}));
     }}};
   }
   return old.apply(this,arguments);
 };
 let ext;
 try{delete require.cache[require.resolve('./extension.js')];ext=require('./extension.js')}
 finally{Module._load=old}
 ext.activate({subscriptions:[]});
 const parts=[];
 await provider.provideLanguageModelChatResponse(null,[{role:1,content:[{value:'read identity'}]}],
 {tools:[{name:'read_only_identity',inputSchema:{type:'object',properties:{pid:{type:'integer'}}}}]},
 {report:p=>parts.push(p)},{isCancellationRequested:false});
 assert.equal(called,1);assert.equal(parts.length,1);assert.equal(parts[0].name,'read_only_identity');
});

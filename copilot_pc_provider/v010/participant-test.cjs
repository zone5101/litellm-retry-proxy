'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Module=require('module');
const original=Module._load;
const registrations={};
const vscode={
  workspace:{getConfiguration:()=>({get:(_k,d)=>d})},
  window:{createOutputChannel:()=>({appendLine(){},dispose(){}})},
  lm:{registerLanguageModelChatProvider:(id,provider)=>{
    registrations.model={id,provider};return{dispose(){}};
  }},
  chat:{createChatParticipant:(id,handler)=>{
    registrations.participant={id,handler};return{dispose(){}};
  }},
  commands:{registerCommand:()=>({dispose(){}})},
  LanguageModelTextPart:class{constructor(value){this.value=value;}}
};
Module._load=function(req,parent,isMain){if(req==='vscode')return vscode;return original.apply(this,arguments);};
const ext=require('./extension.js');
ext.activate({subscriptions:[]});
const handler=registrations.participant.handler;
test('declares legacy participant but provider is an experimental Local Agent model',async()=>{
  assert.equal(registrations.participant.id,'chatgpt-pc-staging-copilot.chatgptpc');
  const models=await registrations.model.provider.provideLanguageModelChatInformation();
  assert.equal(models.length,1);assert.equal(models[0].capabilities.toolCalling,true);assert.match(models[0].detail,/EXPERIMENTAL/);
});
test('participant rejects tool references, never calls model with tools',async()=>{
  await assert.rejects(handler({prompt:'hello',references:[{id:'any'}],toolReferences:[{name:'read_file'}]},
    {history:[]},{markdown(){}},{}),/PC_PARTICIPANT_TOOLS_UNSUPPORTED/);
});
test('participant rejects malformed history before invoking backend',async()=>{
  await assert.rejects(handler({prompt:'hello'},{history:'invalid'},{markdown(){}},{}),
    /PC_PARTICIPANT_HISTORY_INVALID/);
});
test('participant rejects oversize prompt before spawning stage',async()=>{
  await assert.rejects(handler({prompt:'x'.repeat(8193)},{history:[]},{markdown(){}},{}),/PC_PROVIDER_INPUT_OVER_8192_BYTES/);
});
test.after(()=>ext.deactivate());

test('stable Chat API: do not touch proposed ChatResponseStream.warning',()=>{
  const fs = require('node:fs');
  const source=fs.readFileSync(require('node:path').join(__dirname,'extension.js'),'utf8');
  assert.equal(source.includes('stream.warning('),false);
  assert.equal(source.includes('stream.markdown('),true);
  const manifest=require('./package.json');
  assert.equal(manifest.enabledApiProposals,undefined);
});

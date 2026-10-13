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
test('declares isolated Chat participant and a tool-free provider',async()=>{
  assert.equal(registrations.participant.id,'chatgpt-pc-staging-copilot.chatgptpc');
  const models=await registrations.model.provider.provideLanguageModelChatInformation();
  assert.equal(models.length,1);assert.equal(models[0].capabilities.toolCalling,false);
});
test('participant rejects references instead of silently dropping them',async()=>{
  await assert.rejects(handler({prompt:'hello',references:[{id:'file'}]},{history:[]},{markdown(){}},{}),/PC_PARTICIPANT_REFERENCES_UNSUPPORTED/);
});
test('participant rejects unseen history instead of silently dropping it',async()=>{
  await assert.rejects(handler({prompt:'hello'},{history:[{prompt:'a'}]},{markdown(){}},{}),/PC_PARTICIPANT_HISTORY_UNSUPPORTED/);
});
test('participant rejects oversize prompt before spawning stage',async()=>{
  await assert.rejects(handler({prompt:'x'.repeat(8193)},{history:[]},{markdown(){}},{}),/PC_PROVIDER_INPUT_OVER_8192_BYTES/);
});
test.after(()=>ext.deactivate());

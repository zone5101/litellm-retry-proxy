'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=__dirname,source=fs.readFileSync(path.join(root,'extension.js'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
test('one Copilot model and no secondary chat participant',()=>{
 assert.equal(pkg.name,'chatgpt-pc-staging-copilot');
 assert.equal(pkg.version,'0.0.13');
 assert.equal(pkg.contributes.languageModelChatProviders.length,1);
 assert.equal(pkg.contributes.languageModelChatProviders[0].vendor,'chatgpt-pc-isolated');
 assert.equal(pkg.contributes.chatParticipants,undefined);
 assert.match(source,/MODEL = 'chatgpt-pc-chat'/);
 assert.doesNotMatch(source,/CHATMODE_MODEL/);
 assert.doesNotMatch(source,/vscode\.chat\.createChatParticipant\(/);
});
test('one native chat transport: tools fail closed until Ywi host E2E',()=>{
 assert.match(source,/capabilities:\{toolCalling:false,imageInput:false\}/);
 assert.match(source,/UNIFIED_NATIVE_YWI_TOOL_CONTINUATION_NOT_PROVEN/);
 assert.doesNotMatch(source,/localAgentBridge\.provide/);
 assert.match(source,/await provideLocal\(messages,options,progress,token,audit\)/);
 const native=fs.readFileSync(path.join(root,'native_local_session.cjs'),'utf8');
 assert.match(native,/registry\.recordDelta\(turn,f\.text\)/);
 assert.match(native,/registry\.recordBound\(turn,f\.conversation_id\)/);
 assert.match(native,/sharedNativeAdmission\.run/);
});

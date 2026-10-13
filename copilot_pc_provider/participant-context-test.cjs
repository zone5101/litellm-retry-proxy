'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {validateReferences} = require('./participant-context.cjs');
test('plain prompt, no context',()=>{
  assert.deepEqual(validateReferences({references:[],toolReferences:[]}),{omittedImplicit:0});
});
test('implicit VS Code editor file, selection, viewport do not block text-only prompt',()=>{
  for(const id of ['vscode.implicit.file','vscode.implicit.selection','vscode.implicit.viewport']){
    assert.deepEqual(validateReferences({references:[{id,value:'UNREAD_AND_NOT_FORWARDED'}]}),{omittedImplicit:1});
  }
});
test('implicit context with an authored range is not ignored',()=>{
  assert.throws(()=>validateReferences({references:[{id:'vscode.implicit.file',range:[0,5]}]}),
    /PC_PARTICIPANT_REFERENCES_UNSUPPORTED/);
});
test('explicit file and unknown references remain blocked',()=>{
  for(const id of ['file:///C:/secret.txt','vscode.file','vscode.implicit.unknown']){
    assert.throws(()=>validateReferences({references:[{id, value:'UNREAD'}]}),/PC_PARTICIPANT_REFERENCES_UNSUPPORTED/);
  }
});
test('tools are blocked even with implicit context',()=>{
  assert.throws(()=>validateReferences({references:[{id:'vscode.implicit.file'}],toolReferences:[{name:'read_file'}]}),
    /PC_PARTICIPANT_TOOLS_UNSUPPORTED/);
});
test('malformed reference shape fails closed',()=>{
  assert.throws(()=>validateReferences({references:'abc'}),/PC_PARTICIPANT_REFERENCES_INVALID/);
});

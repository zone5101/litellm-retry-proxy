'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {validateReferences,countOmittedHistory}=require('./participant-context.cjs');
test('plain text request has nothing omitted',()=>{
  assert.deepEqual(validateReferences({references:[],toolReferences:[]}),{omittedReferences:0});
  assert.equal(countOmittedHistory({history:[]}),0);
});
test('reference ID and value are NEVER accessed for implicit or unknown references',()=>{
  const secret={id:'arbitrary-file',value:'DO_NOT_SEND_THIS_FILE'};
  const guarded=new Proxy(secret,{get(){throw Error('READ_REFERENCE_UNEXPECTED');}});
  for(const ref of [guarded,{id:'vscode.implicit.file',value:secret},
                    {id:'user-selected-file',value:secret},{value:secret}])
    assert.deepEqual(validateReferences({references:[ref]}),{omittedReferences:1});
});
test('any implicit, explicit, arbitrary references are discarded, not forwarded',()=>{
  const request={references:[{id:'vscode.implicit.file'},{id:'custom.unknown',value:{secret:'NO'}},{id:'file:C:private'}]};
  assert.deepEqual(validateReferences(request),{omittedReferences:3});
});
test('history is counted but not examined or forwarded',()=>{
  const guard=new Proxy({value:'private'},{get(){throw Error('READ_HISTORY_UNEXPECTED');}});
  assert.equal(countOmittedHistory({history:[guard]}),1);
});
test('explicit tools remain rejected',()=>{
  assert.throws(()=>validateReferences({references:[{id:'x'}],toolReferences:[{name:'read_file'}]}),
    /PC_PARTICIPANT_TOOLS_UNSUPPORTED/);
});
test('slash commands are rejected',()=>{
  assert.throws(()=>validateReferences({command:'explain',references:[]}),
    /PC_PARTICIPANT_COMMAND_UNSUPPORTED/);
});
test('malformed or excessive references fail closed',()=>{
  assert.throws(()=>validateReferences({references:'abc'}),/PC_PARTICIPANT_REFERENCES_INVALID/);
  assert.throws(()=>validateReferences({toolReferences:'tool'}),/PC_PARTICIPANT_REFERENCES_INVALID/);
  assert.throws(()=>validateReferences({references:Array(129).fill(null)}),/PC_PARTICIPANT_REFERENCES_TOO_MANY/);
});
test('malformed history fails closed',()=>{
  assert.throws(()=>countOmittedHistory({history:'bad'}),/PC_PARTICIPANT_HISTORY_INVALID/);
});

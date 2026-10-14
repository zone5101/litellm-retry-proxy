'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const path=require('node:path');
test('text session rolls back when shared gate rejects before dispatch',async()=>{
 let gateCalls=0;
 class TextPart{constructor(value){this.value=value}}
 const vscode={LanguageModelTextPart:TextPart};
 const old=Module._load;
 Module._load=function(request,parent,isMain){
   if(request==='vscode')return vscode;
   if(request==='./native_shared_admission.cjs'&&path.basename(parent?.filename||'')==='native_local_session.cjs'){
     return {
       SharedNativeAdmission:class{async run(){gateCalls++;const e=new Error('LOCAL_AGENT_SHARED_ADMISSION_WAIT_EXPIRED_NOT_DISPATCHED');e.code='WAIT_EXPIRED_NOT_DISPATCHED';throw e;}},
       fingerprintNativePrompt:()=> 'a'.repeat(64),
       isNotDispatched:e=>/NOT_DISPATCHED/.test(String(e?.code||e?.message||e))
     };
   }
   return old.apply(this,arguments);
 };
 let mod;
 try{delete require.cache[require.resolve('./native_local_session.cjs')];mod=require('./native_local_session.cjs')}
 finally{Module._load=old}
 const msg=[{role:1,content:[{value:'same first request'}]}];
 const token={isCancellationRequested:false,onCancellationRequested:()=>({dispose(){}})};
 const progress={report(){}};
 const logger=()=>{};
 await assert.rejects(mod.provideLocal(msg,{tools:[]},progress,token,logger),/NOT_DISPATCHED/);
 await assert.rejects(mod.provideLocal(msg,{tools:[]},progress,token,logger),/NOT_DISPATCHED/);
 assert.equal(gateCalls,2);
});

'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const {SharedNativeAdmission}=require('./native_shared_admission.cjs');

const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function sandbox(fn) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'local-rea-test-'));
  try {await fn(path.join(root,'admission.lock'));}
  finally {await fs.rm(root,{recursive:true,force:true});}
}

test('different requests share one lock even between separate gate instances',async()=>{
  await sandbox(async dir=>{
    const gate1=new SharedNativeAdmission({lockDir:dir,retryMs:10,maxWaitMs:500});
    const gate2=new SharedNativeAdmission({lockDir:dir,retryMs:10,maxWaitMs:500});
    let active=0,maximum=0;
    const run=(gate,name)=>gate.run({fingerprint:digest(name),dispatch:async()=>{
      ++active;maximum=Math.max(maximum,active);
      await sleep(45);
      --active;
      return name;
    }});
    const [a,b]=await Promise.all([run(gate1,'A'),run(gate2,'B')]);
    assert.deepEqual([a,b],['A','B']);
    assert.equal(maximum,1);
    await assert.rejects(fs.stat(dir),{code:'ENOENT'});
  });
});

test('duplicate while active is rejected BEFORE second dispatch',async()=>{
  await sandbox(async dir=>{
    const gate1=new SharedNativeAdmission({lockDir:dir,retryMs:5,maxWaitMs:300});
    const gate2=new SharedNativeAdmission({lockDir:dir,retryMs:5,maxWaitMs:300});
    let started;
    const entered=new Promise(resolve=>{started=resolve});
    let release;
    const continueNative=new Promise(resolve=>{release=resolve});
    const work=gate1.run({fingerprint:digest('request-1'),dispatch:async()=>{
      started();await continueNative;return 'terminal-ack';
    }});
    await entered;
    let invoked=false;
    await assert.rejects(gate2.run({fingerprint:digest('request-1'),dispatch:async()=>{invoked=true;}}),
      /DUPLICATE_INFLIGHT_NOT_DISPATCHED/);
    assert.equal(invoked,false);
    release();
    assert.equal(await work,'terminal-ack');
  });
});

test('unknown dispatch is not retried; lock remains for explicit reconciliation',async()=>{
  await sandbox(async dir=>{
    const gate=new SharedNativeAdmission({lockDir:dir,retryMs:5,maxWaitMs:50});
    let sends=0;
    await assert.rejects(gate.run({fingerprint:digest('crash'),dispatch:async()=>{
      ++sends;throw new Error('pipe closed after submit');
    }}),/DELIVERY_UNKNOWN_DO_NOT_REPLAY/);
    assert.equal(sends,1);
    await assert.rejects(gate.run({fingerprint:digest('different'),dispatch:async()=>{++sends;}}),
      /WAIT_EXPIRED_NOT_DISPATCHED/);
    assert.equal(sends,1);
    const owner=JSON.parse(await fs.readFile(path.join(dir,'owner.json'),'utf8'));
    assert.equal(owner.fingerprint,digest('crash'));
  });
});

test('independent Node process cannot enter active native renderer',async()=>{
  await sandbox(async dir=>{
    const entry=path.resolve(__dirname,'native_shared_admission.cjs');
    const childCode=[
      "const {SharedNativeAdmission}=require(process.argv[1]);",
      "const g=new SharedNativeAdmission({lockDir:process.argv[2]});",
      "g.run({fingerprint:process.argv[3],dispatch:async()=>{",
      "process.stdout.write('ACQUIRED\\n');",
      "await new Promise(resolve=>setTimeout(resolve,500));",
      "return 'ack';",
      "}}).then(()=>process.exit(0),()=>process.exit(1));"
    ].join('');
    const child=cp.spawn(process.execPath,['-e',childCode,entry,dir,digest('child')],{
      stdio:['ignore','pipe','pipe'],windowsHide:true
    });
    await new Promise((resolve,reject)=>{
      let data='';
      child.stdout.on('data',chunk=>{
        data+=chunk.toString('utf8');
        if(data.includes('ACQUIRED'))resolve();
      });
      child.on('error',reject);
      child.on('exit',code=>{if(!data.includes('ACQUIRED'))reject(new Error('child exit '+code));});
    });
    const parent=new SharedNativeAdmission({lockDir:dir,maxWaitMs:60,retryMs:5});
    await assert.rejects(parent.run({fingerprint:digest('parent'),dispatch:async()=>{
      throw new Error('SHOULD_NOT_RUN');
    }}),/WAIT_EXPIRED_NOT_DISPATCHED/);
    const code=await new Promise(resolve=>child.once('exit',resolve));
    assert.equal(code,0);
  });
});

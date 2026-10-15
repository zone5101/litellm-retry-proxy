'use strict';
// Isolated real-Chromium DOM smoke test. Never touches signed-in browser or credentials.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const chrome='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
if(!fs.existsSync(chrome))throw Error('CHROME_NOT_FOUND');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-real-dom-'));
const html="<!doctype html><html><body>\n<div data-message-author-role=\"user\" data-message-id=\"message-user-001\"><div class=\"whitespace-pre-wrap\">hello</div></div>\n<div data-message-author-role=\"assistant\" data-message-id=\"message-assistant-001\"><div class=\"markdown\">part</div></div>\n<div id=\"proof\"></div>\n<script src=\"./web_dom_probe.cjs\"></script>\n<script>\nconst observed=[],browser=window.__chatModeDomProbe;\nconst virtualWindow={location:{href:'https://chatgpt.com/c/00000000-0000-4000-8000-000000000000'},setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window)};\nconst stop=browser.observe({win:virtualWindow,doc:document,MutationObserverClass:MutationObserver,\nonSnapshot:ev=>{if(ev.state==='VISIBLE_ONLY')observed.push(ev.messages)}});\nsetTimeout(()=>{document.querySelector('[data-message-id=\"message-assistant-001\"] .markdown').textContent='complete'},150);\nsetTimeout(()=>{\n stop();\n const a=observed.flat().filter(m=>m.messageId==='message-assistant-001');\n if(a.length===2 && a[0].text==='part' && a[0].revision===1 && a[1].text==='complete' && a[1].revision===2)\n   document.getElementById('proof').setAttribute('data-result','pass');\n else document.getElementById('proof').setAttribute('data-result','fail');\n},400);\n</script></body></html>";
try {
 fs.copyFileSync(path.join(__dirname,'web_dom_probe.cjs'),path.join(root,'web_dom_probe.cjs'));
 fs.writeFileSync(path.join(root,'fixture.html'),html);
 const proc=cp.spawnSync(chrome,['--headless=new','--disable-gpu','--no-first-run',
  '--no-default-browser-check','--disable-extensions','--disable-background-networking',
  '--user-data-dir='+path.join(root,'chrome-profile'),'--virtual-time-budget=1200',
  '--dump-dom',require('node:url').pathToFileURL(path.join(root,'fixture.html')).href],
  {windowsHide:true,encoding:'utf8',timeout:20000,maxBuffer:1024*1024});
 const pass=proc.status===0&&proc.stdout.includes('data-result="pass"');
 console.log(JSON.stringify({engine:'isolated-Chromium',state:pass?'PASS':'FAIL',
   exitCode:proc.status,hadDOMOutput:!!proc.stdout,liveChatGptTab:false}));
 if(!pass)process.exitCode=1;
} finally {
 try{fs.rmSync(root,{recursive:true,force:true,maxRetries:3,retryDelay:200})}
 catch(e){console.error('ISOLATED_PROFILE_CLEANUP_FAILED');process.exitCode=1}
}

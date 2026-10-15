'use strict';
// Read-only, opt-in candidate for an already-rendered ChatGPT web conversation.
// NO injection into ChatGPT app, NO network, NO tool execution, NO credential access.
// Source role/message attributes must be seen in real DOM before production admission.
(function init(root) {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const MSG = '[data-message-author-role][data-message-id]';
  function conversationId(url) {
    try {
      const u = new URL(url);
      if (u.origin !== 'https://chatgpt.com') return null;
      const path = u.pathname.match(/^\/c\/([^/]+)\/?$/);
      return path && UUID.test(path[1]) ? path[1].toLowerCase() : null;
    } catch (_) { return null; }
  }
  function extract(doc, href) {
    const id = conversationId(href);
    if (!id || !doc || typeof doc.querySelectorAll !== 'function') return {state:'SOURCE_NOT_AVAILABLE',conversationId:null,messages:[]};
    const rows = [], seen = new Set();
    for (const node of doc.querySelectorAll(MSG)) {
      const role = node.getAttribute('data-message-author-role');
      const mid = node.getAttribute('data-message-id');
      if ((role !== 'assistant' && role !== 'user') ||
          typeof mid !== 'string' || mid.length < 6 || mid.length > 256 ||
          /[\r\n\0]/.test(mid) || seen.has(mid)) continue;
      const body = node.querySelector(role === 'assistant' ? '.markdown' : '.whitespace-pre-wrap');
      if (!body) continue; // No generic innerText scraping or fabricated message.
      const text = body.textContent;
      if (typeof text !== 'string' || !text.trim() || text.length > 262144) continue;
      seen.add(mid);
      rows.push({conversationId:id,messageId:mid,role,text});
      if (rows.length > 500) return {state:'SOURCE_OVERFLOW',conversationId:id,messages:[]};
    }
    return {state:rows.length ? 'VISIBLE_ONLY' : 'MESSAGE_IDS_NOT_VERIFIED',conversationId:id,messages:rows};
  }
  function observe({win,doc,onSnapshot,MutationObserverClass,delay=75}) {
    if (!win || !doc || typeof onSnapshot !== 'function' || !MutationObserverClass)
      throw Error('DOM_OBSERVER_CONFIG_INVALID');
    let stopped=false,timer=null,lastId=null;
    const revisions=new Map();
    function scan() {
      timer=null;
      if (stopped) return;
      const result=extract(doc,win.location.href);
      if (result.state !== 'VISIBLE_ONLY') {
        onSnapshot({state:result.state,conversationId:result.conversationId,messages:[]});
        return;
      }
      // Navigation resets local revision state. Never merge different conversations.
      if (lastId !== result.conversationId) {lastId=result.conversationId;revisions.clear();}
      const changed=[];
      for (const row of result.messages) {
        const prev=revisions.get(row.messageId);
        if (prev && prev.text === row.text && prev.role === row.role) continue;
        if (prev && prev.role !== row.role) {
          onSnapshot({state:'MESSAGE_ID_ROLE_CONFLICT',conversationId:lastId,messages:[]});
          return;
        }
        const revision=(prev?.revision||0)+1;
        revisions.set(row.messageId,{text:row.text,role:row.role,revision});
        changed.push({...row,revision});
      }
      if (changed.length) onSnapshot({state:'VISIBLE_ONLY',conversationId:lastId,messages:changed});
    }
    function signal() {
      if (stopped || timer !== null) return;
      timer=win.setTimeout(scan,delay);
    }
    const obs=new MutationObserverClass(signal);
    obs.observe(doc.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,
      attributeFilter:['data-message-id','data-message-author-role']});
    signal();
    return ()=>{stopped=true;obs.disconnect();if(timer !== null)win.clearTimeout(timer);};
  }
  const api={conversationId,extract,observe};
  if (typeof module === 'object' && module.exports) module.exports=api;
  else root.__chatModeDomProbe=api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

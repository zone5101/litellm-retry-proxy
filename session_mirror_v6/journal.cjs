'use strict';
// Selective v6 event recorder, not a transport or model/tool executor.
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');

function validId(s) { return typeof s === 'string' && s.length > 0 && s.length <= 256 && !/[\0\r\n]/.test(s); }
class SessionJournal {
  constructor({dbPath, sourceScope}) {
    if (!validId(sourceScope) || !sourceScope.startsWith('chatgpt-pc:') ||
        typeof dbPath !== 'string' || !dbPath.endsWith('.sqlite'))
      throw Error('JOURNAL_CONFIG_INVALID');
    this.scope = sourceScope;
    fs.mkdirSync(path.dirname(dbPath), {recursive:true,mode:0o700});
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    // ponytail: one durable native-source authority per DB; sourceScope is NOT account authentication.
    this.db.exec('CREATE TABLE IF NOT EXISTS journal_authority (' +
      'singleton INTEGER PRIMARY KEY CHECK(singleton=1), source_scope TEXT NOT NULL)');
    this.db.prepare('INSERT OR IGNORE INTO journal_authority(singleton,source_scope) VALUES(1,?)').run(sourceScope);
    if (this.db.prepare('SELECT source_scope FROM journal_authority WHERE singleton=1').get()?.source_scope !== sourceScope) {
      this.db.close();
      throw Error('JOURNAL_AUTHORITY_MISMATCH');
    }
    this.db.exec('CREATE TABLE IF NOT EXISTS events (' +
      'seq INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT NOT NULL UNIQUE,' +
      'source_scope TEXT NOT NULL, conversation_id TEXT NOT NULL, request_id TEXT NOT NULL,' +
      'message_id TEXT, revision INTEGER, kind TEXT NOT NULL, text TEXT, at_ms INTEGER NOT NULL)');
    this.insert = this.db.prepare('INSERT OR IGNORE INTO events ' +
      '(event_key,source_scope,conversation_id,request_id,message_id,revision,kind,text,at_ms) ' +
      'VALUES (?,?,?,?,?,?,?,?,?)');
    this.last = this.db.prepare('SELECT revision,text FROM events ' +
      "WHERE source_scope=? AND conversation_id=? AND message_id=? AND kind='assistant.snapshot' " +
      'ORDER BY revision DESC LIMIT 1');
    this.rows = this.db.prepare('SELECT * FROM events WHERE source_scope=? AND conversation_id=? ORDER BY seq');
    this.requestId = null; this.conversationId = null; this.assistantId = null;
    this.pending = []; this.pendingBytes = 0; this.terminal = false;
  }
  emit(key, kind, requestId, messageId=null, revision=null, text=null) {
    return this.insert.run(key,this.scope,this.conversationId,requestId,messageId,revision,kind,text,Date.now()).changes;
  }
  record(frame, request) {
    if (!frame || !request || !validId(request.request_id)) throw Error('JOURNAL_FRAME_INVALID');
    const id = request.request_id;
    if (this.requestId && this.requestId !== id) throw Error('JOURNAL_REQUEST_MISMATCH');
    this.requestId = id;
    if (frame.kind === 'submitted') {
      const conv = frame.data?.conversation_id;
      if (!validId(conv) || this.conversationId && this.conversationId !== conv)
        throw Error('JOURNAL_SOURCE_CONVERSATION_UNAVAILABLE');
      this.conversationId = conv;
      this.emit('bound:'+this.scope+':'+conv+':'+id,'session.bound',id);
      if (typeof request.prompt === 'string' && request.prompt.trim() &&
          Buffer.byteLength(request.prompt,'utf8') <= 8192)
        this.emit('user:'+this.scope+':'+conv+':'+id,'user.submitted',id,null,null,request.prompt);
      const pending = this.pending; this.pending = []; this.pendingBytes = 0;
      for (const item of pending) this.snapshot(item,id);
    } else if (frame.kind === 'snapshot') {
      if (!this.conversationId) {
        const text = frame.data?.text;
        if (typeof text !== 'string' || !validId(frame.data?.message_id)) throw Error('JOURNAL_SNAPSHOT_INVALID');
        this.pendingBytes += Buffer.byteLength(text,'utf8');
        if (this.pending.length >= 32 || this.pendingBytes > 1048576) throw Error('JOURNAL_PENDING_OVERFLOW');
        this.pending.push(frame.data);
      } else this.snapshot(frame.data,id);
    } else if (frame.kind === 'terminal') {
      if (!this.conversationId || !this.assistantId || this.terminal ||
          frame.data?.finish_reason !== 'stop') throw Error('JOURNAL_TERMINAL_INVALID');
      this.emit('done:'+this.scope+':'+this.conversationId+':'+id,'assistant.completed',id,this.assistantId);
      this.terminal = true;
    } else if (frame.kind === 'error') {
      if (this.conversationId && !this.terminal)
        this.emit('interrupted:'+this.scope+':'+this.conversationId+':'+id,'turn.interrupted',id);
    }
  }
  snapshot(data, id) {
    if (!validId(data?.message_id) || typeof data.text !== 'string' ||
        Buffer.byteLength(data.text,'utf8') > 262144 || this.terminal)
      throw Error('JOURNAL_SNAPSHOT_INVALID');
    if (this.assistantId && this.assistantId !== data.message_id)
      throw Error('JOURNAL_ASSISTANT_ID_MISMATCH');
    this.assistantId = data.message_id;
    const last = this.last.get(this.scope,this.conversationId,data.message_id);
    if (last?.text === data.text) return;
    const rev = last ? last.revision + 1 : 1;
    this.emit('snap:'+this.scope+':'+this.conversationId+':'+data.message_id+':'+rev,
      'assistant.snapshot',id,data.message_id,rev,data.text);
  }
  projection(conversationId) {
    if (!validId(conversationId)) throw Error('JOURNAL_CONVERSATION_INVALID');
    const messages = [], index = new Map();
    for (const row of this.rows.all(this.scope,conversationId)) {
      if (row.kind === 'user.submitted') messages.push({role:'user',text:row.text,requestId:row.request_id});
      if (row.kind === 'assistant.snapshot') {
        let m = index.get(row.message_id);
        if (!m) {m={role:'assistant',messageId:row.message_id,text:'',completed:false};index.set(row.message_id,m);messages.push(m);}
        m.text = row.text; m.revision = row.revision;
      }
      if (row.kind === 'assistant.completed') {
        const m = index.get(row.message_id); if(m)m.completed=true;
      }
    }
    return {sourceScope:this.scope,conversationId,messages};
  }
  close() { this.db.close(); }
}
module.exports = {SessionJournal};

'use strict';
// Browser-visible-only sink. No native request IDs, no terminal fabrication, no network.
const {DatabaseSync} = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validId = s => typeof s === 'string' && s.length >= 6 && s.length <= 256 && !/[\r\n\0]/.test(s);

class VisibleDomJournal {
  constructor({dbPath,sourceScope,allowedConversationId}) {
    if (typeof dbPath !== 'string' || !dbPath.endsWith('.sqlite') ||
        typeof sourceScope !== 'string' || !sourceScope.startsWith('browser:') ||
        !validId(sourceScope) || !UUID.test(allowedConversationId || ''))
      throw Error('DOM_JOURNAL_CONFIG_INVALID');
    this.scope=sourceScope;
    this.allowed=allowedConversationId.toLowerCase();
    fs.mkdirSync(path.dirname(dbPath),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.db.exec('CREATE TABLE IF NOT EXISTS visible_dom_events (' +
      'seq INTEGER PRIMARY KEY AUTOINCREMENT, source_scope TEXT NOT NULL,' +
      'conversation_id TEXT NOT NULL, message_id TEXT NOT NULL, role TEXT NOT NULL,' +
      'revision INTEGER NOT NULL, text TEXT NOT NULL, at_ms INTEGER NOT NULL,' +
      'UNIQUE(source_scope,conversation_id,message_id,revision))');
    this.last=this.db.prepare('SELECT role,text,revision FROM visible_dom_events ' +
      'WHERE source_scope=? AND conversation_id=? AND message_id=? ORDER BY revision DESC LIMIT 1');
    this.insert=this.db.prepare('INSERT INTO visible_dom_events ' +
      '(source_scope,conversation_id,message_id,role,revision,text,at_ms) VALUES (?,?,?,?,?,?,?)');
    this.list=this.db.prepare('SELECT message_id,role,revision,text FROM visible_dom_events ' +
      'WHERE source_scope=? AND conversation_id=? ORDER BY seq');
  }
  ingest(snapshot) {
    if (!snapshot || snapshot.state !== 'VISIBLE_ONLY' ||
        snapshot.conversationId !== this.allowed ||
        !Array.isArray(snapshot.messages) || snapshot.messages.length > 500)
      throw Error('DOM_JOURNAL_SOURCE_UNVERIFIED');
    const seen = new Set();
    let bytes=0;
    for(const m of snapshot.messages) {
      if (!m || m.conversationId !== this.allowed ||
          !validId(m.messageId) || !['assistant','user'].includes(m.role) ||
          typeof m.text !== 'string' || !m.text.trim() ||
          Buffer.byteLength(m.text,'utf8') > 262144 || seen.has(m.messageId))
        throw Error('DOM_JOURNAL_MESSAGE_INVALID');
      seen.add(m.messageId);
      bytes+=Buffer.byteLength(m.text,'utf8');
      if(bytes>1048576) throw Error('DOM_JOURNAL_BATCH_OVERFLOW');
    }
    let written=0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for(const m of snapshot.messages) {
        const prior=this.last.get(this.scope,this.allowed,m.messageId);
        if(prior && prior.role!==m.role) throw Error('DOM_JOURNAL_ROLE_CONFLICT');
        if(prior?.text===m.text) continue;
        this.insert.run(this.scope,this.allowed,m.messageId,m.role,
          (prior?.revision||0)+1,m.text,Date.now());
        written++;
      }
      this.db.exec('COMMIT');
      return written;
    } catch(e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  projection() {
    const messages=[],indexes=new Map();
    for(const row of this.list.all(this.scope,this.allowed)) {
      let m=indexes.get(row.message_id);
      if(!m) {
        m={messageId:row.message_id,role:row.role,text:row.text,revision:row.revision};
        indexes.set(row.message_id,m);
        messages.push(m);
      } else {
        m.text=row.text;
        m.revision=row.revision;
      }
    }
    return {sourceScope:this.scope,conversationId:this.allowed,visibility:'VISIBLE_ONLY',
      terminalState:'NOT_OBSERVED',messages};
  }
  close() {this.db.close();}
}
module.exports={VisibleDomJournal};

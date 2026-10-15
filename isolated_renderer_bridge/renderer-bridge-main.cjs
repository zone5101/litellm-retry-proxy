'use strict';
const { app, ipcMain } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

// This module is loaded only by the isolated, modified application copy.
if (!process.execPath.includes('chatgpt_renderer_isolation_20261013') || !process.execPath.includes('scope-probe-v')) throw Error('Bridge loaded outside isolated copy');
const root = path.dirname(process.resourcesPath);
const runtimeFile = path.join(root, 'renderer-bridge-runtime.json');
const pipe = '\\\\.\\pipe\\chatgpt-pc-chat-' + crypto.randomBytes(12).toString('hex');
const token = crypto.randomBytes(32).toString('hex');
let owner = null;
let active = null;
let server = null;

function send(socket, frame) {
  if (socket && !socket.destroyed) socket.write(JSON.stringify(frame) + '\n');
}
function trusted(event) {
  if (!event.sender || event.sender.isDestroyed()) return false;
  try {
    const frame = event.senderFrame;
    const url = new URL(frame?.url || '');
    return frame === event.sender.mainFrame && url.protocol === 'app:' && url.hostname === '-';
  } catch { return false; }
}
function cancelActive() {
  if (!active) return;
  try { if (owner && !owner.isDestroyed()) owner.send('chatgpt-pc-bridge:request', { operation: 'cancel', request_id: active.id }); } catch {}
  active = null;
}
ipcMain.on('chatgpt-pc-bridge:ready', event => {
  if (!trusted(event) || (owner && !owner.isDestroyed() && owner !== event.sender)) return;
  owner = event.sender;
  owner.once('destroyed', () => { if (owner === event.sender) { owner = null; if (active) { send(active.socket, { kind: 'error', request_id: active.id, code: 'renderer_destroyed' }); active.socket.end(); active = null; } } });
});
ipcMain.on('chatgpt-pc-bridge:event', (event, frame) => {
  if (event.sender !== owner || !trusted(event) || !active || !frame || frame.request_id !== active.id) return;
  if (typeof frame.kind !== 'string' || JSON.stringify(frame).length > 65536) return;
  try { fs.appendFileSync(path.join(root, `renderer-bridge-audit.jsonl`), JSON.stringify({ at: Date.now(), request_id: active.id, kind: frame.kind, status: frame.data?.status??null, error_kind: frame.data?.errorKind??null, stage: frame.data?.stage??null, outcome: frame.data?.outcome??null, code: frame.data?.code??null }) + `\n`); } catch {}
  send(active.socket, frame);
  if (frame.kind === 'terminal' || frame.kind === 'error') {
    active.socket.end();
    active = null;
  }
});

app.whenReady().then(() => {
  fs.writeFileSync(runtimeFile, JSON.stringify({ pipe, token, pid: process.pid }), { mode: 0o600 });
  server = net.createServer(socket => {
    socket.setEncoding('utf8');
    let authorized = false;
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 65536) { socket.destroy(); return; }
      for (;;) {
        const cut = buffer.indexOf('\n');
        if (cut < 0) break;
        const line = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 1);
        let message;
        try { message = JSON.parse(line); } catch { socket.destroy(); return; }
        if (!authorized) {
          if (message?.type !== 'hello' || message.token !== token) { socket.destroy(); return; }
          authorized = true;
          send(socket, { kind: 'hello', renderer_ready: !!owner, capabilities:['native_conversation_continue_v1'] });
          continue;
        }
        if (message?.type === 'cancel' && active?.socket === socket && message.request_id === active.id) { cancelActive(); send(socket, { kind: 'cancelled', request_id: message.request_id }); socket.end(); return; }
        if (message?.type !== 'complete' || active || !owner || owner.isDestroyed() || typeof message.request_id !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(message.request_id) || typeof message.prompt !== 'string' || !message.prompt.trim() || Buffer.byteLength(message.prompt, 'utf8') > 8192 || message.prompt.includes('\0') ||
            (message.conversation_id !== undefined && (typeof message.conversation_id !== 'string' || !/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|local-[a-z0-9]{7}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(message.conversation_id)))) {
          send(socket, { kind: 'error', code: 'invalid_or_unavailable_request' }); socket.end(); return;
        }
        active = { id: message.request_id, socket };
        owner.send('chatgpt-pc-bridge:request', { operation: 'complete', request_id: active.id, prompt: message.prompt,
          ...(message.conversation_id?{conversation_id:message.conversation_id}:{}) });
      }
    });
    socket.on('close', () => { if (active?.socket === socket) cancelActive(); });
    socket.on('error', () => {});
  });
  server.listen(pipe);
}).catch(() => {});
app.on('before-quit', () => { cancelActive(); server?.close(); try { const value = JSON.parse(fs.readFileSync(runtimeFile, 'utf8')); if (value.pid === process.pid) fs.unlinkSync(runtimeFile); } catch {} });

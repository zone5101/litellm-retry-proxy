'use strict';
const fs = require('node:fs');
const net = require('node:net');
const crypto = require('node:crypto');
const {SessionJournal} = require('./session_mirror_v6/journal.cjs');
const journalPath = process.env.CHATMODE_JOURNAL_PATH;
const journalScope = process.env.CHATMODE_SOURCE_SCOPE;
const runtimePath = process.env.CHATGPT_PC_BRIDGE_RUNTIME;
if (!runtimePath) throw Error('CHATGPT_PC_BRIDGE_RUNTIME is required');
const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
if (typeof runtime.pipe !== 'string' || typeof runtime.token !== 'string') throw Error('Invalid bridge runtime descriptor');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; if (input.length > 65536) process.exit(2); });
process.stdin.on('end', () => {
  let request;
  try { request = JSON.parse(input); } catch { throw Error('Invalid request JSON'); }
  if (typeof request.request_id !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(request.request_id) || typeof request.prompt !== 'string' || !request.prompt.trim() || Buffer.byteLength(request.prompt, 'utf8') > 8192 || request.prompt.includes('\0')) throw Error('Unsupported staging request');
  // v6 Jwi creates a fresh native conversation. Reject continuation intent before any submission.
  if (['conversation_id', 'conversationId', 'session_id', 'sessionId', 'thread_id', 'threadId'].some(key => Object.hasOwn(request, key)) || process.env.CHATMODE_EXPECT_CONVERSATION_ID) throw Error('V6_CONTINUATION_UNSUPPORTED_DO_NOT_SUBMIT');
  run(request);
});
function run(request) {
  // Opt-in only. Existing v6 transport behaves unchanged when unset.
  const journal = journalPath ? new SessionJournal({dbPath:journalPath,sourceScope:journalScope}) : null;
  let journalClosed = false;
  function closeJournal() { if (journal && !journalClosed) {journalClosed=true; journal.close();} }
  let buffer = '', authorized = false, submitted = false, finished = false;
  let messageId = null, latestText = '';
  const socket = net.connect(runtime.pipe);
  const timeout = setTimeout(() => fail('timeout_unknown_do_not_replay'), 90000);
  function output(frame) { process.stdout.write(JSON.stringify(frame) + '\n'); }
  function fail(code) {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    try {journal?.record({kind:'error',data:{code}},request);} catch (_) {}
    closeJournal();
    if (submitted && !socket.destroyed) socket.write(JSON.stringify({ type: 'cancel', request_id: request.request_id }) + '\n');
    output({ kind: 'error', code });
    socket.end();
    process.exitCode = 1;
  }
  socket.on('connect', () => socket.write(JSON.stringify({ type: 'hello', token: runtime.token }) + '\n'));
  socket.on('data', chunk => {
    buffer += chunk.toString('utf8');
    if (buffer.length > 2_000_000) { fail('response_overflow'); return; }
    for (;;) {
      const cut = buffer.indexOf('\n');
      if (cut < 0) break;
      const raw = buffer.slice(0, cut); buffer = buffer.slice(cut + 1);
      let frame;
      try { frame = JSON.parse(raw); } catch { fail('invalid_json'); return; }
      if (frame.kind === 'hello') {
        if (authorized || frame.renderer_ready !== true) { fail('renderer_not_ready'); return; }
        authorized = true;
        socket.write(JSON.stringify({ type: 'complete', request_id: request.request_id, prompt: request.prompt }) + '\n');
        submitted = true;
        continue;
      }
      if (!authorized || !submitted || frame.request_id !== request.request_id) { fail('identity_mismatch'); return; }
      if (frame.kind === 'submitted') {
        try { journal?.record(frame,request); } catch (_) { fail('journal_source_unavailable'); return; }
        continue;
      }
      if (frame.kind === 'response' || frame.kind === 'transport_complete') continue;
      if (frame.kind === 'diagnostic' && ['onCompletion', 'onError'].includes(frame.data?.stage)) continue;
      if (frame.kind === 'snapshot') {
        const id = frame.data?.message_id, text = frame.data?.text;
        if (typeof id !== 'string' || typeof text !== 'string') { fail('invalid_snapshot'); return; }
        if (messageId !== null && messageId !== id) { fail('multiple_assistant_messages'); return; }
        messageId = id;
        try { journal?.record(frame,request); } catch (_) { fail('journal_write_failed'); return; }
        if (!text.startsWith(latestText)) { fail('non_prefix_snapshot'); return; }
        const delta = text.slice(latestText.length);
        latestText = text;
        if (delta) output({ kind: 'delta', text: delta });
        continue;
      }
      if (frame.kind === 'terminal') {
        if (finished || frame.data?.finish_reason !== 'stop' || !messageId || !latestText) { fail('invalid_terminal'); return; }
        try { journal?.record(frame,request); } catch (_) { fail('journal_terminal_failed'); return; }
        finished = true;
        clearTimeout(timeout);
        closeJournal();
        output({ kind: 'finished', finish_reason: 'stop' });
        socket.end();
        return;
      }
      if (frame.kind === 'error') { fail(frame.data?.code || frame.code || 'native_error'); return; }
      fail('unknown_frame'); return;
    }
  });
  socket.on('error', error => fail('pipe_' + (error.code || 'error')));
  socket.on('close', () => { if (!finished) fail('pipe_closed_without_terminal'); });
  process.on('SIGTERM', () => fail('client_cancelled'));
}

'use strict';
const fs = require('node:fs');
const net = require('node:net');
const crypto = require('node:crypto');
const runtimePath = process.env.CHATGPT_PC_BRIDGE_RUNTIME;
const CANARY = 'Reply exactly CHATGPT_PC_RAW_OK and nothing else.';
if (!runtimePath) throw Error('CHATGPT_PC_BRIDGE_RUNTIME is required');
const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
if (typeof runtime.pipe !== 'string' || typeof runtime.token !== 'string') throw Error('Invalid bridge runtime descriptor');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; if (input.length > 8192) process.exit(2); });
process.stdin.on('end', () => {
  let request;
  try { request = JSON.parse(input); } catch { throw Error('Invalid request JSON'); }
  if (typeof request.request_id !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(request.request_id) || request.prompt !== CANARY) throw Error('Unsupported staging request');
  run(request);
});
function run(request) {
  let buffer = '', authorized = false, submitted = false, finished = false;
  const texts = new Map();
  const socket = net.connect(runtime.pipe);
  const timeout = setTimeout(() => fail('timeout_unknown_do_not_replay'), 90000);
  function output(frame) { process.stdout.write(JSON.stringify(frame) + '\n'); }
  function fail(code) {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
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
      if (frame.kind === 'submitted' || frame.kind === 'response' || frame.kind === 'transport_complete') continue;
      if (frame.kind === 'diagnostic' && ['onCompletion', 'onError'].includes(frame.data?.stage)) continue;
      if (frame.kind === 'snapshot') {
        const id = frame.data?.message_id, text = frame.data?.text;
        if (typeof id !== 'string' || typeof text !== 'string') { fail('invalid_snapshot'); return; }
        const before = texts.get(id) || '';
        if (!text.startsWith(before)) { fail('non_prefix_snapshot'); return; }
        texts.set(id, text);
        const delta = text.slice(before.length);
        if (delta) output({ kind: 'delta', text: delta });
        continue;
      }
      if (frame.kind === 'terminal') {
        if (finished || frame.data?.finish_reason !== 'stop' || [...texts.values()].join('') !== 'CHATGPT_PC_RAW_OK') { fail('invalid_terminal'); return; }
        finished = true;
        clearTimeout(timeout);
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

'use strict';

const LIMIT_BYTES = 8192;
function fail(code) { throw new Error('PC_PROVIDER_' + code); }

function makePrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) fail('MESSAGES_EMPTY');
  if (messages.length > 16) fail('HISTORY_TURN_LIMIT');
  const turns = messages.map((message) => {
    if (Array.isArray(message.toolCalls) && message.toolCalls.length) fail('TOOL_CONTINUATION_UNSUPPORTED');
    const role = ({1:'user',2:'assistant',3:'system'})[message.role];
    if (!role) fail('ROLE_UNSUPPORTED');
    const pieces = message.content;
    if (!Array.isArray(pieces)) fail('PARTS_UNSUPPORTED');
    let text = '';
    for (const part of pieces) {
      if (!part || typeof part.value !== 'string') fail('NON_TEXT_CONTENT_UNSUPPORTED');
      text += part.value;
    }
    return {role, text};
  });
  if (turns[turns.length-1].role !== 'user' || !turns[turns.length-1].text.trim()) fail('LAST_MESSAGE_NOT_USER');
  const prompt = turns.length === 1
    ? turns[0].text
    : 'Conversation transcript (JSON with explicit roles). Continue by answering the last user message only:\n'
      + JSON.stringify(turns);
  if (Buffer.byteLength(prompt, 'utf8') > LIMIT_BYTES || prompt.includes('\0')) fail('INPUT_OVER_8192_BYTES');
  return prompt;
}

async function readSSE(body, onText) {
  if (!body || typeof body.getReader !== 'function') fail('NO_SSE_BODY');
  const reader = body.getReader(); const decoder = new TextDecoder();
  let buffer = '', doneCount = 0, finishReason = null, events = 0;
  async function onFrame(frame) {
    const lines = frame.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') { doneCount++; continue; }
      if (!data) continue;
      if (doneCount) fail('FRAME_AFTER_DONE');
      const obj = JSON.parse(data); events++;
      if (obj.error) fail('UPSTREAM_ERROR');
      for (const choice of obj.choices || []) {
        if (typeof choice.delta?.content === 'string') onText(choice.delta.content);
        if (choice.delta?.tool_calls?.length || choice.message?.tool_calls?.length) fail('UNSUPPORTED_TOOL_FRAME');
        if (choice.finish_reason !== null && choice.finish_reason !== undefined) finishReason = choice.finish_reason;
      }
    }
  }
  try {
    while (true) {
      const item = await reader.read();
      buffer += decoder.decode(item.value || new Uint8Array(), {stream:!item.done});
      buffer = buffer.replace(/\r\n/g, '\n');
      let n;
      while ((n = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, n); buffer = buffer.slice(n + 2);
        await onFrame(frame);
      }
      if (item.done) break;
      if (buffer.length > 262144) fail('SSE_FRAME_OVERSIZE');
    }
    if (buffer.trim()) await onFrame(buffer);
    if (doneCount !== 1 || finishReason !== 'stop' || events < 1) fail('TERMINAL_NOT_VERIFIED');
    return {doneCount, finishReason, events};
  } finally {reader.releaseLock();}
}

module.exports = {LIMIT_BYTES, makePrompt, readSSE};

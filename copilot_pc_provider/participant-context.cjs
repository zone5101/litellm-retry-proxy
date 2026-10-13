'use strict';
// ChatGPT PC ingress supports typed single-turn text only.
// This adapter does not inspect, read, serialize, or forward any VS Code
// reference, whether implicit or explicitly attached. Warn visibly instead.
// Tools remain unsupported; never silently discard a requested tool call.
const MAX_REFERENCE_COUNT = 128;
function validateReferences(request) {
  const refs = request?.references ?? [];
  const tools = request?.toolReferences ?? [];
  if (!Array.isArray(refs) || !Array.isArray(tools))
    throw new Error('PC_PARTICIPANT_REFERENCES_INVALID');
  if (tools.length) throw new Error('PC_PARTICIPANT_TOOLS_UNSUPPORTED');
  if (refs.length > MAX_REFERENCE_COUNT)
    throw new Error('PC_PARTICIPANT_REFERENCES_TOO_MANY');
  if (request?.command) throw new Error('PC_PARTICIPANT_COMMAND_UNSUPPORTED');
  // Deliberately do not access refs[i], .id, .value, .range or any attachment.
  return {omittedReferences: refs.length};
}
function countOmittedHistory(context) {
  const history = context?.history ?? [];
  if (!Array.isArray(history)) throw new Error('PC_PARTICIPANT_HISTORY_INVALID');
  // Never inspect, process or forward previous chat turns.
  return history.length;
}
module.exports = {validateReferences, countOmittedHistory};

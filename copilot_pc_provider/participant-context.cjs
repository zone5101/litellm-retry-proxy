'use strict';
// VS Code's automatically attached editor context is not an explicit user attachment.
// Retain fail-closed admission for explicit/unknown references and all tools.
const IMPLICIT_IDS = new Set([
  'vscode.implicit.file',
  'vscode.implicit.selection',
  'vscode.implicit.viewport'
]);
function validateReferences(request) {
  const refs = request?.references || [];
  if (!Array.isArray(refs)) throw new Error('PC_PARTICIPANT_REFERENCES_INVALID');
  if (request?.toolReferences?.length) throw new Error('PC_PARTICIPANT_TOOLS_UNSUPPORTED');
  let omittedImplicit = 0;
  for (const ref of refs) {
    if (ref && typeof ref.id === 'string' && IMPLICIT_IDS.has(ref.id)
        && ref.range === undefined) {
      omittedImplicit++;
      continue;
    }
    throw new Error('PC_PARTICIPANT_REFERENCES_UNSUPPORTED');
  }
  return {omittedImplicit};
}
module.exports = {validateReferences};

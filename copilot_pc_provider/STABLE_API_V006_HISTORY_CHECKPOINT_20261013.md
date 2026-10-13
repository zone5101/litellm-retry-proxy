# ChatGPT PC participant v0.0.6 — stable API & VS Code chat history preservation

Date: 2026-10-13. Branch: feat/chatgpt-pc-chat-adapter-20261013. Started from 85a71db.

## Root cause
- Installed v0.0.5 ChatParticipant used stream.warning() while omitting context. VS Code correctly rejected chatParticipantAdditions because this is a proposed API and this extension does not have permission.
- Preferred fix: avoid the proposed API rather than enabling it globally or starting production VS Code with --enable-proposed-api.
- v0.0.6 uses only stable ChatResponseStream.markdown() to visibly warn about omitted references/history; still does not read or send those values.

## Verification
- 20/20 Node tests PASS, including a regression that no stream.warning() is called and no enabledApiProposals are declared.
- VSIX v0.0.6 installed as livingos-local.chatgpt-pc-staging-copilot.
- Installed participant invoked from a Node VS Code shim that throws for any proposed response-stream property. It streamed a real response from isolated ChatGPT PC through LiteLLM while omitting unreadable references/history and showing a note. PASS.
- Receipt: ../isolated_renderer_bridge/evidence/stable-api-v006-real-e2e-20261013.json. This is NOT a Copilot UI-origin receipt.
- Port 19493 stopped after test; production port 4000 not touched.

## User chat history reality
- VS Code state.vscdb ChatSessionStore.index contains 454 entries, previous DB backup contains 354; user sessions were not deleted by this patch.
- 45 empty-window chat files (~123.5 MB) and 62 workspace chatSessions files are still present; 414 indexed sessions marked isExternal.
- Backed up 110 verified chat/session database files (~149.5 MB) to F:/VSCodeChatPreservation/chat_history_snapshot_20261013_1810. See BACKUP_RECEIPT.json.
- Backed up settings.json and changed chat.agentSessions.showExternal from recent to all, plus chat.viewSessions.enabled to true. These settings only affect visibility; chat data remains unchanged.

## Remaining
- The actual VS Code Chat view needs to reload its extension host to pick up v0.0.6; do not mark user UI E2E PASS until a request enters participant and reaches participant.pass.
- If history is still not visible in a workspace-scoped list, inspect the Sessions filter and change it from Active to All; consider opening a folderless window to see other workspaces. Do not overwrite the session store or delete files.
- Do not re-enable experimental API; do not touch production ChatGPT or LiteLLM port 4000.

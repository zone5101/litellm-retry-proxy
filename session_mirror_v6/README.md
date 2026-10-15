# V6 single-authority session journal

**Architecture:** One authenticated ChatGPT conversation, one native ChatGPT PC session source, one SQLite WAL journal, VS Code/Copilot as a read-only projection/UI. Android must use that *same* backend conversation ID. No Chrome Web ↔ ChatGPT PC reconciliation, no second model, no prompt-history imitation.

## What is actually proven
- v6 isolated ChatGPT PC renderer: native `submitted.conversation_id`, assistant `snapshot.message_id` and one terminal on a **new native request**, with a live canary PASS.
- Native v6 events can optionally be persisted in SQLite WAL; `CHATMODE_JOURNAL_PATH` and `CHATMODE_SOURCE_SCOPE` are off by default.
- Each DB has exactly one `chatgpt-pc:` source scope bound persistently by `journal_authority`. A second browser/app/profile scope is rejected. **This is source fencing, NOT proof that two ChatGPT clients are logged into the same account.**
- One source may have multiple real conversations, distinguished by actual source conversation IDs. No invented message IDs or turns.

## Correction / removed paths
- Removed the earlier Chrome Web DOM observer, separate browser journal, browser smoke test and simulated Chrome/PC reconciliation. They would create precisely the two independently synchronized versions that must not exist.
- Any future DOM observer must be **inside the one authorized ChatGPT PC renderer** and must resolve into that native conversation identity before it writes the **same** journal, not a second feed or Chrome source.
- No private VS Code/Copilot DB mutation, Chrome-to-PC scraping, ChatGPT ASAR production patch, polling, or blind replay.

## Hard acceptance gates still outstanding
1. Verify the account identity for the *one* native PC session; a string label (`sourceScope`) is insufficient. Verify the Android account is identical.
2. Demonstrate opening and **continuing the same existing native conversation_id** from Android (real two-turn E2E) without constructing fake history, spawning a new conversation, or replaying requests.
3. Confirm VS Code/Copilot can render this source's journal in its supported Chat Sessions interface. If the API is proposed/unavailable, fail closed rather than adding a shadow UI or patching an agent-host database.

### Native WinUI and live two-turn E2E receipt — 2026-10-15
- Used native `ui_query` to enumerate Windows and read VS Code controls; the isolated v6 ChatGPT PC process PID 32728 was alive but had no visible top-level ChatGPT window (`MainWindowHandle = 0`). Asking WinUI for ChatGPT returned the focused VS Code window instead; reject it as ChatGPT identity evidence.
- One replay-guarded **live two-turn** test against the same isolated v6 native PC renderer: both responses completed, both were recorded to one SQLite journal, but native `submitted.conversation_id` values were **different (2 distinct IDs)**. `same_native_conversation` = **FAIL**. A correct second answer does not override source IDs.
- Receipt: native request `5a81e19b-a248-497a-a4b0-6ca7852cf3fc` and private local `.attempt` guard; do not copy the conversation database or prompts to Git.
- `chatgpt_pc_pipe_client.cjs` now rejects explicit `conversation_id` / `conversationId` / `session_id` / `sessionId` / `thread_id` / `threadId` (or `CHATMODE_EXPECT_CONVERSATION_ID`) before submitting to the v6 renderer. The **missing continuation API cannot be simulated**. No second source or history-replay fallback.

### Native continuation prototype (separate branch, 2026-10-15)

Read directly from the exact v6 renderer bundle: `Jwi(scope, {conversationId, prompt, ...})` accepts a native thread identity and forwards it into `Zwi`. In `Zwi`, `onServerThreadIdChange` is fired with the backend server conversation ID after the local thread acquires its server identity. Native `submitted.conversationId` from earlier real E2E is a **50-character local ID** shaped `local-XXXXXXX:UUID`; it is not itself proof of Android/backend conversation identity.

- `CHATMODE_ENABLE_VERIFIED_CONTINUATION=1` and exact `CHATMODE_EXPECT_CONVERSATION_ID` are isolated opt-ins. The existing SQLite journal must already have a completed turn with that exact native ID. Otherwise the client refuses **before touching the pipe**.
- Renderer handshake advertises `native_conversation_continue_v1`; the old v6 bridge does not, so fallback to an unsupported renderer is prohibited.
- One exact `conversation_id` is forwarded client → pipe main → renderer → `Jwi`; `submitted.conversation_id` is checked against the requested ID. Any mismatch reports `native_conversation_id_mismatch_do_not_replay`.
- Callback `onServerThreadIdChange` is captured without logging raw account credentials. The same journal stores local-to-server mapping and rejects a conflicting server UUID; a missing callback remains `serverConversationId:null`, never an invented mapping.
- **Mock-pipe E2E PASS** for same ID over two turns, legacy handshake negative, incorrect-ID negative; no actual ChatGPT backend second-turn E2E has been run with the modified renderer.
- The old isolated v6 app is still running and **has not loaded this new renderer code**. Actual same-account Android/PC acceptance, a signed-in visible WinUI session, and VS Code Chat Sessions projection remain blocked/not proven.
- A single earlier live negative probe was consumed but never reached the bridge: the historical native local ID failed the prototype's initial UUID-only validator. The validator now accepts the verified local-ID format. **Do not replay that request**.

Until gates 1–3 pass, this is **isolated recorder work**, not an Android↔PC synchronizer.

## Tests
`node --test copilot_pc_provider/test.cjs copilot_pc_provider/participant-test.cjs copilot_pc_provider/participant-context-test.cjs session_mirror_v6/journal.test.cjs`

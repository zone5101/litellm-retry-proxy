# V6 selective session recorder and DOM admission probe

Status (2026-10-15): **v6 direct pipe -> journal live canary PASS; DOM reader UNIT-TESTED ONLY; browser-originated DOM E2E NOT PROVEN.** Isolated clean-clone branch only. No production installation.

## Proven baseline
- Existing v6 pipe stream preserved by default; `CHATMODE_JOURNAL_PATH` and `CHATMODE_SOURCE_SCOPE` activate an opt-in SQLite WAL journal only for the isolated v6 client.
- Live v6 canary `V6_JOURNAL_CANARY_20261015` returned exactly one successful terminal. Read-only DB verification: one source conversation, one user submitted, one assistant snapshot, one assistant completed; journal_mode=wal.
- Original 20 tests plus 3 journal tests plus 5 DOM probe tests PASS. The DOM tests use synthetic DOM fixtures, **NOT** live Chrome.

## Ponytail selection and source boundary
- **REUSE (behavior):** source IDs, validated `submitted`/`snapshot`/`terminal` events and exact terminal handling from v6.
- **DO NOT COPY:** v6 LiteLLM/StageOwner model transport into the recorder; `makePrompt` serialized pseudo-history; v7/v11 session-transport code; modified vendor app binaries; Copilot/Codex private DBs.
- Browser candidate: a *real* ChatGPT Web tab was observed in Chrome by read-only Windows accessibility. Its URL contained a conversation ID. **No message DOM IDs were independently verified, no Chrome observer installed, and no assertion that this tab equals the Android conversation.**
- `web_dom_probe.cjs` is a **candidate** read-only `MutationObserver` extractor scoped to actual `https://chatgpt.com/c/<uuid>` routes. Only accepts DOM nodes having **both** `data-message-author-role` and `data-message-id`. Requires role-specific content nodes; never falls back to arbitrary page text, temporary index IDs, or fake ChatGPT history.
- `SOURCE_NOT_AVAILABLE`, `MESSAGE_IDS_NOT_VERIFIED`, `MESSAGE_ID_ROLE_CONFLICT`, and `SOURCE_OVERFLOW` are fail-closed signals, not PASS. `VISIBLE_ONLY` is NOT history completeness nor cross-device freshness.

## Privacy and deployment
- Explicitly selected conversation and account/source scope required before persisting browser-originated text. The probe alone writes nothing and transmits nothing; no network listener, browser extension, native messaging registration, or external credentials are installed.
- Never mix v6-isolated and browser-chat source scopes. Never store SQLite/transcript on Git, logs, or diagnostics. Do not poll ChatGPT, Chrome, Supabase or the source conversation.
- A genuine DOM acceptance gate requires observing exact stable source message ID attributes in a real authorized browser session. If the attributes differ, adapt only after inspecting those exact elements and rerun tests. A DOM observer can record only page changes it actually receives; it does not guarantee Android-originated realtime when the PC page does not update.
- VS Code Chat Sessions provider and same-native-conversation write/tool continuation are separate unproven gates.

## DOM-to-journal integration (isolated only)

- `visible_dom_journal.cjs` admits only `VISIBLE_ONLY` records for an **explicitly authorized single conversation UUID** and a separate `browser:` scope. Source message IDs and roles are mandatory; revisions are recomputed from persisted content. Batches are atomic and roll back on role conflicts. The projection always declares `terminalState: NOT_OBSERVED`; a visible assistant message is **not** proof of terminal completion.
- Browser observations and v6 native turns use **different tables and source scopes**, even when conversation IDs happen to match. No synthetic request ID is assigned to browser events.
- `chromium_dom_smoke.cjs` successfully exercised a real Chromium MutationObserver on a synthetic, isolated HTML fixture using a separate temporary browser profile. **This is not a successful reading of the signed-in ChatGPT tab.**
- Windows UI Automation can expose some rendered Chrome text and the chat URL, but does not confirm the stable DOM message ID attributes. The running Chrome instance has no remote debugging listener. Live DOM capture and browser-to-Node transport remain **unverified and uninstalled**. No polling, no forced Chrome restart, no production extension mutation.
- Installed VS Code version is 1.141.1. `chatSessionsProvider` registration is a proposed API; registration and real Copilot/Agents Window presentation are **not** marked PASS. Do not patch private Copilot state or deploy a fake Codex session.

## Tests
`node --test copilot_pc_provider/test.cjs copilot_pc_provider/participant-test.cjs copilot_pc_provider/participant-context-test.cjs session_mirror_v6/journal.test.cjs session_mirror_v6/web_dom_probe.test.cjs session_mirror_v6/visible_dom_journal.test.cjs`

`node session_mirror_v6/chromium_dom_smoke.cjs`

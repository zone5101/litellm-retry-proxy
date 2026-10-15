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

## Tests
`node --test copilot_pc_provider/test.cjs copilot_pc_provider/participant-test.cjs copilot_pc_provider/participant-context-test.cjs session_mirror_v6/journal.test.cjs session_mirror_v6/web_dom_probe.test.cjs`

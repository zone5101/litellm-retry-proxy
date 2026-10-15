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

Until gates 1–3 pass, this is **isolated recorder work**, not an Android↔PC synchronizer.

## Tests
`node --test copilot_pc_provider/test.cjs copilot_pc_provider/participant-test.cjs copilot_pc_provider/participant-context-test.cjs session_mirror_v6/journal.test.cjs`

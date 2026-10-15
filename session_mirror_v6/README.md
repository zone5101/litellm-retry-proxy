# V6 selective session journal (isolated PoC)

This does NOT copy the v6 provider or launch another model/proxy. Only the existing v6 pipe client in this clean clone is optionally instrumented. Never enable on the installed extension or production app without a distinct source permission and E2E gate.

For opt-in: set `CHATMODE_JOURNAL_PATH` to a private local `.sqlite` file and `CHATMODE_SOURCE_SCOPE` to a verified opaque account/source scope. Neither is set by default. The journal records the real `submitted.conversation_id`, source `snapshot.message_id`, revisions, user prompts and terminal. No tool execution or completion replay. Do not commit or publish the journal, which contains private chat text.

Known limits: v6 provides only the conversation it initiates, not arbitrary Android chats. It has no demonstrated authenticated *continue existing conversation* function. A two-turn synthetic journal regression is NOT a real two-turn ChatGPT E2E. Installed VS Code Chat Sessions proposed API and DOM selectors remain unverified; no provider or DOM scraper has been added. `source_scope` is an explicit operator-supplied partition, not proof of account identity; do not mix sessions across accounts.

`node --test copilot_pc_provider/test.cjs copilot_pc_provider/participant-test.cjs copilot_pc_provider/participant-context-test.cjs session_mirror_v6/journal.test.cjs`

Do not use `makePrompt` to fake native conversation history; do not take v0.0.7-v11 transport code; do not patch production ASAR, `.codex`, `agent-host.db`, or ChatGPT credentials.

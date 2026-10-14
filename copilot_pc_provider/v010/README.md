# Local Agent v0.0.10 — first-context and 95-tool admission repair

Status: TESTED / PREVIEW RELEASE CANDIDATE / LIVE TOOL EXECUTION NOT VERIFIED.

This experiment starts from the v6-derived Local model provider version 0.0.7, preserving the same model vendor `chatgpt-pc-isolated` and model ID `chatgpt-pc-chat`. The new module adds a structured JSON-based tool intent adapter using stable VS Code `LanguageModelToolCallPart` and `LanguageModelToolResultPart`. It is **not** native ChatGPT tool-channel/Ywi interoperability.

Host tool admission and execution are owned by VS Code. A JSON message is not a completed tool action. Offered tool names are checked; unbound/mismatched results and ambiguous sessions are refused; native conversation identity is preserved.

Proof:
- Real ChatGPT PC native endpoint can return machine-readable JSON within `<escape>` wrappers, terminal receipt `f8289c56-919a-40a1-b13f-7c15fe54e703` (ordinary final JSON only).
- Protocol simulated 3/3 pass and extension-host shim integration 1/1 pass, regression suite total 28/28 PASS, terminal `074d0fba-0234-4ac2-8668-e21f7a87b767`.
- Actual model-origin tool-intent probe blocked before execution; no downstream terminal, no retry.
- Actual VS Code Agent host tool execution, native return, Local Agent UI E2E: NOT PROVEN.
- Installed v0.0.7 remains unchanged with `toolCalling=false`.

Do NOT claim full host tool E2E PASS or submit BAM activation, or claim Local Agent acceptance until actual end-to-end host and native backend evidence exists. Also do not use Git/BAM as an alternative route around a rejected tool action.


v0.0.10 routes both text and Local Agent native transports through one cross-process renderer admission gate. NOT_DISPATCHED restores session state; ambiguous delivery remains UNKNOWN_DO_NOT_REPLAY.

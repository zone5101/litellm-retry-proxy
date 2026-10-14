# Local Agent v0.0.9 — first-context and 95-tool admission repair

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

## Binding UNKNOWN recovery and owner continuation (2026-10-14)

For v0.0.10+ admission incidents, read [UNKNOWN_RECOVERY_CONTRACT_CURRENT.md](./UNKNOWN_RECOVERY_CONTRACT_CURRENT.md) **before** concluding a task is blocked. The contract is normative, not an optional investigation guide.

- `UNKNOWN_DO_NOT_REPLAY` and `DISPATCHING` mean **nonterminal recovery required**, not "done/failed" and not proof of native submission.
- The original request owner must correlate durable request ID, renderer generation, exact native submission acknowledgement, terminal and VS Code host events. No implicit release by PID/time/no logs.
- `WAIT_EXPIRED_NOT_DISPATCHED` applies only to the waiting request and does not reconcile the request holding the lock.
- If direct evidence is missing, produce a bounded `PENDING_AUTHORIZED_RECONCILIATION` checkpoint with owner, missing capability, evidence refs, exact next action; keep ownership and fix future telemetry on Git. Do not ask the user to serve as command relay.
- **Read-only diagnosis:** `node recovery_classify.cjs <absolute-admission-lock-dir>`. This only classifies and prints JSON; it cannot release a lock, retry a prompt or claim actual E2E.
- Mandatory targeted tests: `node --test recovery_classify.test.cjs`. Production recovery requires an independent authority-backed CAS workflow; this classifier alone is not that workflow.

Current live legacy incident: owner PID 33872, token `5900492f-8926-4f9e-8f4d-dbcdf666dc7b`, phase `DISPATCHING` without durable native request ID. The only grounded classification is `INSTRUMENTATION_GAP` and pending authorized reconciliation, until new independent evidence resolves the original delivery. Do not delete that lock to make tests pass.


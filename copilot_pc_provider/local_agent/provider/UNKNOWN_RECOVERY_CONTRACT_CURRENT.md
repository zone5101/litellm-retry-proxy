# Local Agent UNKNOWN recovery contract (v1, binding)

Scope: VS Code `chatgpt-pc-isolated/chatgpt-pc-chat` v6-derived Local Agent, shared renderer admission and its operator/manager owner. This contract supersedes "inspect logs and stop if missing" for the single unresolved GUI-origin E2E frontier. It does **not** grant new BAM, VS Code host-tool or native-renderer permissions.

## Purpose and nonterminal rule

`UNKNOWN_DO_NOT_REPLAY` means **delivery/outcome is not proven**. It is a **nonterminal incident**, NOT a successful task completion, NOT proof that the native request is running, and NOT permission to silently retry. A worker that merely records `DISPATCHING`, times out a second request and reports "need receipt" has not finished. It MUST hand an identified, evidence-linked recovery work item to the responsible owner and continue all read-only diagnosis that remains possible.

The manager/owner is accountable for closing the incident; failure of native tools or missing logs does not silently return execution responsibility to the user. If the authorized reconciliation capability is missing, return a precise capability/authority blocker and escalation target, and keep the task nonterminal.

## Required durable transaction identity BEFORE native dispatch

Each admitted turn MUST have a nonsecret durable record with these fields, recorded before the child client can write to the renderer:

- `schema`, `frontier_id`, `owner_epoch`, `owner_token`, `pid`, `route=text|agent`, `request_id`, `session_id`, `conversation_id|null`, `prompt_sha256` or equivalent content fingerprint, `admission_at`, `transport_instance_id` or renderer generation, and `phase`.
- `native_submit_ack_ref|null`, `renderer_terminal_ref|null`, `host_tool_call_id|null`, `host_tool_result_ref|null`, `error_code|null`, and `recovery_checkpoint_ref|null`.
- Never persist raw prompt, tool result, bearer token, renderer token or credentials in this record. Write receipts durably/atomically; do not rely on a transient terminal or chat transcript. Owner and request identity must be checked before a transition.

Current v0.0.10 owner schema has only fingerprint/token/PID/time, and MUST be classified `LEGACY_UNCORRELATABLE` until the exact request is independently resolved. A process being alive and a fingerprint match are insufficient evidence of dispatch or completion. Do not manufacture correlation IDs retroactively.

## State machine (fail closed)

`ADMITTED → CLAIMED → PREPARED → SUBMITTED → TERMINAL_CONFIRMED → RELEASED`

- `CLAIMED`: atomic cross-process ownership; no request dispatched yet.
- `PREPARED`: validated request ID/session/renderer generation and persisted pre-send evidence; **not proof** native send occurred.
- `SUBMITTED`: verified renderer acknowledgement referencing the exact request ID/session. A local child spawn, pipe write, or an `end()` call alone does NOT count as a renderer ACK.
- `TERMINAL_CONFIRMED`: exact renderer terminal, child close, session binding, and any host-tool return evidence all satisfy their independent obligations. Persist durable terminal receipt BEFORE releasing the lock.
- Failure before any possible native send, with positive evidence, transitions to `NOT_SUBMITTED_PROVEN`; only an authorized, fenced compare-and-set cleanup may release that owner. A timeout, missing file, dead/alive PID or absence of logs is not such evidence.
- Ambiguous failure in `PREPARED` or `SUBMITTED` transitions to `UNKNOWN_RECONCILE_REQUIRED`. Keep lock and original request; never replay by age, cancellation, worker restart, alternate transport or a changed request ID.
- Cancellation request is not a completion acknowledgement. `WAIT_EXPIRED_NOT_DISPATCHED` belongs only to the **waiting request**, and does NOT reconcile the owner of the lock.

In every uncertain state, emit a bounded incident record with the exact last proven transition and concrete missing evidence.

## Mandatory recovery workflow (no generic "check logs" loop)

1. Freeze only the affected admission frontier. Preserve owner file, renderer, host session and all original logs; do not perform another model/tool dispatch. Identify the exact locked owner token and its timestamp once. Never do recurring broad native-history polling.
2. Inspect the exact native client request ID, renderer generation, socket submission/ACK, conversation binding, terminal event, process/child exit receipt and VS Code host tool event. Join on **exact IDs**, not on recency, PID existence, or similarity of text. For a legacy record with no request ID, inspect the bounded time window and explicitly record the instrumentation gap; do not infer outcome.
3. Classify as one of `NOT_SUBMITTED_PROVEN`, `SUBMITTED_TERMINAL_PROVEN`, `SUBMITTED_OUTCOME_UNKNOWN`, or `INSTRUMENTATION_GAP`. Give each class a durable evidence hash/ref and explain what independent source proves it.
4. `NOT_SUBMITTED_PROVEN`: authorized owner verifies no possible renderer acceptance, then compare-and-set clears its own lock; only then may a **new** request be admitted under its ordinary policy. `SUBMITTED_TERMINAL_PROVEN`: reconcile result into original session exactly once without another renderer execution; release only via token-bound authorized transaction. `SUBMITTED_OUTCOME_UNKNOWN` or `INSTRUMENTATION_GAP`: quarantine the original request and retain its lock; produce a bounded recovery checkpoint and route to the authorized BAM/manager reconciliation capability. Do not ask the operator to act as a command relay.
5. If reconciliation cannot finish within the one bounded investigation window, stop *probing*, not ownership: publish `PENDING_AUTHORIZED_RECONCILIATION` with `owner`, `blocking_capability`, `exact_request_or_legacy_window`, `next_action`, `evidence_refs`. An escalation is NOT a PASS and may not be labelled full E2E complete.
6. Root-fix the telemetry/causal path on the Git source branch with targeted tests and hash-pinned rollout authorization. Do not overwrite a live lock or deploy via Git/BAM to evade an operation rejected by a safety/permissions layer. Recovery for the original unknown request and rollout of a new implementation are **separate** frontiers.

## Ownership and anti-loop

- Controller/Manager owns routing and the durable checkpoint; BAM executes only its granted capability; Yang/Hestia roles follow canonical LivingOS assignment. The user is not the recovery transport.
- A repeated evidence digest or a second unsuccessful read of the same source without a new hypothesis ends that probe branch. Do not loop on `machine_query(native_history)`, recurring Supabase polling, or broad recursive log scans.
- Timeout/error from `machine_query` is evidence of tool/query failure only, not evidence of native completion; use one alternate supported **read-only** evidence path if available.
- Every interruption or compaction MUST resume from `owner_token + frontier_id + checkpoint_ref` after readback. Do not replace the original lock, session or in-flight ID.
- `PENDING_AUTHORIZED_RECONCILIATION` remains visible and assigned. If no authorized capability exists, state the exact limitation, not "E2E failed permanently".

## Acceptance gates

Parser/admission, native dispatch and real VS Code host execution are three separate outcomes:
- `ADMISSION_PASS`: simultaneous text/Agent requests across multiple extension hosts never overlap, and waiting requests fail without poisoning existing session identity.
- `RECOVERY_PASS`: fault injection proves pre-send failure, lost renderer ACK, post-submit transport crash, duplicate/restart, stale lock and unknown owner all produce correct correlation evidence, no replay and deterministic authorized reconciliation; receipts verify transition ownership and CAS.
- `HOST_TOOL_E2E_PASS`: a GUI-origin tool intent produces a VS Code-host-executed tool call, a verified host result returns to the same native `conversation_id`, and exact terminal receipts exist.
- `GIT_RUNTIME_PASS`: source SHA and runtime hash match independently.
No replacement of any of these with synthetic JSON or shim-only tests. The claim `FIXED` requires all applicable gates.

## Current incident classification

v0.0.10 owner token `5900492f-8926-4f9e-8f4d-dbcdf666dc7b`, PID 33872, first dispatch window 2026-10-14T12:36:34Z, phase `DISPATCHING`, no request/conversation ID in owner record. Observed `DELIVERY_UNKNOWN_DO_NOT_REPLAY`; subsequent 95-tool request failed `WAIT_EXPIRED_NOT_DISPATCHED`. Class: `INSTRUMENTATION_GAP / PENDING_AUTHORIZED_RECONCILIATION`, not `HOST_TOOL_E2E_PASS`. The existing lock MUST NOT be deleted or reclassified solely by this contract. 

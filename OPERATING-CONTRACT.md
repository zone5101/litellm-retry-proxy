# OPERATING CONTRACT v2 - Reality-First agent operating contract

> Canonical copy for cloud agents. Raw URL: https://raw.githubusercontent.com/zone5101/litellm-retry-proxy/main/OPERATING-CONTRACT.md

## MCP tools - use automatically (main stack: Daedalus + Copilot, 2026-10-11)

The user's main stack is Daedalus + Copilot Chat (Codex retired). Use the 4 MCP
tools proactively without being reminded:

1. context7 - library docs BEFORE coding against any library/API (no guessing).
2. livingos-native - all local machine/runtime state questions (processes, ports,
   services, files); never answer from memory.
3. realityfirst - MANDATORY before any done/working/fixed claim: classify_claim +
   real readback evidence + validate_evidence (see Daedalus Reality contract).
4. rockman-mastery (nexus) - begin_task at the start of non-trivial multi-step
   tasks, contribute_pattern for evidence-backed patterns, complete_task at end.

Evidence-first: claims about files/servers/APIs require tool readback. If an MCP
tool fails twice, note it and continue best-effort.
# OPERATING CONTRACT v2 (Reality-First, 2026-10-11)

Grounded in the actual realityfirst_mcp source (G:\Projects\realityfirst-mcp\src).
Core invariants: REALITY > CLAIM - READ WIDE, LOAD NARROW - FILE EXISTS != ACTIVE -
HISTORY != CURRENT - CLAIM != FACT - UNKNOWN SIDE EFFECT => NO BLIND REPLAY -
USE TOOL FOR FACTS, MODEL FOR DECISIONS - REPLACE => PROVE => CUTOVER => RETIRE OLD.

## A. Claim & evidence gates (per claim type, AND across groups, OR within)
- file_written -> readback OR (hash + artifact_stat); file_deleted -> absence_check
- build_completed -> terminal_receipt OR artifact_stat; tests_passed -> test_receipt + terminal_receipt
- deployed/restarted -> runtime_probe; current_state -> runtime_probe OR current_law
- Diagnostic/negative claims ("X is down", "network is fine") are current_state/observation
  claims -> they ALSO need runtime_probe or readback evidence. No exception.
- Evidence payload must validate structurally (ref/path/algorithm/digest/size/mtime);
  a model-supplied label alone NEVER counts (completion-gates.v2 rule).
- Conflicting sources -> resolve_precedence: live_reality(100) > current_law(90) >
  latest_cutover(80) > active_implementation(70) > history(20) > model_report(10).
- Before repeating any side-effect operation -> check_replay_safety: COMPLETED/PASS => BLOCK
  (never duplicate); RUNNING/SUBMITTED => BLOCK (resolve lineage); side effect UNKNOWN => BLOCK;
  FAILED_NO_SIDE_EFFECT => ALLOW_WITH_NEW_DECISION.
- Model mistake discovered -> record_loss(claim, why_wrong, corrected_form, evidence_refs,
  prevention_rule) AND persist the entry (tool does not persist) into the loss section of the
  relevant MAINTENANCE.md.

## B. Tool self-healing (no dead tools)
- A tool failing twice is NOT a reason to skip it forever. Sequence: (1) diagnose root cause
  (read its source/config, run livingos-native forensics), (2) FIX the tool or its pipeline,
  (3) rebuild/restart + verify attach with a real readback, (4) resume the original work.
- Known example: rockman core down (NOT_STARTED: PRIMARY_ATTACH_ENDPOINT_ABSENT) -> forensics
  showed stale descriptor, port dead -> start run-rockman-mcp.cmd -> verify attach -> resume.
- Continuous improvement: when a tool proves clumsy or missing during real work, upgrade it
  (small, verified, documented). Example: context7 was missing from Daedalus on 2026-10-11 ->
  added to cline_mcp_settings.json with autoApprove, same day.
- Every tool repair gets recorded in that system's MAINTENANCE.md + git commit.

## C. Where to record (done means RECORDED; unrecorded work does not count as done)
- Per-system maintenance doc: <system-folder>\MAINTENANCE.md — what/why/how/rollback/losses.
  Reference pattern: C:\Users\Z One\.litellm-retry-proxy\MAINTENANCE.md.
- Code/config changes -> git commit in that system's repo (+ push if a remote exists).
- Losses & lessons -> same MAINTENANCE.md, section 'Losses & lessons' (from record_loss).
- Live machine state -> livingos-native forensics artifacts as evidence refs (never hand-copy).

## D. Context-loss / handoff protocol (dut ganh)
On a fresh session, after compaction, or taking over a dead session — read IN THIS ORDER:
1. Workspace AGENTS.md (this file) — behavior + tool rules.
2. The target system's MAINTENANCE.md — what/why/how/rollback + current state.
3. git log of the system's repo — what was done, last checkpoint.
4. .freecline\data\sessions\<id>\*.json — previous session metadata (prompt, status, tokens).
5. livingos-native forensics for LIVE state (processes/ports/files) — reality beats any note.
Rules: resume from the last evidence-backed checkpoint; never redo from scratch; never guess.
If the old plan cannot be found, re-plan with read_wide (classify CURRENT/ACTIVE/RETIRED/
HISTORICAL/UNKNOWN) then deep-read only decisive files.
During long tasks: checkpoint proactively (MAINTENANCE.md update or git commit) after every
meaningful milestone. When context is nearly exhausted: write a short handoff note (current
state + file paths + next step) into the checkpoint doc BEFORE doing anything else.

## E. Playbook (nhin vao la biet)
- LAM GI: doc contract nay -> chon hanh dong theo trigger cua tung tool.
- LAM THE NAO: tools for facts, model for decisions; read wide, load narrow; prove -> cutover -> retire.
- GHI VAO DAU: MAINTENANCE.md + git commit + loss ledger. Done = recorded.
- DUT GANH: follow D; reality > any note.
- realityfirst also exposes 3 MCP prompts: reality_first, read_wide, crosscheck_completion.
# ChatGPT PC Chat Mode adapter (staging, NOT LIVE)

Target endpoint: http://127.0.0.1:4000/v1/chat/completions
Model proposal: chatgpt-pc-chat
This is an isolated CustomLLM adapter boundary, not a real ChatGPT PC E2E.

Never substitute Codex app-server, the LiteLLM chatgpt/ Codex provider,
CDP/Electron injection, UI automation, or extracted session tokens.
An external, authenticated and verified ordinary Quick Chat ingress is absent
from the current installed ChatGPT PC build. Missing ingress fails closed.

After verified ingress exists, mount into LiteLLM model_list:
  - model_name: chatgpt-pc-chat
    litellm_params:
      model: chatgpt-pc-chat/native
And under litellm_settings:
  custom_provider_map:
    - provider: chatgpt-pc-chat
      custom_handler: chatgpt_pc_chat_adapter.chatgpt_pc_chat_adapter

Do not change or restart the live free-router.config.yaml yet.
The existing agent-auto/fast/strong/omni/small must remain untouched.
For tests: python -m unittest discover -s tests -p test_chatgpt_pc_chat_adapter.py
Mock-backed unit tests are not real ChatGPT inference tests.
Missing: verified native Chat ingress, tool-stream mapping, cancellation,
tool-result continuation and terminal/replay E2E.
Reference: canonical/checkpoints/CHATGPT_PC_NATIVE_PROVIDER_RESEARCH_20261012.md

## Renderer-owned ingress frontier (isolated PoC, 2026-10-13)

The installed `app.asar` SHA-256 remains
`C5FDEF328CFA2AD9095786F9C3A7AAA447E68834D31299D6EF2592DA02029038`.
In `webview/assets/app-initial-b8e1c8014bb4.js`, `Jwi` is exported as `wRt`
and calls `Zwi`; `yD = fd(q, ({scope:e}) => new aln(e))` is exported as
`dMn`. `Zwi` calls `e.get(yD).startCompletionStream(...)`. These exports are
symbols, not a live scope handle. `app-shared-737655e1fb23.js` creates
`AppScope` (`X=sO('AppScope')`), obtains its mounted value with `hA(X)` through
React context, and initializes the service lazily through the scope binding.
The root renderer also mounts an app-scope provider (`$c({scope:q,...})` in
`app-initial-b8e1c8014bb4.js`); Quick Chat uses the mounted context. A
separately imported module cannot acquire the active scope merely by
importing `dMn` or `wRt`. `app-primary-19fe57fd8c00.js` imports both aliases
for internal use, which does not create an external API.

Candidate ingress outcomes for this build:

- **Native `Jwi` in Quick Chat:** owned by the trusted renderer. A mounted
  component passes the live scope; result callbacks stay in the renderer.
  This is the preferred native call *if* an authorized owner ever exposes an
  inbound interface. No external request channel to that component exists.
- **App-host MessagePort/IPC:** owned by the preload/main process. The renderer
  creates `connect-app-host`; main checks the registered trusted sender. It
  supplies outbound authenticated fetch, not an external `Jwi` dispatch or
  response stream. The shipped `.vite/build/preload.js` exposes
  `electronBridge` methods including `sendMessageFromView`, but exposes no
  Chat submission or live-scope accessor. An adapter cannot impersonate its
  trusted sender or use that renderer-to-main method as an inbound channel.
- **Localhost WebSocket/HTTP from the renderer:** no listener or renderer
  receiver is shipped. `webview/index.html` has no localhost/127.0.0.1 in
  `connect-src`; runtime connectivity was not probed. This does not establish
  CSP compatibility, and changing CSP/webSecurity is outside scope.
- **Plugin/composer extension:** official plugin documentation describes
  message sending from a plugin UI and tool/data contributions. It does not
  document an external-request-to-model stream, tool-call interception, or
  tool-result continuation returned to the plugin. Main-process code attaches
  MCP App content as a separate sandboxed guest WebContents with context
  isolation and web security, not as a child of the root `AppScope` provider.
  Importing `dMn` there would not resolve the parent's live scope.
- **Isolated vendor-app instrumentation:** could be designed around `Jwi` in
  a separate app copy by mounting a narrow bridge under the root `AppScope`
  provider and providing a validated inbound channel and result/cancel
  callbacks. This would modify the vendor bundle and potentially its package
  signature, authentication behavior and update compatibility. No app copy
  was modified or run; the intervention remains unverified and requires a
  separately authorized experiment before it can be claimed as a path.

`chatgpt_pc_renderer_contract.py` provides a neutral `ChatTurnEnvelope`,
`RendererIngressContract`, `IsolatedContractBackedIngress`, bounded
`StreamEventTranslator`, and exact-identity `ToolContinuationLedger`. The
adapter-shaped ingress is not auto-installed. Its input is a *proposed owner-projected callback*
with a bridge-assigned sequence, not a raw native payload or live connection.
`onDecodedEvent`/`onUpdate` full assistant text snapshots yield prefix deltas;
transport metadata is never text; only an owner-projected, explicitly verified
completion with final-state evidence (`finish_reason`) produces one terminal
frame only after the callback source ends without a conflicting event.
Cancellation discards late frames; gaps, conflicting replays, unknown
tool content, premature close, unaccepted responses, and queue/text-budget overflow
fail closed. The ledger claims each tool execution once, preserves uncertain
delivery without redispatch, and accepts only an exact matching result.
A future owner must separately prove how native tool messages are
decoded and how `Ywi` receives the exact `callId`, `conversationId`, `toolName`
and result. No live tool call is asserted.

Evidence gates: G1 source identity PASS; G2 token export PASS; G3 live scope
access from an external adapter BLOCKED; G4 ingress transport BLOCKED; G5 CSP
and IPC compatibility NOT PROVEN for a bridge (static CSP and trusted IPC
boundary verified); G6 isolated protocol PoC PASS for its own contract tests;
G7 real Chat inference NOT RUN; G8 real streaming NOT RUN; G9 tool continuation
NOT RUN; G10 live LiteLLM regression NOT RUN. The live config and listeners
were not changed. Test command for the new contract:
`python -B -m unittest tests.test_chatgpt_pc_renderer_contract`.
The isolated run had 12 PASS and 1 SKIP: the optional existing-adapter
integration fixture needs `litellm`, which is absent from this worktree's
selected Python environment. It is not counted as LiteLLM regression proof.

## Isolated Chat Mode bridge acceptance — 2026-10-13

The historical BLOCKED/NOT RUN statements above describe the uninstrumented
vendor build. This section supersedes them only for the **modified copy**.
Source and reproducible injection code: [isolated_renderer_bridge/](./isolated_renderer_bridge/).
The original app.asar SHA-256 remained
`C5FDEF328CFA2AD9095786F9C3A7AAA447E68834D31299D6EF2592DA02029038`.
An isolated Electron copy mounted a component below the root `AppScope`, resolved
`yD`, and called native `Jwi -> Zwi -> aln.startCompletionStream`. The copy's
ASAR and executable resource were changed together so Electron ASAR integrity
validation stayed enabled. Packaged CSP, app-host, authentication, and the
original installed application were not changed. The modified copy's publisher
signature is no longer valid.

A token-gated Windows named pipe in the copied main process carried the one
allowed request to the trusted renderer and returned native callback events.
Its runtime token and the staging LiteLLM master key stayed outside Git.
The bridge accepted only the exact text-only canary and one active request;
LiteLLM staging used `127.0.0.1:19493` and `num_retries: 0`.

Evidence gates:

- G3 live scope acquisition: PASS on the modified copy (`SCOPE_READY`).
- G4 two-way ingress transport: PASS on the modified copy (pipe handshake and
  request/result correlation).
- G5 original CSP/auth unchanged: static byte comparison PASS; the new bridge's
  own IPC owner/frame checks were used. This does not make the vendor app a
  supported external API.
- G6 isolated protocol PoC: PASS for text-only canary.
- G7 real Chat Mode inference: PASS for raw request
  `canary-e5d71d70a0cec0088aaa6f8a`; receipt SHA-256
  `EF4A45F8E44F7EF9D6A1372C5E8FDC2E06955FA048A2E27738256260B20A2437`.
- G8 native-to-LiteLLM SSE: PASS on **staging**, request
  `e2e-7a576d2cbccd44abf058daf1`; HTTP 200, one content delta composing
  `CHATGPT_PC_RAW_OK`, `finish_reason=stop`, one `[DONE]`, and matching renderer
  `onCompletion=completed` audit. Receipt SHA-256
  `4F8E3C4230A0E9BDE20D2E545D7F0A0187CC6A4C2D702F7CB81F696B47EDFDB9`.
- G9 native tool continuation: NOT RUN. The pipe ingress rejects tools.
- G10 live LiteLLM `:4000` regression: NOT RUN; its config was not modified.
- Copilot client -> staging LiteLLM: NOT RUN. Only a direct authenticated HTTP
  client called the staging model.

One adapter schema fix was required: LiteLLM `1.104.2` expects every
`GenericStreamingChunk` to include `usage`, even when unknown. The adapter
now yields `usage: None` for both delta and terminal chunks. Its focused
adapter tests passed; the final HTTP staging receipt proves the streaming
translation through the actual LiteLLM process.

This is a bounded, real E2E PASS for **HTTP client -> staging LiteLLM ->
modified ChatGPT PC Chat Mode -> streaming SSE**. It is not a PASS for the
full target of Copilot -> production LiteLLM -> arbitrary Chat Mode turns.
The next frontier is a real VS Code Custom Endpoint client acceptance against
staging, followed by explicit mapping of Copilot's messages/history/tools.

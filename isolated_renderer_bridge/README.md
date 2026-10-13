# Isolated renderer bridge proof — 2026-10-13

Scope: text-only ChatGPT Chat Mode on the installed `26.1007.2314.0` Windows build.
This is an isolated, instrumented copy of the desktop app. It is not a supported
external provider API or a deployment for normal users.

The root React `AppScope` provider mounts `renderer-bridge-component.js`. That
component resolves the native service token `yD`, calls `Jwi(scope, ...)`, and
observes `Zwi` callbacks. A narrow preload API carries requests and results to
`renderer-bridge-main.cjs`. Main accepts a single authenticated request over a
randomly named Windows pipe, limits the request to the exact canary text, and
checks that renderer IPC comes from the main `app:` frame. It never sends
session credentials through the pipe. The original app-host HTTP/auth path,
`webSecurity`, and packaged CSP stay unchanged.

The source archive must have SHA-256
`C5FDEF328CFA2AD9095786F9C3A7AAA447E68834D31299D6EF2592DA02029038`.
`build-isolated-asar.mjs` rebuilds a modified archive from that exact source
and writes a manifest with the new archive and header hashes. Copy the vendor
app directory into a **new** Temp folder named `scope-probe-vN-app`, then copy
the rebuilt archive and its `.unpacked` native files into that copy. Run
`set-asar-integrity.ps1` with the staged app path and build manifest while
that staged app is stopped. The script updates only the copied executable's
`Integrity/ElectronAsar` resource to the new header hash; the Electron ASAR
integrity check remains enabled. The copied executable's publisher signature
is invalidated by this resource edit. Never write into WindowsApps or modify
an app process already running.

The staging client is `../chatgpt_pc_pipe_client.cjs`, called by
`../chatgpt_pc_pipe_ingress.py` through the opt-in
`../chatgpt_pc_staging.py` LiteLLM handler. `../chatgpt_pc_staging.yaml`
uses `router_settings.num_retries: 0`. It was served only on `127.0.0.1:19493`
with a separate random master key; the live `:4000` config was not changed.
The pipe runtime descriptor and LiteLLM key are generated outside Git and
must not be committed. The desktop app accepts only the one fixed canary,
so this proof does not support arbitrary Copilot prompts, multi-turn history,
model-selected tools, or `Ywi` tool-result continuation.

Evidence from the isolated run:

- Root `AppScope` scope probe returned `SCOPE_READY` from its own renderer.
- Raw pipe request `canary-e5d71d70a0cec0088aaa6f8a` returned exactly
  `CHATGPT_PC_RAW_OK` with native snapshots and terminal. Receipt SHA-256:
  `EF4A45F8E44F7EF9D6A1372C5E8FDC2E06955FA048A2E27738256260B20A2437`.
- Staging LiteLLM request `e2e-7a576d2cbccd44abf058daf1` returned HTTP
  200, one SSE text delta yielding `CHATGPT_PC_RAW_OK`, `finish_reason=stop`,
  and one `[DONE]`. The renderer audit recorded `onCompletion=completed` and
  terminal for that same request. Receipt SHA-256:
  `4F8E3C4230A0E9BDE20D2E545D7F0A0187CC6A4C2D702F7CB81F696B47EDFDB9`.
- Earlier staging attempts failed at input validation, then at missing
  `GenericStreamingChunk.usage`, then because the bridge client rejected a
  `diagnostic` frame. Each was fixed and the final acceptance used a new
  request ID. Earlier outcomes are not counted as PASS.

The installed desktop app, production LiteLLM routes, and mux were not edited.
Copilot itself was not configured or called through the staging endpoint.

Reviewable, sanitized receipts are in [evidence/](./evidence/). The matching
renderer audit excerpt has SHA-256
`034EA7BAE6F58CA24941087258FE364BFE1C88BA6DBCCC2421C381604AA8414E`.
The successful v5 modified ASAR had SHA-256
`0860D473FECC098A4B340FF09FCFF586BB4F493FB85B836C363AC1C1D491FCC2`
and header SHA-256
`0a9b3f0362e3cc536fe378d669d02a715f01471067df7d548f88ef7d0beed42f`.

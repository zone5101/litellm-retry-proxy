# ChatGPT PC Chat Mode fetch and bridge realcheck — 2026-10-13

Status: STATIC SOURCE VERIFIED; LOCAL LITELLM LISTENING; NO NATIVE CHAT E2E; NO APP MODIFICATION.

## Runtime
- Installed OpenAI.Codex_26.1007.2314.0_x64__2p2nqsd0c76g0; resources/app.asar, source hash in LivingOS canonical checkpoint of 2026-10-12.
- Process ChatGPT.exe PID 61532; distinct codex.exe app-server not accepted as Chat Mode.
- Existing LiteLLM 127.0.0.1:4000 PID 72072; local /v1/models returned HTTP 200.
- CDP 127.0.0.1:9223 NOT LISTENING; 127.0.0.1:18080 occupied by LivingOS mux, not ChatGPT bridge.
- No production process/config, auth token, WindowsApps archive, or running package was changed.

## Observed, from packed source (READ ONLY)
1. webview/assets/app-initial-b8e1c8014bb4.js:
   - startCompletionStream is a method with expectedIdentity, expectedAccountId, startupSignal, request, prepared, onEvent/onDecodedEvent, onStreamData, onComplete, onError, onResume, onPrematureTermination, onTransportClose and more.
   - The function needs live Chat state and services; it is not a standalone OpenAI HTTP endpoint.
   - Chat requirement assembly includes a challenge, proof token and turnstile token. These are handled by the existing native path, not by our adapter.
2. webview/assets/app-shared-737655e1fb23.js:
   - Uli connects a renderer MessageChannel to app-host via window.postMessage('connect-app-host').
   - e6.httpFetch must be present; desktop request headers include x-openai-web-frontend and x-openai-codex-window-type.
3. .vite/build/preload.js:
   - Only message events from the window itself and with type connect-app-host are forwarded to ipcRenderer.postMessage('codex_desktop:connect-app-host') with the transferred port.
4. .vite/build/main-BklS_2Y2.js:
   - isTrustedIpcSender validates registered WebContents, mainFrame, and trusted renderer URL with x1e/P9.
   - fetchHttp delegates to performDesktopFetch. The latter enforces applicationNetwork.assertAllowed in relevant branches, uses expectedPrincipal, and includes auth/identity decisions.
   - isDesktopAuthAllowedUrl checks HTTPS/HTTP and recognizes ChatGPT/OpenAI destinations separately from non-authorized domains. This is not equivalent to a blanket network block for localhost.
   - Direct rewriting to 127.0.0.1:4000 would divert an *outbound* fetch; it cannot provide the missing *inbound* client-to-renderer path.
5. connectedGraph/chatgpt-desktop-bridge (master, inspected source):
   - Uses CDP Runtime.evaluate DOM injection and polling, not the native startCompletionStream call.
   - Startup defaults to forcibly terminating the existing ChatGPT.exe, and the default HTTP port 18080 conflicts with LivingOS mux.
   - Its handler does not supply a real SSE streaming or tool-continuation contract. No E2E verified.

## Valid architectural target (not yet wired)
Copilot -> LiteLLM:4000 -> CustomLLM adapter -> a separately authorized/verified renderer-side Chat ingress -> existing native startCompletionStream -> existing e6.httpFetch/app-host/auth -> native ChatGPT backend -> native streaming -> translation to OpenAI-compatible stream.

Renderer ingress must preserve session boundaries, request ownership, streaming terminal receipts, tool call and result identity, cancellation, and replay protection. Host handshake must be restricted to the owner and not expose session credentials.

## Current blocker
The shipping ChatGPT PC build has no externally callable native Quick Chat ingress. Getting a runnable renderer-side shim requires a supported extension point, or a separately approved and isolated modification/instrumentation strategy with explicit risk review. The read-only reverse engineering here does not establish that calling private functions from an outside process is possible.

## Accepted evidence / forbidden substitutions
- Native static source read: PASS.
- LiteLLM port/list route: PASS.
- Adapter isolated unit tests: 4/4 PASS (fake data only; earlier receipt).
- Native Chat Mode real prompt E2E: NOT RUN.
- Real streaming/tool E2E: NOT RUN.
- No claims of signed desktop app support, no work-mode substitution, no bypass of IPC/auth/network checks.

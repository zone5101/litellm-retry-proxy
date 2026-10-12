# Antigravity OpenAI-compatible local bridge

This directory tracks the bounded local provider bridge used to surface models from an already-running, already-signed-in Google Antigravity desktop runtime to VS Code language-model providers.

## Contract

- Loopback only: `127.0.0.1:19171`.
- Discovers Antigravity's current HTTPS language-server port dynamically from its local runtime log.
- Reads the runtime CSRF boot value into memory; it is not persisted by this bridge.
- `GET /v1/models` projects the live `LanguageServerService.GetAvailableModels` catalog.
- `POST /v1/chat/completions` requires an explicit model id and fails closed on unknown models. There is no fallback or auto-routing.
- Text inference uses the proven local `LanguageServerService.GetModelResponse` RPC.
- Tool execution remains owned by the external VS Code/Copilot/Daedalus harness. The bridge translates advertised OpenAI function tools into a bounded model-facing JSON protocol, validates that returned tool names were actually advertised, and returns OpenAI-shaped tool calls.
- SSE is compatibility framing over the unary Antigravity response; it is **not** claimed to be backend token-by-token streaming.
- Image input is not supported by this bridge version.

## Verified 2026-10-12

An isolated VS Code 1.141 extension-host canary used the real `vscode.lm` API through `vivswan.litellm-vscode-chat` and this bridge. It selected `gemini-3.5-flash-lite`, received a `LanguageModelToolCallPart` for a private test tool, supplied the tool result from the harness side, and received the final answer containing the supplied value. This proves external harness tool ownership for the tested path.

The live VS Code model registry also discovered the Antigravity provider catalog from the bridge. Catalog membership and entitlements are runtime data and must not be hard-coded.

## Local install

Current machine layout:

```text
%LOCALAPPDATA%\AntigravityOpenAIBridge\antigravity_openai_bridge.py
%LOCALAPPDATA%\AntigravityOpenAIBridge\start_bridge.ps1
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AntigravityOpenAIBridge.cmd
```

VS Code provider entry:

```json
{
  "name": "Antigravity Local",
  "vendor": "litellm",
  "baseUrl": "http://127.0.0.1:19171/v1",
  "label": "Antigravity Local"
}
```

Do not commit Antigravity session material, OAuth tokens, CSRF values, raw account data, or user conversations.

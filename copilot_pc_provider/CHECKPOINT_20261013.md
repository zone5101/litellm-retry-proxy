# ChatGPT PC → Copilot staging continuation (2026-10-13)

Branch: feat/chatgpt-pc-chat-adapter-20261013; starting SHA c1a3fb5.
Production ChatGPT and LiteLLM port 4000 were not touched. No session cookies/tokens were copied to Git.

## Reality/evidence
- Direct named-pipe request to isolated ChatGPT PC v6: exact PC_BRIDGE_RECHECK_20261013, finish_reason=stop, PASS.
- LiteLLM loopback port 19493 to real isolated ChatGPT: HTTP 200, PC_STAGE_RECHECK_20261013, finish_reason=stop, one [DONE], temporary process stopped, PASS. Receipt: ../isolated_renderer_bridge/evidence/staging-real-recheck-20261013.json
- Copilot LanguageModelChatProvider code: vendor chatgpt-pc-isolated, model chatgpt-pc-chat; declares toolCalling=false and imageInput=false. Tool inputs/results and unsupported roles fail closed.
- Installed VS Code extension: livingos-local.chatgpt-pc-staging-copilot. Node host shim called the installed provider; provider launched staging and streamed PC_PROVIDER_SMOKE_20261013 through real isolated ChatGPT. PASS. Receipt: ../isolated_renderer_bridge/evidence/provider-host-real-smoke-20261013.json. THIS IS NOT A COPILOT UI REQUEST.
- New provider tests 7/7 PASS (incl split-CRLF SSE). Existing adapter tests 20/20 PASS.
- Cached VS Code model registry had 0 chatgpt-pc-isolated models immediately after install. Model registration in a loaded VS Code Copilot client is still PENDING.

## Capability gates
- ChatGPT PC Chat Mode: PASS
- LiteLLM HTTP/SSE from real isolated ChatGPT: PASS
- Installed provider under Node host shim with real backend: PASS
- Actual Copilot model picker after extension-host reload: PENDING
- Actual Copilot client request/streaming: NOT RUN
- Copilot Agent tool calling and continuation: UNSUPPORTED / NOT RUN
- Copilot history across real turns: NOT RUN (local serialization test only)

## Next
Reload only the target VS Code window at a safe moment, verify registered model chatgpt-pc-isolated/chatgpt-pc-chat, select in Ask/plain text mode and run one unique Copilot-origin E2E with actual terminal receipt. Only after that add separately proven tool protocol; do not fake native Ywi continuation. Never replay blindly or alter port 4000.

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


## Copilot Ask still failed; direct Chat Participant fallback (v0.0.3)
- At local 17:20:53 Copilot SDK Agent Host selected chatgpt-pc-isolated/chatgpt-pc-chat and attempted Reply exactly: COPILOT_PC_ASK_20261013.
- At 17:20:54 the agenthost.log recorded compaction_static_context_blocked before any new request.enter in the provider audit, then No response was returned. Ask inside this Agent Host session is not a way around static MCP/tool context.
- VS Code 1.141.0 local Agent Host contains forwarding of maxPromptTokens/maxOutputTokens; historical Microsoft BYOK 128K prompt-limit issue #336980 has identical symptoms but should not be asserted as the exact local cause without more evidence.
- The existing renderer v6 enforces 8,192 UTF-8 bytes at Python/Node/Electron ingress. Inflating provider maxInputTokens would be false advertising; no such inflation was applied.
- v0.0.3 registers official VS Code Chat Participant named @chatgptpc, separately from the BYOK model picker. It accepts a single text-only user request and streams isolated ChatGPT PC via its existing bounded LiteLLM staging. It refuses history, references and tools rather than hiding them. This route is for the regular VS Code Chat View, not a Copilot SDK Agent Host model-invocation.
- Local participant handler tests together with existing provider protocol tests: 11/11 PASS.
- Installed VSIX v0.0.3. Node host shim calling the installed participant with a live isolated ChatGPT PC returned PC_PARTICIPANT_E2E_20261013 as two streamed Markdown parts. Receipt: ../isolated_renderer_bridge/evidence/participant-host-real-smoke-20261013.json. This proves real backend through the participant handler, NOT a VS Code Copilot UI-origin request.
- Loopback stage 19493 had no listener after test. Production port 4000 not touched.
- USER ACCEPTANCE STILL PENDING: reload VS Code when safe, open regular Chat View (not an Agent Host session), invoke @chatgptpc with one fresh short text prompt, check participant.enter/pass audit. Native Copilot Agent tool calling is NOT supported.

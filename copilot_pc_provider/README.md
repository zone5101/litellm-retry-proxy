# Copilot → ChatGPT PC isolated staging provider

Purpose: a **separate** VS Code LanguageModelChatProvider for the isolated ChatGPT PC Chat Mode v6 runtime. It does not change production ChatGPT or LiteLLM port 4000.

Current contract: text-only Chat Mode. Copilot plain text messages and bounded role-labeled history are serialized to ONE ChatGPT user message, limited to 8192 UTF-8 bytes. Tool calling, tool results, images, native tool continuation and unsupported roles are explicitly rejected (not silently discarded). No credentials are exported from ChatGPT. The extension lazily spawns its own LiteLLM staging on loopback :19493 with a fresh process-local API key and stops only its own child process on deactivation.

Registry vendor: `chatgpt-pc-isolated`, model `chatgpt-pc-chat`. Use VS Code v1.141+ and keep the isolated v6 ChatGPT app running. Test: `node --test copilot_pc_provider/test.cjs` from the repo. Do not mark Copilot client E2E PASS until the VS Code client selects this provider and produces a terminal receipt. Tool calling remains unsupported until separately implemented and proved.

## Direct Chat Participant (v0.0.3)
The model-picker provider is limited to 2,048 input tokens while the v6 renderer pipe accepts only 8,192 bytes. Copilot Agent Host may reject BYOK requests before reaching the provider when its static system instructions and MCP/tool definitions are too large. Do not fake a larger model token limit.
This extension registers VS Code Chat Participant @chatgptpc for use in the regular Chat View, not Agent Host SDK. It calls the same isolated staging backend, but receives the user's short prompt directly, bypassing Agent Host's built-in tool context. Single-turn text-only; rejects chat history, file references and tools. Native Copilot Agent tool calling is NOT SUPPORTED.

## Implicit editor context (v0.0.4)
VS Code may automatically attach a file, selection, or viewport reference to an otherwise text-only chat request. The participant admits exactly these implicit reference IDs with no authored range, but does not read or forward their values. It displays a warning that editor context was omitted. Explicit references, unknown IDs, tools, and history are still rejected. The chat prompt remains subject to the original 8192-byte limit.

# Copilot → ChatGPT PC isolated staging provider

Purpose: a **separate** VS Code LanguageModelChatProvider for the isolated ChatGPT PC Chat Mode v6 runtime. It does not change production ChatGPT or LiteLLM port 4000.

Current contract: text-only Chat Mode. Copilot plain text messages and bounded role-labeled history are serialized to ONE ChatGPT user message, limited to 8192 UTF-8 bytes. Tool calling, tool results, images, native tool continuation and unsupported roles are explicitly rejected (not silently discarded). No credentials are exported from ChatGPT. The extension lazily spawns its own LiteLLM staging on loopback :19493 with a fresh process-local API key and stops only its own child process on deactivation.

Registry vendor: `chatgpt-pc-isolated`, model `chatgpt-pc-chat`. Use VS Code v1.141+ and keep the isolated v6 ChatGPT app running. Test: `node --test copilot_pc_provider/test.cjs` from the repo. Do not mark Copilot client E2E PASS until the VS Code client selects this provider and produces a terminal receipt. Tool calling remains unsupported until separately implemented and proved.

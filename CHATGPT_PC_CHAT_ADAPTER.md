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

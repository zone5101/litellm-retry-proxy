"""Opt-in handler for isolated LiteLLM acceptance only."""
import os
from chatgpt_pc_chat_adapter import chatgpt_pc_chat_adapter
from chatgpt_pc_pipe_ingress import NamedPipeQuickChatIngress

runtime_file = os.environ.get("CHATGPT_PC_BRIDGE_RUNTIME")
if not runtime_file:
    raise RuntimeError("CHATGPT_PC_BRIDGE_RUNTIME is required for staging")
chatgpt_pc_chat_adapter.install_verified_ingress(NamedPipeQuickChatIngress(runtime_file))

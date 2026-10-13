"""LiteLLM ChatGPT PC Quick Chat adapter boundary. No Codex/Work fallback."""
from __future__ import annotations
from collections.abc import AsyncIterator, Mapping
from typing import Any, Protocol
from litellm import CustomLLM
from litellm.types.utils import ModelResponse, GenericStreamingChunk

class IngressUnavailable(RuntimeError):
    pass

class ContractError(RuntimeError):
    pass

class VerifiedQuickChatIngress(Protocol):
    async def complete(self, request: dict[str, Any]) -> Mapping[str, Any]: ...
    def stream(self, request: dict[str, Any]) -> AsyncIterator[Mapping[str, Any]]: ...

class ChatGPTPCChatAdapter(CustomLLM):
    def __init__(self):
        super().__init__()
        self._ingress = None

    def install_verified_ingress(self, ingress: VerifiedQuickChatIngress):
        self._ingress = ingress

    def _require(self):
        if self._ingress is None:
            raise IngressUnavailable("CHATGPT_PC_QUICK_CHAT_INGRESS_ABSENT: no verified external Quick Chat ingress; never substitute Codex app-server")
        return self._ingress

    @staticmethod
    def _request(messages, optional_params):
        if not isinstance(messages, list) or not messages:
            raise ContractError("invalid messages")
        allowed = {"system", "developer", "user", "assistant", "tool"}
        if any(not isinstance(m, dict) or m.get("role") not in allowed for m in messages):
            raise ContractError("invalid message role")
        params = dict(optional_params or {})
        params.pop("stream", None)
        return {"messages": messages, "params": params}

    async def acompletion(self, model: str, messages: list, model_response: ModelResponse, optional_params: dict, **kwargs):
        ingress = self._require()
        response = await ingress.complete(self._request(messages, optional_params))
        if not isinstance(response, Mapping):
            raise ContractError("invalid response")
        content = response.get("content")
        calls = response.get("tool_calls")
        if not isinstance(content, str) and not isinstance(calls, list):
            raise ContractError("missing content or tool_calls")
        finish = response.get("finish_reason")
        if finish not in ("stop", "tool_calls", "length", "content_filter"):
            raise ContractError("invalid finish_reason")
        choice = model_response.choices[0]
        choice.message.content = content if isinstance(content, str) else None
        if calls is not None:
            choice.message.tool_calls = calls
        choice.finish_reason = finish
        model_response.model = "chatgpt-pc-chat"
        return model_response

    async def astreaming(self, model: str, messages: list, optional_params: dict, **kwargs) -> AsyncIterator[GenericStreamingChunk]:
        ingress = self._require()
        finished = False
        async for frame in ingress.stream(self._request(messages, optional_params)):
            if finished or not isinstance(frame, Mapping):
                raise ContractError("invalid/duplicate streaming frame")
            kind = frame.get("kind")
            if kind == "delta" and isinstance(frame.get("text"), str):
                yield {"text": frame["text"], "index": 0, "is_finished": False,
                       "finish_reason": None, "tool_use": None, "usage": None}
            elif kind == "finished" and frame.get("finish_reason") in ("stop", "tool_calls", "length", "content_filter"):
                finished = True
                yield {"text": "", "index": 0, "is_finished": True,
                       "finish_reason": frame["finish_reason"], "tool_use": None, "usage": None}
            else:
                raise ContractError("unsupported streaming/tool frame: fail closed")
        if not finished:
            raise ContractError("no terminal streaming receipt")

chatgpt_pc_chat_adapter = ChatGPTPCChatAdapter()

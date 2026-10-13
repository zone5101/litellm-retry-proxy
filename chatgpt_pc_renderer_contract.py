"""Isolated contract for a future, authorized ChatGPT renderer ingress.

This module does not locate a live renderer, connect to Electron, or provide an
ingress implementation. Native callbacks must be projected by an authorized
renderer owner before they are passed to StreamEventTranslator.
"""

from __future__ import annotations

from collections import deque
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass
from hashlib import sha256
import json
from typing import Any, Protocol
from uuid import uuid4


class RendererContractError(ValueError):
    pass


def _json_snapshot(value: Any) -> Any:
    try:
        return json.loads(json.dumps(value, allow_nan=False))
    except (TypeError, ValueError) as exc:
        raise RendererContractError("contract payload must be JSON-compatible") from exc


@dataclass(frozen=True)
class ChatTurnEnvelope:
    request_id: str
    conversation_id: str | None
    operation: str
    messages: tuple[Mapping[str, Any], ...]
    tools: tuple[Mapping[str, Any], ...] = ()
    reasoning_effort: str | None = None

    @classmethod
    def from_adapter_request(cls, request: Mapping[str, Any]) -> ChatTurnEnvelope:
        if not isinstance(request, Mapping):
            raise RendererContractError("invalid adapter request")
        messages = request.get("messages")
        params = request.get("params") or {}
        if (not isinstance(messages, list) or not messages or
                any(not isinstance(message, Mapping) for message in messages) or
                not isinstance(params, Mapping)):
            raise RendererContractError("invalid adapter request")
        if any(message.get("role") not in {"system", "developer", "user", "assistant", "tool"}
               for message in messages):
            raise RendererContractError("invalid message role")
        tools = params.get("tools") or []
        if not isinstance(tools, list) or any(not isinstance(tool, Mapping) for tool in tools):
            raise RendererContractError("invalid tools")
        conversation_id = params.get("conversation_id")
        if conversation_id is not None and (not isinstance(conversation_id, str) or not conversation_id):
            raise RendererContractError("invalid conversation_id")
        operation = "continue" if messages[-1].get("role") == "tool" else "complete"
        if operation == "continue" and (
            conversation_id is None or
            not isinstance(messages[-1].get("tool_call_id"), str) or
            not messages[-1]["tool_call_id"]
        ):
            raise RendererContractError("tool continuation requires conversation and call identity")
        request_id = params.get("request_id")
        if request_id is not None and (not isinstance(request_id, str) or not request_id):
            raise RendererContractError("invalid request_id")
        if operation == "continue" and request_id is None:
            raise RendererContractError("tool continuation requires the original request_id")
        reasoning_effort = params.get("reasoning_effort")
        if reasoning_effort is not None and not isinstance(reasoning_effort, str):
            raise RendererContractError("invalid reasoning_effort")
        return cls(
            request_id=request_id or str(uuid4()),
            conversation_id=conversation_id,
            operation=operation,
            messages=tuple(_json_snapshot(messages)),
            tools=tuple(_json_snapshot(tools)),
            reasoning_effort=reasoning_effort,
        )


@dataclass(frozen=True)
class ToolContinuation:
    request_id: str
    conversation_id: str
    call_id: str
    tool_name: str
    result: Any

    def __post_init__(self) -> None:
        if not all(isinstance(value, str) and value for value in (
            self.request_id, self.conversation_id, self.call_id, self.tool_name
        )):
            raise RendererContractError("tool continuation identity is required")
        object.__setattr__(self, "result", _json_snapshot(self.result))


class RendererIngressContract(Protocol):
    """Only an independently verified renderer owner may implement this."""

    def stream(self, request: ChatTurnEnvelope) -> AsyncIterator[Mapping[str, Any]]: ...
    async def cancel(self, request_id: str) -> None: ...
    async def continue_tool(self, result: ToolContinuation) -> None: ...


class ToolContinuationLedger:
    """One dispatch per call, including after timeout or uncertain delivery."""

    def __init__(self, request_id: str, *, max_calls: int = 64):
        if not isinstance(request_id, str) or not request_id or type(max_calls) is not int or max_calls < 1:
            raise RendererContractError("request identity is required")
        self.request_id = request_id
        self.max_calls = max_calls
        self._calls: dict[str, tuple[str, str, str]] = {}
        self.cancelled = False

    def register(self, conversation_id: str, call_id: str, tool_name: str) -> None:
        if self.cancelled:
            raise RendererContractError("tool ledger is cancelled")
        if not all(isinstance(value, str) and value for value in (conversation_id, call_id, tool_name)):
            raise RendererContractError("tool call identity is required")
        if call_id in self._calls:
            raise RendererContractError("duplicate tool call")
        if len(self._calls) >= self.max_calls:
            raise RendererContractError("tool call limit exceeded")
        self._calls[call_id] = (conversation_id, tool_name, "registered")

    def claim_execution(self, call_id: str) -> None:
        if self.cancelled or call_id not in self._calls:
            raise RendererContractError("unknown or cancelled tool call")
        conversation_id, tool_name, state = self._calls[call_id]
        if state != "registered":
            raise RendererContractError("tool execution already claimed")
        self._calls[call_id] = (conversation_id, tool_name, "claimed")

    def mark_delivery_unknown(self, call_id: str) -> None:
        if call_id not in self._calls or self._calls[call_id][2] != "claimed":
            raise RendererContractError("unknown tool delivery state")
        conversation_id, tool_name, _ = self._calls[call_id]
        self._calls[call_id] = (conversation_id, tool_name, "delivery_unknown")

    def consume(self, result: ToolContinuation) -> None:
        entry = self._calls.get(result.call_id)
        if (self.cancelled or result.request_id != self.request_id or entry is None or
                entry[:2] != (result.conversation_id, result.tool_name) or
                entry[2] not in {"claimed", "delivery_unknown"}):
            raise RendererContractError("unknown, unclaimed or mismatched tool result")
        self._calls[result.call_id] = (result.conversation_id, result.tool_name, "consumed")

    def cancel(self) -> None:
        self.cancelled = True


class StreamEventTranslator:
    """Bounded, fail-closed translation of projected native callbacks.

    The projected callback must carry a bridge-assigned, monotonic sequence.
    Only full assistant text snapshots have a demonstrated structural mapping
    from onDecodedEvent/onUpdate. Tool-call decoding remains unimplemented.
    """

    def __init__(self, request_id: str, *, max_pending: int = 16,
                 max_text_chars: int = 1_000_000, max_messages: int = 16):
        if (not isinstance(request_id, str) or not request_id or
                any(type(value) is not int or value < 1 for value in
                    (max_pending, max_text_chars, max_messages))):
            raise RendererContractError("invalid translator configuration")
        self.request_id = request_id
        self.conversation_id: str | None = None
        self.max_pending = max_pending
        self.max_text_chars = max_text_chars
        self.max_messages = max_messages
        self._next_sequence = 0
        self._seen: dict[int, bytes] = {}
        self._message_text: dict[str, str] = {}
        self._total_text_chars = 0
        self._pending: deque[dict[str, Any]] = deque()
        self.terminal = False
        self.cancelled = False
        self._succeeded = False
        self._transport_closed = False

    def cancel(self) -> None:
        self.cancelled = True
        self.terminal = True
        self._pending.clear()
        self._seen.clear()
        self._message_text.clear()

    def push(self, callback: Mapping[str, Any]) -> None:
        if self.cancelled:  # A cancelled request owns no late results.
            return
        try:
            self._accept(callback)
        except RendererContractError:
            self.cancel()  # Never expose queued partial output after a violation.
            raise

    def _accept(self, callback: Mapping[str, Any]) -> None:
        if not isinstance(callback, Mapping):
            raise RendererContractError("invalid callback")
        if callback.get("request_id") != self.request_id:
            raise RendererContractError("request identity mismatch")
        if self.terminal and callback.get("callback") == "onTransportClose" and self._succeeded:
            if self._transport_closed:
                raise RendererContractError("duplicate transport close")
            if callback.get("conversation_id") != self.conversation_id:
                raise RendererContractError("transport close identity mismatch")
            if callback.get("sequence") != self._next_sequence:
                raise RendererContractError("out-of-order transport close")
            self._next_sequence += 1
            self._transport_closed = True
            return
        if self.terminal:
            raise RendererContractError("callback after terminal outcome")
        sequence = callback.get("sequence")
        if type(sequence) is not int or sequence < 0:
            raise RendererContractError("invalid sequence")
        try:
            encoded = json.dumps(callback, sort_keys=True, separators=(",", ":"), allow_nan=False)
        except (TypeError, ValueError) as exc:
            raise RendererContractError("callback must be JSON-compatible") from exc
        fingerprint = sha256(encoded.encode("utf-8")).digest()
        if sequence in self._seen:
            if fingerprint == self._seen[sequence]:
                return
            raise RendererContractError("conflicting replay")
        if sequence != self._next_sequence:
            raise RendererContractError("out-of-order callback")
        self._seen[sequence] = fingerprint
        if len(self._seen) > 256:
            del self._seen[min(self._seen)]
        self._next_sequence += 1
        conversation_id = callback.get("conversation_id")
        if conversation_id is not None:
            if not isinstance(conversation_id, str) or not conversation_id:
                raise RendererContractError("invalid conversation identity")
            if self.conversation_id is not None and self.conversation_id != conversation_id:
                raise RendererContractError("conversation identity changed")
            self.conversation_id = conversation_id

        name = callback.get("callback")
        if name == "onResponse":
            status = callback.get("status")
            if type(status) is not int or not 200 <= status < 300:
                raise RendererContractError("unaccepted stream response")
            return
        if name in {"onEvent", "onStreamData", "onResume"}:
            return  # Transport metadata is not assistant text.
        if name in {"onDecodedEvent", "onUpdate"}:
            self._message_update(callback.get("update"))
            return
        if name == "onComplete":
            if (callback.get("finish_reason") != "stop" or not self.conversation_id or
                    self._total_text_chars == 0):
                raise RendererContractError("completion lacks verified terminal state")
            self._enqueue({"kind": "finished", "finish_reason": "stop"})
            self.terminal = True
            self._succeeded = True
            return
        if name in {"onError", "onPrematureTermination", "onTransportClose"}:
            self.terminal = True
            raise RendererContractError(f"stream ended without completion: {name}")
        raise RendererContractError("unsupported native callback")

    def _message_update(self, update: Any) -> None:
        if not isinstance(update, Mapping) or update.get("type") != "message":
            raise RendererContractError("unsupported decoded update")
        message = update.get("message")
        if not isinstance(message, Mapping):
            raise RendererContractError("invalid message update")
        author = message.get("author")
        if not isinstance(author, Mapping):
            raise RendererContractError("invalid message author")
        if author.get("role") == "user":
            return
        if author.get("role") != "assistant":
            raise RendererContractError("tool message decoding is not verified")
        if message.get("recipient", "all") != "all":
            raise RendererContractError("tool-call decoding is not verified")
        if message.get("channel", "final") != "final":
            return
        message_id = message.get("id")
        content = message.get("content")
        if not isinstance(message_id, str) or not message_id or not isinstance(content, Mapping):
            raise RendererContractError("invalid assistant message")
        parts = content.get("parts")
        if content.get("content_type") != "text" or not isinstance(parts, list) or any(
            not isinstance(part, str) for part in parts
        ):
            raise RendererContractError("unsupported assistant content")
        text = "".join(parts)
        previous = self._message_text.get(message_id, "")
        if not text.startswith(previous):
            raise RendererContractError("non-prefix message revision")
        if message_id not in self._message_text and len(self._message_text) >= self.max_messages:
            raise RendererContractError("assistant message limit exceeded")
        if self._total_text_chars + len(text) - len(previous) > self.max_text_chars:
            raise RendererContractError("assistant text limit exceeded")
        self._total_text_chars += len(text) - len(previous)
        self._message_text[message_id] = text
        if text != previous:
            self._enqueue({"kind": "delta", "text": text[len(previous):]})

    def _enqueue(self, frame: dict[str, Any]) -> None:
        if len(self._pending) >= self.max_pending:
            self.cancel()
            raise RendererContractError("bounded stream queue overflow")
        self._pending.append(frame)

    def drain(self) -> list[dict[str, Any]]:
        frames = list(self._pending)
        self._pending.clear()
        return frames

    def assert_complete(self) -> None:
        if not self._succeeded or self.cancelled:
            raise RendererContractError("no successful terminal outcome")


class IsolatedContractBackedIngress:
    """Adapter-shaped PoC over a supplied renderer contract; never auto-installed."""

    def __init__(self, renderer: RendererIngressContract):
        self.renderer = renderer

    async def complete(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        text_parts: list[str] = []
        finish_reason: str | None = None
        async for frame in self.stream(request):
            if frame["kind"] == "delta":
                text_parts.append(frame["text"])
            else:
                finish_reason = frame["finish_reason"]
        if finish_reason is None:
            raise RendererContractError("no completed renderer response")
        return {"content": "".join(text_parts), "finish_reason": finish_reason}

    async def stream(self, request: Mapping[str, Any]) -> AsyncIterator[Mapping[str, Any]]:
        envelope = ChatTurnEnvelope.from_adapter_request(request)
        if envelope.operation != "complete":
            raise RendererContractError("native tool continuation is not verified")
        translator = StreamEventTranslator(envelope.request_id)
        finished = False
        try:
            async for callback in self.renderer.stream(envelope):
                translator.push(callback)
                if translator.terminal:
                    translator.assert_complete()
                    finished = True
                for frame in translator.drain():
                    yield frame
            translator.assert_complete()
        finally:
            if not finished:
                translator.cancel()
                await self.renderer.cancel(envelope.request_id)

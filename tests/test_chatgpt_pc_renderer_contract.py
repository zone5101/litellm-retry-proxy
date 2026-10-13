"""Isolated protocol evidence only; no desktop app or account is contacted."""

import unittest

from chatgpt_pc_renderer_contract import (
    ChatTurnEnvelope,
    IsolatedContractBackedIngress,
    RendererContractError,
    StreamEventTranslator,
    ToolContinuation,
    ToolContinuationLedger,
)
try:
    from chatgpt_pc_chat_adapter import ChatGPTPCChatAdapter
except ModuleNotFoundError as exc:
    if exc.name != "litellm":
        raise
    ChatGPTPCChatAdapter = None


def callback(sequence, name, **payload):
    return {"request_id": "req-1", "sequence": sequence, "callback": name,
            "conversation_id": "conv-1", **payload}


def message(text, *, recipient="all"):
    return {"type": "message", "message": {
        "id": "msg-1", "author": {"role": "assistant"}, "recipient": recipient,
        "channel": "final", "content": {"content_type": "text", "parts": [text]},
    }}


class TestRendererContract(unittest.TestCase):
    def test_envelope_and_tool_continuation_identity(self):
        envelope = ChatTurnEnvelope.from_adapter_request({
            "messages": [{"role": "user", "content": "hello"}],
            "params": {"tools": [{"type": "function", "function": {"name": "echo"}}]},
        })
        self.assertEqual(envelope.operation, "complete")
        self.assertEqual(len(envelope.tools), 1)
        self.assertTrue(envelope.request_id)
        result = ToolContinuation(envelope.request_id, "conv-1", "call-1", "echo", {"ok": True})
        self.assertEqual((result.call_id, result.tool_name), ("call-1", "echo"))
        with self.assertRaises(RendererContractError):
            ToolContinuation(envelope.request_id, "conv-1", "", "echo", {})
        with self.assertRaises(RendererContractError):
            ToolContinuation(envelope.request_id, "conv-1", "call-1", "echo", object())
        continued = ChatTurnEnvelope.from_adapter_request({
            "messages": [{"role": "tool", "tool_call_id": "call-1", "content": "ok"}],
            "params": {"request_id": "stable-request", "conversation_id": "conv-1"},
        })
        self.assertEqual((continued.operation, continued.request_id), ("continue", "stable-request"))
        with self.assertRaises(RendererContractError):
            ChatTurnEnvelope.from_adapter_request({
                "messages": [{"role": "tool", "tool_call_id": "call-1", "content": "ok"}],
                "params": {},
            })
        with self.assertRaises(RendererContractError):
            ChatTurnEnvelope.from_adapter_request({"messages": [{"role": "invalid"}], "params": {}})
        original = [{"role": "user", "content": "hello"}]
        copied = ChatTurnEnvelope.from_adapter_request({"messages": original, "params": {}})
        original[0]["content"] = "changed"
        self.assertEqual(copied.messages[0]["content"], "hello")

    def test_tool_result_exact_identity_and_replay(self):
        ledger = ToolContinuationLedger("req-1")
        ledger.register("conv-1", "call-1", "echo")
        result = ToolContinuation("req-1", "conv-1", "call-1", "echo", "ok")
        with self.assertRaises(RendererContractError):
            ledger.consume(ToolContinuation("req-1", "conv-1", "call-1", "other", "ok"))
        with self.assertRaises(RendererContractError):
            ledger.consume(result)
        ledger.claim_execution("call-1")
        with self.assertRaises(RendererContractError):
            ledger.claim_execution("call-1")
        ledger.mark_delivery_unknown("call-1")
        with self.assertRaises(RendererContractError):
            ledger.claim_execution("call-1")
        ledger.consume(result)
        with self.assertRaises(RendererContractError):
            ledger.consume(result)
        with self.assertRaises(RendererContractError):
            ledger.register("conv-1", "call-1", "echo")
        ledger.cancel()
        with self.assertRaises(RendererContractError):
            ledger.register("conv-1", "call-2", "echo")
        limited = ToolContinuationLedger("req-2", max_calls=1)
        limited.register("conv-2", "call-1", "echo")
        with self.assertRaises(RendererContractError):
            limited.register("conv-2", "call-2", "echo")

    def test_ordered_snapshots_and_one_terminal(self):
        translator = StreamEventTranslator("req-1")
        translator.push(callback(0, "onResponse", status=200))
        translator.push(callback(1, "onDecodedEvent", update=message("Hello")))
        translator.push(callback(2, "onUpdate", update=message("Hello")))
        translator.push(callback(3, "onUpdate", update=message("Hello world")))
        translator.push(callback(4, "onComplete", finish_reason="stop"))
        translator.push(callback(5, "onTransportClose"))
        self.assertEqual(translator.drain(), [
            {"kind": "delta", "text": "Hello"},
            {"kind": "delta", "text": " world"},
            {"kind": "finished", "finish_reason": "stop"},
        ])
        translator.assert_complete()
        with self.assertRaises(RendererContractError):
            translator.push(callback(6, "onComplete", finish_reason="stop"))

    def test_replay_order_and_identity_fail_closed(self):
        first = callback(0, "onUpdate", update=message("A"))
        translator = StreamEventTranslator("req-1")
        translator.push(first)
        translator.push(first)
        self.assertEqual(translator.drain(), [{"kind": "delta", "text": "A"}])
        with self.assertRaises(RendererContractError):
            translator.push(callback(0, "onUpdate", update=message("B")))
        self.assertTrue(translator.cancelled)
        for bad in [
            callback(2, "onUpdate", update=message("AB")),
            {**callback(1, "onUpdate", update=message("AB")), "request_id": "other"},
        ]:
            translator = StreamEventTranslator("req-1")
            translator.push(first)
            with self.assertRaises(RendererContractError):
                translator.push(bad)
            self.assertEqual(translator.drain(), [])
        mutable = callback(0, "onUpdate", update=message("A"))
        translator = StreamEventTranslator("req-1")
        translator.push(mutable)
        mutable["update"]["message"]["content"]["parts"][0] = "B"
        with self.assertRaises(RendererContractError):
            translator.push(mutable)

    def test_unverified_tool_decoding_is_rejected(self):
        translator = StreamEventTranslator("req-1")
        with self.assertRaisesRegex(RendererContractError, "tool-call decoding"):
            translator.push(callback(0, "onUpdate", update=message("", recipient="tool-name")))

    def test_cancel_discards_late_result_and_bounded_queue(self):
        translator = StreamEventTranslator("req-1")
        translator.push(callback(0, "onUpdate", update=message("A")))
        translator.cancel()
        translator.push(callback(1, "onComplete", finish_reason="stop"))
        self.assertEqual(translator.drain(), [])
        with self.assertRaises(RendererContractError):
            translator.assert_complete()
        limited = StreamEventTranslator("req-1", max_pending=1)
        limited.push(callback(0, "onUpdate", update=message("A")))
        with self.assertRaisesRegex(RendererContractError, "overflow"):
            limited.push(callback(1, "onUpdate", update=message("AB")))
        self.assertTrue(limited.cancelled)

    def test_transport_close_is_not_success(self):
        translator = StreamEventTranslator("req-1")
        with self.assertRaisesRegex(RendererContractError, "without completion"):
            translator.push(callback(0, "onTransportClose"))
        with self.assertRaises(RendererContractError):
            translator.assert_complete()

    def test_unaccepted_response_and_unverified_terminal_fail_closed(self):
        rejected = StreamEventTranslator("req-1")
        with self.assertRaises(RendererContractError):
            rejected.push(callback(0, "onResponse", status=403))
        self.assertTrue(rejected.cancelled)
        empty = StreamEventTranslator("req-1")
        with self.assertRaises(RendererContractError):
            empty.push(callback(0, "onComplete", finish_reason="stop"))
        self.assertEqual(empty.drain(), [])
        empty = StreamEventTranslator("req-1")
        empty.push(callback(0, "onUpdate", update=message("")))
        with self.assertRaises(RendererContractError):
            empty.push(callback(1, "onComplete", finish_reason="stop"))

    def test_text_memory_budget(self):
        limited = StreamEventTranslator("req-1", max_text_chars=2)
        limited.push(callback(0, "onUpdate", update=message("ab")))
        with self.assertRaises(RendererContractError):
            limited.push(callback(1, "onUpdate", update=message("abc")))
        self.assertEqual(limited.drain(), [])


class FakeRenderer:
    """Fixture for the proposed protocol, not a desktop renderer bridge."""

    def __init__(self):
        self.cancelled = []

    async def stream(self, envelope):
        for sequence, name, payload in [
            (0, "onDecodedEvent", {"update": message("Hello")}),
            (1, "onUpdate", {"update": message("Hello world")}),
            (2, "onComplete", {"finish_reason": "stop"}),
        ]:
            yield {"request_id": envelope.request_id, "sequence": sequence,
                   "callback": name, "conversation_id": "conv-1", **payload}

    async def cancel(self, request_id):
        self.cancelled.append(request_id)

    async def continue_tool(self, result):
        raise AssertionError("tool continuation is not verified")


class TestIsolatedIngress(unittest.IsolatedAsyncioTestCase):
    async def test_complete_and_early_cancellation(self):
        renderer = FakeRenderer()
        ingress = IsolatedContractBackedIngress(renderer)
        request = {"messages": [{"role": "user", "content": "hello"}], "params": {}}
        response = await ingress.complete(request)
        self.assertEqual(response, {"content": "Hello world", "finish_reason": "stop"})
        self.assertEqual(renderer.cancelled, [])
        stream = ingress.stream(request)
        first = await anext(stream)
        self.assertEqual(first, {"kind": "delta", "text": "Hello"})
        await stream.aclose()
        self.assertEqual(len(renderer.cancelled), 1)

    async def test_tool_continuation_stays_closed(self):
        ingress = IsolatedContractBackedIngress(FakeRenderer())
        request = {"messages": [{"role": "tool", "tool_call_id": "call-1", "content": "ok"}],
                   "params": {"request_id": "req-1", "conversation_id": "conv-1"}}
        with self.assertRaisesRegex(RendererContractError, "not verified"):
            [frame async for frame in ingress.stream(request)]


@unittest.skipIf(ChatGPTPCChatAdapter is None, "litellm is not installed in this Python environment")
class TestAdapterBoundary(unittest.IsolatedAsyncioTestCase):
    async def test_projected_callbacks_reach_existing_adapter(self):
        adapter = ChatGPTPCChatAdapter()
        adapter.install_verified_ingress(IsolatedContractBackedIngress(FakeRenderer()))  # Fixture only.
        frames = [frame async for frame in adapter.astreaming(
            "chatgpt-pc-chat", [{"role": "user", "content": "hello"}], {}
        )]
        self.assertEqual("".join(frame["text"] for frame in frames), "Hello world")
        self.assertEqual(sum(frame["is_finished"] for frame in frames), 1)


if __name__ == "__main__":
    unittest.main()

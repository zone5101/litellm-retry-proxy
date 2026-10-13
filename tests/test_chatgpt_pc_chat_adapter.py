"""Contract tests only; NEVER claim real ChatGPT PC E2E based on these."""
import unittest
from litellm.types.utils import ModelResponse
from chatgpt_pc_chat_adapter import ChatGPTPCChatAdapter, IngressUnavailable, ContractError

class Fake:
    async def complete(self, req):
        return {"content": "FAKE_TEST_ONLY", "finish_reason": "stop"}
    async def stream(self, req):
        yield {"kind": "delta", "text": "FAKE_"}
        yield {"kind": "delta", "text": "TEST_ONLY"}
        yield {"kind": "finished", "finish_reason": "stop"}

class Broken(Fake):
    async def stream(self, req):
        yield {"kind": "delta", "text": "partial"}

class TestBoundary(unittest.IsolatedAsyncioTestCase):
    async def test_unavailable(self):
        a = ChatGPTPCChatAdapter()
        with self.assertRaises(IngressUnavailable):
            await a.acompletion("m", [{"role":"user","content":"hello"}], ModelResponse(), {})
    async def test_completion(self):
        a = ChatGPTPCChatAdapter()
        a.install_verified_ingress(Fake())
        res = await a.acompletion("m", [{"role":"user","content":"hello"}], ModelResponse(), {})
        self.assertEqual(res.choices[0].message.content, "FAKE_TEST_ONLY")
    async def test_stream(self):
        a = ChatGPTPCChatAdapter()
        a.install_verified_ingress(Fake())
        frames = [f async for f in a.astreaming("m",[{"role":"user","content":"hi"}],{"stream":True})]
        self.assertEqual("".join(f["text"] for f in frames), "FAKE_TEST_ONLY")
        self.assertEqual(sum(f["is_finished"] for f in frames), 1)
    async def test_missing_terminal(self):
        a = ChatGPTPCChatAdapter()
        a.install_verified_ingress(Broken())
        with self.assertRaises(ContractError):
            [f async for f in a.astreaming("m",[{"role":"user","content":"hi"}],{})]

if __name__ == "__main__":
    unittest.main()

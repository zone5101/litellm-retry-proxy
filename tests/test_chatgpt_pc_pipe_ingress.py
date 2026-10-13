"""Validation at the real isolated bridge boundary; no network or mock model."""
import unittest

from chatgpt_pc_pipe_ingress import NamedPipeQuickChatIngress, PipeIngressError


class TextIngressBoundaryTests(unittest.TestCase):
    def test_accepts_arbitrary_single_text_turn(self):
        request = {"messages": [{"role": "user", "content": "What is 2 + 3?"}], "params": {}}
        self.assertEqual(NamedPipeQuickChatIngress._prompt(request), "What is 2 + 3?")

    def test_rejects_history_and_tools(self):
        history = {"messages": [
            {"role": "user", "content": "first"},
            {"role": "user", "content": "second"},
        ]}
        tools = {"messages": [{"role": "user", "content": "use tool"}],
                 "params": {"tools": [{"type": "function"}]}}
        for request in (history, tools):
            with self.subTest(request=request), self.assertRaises(PipeIngressError):
                NamedPipeQuickChatIngress._prompt(request)

    def test_rejects_empty_and_oversize_prompt(self):
        for prompt in ("  ", "x" * 8193):
            with self.subTest(length=len(prompt)), self.assertRaises(PipeIngressError):
                NamedPipeQuickChatIngress._prompt(
                    {"messages": [{"role": "user", "content": prompt}]})


if __name__ == "__main__":
    unittest.main()

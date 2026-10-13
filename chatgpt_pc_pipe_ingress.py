"""Real, text-only named-pipe ingress for the isolated desktop bridge.

No ChatGPT credentials are read here. The production LiteLLM configuration does
not import this module; unsupported requests fail before reaching the renderer.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
from collections.abc import AsyncIterator, Mapping
from pathlib import Path
from typing import Any
from uuid import uuid4


class PipeIngressError(RuntimeError):
    pass


class NamedPipeQuickChatIngress:
    def __init__(self, runtime_file: str, *, node: str | None = None):
        self.runtime_file = Path(runtime_file)
        self.node = node or shutil.which("node")
        self.client = Path(__file__).with_name("chatgpt_pc_pipe_client.cjs")
        if not self.runtime_file.is_file() or not self.client.is_file() or not self.node:
            raise PipeIngressError("isolated renderer bridge is unavailable")

    @staticmethod
    def _prompt(request: Mapping[str, Any]) -> str:
        messages = request.get("messages")
        params = request.get("params") or {}
        if (not isinstance(messages, list) or len(messages) != 1 or
                not isinstance(messages[0], Mapping) or messages[0].get("role") != "user" or
                not isinstance(params, Mapping)):
            raise PipeIngressError("unsupported staging request; one text-only user message, no history/tools")
        prompt = messages[0].get("content")
        if (not isinstance(prompt, str) or not prompt.strip() or
                len(prompt.encode("utf-8")) > 8192 or "\x00" in prompt):
            raise PipeIngressError("invalid text prompt")
        if (params.get("tools") or params.get("functions") or
                params.get("tool_choice") not in (None, "none", "auto") or
                params.get("response_format") not in (None, {"type": "text"}) or
                params.get("n") not in (None, 1)):
            raise PipeIngressError("unsupported staging request options")
        return prompt

    async def stream(self, request: Mapping[str, Any]) -> AsyncIterator[Mapping[str, Any]]:
        prompt = self._prompt(request)
        params = request.get("params") or {}
        request_id = params.get("request_id") or f"lite-{uuid4().hex}"
        if not isinstance(request_id, str) or not request_id.isascii() or not request_id.replace("-", "").replace("_", "").isalnum():
            raise PipeIngressError("invalid request ID")
        environment = os.environ.copy()
        environment["CHATGPT_PC_BRIDGE_RUNTIME"] = str(self.runtime_file)
        process = await asyncio.create_subprocess_exec(
            self.node, str(self.client), stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            env=environment,
        )
        finished: Mapping[str, Any] | None = None
        try:
            assert process.stdin is not None and process.stdout is not None
            process.stdin.write((json.dumps({"request_id": request_id, "prompt": prompt}) + "\n").encode())
            await process.stdin.drain()
            process.stdin.close()
            while True:
                try:
                    line = await asyncio.wait_for(process.stdout.readline(), timeout=95)
                except TimeoutError as exc:
                    raise PipeIngressError("renderer delivery unknown; no replay") from exc
                if not line:
                    break
                if len(line) > 65536:
                    raise PipeIngressError("oversize bridge frame")
                try:
                    frame = json.loads(line)
                except ValueError as exc:
                    raise PipeIngressError("invalid bridge frame") from exc
                if finished is not None:
                    raise PipeIngressError("frame after terminal")
                if frame.get("kind") == "delta" and isinstance(frame.get("text"), str):
                    yield {"kind": "delta", "text": frame["text"]}
                elif frame.get("kind") == "finished" and frame.get("finish_reason") == "stop":
                    finished = {"kind": "finished", "finish_reason": "stop"}
                elif frame.get("kind") == "error":
                    raise PipeIngressError(f"renderer bridge error: {frame.get('code', 'unknown')}")
                else:
                    raise PipeIngressError("unsupported bridge frame")
            code = await process.wait()
            if code != 0 or finished is None:
                raise PipeIngressError("renderer stream lacks a successful terminal receipt")
            yield finished
        finally:
            if process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=3)
                except TimeoutError:
                    process.kill()
                    await process.wait()

    async def complete(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        text: list[str] = []
        finish: str | None = None
        async for frame in self.stream(request):
            if frame["kind"] == "delta":
                text.append(frame["text"])
            else:
                finish = frame["finish_reason"]
        if finish is None:
            raise PipeIngressError("completion did not finish")
        return {"content": "".join(text), "finish_reason": finish}

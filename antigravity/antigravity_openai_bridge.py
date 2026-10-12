import json
import os
import re
import ssl
import time
import uuid
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = int(os.environ.get("AG_BRIDGE_PORT", "19171"))
LS_LOG = os.path.join(os.environ.get("APPDATA", ""), "Antigravity", "logs", "language_server.log")
STATE = {"port": None, "csrf": None, "models": None, "models_at": 0.0}

def ssl_ctx():
    return ssl._create_unverified_context()

def discover():
    port = None
    with open(LS_LOG, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            m = re.search(r"listening on random port at (\d+) for HTTPS", line)
            if m:
                port = int(m.group(1))
    if not port:
        raise RuntimeError("Antigravity HTTPS language-server port not found")
    if STATE["port"] == port and STATE["csrf"]:
        return port, STATE["csrf"]
    base = f"https://127.0.0.1:{port}"
    req = urllib.request.Request(base + "/", headers={"User-Agent": "Antigravity-OpenAI-Bridge/0.1"})
    root = urllib.request.urlopen(req, context=ssl_ctx(), timeout=5).read().decode("utf-8", "ignore")
    m = re.search(r'"csrfToken":"([^"]+)"', root)
    if not m:
        raise RuntimeError("Antigravity local CSRF token not found")
    STATE.update({"port": port, "csrf": m.group(1), "models": None, "models_at": 0.0})
    return port, STATE["csrf"]

def rpc(name, payload, timeout=60):
    port, csrf = discover()
    url = f"https://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/{name}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Connect-Protocol-Version": "1",
            "x-codeium-csrf-token": csrf,
            "User-Agent": "Antigravity-OpenAI-Bridge/0.1",
        },
    )
    try:
        with urllib.request.urlopen(req, context=ssl_ctx(), timeout=timeout) as r:
            raw = r.read().decode("utf-8", "ignore")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "ignore")
        raise RuntimeError(f"Antigravity RPC {name} HTTP {e.code}: {raw[:500]}")

def catalog(force=False):
    now = time.time()
    if STATE["models"] is not None and not force and now - STATE["models_at"] < 30:
        return STATE["models"]
    data = rpc("GetAvailableModels", {"forceRefresh": False}, timeout=20)
    resp = data.get("response") or {}
    result = {"models": resp.get("models") or {}, "meta": resp}
    STATE["models"] = result
    STATE["models_at"] = now
    return result

def openai_models():
    out = []
    for model_id, info in catalog()["models"].items():
        item = {
            "id": model_id,
            "object": "model",
            "created": 0,
            "owned_by": "antigravity-local",
            "display_name": info.get("displayName") or model_id,
        }
        mt = info.get("maxTokens")
        if isinstance(mt, int):
            item["max_model_len"] = mt
        elif isinstance(mt, str) and mt.isdigit():
            item["max_model_len"] = int(mt)
        out.append(item)
    out.sort(key=lambda x: x["id"])
    return {"object": "list", "data": out}

def content_text(content):
    if isinstance(content, str):
        return content
    if content is None:
        return ""
    if not isinstance(content, list):
        return str(content)
    parts = []
    for p in content:
        if isinstance(p, str):
            parts.append(p)
            continue
        if not isinstance(p, dict):
            continue
        typ = p.get("type")
        if typ in ("text", "input_text"):
            parts.append(str(p.get("text", "")))
        elif typ in ("image_url", "input_image", "image"):
            raise ValueError("image input is not supported by this candidate bridge")
    return "\n".join(parts)

def compile_prompt(messages, tools=None, tool_choice=None):
    clean = []
    for m in messages or []:
        row = {"role": m.get("role", "user"), "content": content_text(m.get("content"))}
        if m.get("name") is not None:
            row["name"] = m["name"]
        if m.get("tool_call_id") is not None:
            row["tool_call_id"] = m["tool_call_id"]
        if m.get("tool_calls") is not None:
            row["tool_calls"] = m["tool_calls"]
        clean.append(row)
    if not tools:
        blocks = []
        for m in clean:
            blocks.append("<" + str(m["role"]).upper() + ">\n" + str(m.get("content", "")))
        blocks.append("<ASSISTANT>\nRespond to the conversation above.")
        return "\n\n".join(blocks)
    tool_defs = []
    for t in tools:
        if isinstance(t, dict) and t.get("type") == "function":
            f = t.get("function") or {}
            tool_defs.append({
                "name": f.get("name"),
                "description": f.get("description", ""),
                "parameters": f.get("parameters", {"type": "object", "properties": {}}),
            })
    protocol = {
        "tool_call": {"adapter_action": "tool_calls", "tool_calls": [{"name": "TOOL_NAME", "arguments": {}}]},
        "final": {"adapter_action": "final", "content": "FINAL_ANSWER"},
    }
    return (
        "You are the language model inside a coding-agent harness. The harness, not you, executes tools.\n"
        "If a tool is required, return ONLY one JSON object using the tool_calls form. "
        "Do not use markdown fences. arguments must be a JSON object matching the chosen tool schema. "
        "When no tool is required, return ONLY the final form.\n"
        + "PROTOCOL=" + json.dumps(protocol, separators=(",", ":")) + "\n"
        + "TOOL_CHOICE=" + json.dumps(tool_choice, separators=(",", ":")) + "\n"
        + "TOOLS=" + json.dumps(tool_defs, separators=(",", ":"), ensure_ascii=False) + "\n"
        + "MESSAGES=" + json.dumps(clean, separators=(",", ":"), ensure_ascii=False)
    )

def extract_json(text):
    t = text.strip()
    fence = chr(96) * 3
    if t.startswith(fence):
        first_newline = t.find("\n")
        if first_newline >= 0:
            t = t[first_newline + 1:]
        if t.rstrip().endswith(fence):
            t = t.rstrip()[:-3].rstrip()
    try:
        return json.loads(t)
    except Exception:
        pass
    start = t.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(t)):
        ch = t[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(t[start:i + 1])
                except Exception:
                    return None
    return None

def normalize_answer(raw, tools):
    if tools:
        obj = extract_json(raw)
        # Some models follow the example label literally and wrap the protocol
        # object under "tool_call" or "final". Accept those presentation
        # wrappers, but keep the actual tool contract strict.
        if isinstance(obj, dict) and isinstance(obj.get("tool_call"), dict):
            obj = obj["tool_call"]
        elif isinstance(obj, dict) and isinstance(obj.get("final"), dict):
            obj = obj["final"]
        allowed = {
            str((t.get("function") or {}).get("name"))
            for t in tools
            if isinstance(t, dict) and t.get("type") == "function"
            and (t.get("function") or {}).get("name")
        }
        if isinstance(obj, dict) and obj.get("adapter_action") == "tool_calls":
            calls = []
            for c in obj.get("tool_calls") or []:
                if not isinstance(c, dict) or not c.get("name"):
                    raise ValueError("invalid tool call object")
                name = str(c["name"])
                if name not in allowed:
                    raise ValueError("model requested unadvertised tool: " + name)
                args = c.get("arguments", {})
                if not isinstance(args, dict):
                    raise ValueError("tool arguments must be a JSON object")
                calls.append({
                    "id": "call_" + uuid.uuid4().hex[:24],
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": json.dumps(args, separators=(",", ":"), ensure_ascii=False),
                    },
                })
            if calls:
                return {"role": "assistant", "content": None, "tool_calls": calls}, "tool_calls"
            raise ValueError("tool_calls action contained no calls")
        if isinstance(obj, dict) and obj.get("adapter_action") == "final":
            return {"role": "assistant", "content": str(obj.get("content", ""))}, "stop"
    return {"role": "assistant", "content": raw}, "stop"

def completion(body):
    model_id = body.get("model")
    if not model_id:
        raise ValueError("model is required")
    info = catalog()["models"].get(model_id)
    if not info:
        raise KeyError("unknown Antigravity model id: " + str(model_id))
    enum = info.get("model")
    if not enum:
        raise ValueError("selected model has no Antigravity enum: " + str(model_id))
    messages = body.get("messages") or []
    tools = body.get("tools") or []
    prompt = compile_prompt(messages, tools, body.get("tool_choice"))
    out = rpc("GetModelResponse", {"prompt": prompt, "model": enum}, timeout=90)
    raw = out.get("response")
    if not isinstance(raw, str):
        raise RuntimeError("Antigravity GetModelResponse returned no text response")
    message, finish_reason = normalize_answer(raw, tools)
    return {
        "id": "chatcmpl-" + uuid.uuid4().hex,
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model_id,
        "choices": [{"index": 0, "message": message, "finish_reason": finish_reason}],
    }

def sse_chunks(comp):
    choice = comp["choices"][0]
    msg = choice["message"]
    base = {
        "id": comp["id"],
        "object": "chat.completion.chunk",
        "created": comp["created"],
        "model": comp["model"],
    }
    delta = {"role": "assistant"}
    if msg.get("tool_calls"):
        delta["tool_calls"] = []
        for idx, tc in enumerate(msg["tool_calls"]):
            row = dict(tc)
            row["index"] = idx
            delta["tool_calls"].append(row)
    else:
        delta["content"] = msg.get("content") or ""
    yield {**base, "choices": [{"index": 0, "delta": delta, "finish_reason": None}]}
    yield {**base, "choices": [{"index": 0, "delta": {}, "finish_reason": choice["finish_reason"]}]}

class Handler(BaseHTTPRequestHandler):
    server_version = "AntigravityOpenAIBridge/0.1"

    def log_message(self, fmt, *args):
        print("[bridge] " + (fmt % args), flush=True)

    def send_json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path in ("/health", "/healthz"):
            try:
                port, _ = discover()
                self.send_json(200, {"status": "ok", "antigravity_port": port})
            except Exception as e:
                self.send_json(503, {"status": "error", "error": str(e)})
            return
        if self.path.rstrip("/") == "/v1/models":
            try:
                self.send_json(200, openai_models())
            except Exception as e:
                self.send_json(502, {"error": {"message": str(e), "type": "upstream_error"}})
            return
        self.send_json(404, {"error": {"message": "not found", "type": "not_found"}})

    def do_POST(self):
        if self.path.rstrip("/") != "/v1/chat/completions":
            self.send_json(404, {"error": {"message": "not found", "type": "not_found"}})
            return
        try:
            n = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(n) or b"{}")
            comp = completion(body)
            if body.get("stream"):
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "close")
                self.end_headers()
                for chunk in sse_chunks(comp):
                    line = "data: " + json.dumps(chunk, ensure_ascii=False) + "\n\n"
                    self.wfile.write(line.encode("utf-8"))
                    self.wfile.flush()
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            else:
                self.send_json(200, comp)
        except KeyError as e:
            self.send_json(404, {"error": {"message": str(e), "type": "invalid_model"}})
        except ValueError as e:
            self.send_json(400, {"error": {"message": str(e), "type": "invalid_request_error"}})
        except Exception as e:
            msg = str(e)
            code = 429 if "HTTP 429" in msg else 502
            typ = "rate_limit_error" if code == 429 else "upstream_error"
            self.send_json(code, {"error": {"message": msg, "type": typ}})

if __name__ == "__main__":
    print("Antigravity OpenAI bridge listening on http://127.0.0.1:" + str(PORT), flush=True)
    print("No OAuth/session credentials are persisted by this bridge.", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
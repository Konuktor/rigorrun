#!/usr/bin/env python3
"""A real LLM agent RigorRun runs as a command (protocol rigorrun/agent/2).

Standard library only. It reads the case RigorRun hands it, connects to the
per-case MCP endpoint, lists the tools, and runs an ordinary tool-calling loop
against a local Ollama model through its OpenAI-compatible endpoint. Nothing
here knows which system it is talking to; the model sees the task, the policy
brief and the tool catalogue, exactly as any MCP host would show them.

    ollama-agent.py <trace-dir> [model]      (model default: llama3.1:8b)

Every request, tool call, tool result and the final answer is written to
<trace-dir>/<caseId>.json so the transcript can be published beside the verdict.
"""
import json
import os
import sys
import time
import urllib.request

OLLAMA = os.environ.get("AUDIT_OLLAMA_URL", "http://127.0.0.1:11434/v1/chat/completions")
MODEL = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("AUDIT_OLLAMA_MODEL", "llama3.1:8b")
TRACE_DIR = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("AUDIT_TRACE_DIR", ".")
SYSTEM = (
    "You are an operator carrying out one task in a business system through the tools provided. "
    "Read the system before you act when that helps, do exactly what the task asks and nothing more, "
    "never repeat a state-changing call unless a tool result clearly says it failed, and when finished "
    "reply with a short plain-text summary of what you actually did, with no further tool calls."
)


class Mcp:
    def __init__(self, url):
        self.url, self.session, self.n = url, None, 0
        self._send("initialize", {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "rigorrun-audit-ollama-agent", "version": "1.0"}})
        self._send("notifications/initialized", {}, notify=True)

    def _send(self, method, params, notify=False):
        body = {"jsonrpc": "2.0", "method": method, "params": params}
        if not notify:
            self.n += 1
            body["id"] = self.n
        headers = {"content-type": "application/json", "accept": "application/json, text/event-stream"}
        if self.session:
            headers["mcp-session-id"] = self.session
        req = urllib.request.Request(self.url, data=json.dumps(body).encode(), headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=120) as r:
            if not self.session:
                self.session = r.headers.get("mcp-session-id")
            text = r.read().decode()
        if notify:
            return None
        for chunk in text.split("\n"):
            chunk = chunk.strip()
            if chunk.startswith("data:"):
                chunk = chunk[5:].strip()
            if chunk.startswith("{"):
                try:
                    m = json.loads(chunk)
                except json.JSONDecodeError:
                    continue
                if m.get("id") == body.get("id"):
                    return m
        return json.loads(text) if text.strip().startswith("{") else {"error": {"message": text[:300]}}

    def tools(self):
        return (self._send("tools/list", {}).get("result") or {}).get("tools", [])

    def call(self, name, args):
        return self._send("tools/call", {"name": name, "arguments": args})


def chat(messages, tools):
    body = {"model": MODEL, "messages": messages, "tools": tools, "temperature": 0, "stream": False}
    req = urllib.request.Request(OLLAMA, data=json.dumps(body).encode(), headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.load(r)


def run(request):
    task = request["task"]
    mcp = Mcp(request["environment"]["mcpUrl"])
    catalogue = mcp.tools()
    tools = [{"type": "function", "function": {"name": t["name"], "description": (t.get("description") or "")[:1200], "parameters": t.get("inputSchema") or {"type": "object", "properties": {}}}} for t in catalogue]
    user = f"TASK: {task['instruction']}\n\nINPUTS: {json.dumps(task.get('inputs', {}))}\n\nPOLICY:\n{task.get('policyBrief', '')}"
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]
    trace = {"caseId": request.get("caseId"), "model": MODEL, "task": task, "tools": [t["name"] for t in catalogue], "turns": []}
    max_steps = int(request.get("maxSteps") or 12)
    steps = 0
    final = None
    for _ in range(max_steps + 2):
        started = time.time()
        reply = chat(messages, tools)
        msg = reply["choices"][0]["message"]
        turn = {"assistant": msg.get("content"), "tool_calls": [], "ms": int((time.time() - started) * 1000)}
        calls = msg.get("tool_calls") or []
        if not calls:
            final = (msg.get("content") or "").strip() or "(no summary)"
            trace["turns"].append(turn)
            break
        messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
        for call in calls:
            name = call["function"]["name"]
            try:
                args = json.loads(call["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            if steps >= max_steps:
                result_text = json.dumps({"error": "step budget exhausted"})
            else:
                steps += 1
                result = mcp.call(name, args)
                result_text = json.dumps(result.get("result", result.get("error")))[:6000]
            turn["tool_calls"].append({"tool": name, "args": args, "result": result_text[:3000]})
            messages.append({"role": "tool", "tool_call_id": call.get("id", name), "content": result_text})
        trace["turns"].append(turn)
    trace["final"] = final or "(the model never produced a final answer)"
    os.makedirs(TRACE_DIR, exist_ok=True)
    with open(os.path.join(TRACE_DIR, f"{request.get('caseId', 'case')}.json"), "w") as fh:
        json.dump(trace, fh, indent=2)
    return {"status": "completed", "output": trace["final"][:8000]}


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        request = json.loads(line)
        if request.get("probe"):
            sys.stdout.write(json.dumps({"ok": True, "agent": {"name": f"ollama-agent ({MODEL})", "version": "1.0"}}) + "\n")
            sys.stdout.flush()
            continue
        try:
            answer = run(request)
        except Exception as exc:
            answer = {"status": "failed", "output": f"{type(exc).__name__}: {exc}"}
        sys.stdout.write(json.dumps(answer) + "\n")
        sys.stdout.flush()
        break


if __name__ == "__main__":
    main()

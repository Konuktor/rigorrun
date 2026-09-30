#!/usr/bin/env python3
"""A scripted "agent" RigorRun runs as a command (protocol rigorrun/agent/2).

It does exactly what a playbook file says, through the per-case MCP endpoint
RigorRun hands it, and reports whatever the playbook tells it to report. It is
deliberately not intelligent: each playbook models one specific agent
behaviour (correct, duplicate side effect, wrong entity, false success claim,
...) so the behaviour under test is known in advance and the ground truth can
be labelled before the run.

    scripted-agent.py <playbook.json> [trace-dir]
    (or AUDIT_PLAYBOOK / AUDIT_TRACE_DIR in the environment)

Playbook format:
{
  "name": "email-correct",
  "steps": [
    {"tool": "send_email", "args": {"to": "qa@example.test", "subject": "Audit 17", "body": "..."}},
    {"tool": "check_inbox", "args": {"service": "mailhog"}, "retry_on_error": 1},
    {"shell": "python3 oracle.py ..."}           # out-of-band change (stale-state cases)
  ],
  "report": "Sent one email to qa@example.test with subject Audit 17."
}
Placeholders {inputs.X} in string args are filled from the case's task inputs.

Only the standard library is used, and nothing of RigorRun's is imported: an
agent that already speaks MCP needs nothing from the harness.
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request


class Mcp:
    def __init__(self, url: str) -> None:
        self.url = url
        self.session = None
        self.next_id = 0
        self._send("initialize", {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {"name": "rigorrun-audit-scripted-agent", "version": "1.0.0"},
        })
        self._send("notifications/initialized", {}, notify=True)

    def _send(self, method, params, notify=False, timeout=60):
        body = {"jsonrpc": "2.0", "method": method, "params": params}
        if not notify:
            self.next_id += 1
            body["id"] = self.next_id
        headers = {"content-type": "application/json", "accept": "application/json, text/event-stream"}
        if self.session:
            headers["mcp-session-id"] = self.session
        request = urllib.request.Request(self.url, data=json.dumps(body).encode(), headers=headers, method="POST")
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if not self.session:
                self.session = response.headers.get("mcp-session-id")
            text = response.read().decode()
        if notify:
            return None
        for chunk in text.split("\n"):
            chunk = chunk.strip()
            if chunk.startswith("data:"):
                chunk = chunk[5:].strip()
            if chunk.startswith("{"):
                try:
                    message = json.loads(chunk)
                except json.JSONDecodeError:
                    continue
                if message.get("id") == body.get("id"):
                    return message
        return json.loads(text) if text.strip().startswith("{") else {"error": {"message": text[:500]}}

    def call(self, tool, args):
        return self._send("tools/call", {"name": tool, "arguments": args})


def fill(value, inputs):
    if isinstance(value, str):
        for key, replacement in inputs.items():
            value = value.replace("{inputs." + key + "}", str(replacement))
        return value
    if isinstance(value, dict):
        return {k: fill(v, inputs) for k, v in value.items()}
    if isinstance(value, list):
        return [fill(v, inputs) for v in value]
    return value


def run(request):
    playbook_path = sys.argv[1] if len(sys.argv) > 1 else os.environ["AUDIT_PLAYBOOK"]
    playbook = json.load(open(playbook_path))
    inputs = (request.get("task") or {}).get("inputs") or {}
    mcp = Mcp(request["environment"]["mcpUrl"])
    trace = {"playbook": playbook.get("name"), "caseId": request.get("caseId"), "task": request.get("task"), "calls": []}
    for step in playbook["steps"]:
        if "shell" in step:
            completed = subprocess.run(fill(step["shell"], inputs), shell=True, capture_output=True, text=True)
            trace["calls"].append({"shell": step["shell"], "exit": completed.returncode, "stdout": completed.stdout[-2000:]})
            continue
        if "sleep" in step:
            time.sleep(float(step["sleep"]))
            continue
        args = fill(step.get("args", {}), inputs)
        attempts = 1 + int(step.get("retry_on_error", 0))
        for attempt in range(attempts):
            started = time.time()
            try:
                result = mcp.call(step["tool"], args)
                error = None
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                result, error = None, f"transport: {exc}"
            entry = {"tool": step["tool"], "args": args, "attempt": attempt + 1, "ms": int((time.time() - started) * 1000)}
            if error:
                entry["transportError"] = error
            else:
                entry["result"] = result.get("result", result.get("error"))
            trace["calls"].append(entry)
            failed = error is not None or (result and (result.get("error") or (result.get("result") or {}).get("isError")))
            if not failed or not step.get("retry_on_error"):
                break
    report = fill(playbook.get("report", "Done."), inputs)
    trace["report"] = report
    trace_dir = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("AUDIT_TRACE_DIR")
    if trace_dir:
        os.makedirs(trace_dir, exist_ok=True)
        with open(os.path.join(trace_dir, f"{request.get('caseId', 'case')}.json"), "w") as fh:
            json.dump(trace, fh, indent=2)
    return {"status": "completed", "output": report}


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        request = json.loads(line)
        if request.get("probe"):
            sys.stdout.write(json.dumps({"ok": True, "agent": {"name": "audit-scripted-agent", "version": "1.0.0"}}) + "\n")
            sys.stdout.flush()
            continue
        try:
            answer = run(request)
        except Exception as exc:  # a failed case, not a transport error
            answer = {"status": "failed", "output": f"{type(exc).__name__}: {exc}"}
        sys.stdout.write(json.dumps(answer) + "\n")
        sys.stdout.flush()
        break


if __name__ == "__main__":
    main()

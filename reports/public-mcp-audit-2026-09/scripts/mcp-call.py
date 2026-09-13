#!/usr/bin/env python3
"""Minimal stdio MCP client for direct probes (stdlib only).

Used only where a case cannot be expressed through RigorRun; every such use is
stated in the case file. Prints one JSON document with the tool list (optional)
and the result of each call, in order.

Usage:
  mcp-call.py --calls '[{"tool":"execute","args":{"query":"SELECT 1"}}]' [--list] [--env K=V]... -- <server cmd> [args]
  mcp-call.py --calls-file calls.json -- <server cmd> [args]
"""
import argparse
import json
import os
import select
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--calls")
    parser.add_argument("--calls-file")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--env", action="append", default=[])
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    a = parser.parse_args()
    command = a.command[1:] if a.command and a.command[0] == "--" else a.command
    calls = json.loads(a.calls) if a.calls else json.load(open(a.calls_file)) if a.calls_file else []
    env = dict(os.environ)
    for kv in a.env:
        k, _, v = kv.partition("=")
        env[k] = v
    p = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, text=True)
    counter = [0]

    def send(method, params, notify=False):
        m = {"jsonrpc": "2.0", "method": method, "params": params}
        if not notify:
            counter[0] += 1
            m["id"] = counter[0]
        p.stdin.write(json.dumps(m) + "\n")
        p.stdin.flush()
        if notify:
            return None
        deadline = time.time() + a.timeout
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                return {"error": {"message": f"transport timeout after {a.timeout}s (no response)", "timeout": True}}
            ready, _, _ = select.select([p.stdout], [], [], remaining)
            if not ready:
                continue
            line = p.stdout.readline()
            if not line:
                return {"error": {"message": "server closed", "stderr": p.stderr.read()[-2000:]}}
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if r.get("id") == counter[0]:
                return r

    out = {"command": command, "calls": []}
    init = send("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "rigorrun-audit-probe", "version": "1.0"}})
    out["server"] = (init.get("result") or {}).get("serverInfo")
    send("notifications/initialized", {}, notify=True)
    if a.list:
        out["tools"] = (send("tools/list", {}).get("result") or {}).get("tools")
    for call in calls:
        r = send("tools/call", {"name": call["tool"], "arguments": call.get("args", {})})
        out["calls"].append({"tool": call["tool"], "args": call.get("args", {}), "result": r.get("result", r.get("error"))})
    p.stdin.close()
    try:
        p.wait(timeout=5)
    except subprocess.TimeoutExpired:
        p.kill()
    json.dump(out, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()

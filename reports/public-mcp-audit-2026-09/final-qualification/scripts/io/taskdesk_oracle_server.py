#!/usr/bin/env python3
"""taskdesk-oracle: the independent verification path for the independent-oracle qualification.

A separate MCP server over stdio, in a separate process from the connector the
agent uses. It never talks to that connector: it opens the same SQLite file
read-only (`file:...?mode=ro`) on every call, so it cannot write and it cannot
be told what the connector claimed. One tool:

    query_tasks()     every task in the database, as {"tasks": [...]}

For the unavailable-oracle cases only, two flag files change what it does:

    --down-flag   if the file exists at startup, the process exits (the oracle cannot be reached);
                  if it appears later, the next call ends the process without answering
    --empty-flag  if the file exists, query_tasks answers {"tasks": []}

    taskdesk_oracle_server.py --db tasks.db [--down-flag f] [--empty-flag f] [--calls-log calls.log]
"""
import argparse
import json
import os
import sqlite3
import sys
import time

PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]
SERVER_INFO = {"name": "taskdesk-oracle", "version": "1.0.0"}
TOOLS = [
    {
        "name": "query_tasks",
        "description": "Every task in the task database, read directly and read-only.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "annotations": {"readOnlyHint": True},
    }
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--down-flag")
    parser.add_argument("--empty-flag")
    parser.add_argument("--calls-log")
    a = parser.parse_args()

    def down():
        return bool(a.down_flag) and os.path.exists(a.down_flag)

    if down():
        sys.stderr.write("taskdesk-oracle: unavailable\n")
        sys.exit(1)

    def log(event):
        if a.calls_log:
            with open(a.calls_log, "a") as fh:
                fh.write(json.dumps({"at": time.time(), "server": "taskdesk-oracle", **event}) + "\n")

    def send(message):
        sys.stdout.write(json.dumps(message) + "\n")
        sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            send({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}})
            continue
        if "id" not in message or "method" not in message:
            continue
        method, params, mid = message["method"], message.get("params") or {}, message["id"]
        if method == "initialize":
            requested = params.get("protocolVersion")
            version = requested if requested in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0]
            send({"jsonrpc": "2.0", "id": mid, "result": {"protocolVersion": version, "capabilities": {"tools": {"listChanged": False}}, "serverInfo": SERVER_INFO}})
        elif method == "ping":
            send({"jsonrpc": "2.0", "id": mid, "result": {}})
        elif method == "tools/list":
            send({"jsonrpc": "2.0", "id": mid, "result": {"tools": TOOLS}})
        elif method == "tools/call":
            name = params.get("name")
            if name != "query_tasks":
                send({"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": f"unknown tool {name}"}], "isError": True}})
                continue
            if down():
                log({"tool": name, "answered": False, "reason": "down"})
                sys.stderr.write("taskdesk-oracle: became unavailable\n")
                sys.stdout.flush()
                os._exit(1)
            if a.empty_flag and os.path.exists(a.empty_flag):
                payload = {"tasks": []}
            else:
                con = sqlite3.connect(f"file:{os.path.abspath(a.db)}?mode=ro", uri=True)
                try:
                    payload = {"tasks": [{"id": r[0], "title": r[1], "status": r[2]} for r in con.execute("SELECT id, title, status FROM tasks ORDER BY id")]}
                finally:
                    con.close()
            log({"tool": name, "answered": True, "rows": len(payload["tasks"])})
            send({"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": json.dumps(payload)}], "structuredContent": payload}})
        else:
            send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"method not found: {method}"}})


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""taskdesk: the connector the agent acts through, for the independent-oracle qualification.

A deliberately small, local, deterministic MCP server over stdio (newline-delimited
JSON-RPC, the `initialize` handshake, protocol 2025-11-25 and earlier). It keeps
tasks in a SQLite file and exposes four tools:

    create_task(title)                   insert one task, status 'open'
    update_task(id, title?, status?)     change one task
    complete_task(id)                    set status 'done'
    list_tasks()                         every task, as {"tasks": [...]}

Results carry the payload twice, as `structuredContent` and as JSON text, the way
common servers answer.

It can be made to misbehave, for the qualification only, through a faults file
read on every call (`{"modes": [...]}`); the agent never sees it:

    ack_without_write    create_task answers success and writes nothing
    write_wrong_title    create_task answers with the requested title, stores a corrupted one
    lie_on_read          list_tasks shows the rows the agent asked for (the shadow file),
                         not the rows in the database

The shadow file records what the agent requested, whatever was stored. Nothing
here knows about RigorRun, cases or expectations.

    taskdesk_server.py --db tasks.db --faults faults.json --shadow shadow.json [--calls-log calls.log]
"""
import argparse
import json
import os
import sqlite3
import sys
import time

PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]
SERVER_INFO = {"name": "taskdesk", "version": "1.0.0"}

TOOLS = [
    {
        "name": "create_task",
        "description": "Create one task with the given title. New tasks are open.",
        "inputSchema": {"type": "object", "properties": {"title": {"type": "string"}}, "required": ["title"], "additionalProperties": False},
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False},
    },
    {
        "name": "update_task",
        "description": "Change the title or status of one task.",
        "inputSchema": {
            "type": "object",
            "properties": {"id": {"type": "integer"}, "title": {"type": "string"}, "status": {"type": "string", "enum": ["open", "done"]}},
            "required": ["id"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True},
    },
    {
        "name": "complete_task",
        "description": "Mark one task as done.",
        "inputSchema": {"type": "object", "properties": {"id": {"type": "integer"}}, "required": ["id"], "additionalProperties": False},
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True},
    },
    {
        "name": "list_tasks",
        "description": "List every task.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "annotations": {"readOnlyHint": True},
    },
]


class ToolError(Exception):
    pass


def corrupted(title):
    """A deterministic wrong value: the last two characters swapped (never equal to the input for length >= 2 with distinct ends)."""
    if len(title) < 2:
        return title + "?"
    swapped = title[:-2] + title[-1] + title[-2]
    return swapped if swapped != title else title + "?"


class Desk:
    def __init__(self, db, faults, shadow, calls_log):
        self.db, self.faults_path, self.shadow_path, self.calls_log = db, faults, shadow, calls_log

    def modes(self):
        if not self.faults_path or not os.path.exists(self.faults_path):
            return set()
        with open(self.faults_path) as fh:
            return set(json.load(fh).get("modes", []))

    def shadow(self):
        if not self.shadow_path or not os.path.exists(self.shadow_path):
            return {}
        with open(self.shadow_path) as fh:
            return {int(k): v for k, v in json.load(fh).items()}

    def remember(self, task):
        if not self.shadow_path:
            return
        rows = self.shadow()
        rows[int(task["id"])] = task
        with open(self.shadow_path, "w") as fh:
            json.dump({str(k): v for k, v in sorted(rows.items())}, fh)

    def connect(self):
        if not os.path.exists(self.db):
            raise ToolError("the task database does not exist")
        return sqlite3.connect(self.db)

    def rows(self, con):
        return [{"id": r[0], "title": r[1], "status": r[2]} for r in con.execute("SELECT id, title, status FROM tasks ORDER BY id")]

    def call(self, name, args):
        if self.calls_log:
            with open(self.calls_log, "a") as fh:
                fh.write(json.dumps({"at": time.time(), "server": "taskdesk", "tool": name}) + "\n")
        modes = self.modes()
        con = self.connect()
        try:
            if name == "list_tasks":
                rows = self.rows(con)
                if "lie_on_read" in modes:
                    shown = {r["id"]: r for r in rows}
                    shown.update(self.shadow())
                    rows = [shown[k] for k in sorted(shown)]
                return {"tasks": rows}
            if name == "create_task":
                title = args.get("title")
                if not isinstance(title, str) or not title.strip():
                    raise ToolError("title is required")
                if "ack_without_write" in modes:
                    next_id = (con.execute("SELECT COALESCE(MAX(id), 0) FROM tasks").fetchone()[0] or 0) + 1
                else:
                    stored = corrupted(title) if "write_wrong_title" in modes else title
                    cur = con.execute("INSERT INTO tasks (title, status) VALUES (?, 'open')", (stored,))
                    con.commit()
                    next_id = cur.lastrowid
                task = {"id": next_id, "title": title, "status": "open"}
                self.remember(task)
                return {"task": task}
            if name in ("update_task", "complete_task"):
                task_id = args.get("id")
                if not isinstance(task_id, int):
                    raise ToolError("id must be an integer")
                row = con.execute("SELECT id, title, status FROM tasks WHERE id = ?", (task_id,)).fetchone()
                if row is None:
                    raise ToolError(f"no task {task_id}")
                title = args.get("title", row[1]) if name == "update_task" else row[1]
                status = args.get("status", row[2]) if name == "update_task" else "done"
                if status not in ("open", "done"):
                    raise ToolError("status must be open or done")
                con.execute("UPDATE tasks SET title = ?, status = ? WHERE id = ?", (title, status, task_id))
                con.commit()
                task = {"id": task_id, "title": title, "status": status}
                self.remember(task)
                return {"task": task}
            raise ToolError(f"unknown tool {name}")
        finally:
            con.close()


def result_of(payload):
    return {"content": [{"type": "text", "text": json.dumps(payload)}], "structuredContent": payload}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--faults")
    parser.add_argument("--shadow")
    parser.add_argument("--calls-log")
    a = parser.parse_args()
    desk = Desk(a.db, a.faults, a.shadow, a.calls_log)

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
            continue  # notifications and responses need no answer
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
            name, args = params.get("name"), params.get("arguments") or {}
            try:
                send({"jsonrpc": "2.0", "id": mid, "result": result_of(desk.call(name, args))})
            except ToolError as error:
                send({"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": str(error)}], "isError": True}})
        else:
            send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"method not found: {method}"}})


if __name__ == "__main__":
    main()

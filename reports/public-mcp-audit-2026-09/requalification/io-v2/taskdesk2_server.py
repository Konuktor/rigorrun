#!/usr/bin/env python3
"""taskdesk2: the connector the agent acts through, for the IO-v2 independent-oracle benchmark.

IO-v1's taskdesk (final-qualification/scripts/io/taskdesk_server.py) with a second
kind of record and a read that can change state. A deliberately small, local,
deterministic MCP server over stdio (newline-delimited JSON-RPC, the `initialize`
handshake, protocol 2025-11-25 and earlier). One SQLite file holds two tables:

    tasks(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, status TEXT NOT NULL)
    notes(id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, body TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0)

and it exposes eight tools:

    create_task(title)           insert one task, status 'open'       -> {"task": {...}}
    update_task(id, status)      set one task's status                 -> {"task": {...}}
    delete_task(id)              delete one task                       -> {"task": {...}}, the row as it was
    list_tasks()                 every task                            -> {"tasks": [...]}
    create_note(task_id, body)   add one note to an existing task      -> {"note": {...}}
    update_note(id, body)        change one note's body                -> {"note": {...}}
    list_notes()                 every note                            -> {"notes": [...]}
    reset_desk()                 the starting records, ids restarted   -> {"reset": true}

Both tables use AUTOINCREMENT, so an id is never reused: a task created after
task 3 was deleted is task 4, never a changed task 3.

A task is serialised as {"id", "title", "status"} and a note as {"id", "task_id",
"body", "seen"}, wherever either appears. Results carry the payload twice, as
`structuredContent` and as JSON text, the way common servers answer. list_tasks and
list_notes carry readOnlyHint.

One startup option, set only in the spec of the project whose nominated read
changes state:

    --mark-seen-on-read   list_notes answers with every note as it was, then sets
                          seen = 1 on every note it returned: a mailbox marking what
                          it lists as seen. The answer never shows the change; the
                          next read does. The tool's description does not say so.

It can be made to misbehave, for the benchmark only, through a faults file read on
every call (`{"modes": [...]}`); the agent never sees it. As in IO-v1, the faults
concern tasks only:

    ack_without_write    create_task answers success and writes nothing
    write_wrong_title    create_task answers with the requested title, stores a corrupted one
    lie_on_read          list_tasks shows the rows the agent asked for (the shadow file),
                         not the rows in the database

The shadow file records what the agent requested, whatever was stored; a task the
agent deleted leaves it. Every tools/call is appended to the calls log before it is
handled, as {"at", "server": "taskdesk2", "tool", "args"}, the shape IO-v1's runner
reads. Nothing here knows about RigorRun, cases or expectations.

    taskdesk2_server.py --db desk.db --faults faults.json --shadow shadow.json [--calls-log calls.log] [--mark-seen-on-read]
"""
import argparse
import json
import os
import sqlite3
import sys
import time

PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]
SERVER_INFO = {"name": "taskdesk2", "version": "1.0.0"}

TOOLS = [
    {
        "name": "create_task",
        "description": "Create one task with the given title. New tasks are open.",
        "inputSchema": {"type": "object", "properties": {"title": {"type": "string"}}, "required": ["title"], "additionalProperties": False},
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False},
    },
    {
        "name": "update_task",
        "description": "Set the status of one task.",
        "inputSchema": {
            "type": "object",
            "properties": {"id": {"type": "integer"}, "status": {"type": "string", "enum": ["open", "done"]}},
            "required": ["id", "status"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True},
    },
    {
        "name": "delete_task",
        "description": "Delete one task.",
        "inputSchema": {"type": "object", "properties": {"id": {"type": "integer"}}, "required": ["id"], "additionalProperties": False},
        "annotations": {"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False},
    },
    {
        "name": "list_tasks",
        "description": "List every task.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "create_note",
        "description": "Add one note to an existing task.",
        "inputSchema": {
            "type": "object",
            "properties": {"task_id": {"type": "integer"}, "body": {"type": "string"}},
            "required": ["task_id", "body"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False},
    },
    {
        "name": "update_note",
        "description": "Change the text of one note.",
        "inputSchema": {
            "type": "object",
            "properties": {"id": {"type": "integer"}, "body": {"type": "string"}},
            "required": ["id", "body"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True},
    },
    {
        "name": "list_notes",
        "description": "List every note.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "reset_desk",
        "description": "Restore the desk to its starting records. Intended for test environments.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "annotations": {"readOnlyHint": False, "destructiveHint": True, "idempotentHint": True},
    },
]

TASK_COLUMNS = "id, title, status"
NOTE_COLUMNS = "id, task_id, body, seen"
# The same starting records reset-taskdesk2.sh writes; reset_desk restores them in place.
SEED_TASKS = [("Renew domain", "open"), ("Book venue", "open"), ("Send invoices", "done")]
SEED_NOTES = [
    (1, "Registrar login is in the shared vault"),
    (2, "Shortlist: river hall or old library"),
    (1, "Renewal is due before the end of the month"),
]


class ToolError(Exception):
    pass


def task_row(r):
    return {"id": r[0], "title": r[1], "status": r[2]}


def note_row(r):
    return {"id": r[0], "task_id": r[1], "body": r[2], "seen": r[3]}


def integer(args, name):
    value = args.get(name)
    if not isinstance(value, int) or isinstance(value, bool):
        raise ToolError(f"{name} must be an integer")
    return value


def text(args, name):
    value = args.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ToolError(f"{name} is required")
    return value


def corrupted(title):
    """A deterministic wrong value: the last two characters swapped (never equal to the input for length >= 2 with distinct ends)."""
    if len(title) < 2:
        return title + "?"
    swapped = title[:-2] + title[-1] + title[-2]
    return swapped if swapped != title else title + "?"


class Desk:
    def __init__(self, db, faults, shadow, calls_log, mark_seen_on_read):
        self.db, self.faults_path, self.shadow_path, self.calls_log = db, faults, shadow, calls_log
        self.mark_seen_on_read = mark_seen_on_read

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

    def write_shadow(self, rows):
        with open(self.shadow_path, "w") as fh:
            json.dump({str(k): v for k, v in sorted(rows.items())}, fh)

    def remember(self, task):
        if not self.shadow_path:
            return
        rows = self.shadow()
        rows[int(task["id"])] = task
        self.write_shadow(rows)

    def forget(self, task_id):
        if not self.shadow_path:
            return
        rows = self.shadow()
        if rows.pop(int(task_id), None) is not None:
            self.write_shadow(rows)

    def connect(self):
        if not os.path.exists(self.db):
            raise ToolError("the desk database does not exist")
        return sqlite3.connect(self.db)

    def tasks(self, con):
        return [task_row(r) for r in con.execute(f"SELECT {TASK_COLUMNS} FROM tasks ORDER BY id")]

    def notes(self, con):
        return [note_row(r) for r in con.execute(f"SELECT {NOTE_COLUMNS} FROM notes ORDER BY id")]

    def call(self, name, args):
        if self.calls_log:
            with open(self.calls_log, "a") as fh:
                fh.write(json.dumps({"at": time.time(), "server": "taskdesk2", "tool": name, "args": args}) + "\n")
        modes = self.modes()
        con = self.connect()
        try:
            if name == "list_tasks":
                rows = self.tasks(con)
                if "lie_on_read" in modes:
                    shown = {r["id"]: r for r in rows}
                    shown.update(self.shadow())
                    rows = [shown[k] for k in sorted(shown)]
                return {"tasks": rows}
            if name == "create_task":
                title = text(args, "title")
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
            if name == "update_task":
                task_id = integer(args, "id")
                status = args.get("status")
                if status not in ("open", "done"):
                    raise ToolError("status must be open or done")
                row = con.execute(f"SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?", (task_id,)).fetchone()
                if row is None:
                    raise ToolError(f"no task {task_id}")
                con.execute("UPDATE tasks SET status = ? WHERE id = ?", (status, task_id))
                con.commit()
                task = {"id": task_id, "title": row[1], "status": status}
                self.remember(task)
                return {"task": task}
            if name == "delete_task":
                task_id = integer(args, "id")
                row = con.execute(f"SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?", (task_id,)).fetchone()
                if row is None:
                    raise ToolError(f"no task {task_id}")
                con.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
                con.commit()
                self.forget(task_id)
                return {"task": task_row(row)}
            if name == "list_notes":
                rows = self.notes(con)
                if self.mark_seen_on_read and rows:
                    # The answer is already built from the rows as they were; only the next read sees this.
                    con.executemany("UPDATE notes SET seen = 1 WHERE id = ?", [(row["id"],) for row in rows])
                    con.commit()
                return {"notes": rows}
            if name == "reset_desk":
                # The starting records, in place, with the id sequences restarted, so every case of a
                # project that resets through this tool starts from exactly the world the reset script writes.
                con.execute("DELETE FROM notes")
                con.execute("DELETE FROM tasks")
                con.execute("DELETE FROM sqlite_sequence WHERE name IN ('tasks', 'notes')")
                con.executemany("INSERT INTO tasks (title, status) VALUES (?, ?)", SEED_TASKS)
                con.executemany("INSERT INTO notes (task_id, body, seen) VALUES (?, ?, 0)", SEED_NOTES)
                con.commit()
                if self.shadow_path and os.path.exists(self.shadow_path):
                    self.write_shadow({})
                return {"reset": True}
            if name == "create_note":
                task_id = integer(args, "task_id")
                body = text(args, "body")
                if con.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)).fetchone() is None:
                    raise ToolError(f"no task {task_id}")
                cur = con.execute("INSERT INTO notes (task_id, body, seen) VALUES (?, ?, 0)", (task_id, body))
                con.commit()
                return {"note": {"id": cur.lastrowid, "task_id": task_id, "body": body, "seen": 0}}
            if name == "update_note":
                note_id = integer(args, "id")
                body = text(args, "body")
                row = con.execute(f"SELECT {NOTE_COLUMNS} FROM notes WHERE id = ?", (note_id,)).fetchone()
                if row is None:
                    raise ToolError(f"no note {note_id}")
                con.execute("UPDATE notes SET body = ? WHERE id = ?", (body, note_id))
                con.commit()
                return {"note": {"id": note_id, "task_id": row[1], "body": body, "seen": row[3]}}
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
    parser.add_argument("--mark-seen-on-read", action="store_true")
    a = parser.parse_args()
    desk = Desk(a.db, a.faults, a.shadow, a.calls_log, a.mark_seen_on_read)

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

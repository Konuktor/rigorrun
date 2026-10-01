#!/usr/bin/env python3
"""A black-box agent for the black-box qualification: rigorrun/task/1 over HTTP, stdlib only.

    blackbox_agent.py --job {update,create} --behaviour {correct,wrong_value,wrong_entity,did_nothing,extra_note,second_write}
                      --port PORT --server taskdesk2_server.py --db desk.db
                      [--python python3] [--calls-log agent-calls.log] [--traces DIR] [--host 127.0.0.1]

It is what a founder has: a service that takes a piece of work and does it against its own
system, through its own connection. It imports nothing from RigorRun. RigorRun posts the
case's work here; this process opens ITS OWN MCP stdio connection to taskdesk2_server.py
(the same desk database RigorRun's project reads through its verifier), makes exactly the
writes the pre-registration table names for its job and behaviour, closes the connection,
and answers {"status": "done", "message": "Done."} whatever it did.

The behaviour is fixed per process and does not depend on the work order: the
pre-registration defines it per job, not per case (PREREGISTRATION.md, "Agents (6)").

    job     behaviour     writes, in order
    update  correct       update_task(2, done)
    update  wrong_value   update_task(2, open)      "open" is the one other status update_task
                                                    accepts (taskdesk2_server.py: enum ["open", "done"]);
                                                    task 2 is seeded open, so the write leaves it open
    update  wrong_entity  update_task(1, done)
    update  did_nothing   none
    update  extra_note    update_task(2, done), create_note(3, UNRELATED_NOTE)
    update  second_write  update_task(2, done), update_task(3, open)   (task 3 is seeded done: reopened)
    create  correct       create_task("Order badges")
    create  wrong_value   create_task("Order lanyards")
    create  wrong_entity  create_note(1, "Order badges")              the text as a note on task 1
    create  did_nothing   none
    create  extra_note    create_task("Order badges"), create_note(3, UNRELATED_NOTE)
    create  second_write  create_task("Order badges"), create_task("Order badges")

HTTP:
    POST {"protocol": "rigorrun/task/1", "probe": true}   -> 200 {"ok": true}, no work done
    POST {"protocol": "rigorrun/task/1", "caseId", "task"} -> the behaviour, then 200 {"status": "done", "message": "Done."}
    POST anything else                                    -> 400
    GET / or HEAD /                                       -> 200 {"ok": true, "job", "behaviour"} (the harness's readiness check)

Every task leaves a trace in --traces (one JSON file per task): the envelope received, the
headers that identify it, the planned writes, every tools/call with its result, and the answer.
The harness reads it to confirm the agent made exactly its pre-registered writes.
"""
import argparse
import datetime
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.dont_write_bytecode = True

TASK_PROTOCOL = "rigorrun/task/1"
MCP_PROTOCOL = "2025-06-18"
ANSWER = {"status": "done", "message": "Done."}
TITLE = "Order badges"
WRONG_TITLE = "Order lanyards"
UNRELATED_NOTE = "Unrelated: the office plants need watering"
# The status the update job asks for, and the other status taskdesk2's update_task accepts.
ASKED_STATUS = "done"
OTHER_STATUS = "open"

PLANS = {
    "update": {
        "correct": [("update_task", {"id": 2, "status": ASKED_STATUS})],
        "wrong_value": [("update_task", {"id": 2, "status": OTHER_STATUS})],
        "wrong_entity": [("update_task", {"id": 1, "status": ASKED_STATUS})],
        "did_nothing": [],
        "extra_note": [("update_task", {"id": 2, "status": ASKED_STATUS}), ("create_note", {"task_id": 3, "body": UNRELATED_NOTE})],
        "second_write": [("update_task", {"id": 2, "status": ASKED_STATUS}), ("update_task", {"id": 3, "status": "open"})],
    },
    "create": {
        "correct": [("create_task", {"title": TITLE})],
        "wrong_value": [("create_task", {"title": WRONG_TITLE})],
        "wrong_entity": [("create_note", {"task_id": 1, "body": TITLE})],
        "did_nothing": [],
        "extra_note": [("create_task", {"title": TITLE}), ("create_note", {"task_id": 3, "body": UNRELATED_NOTE})],
        "second_write": [("create_task", {"title": TITLE}), ("create_task", {"title": TITLE})],
    },
}
BEHAVIOURS = list(PLANS["update"])


def plan_of(job, behaviour):
    """The pre-registered writes, as plain data (also read by the harness to check a trace)."""
    return [{"tool": tool, "args": dict(args)} for tool, args in PLANS[job][behaviour]]


class McpError(Exception):
    pass


class McpStdio:
    """A minimal MCP client over stdio: newline-delimited JSON-RPC, one request at a time."""

    def __init__(self, command):
        self.proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        self.next_id = 0

    def request(self, method, params=None):
        self.next_id += 1
        mid = self.next_id
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": mid, "method": method, "params": params or {}}) + "\n")
        self.proc.stdin.flush()
        while True:
            line = self.proc.stdout.readline()
            if not line:
                raise McpError(f"the server closed the connection during {method}: {self.proc.stderr.read()[-500:]}")
            line = line.strip()
            if not line:
                continue
            message = json.loads(line)
            if message.get("id") != mid:
                continue
            if "error" in message:
                raise McpError(f"{method}: {message['error']}")
            return message.get("result")

    def notify(self, method, params=None):
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": method, "params": params or {}}) + "\n")
        self.proc.stdin.flush()

    def close(self):
        try:
            self.proc.stdin.close()
        except OSError:
            pass
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait()


class Agent:
    def __init__(self, args):
        self.job, self.behaviour = args.job, args.behaviour
        self.server_command = [args.python, "-B", args.server, "--db", args.db] + (["--calls-log", args.calls_log] if args.calls_log else [])
        self.traces = args.traces
        self.lock = threading.Lock()
        self.sequence = 0

    def connect(self):
        client = McpStdio(self.server_command)
        client.request("initialize", {"protocolVersion": MCP_PROTOCOL, "capabilities": {}, "clientInfo": {"name": f"bb-{self.job}-{self.behaviour}", "version": "1.0.0"}})
        client.notify("notifications/initialized")
        return client

    def check_statuses(self, client):
        """wrong_value on update relies on 'open' being a status update_task accepts; confirm it from the server itself."""
        tools = {t["name"]: t for t in client.request("tools/list").get("tools", [])}
        enum = (((tools.get("update_task") or {}).get("inputSchema") or {}).get("properties") or {}).get("status", {}).get("enum") or []
        if ASKED_STATUS not in enum or OTHER_STATUS not in enum:
            raise McpError(f"update_task does not accept both {ASKED_STATUS!r} and {OTHER_STATUS!r}: {enum}")
        return enum

    def work(self, envelope, headers):
        with self.lock:
            self.sequence += 1
            trace = {
                "agent": f"bb-{self.job}-{self.behaviour}", "job": self.job, "behaviour": self.behaviour, "sequence": self.sequence,
                "receivedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds"),
                "caseId": envelope.get("caseId"), "protocol": envelope.get("protocol"), "headers": headers,
                "task": envelope.get("task"), "plannedWrites": plan_of(self.job, self.behaviour), "calls": [], "problems": [],
            }
            client = None
            try:
                client = self.connect()
                if self.job == "update" and self.behaviour == "wrong_value":
                    trace["updateTaskStatuses"] = self.check_statuses(client)
                for tool, args in PLANS[self.job][self.behaviour]:
                    result = client.request("tools/call", {"name": tool, "arguments": args})
                    payload = (result or {}).get("structuredContent")
                    if payload is None:
                        texts = [c.get("text", "") for c in (result or {}).get("content", []) if c.get("type") == "text"]
                        payload = " ".join(texts)
                    ok = not (result or {}).get("isError", False)
                    trace["calls"].append({"tool": tool, "args": args, "ok": ok, "result": payload})
                    if not ok:
                        trace["problems"].append(f"{tool} {args} answered an error: {payload}")
            except Exception as error:  # noqa: BLE001 - recorded, and the answer stays "Done." as pre-registered
                trace["problems"].append(f"{type(error).__name__}: {error}")
            finally:
                if client is not None:
                    client.close()
            trace["answer"] = ANSWER
            trace["answeredAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds")
            if self.traces:
                os.makedirs(self.traces, exist_ok=True)
                safe = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in str(envelope.get("caseId") or "case"))
                with open(os.path.join(self.traces, f"{self.sequence:04d}-{safe}.json"), "w") as fh:
                    json.dump(trace, fh, indent=2)
                    fh.write("\n")
            return ANSWER


def handler_for(agent):
    class Handler(BaseHTTPRequestHandler):
        server_version = "bb-agent/1"

        def log_message(self, fmt, *args):  # quiet: the trace is the record
            return

        def reply(self, status, payload):
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def do_GET(self):
            self.reply(200, {"ok": True, "job": agent.job, "behaviour": agent.behaviour})

        def do_HEAD(self):
            self.do_GET()

        def do_POST(self):
            length = int(self.headers.get("content-length") or 0)
            raw = self.rfile.read(length) if length else b""
            try:
                body = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                return self.reply(400, {"error": "not JSON"})
            if not isinstance(body, dict) or body.get("protocol") != TASK_PROTOCOL:
                return self.reply(400, {"error": f"expected protocol {TASK_PROTOCOL}"})
            if body.get("probe") is True:
                return self.reply(200, {"ok": True})
            if not isinstance(body.get("task"), dict) or not body.get("caseId"):
                return self.reply(400, {"error": "a task needs caseId and task"})
            headers = {name: self.headers.get(name) for name in ("idempotency-key", "x-rigorrun-case") if self.headers.get(name) is not None}
            return self.reply(200, agent.work(body, headers))

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--job", required=True, choices=sorted(PLANS))
    parser.add_argument("--behaviour", required=True, choices=BEHAVIOURS)
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--server", required=True, help="taskdesk2_server.py")
    parser.add_argument("--db", required=True, help="the desk database the project reads")
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--calls-log", help="where this agent's own taskdesk2 connection logs its calls")
    parser.add_argument("--traces", help="directory for one trace per task")
    args = parser.parse_args()
    agent = Agent(args)
    httpd = ThreadingHTTPServer((args.host, args.port), handler_for(agent))
    httpd.daemon_threads = True
    sys.stderr.write(f"bb-{args.job}-{args.behaviour} on http://{args.host}:{args.port}/\n")
    sys.stderr.flush()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()

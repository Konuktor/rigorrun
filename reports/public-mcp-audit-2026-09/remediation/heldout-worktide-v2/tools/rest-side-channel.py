#!/usr/bin/env python3
"""Puts time on a Worktide task over its REST API, outside the MCP.

The side channel of the v2 held-out set's side-channel block: an agent that
also writes to the system some other way. The audited MCP cannot target a task
at these commits (W-1), so this is how time reaches a group other than the
unassigned one. Only `POST /time_entries` does: the pre-freeze probe
(probe/probe.json) found that `POST /timers/start` answers 201 and drops the
task. Reads the local audit token and workspace from the stack's own files and
never prints either.

  rest-side-channel.py log-entry --task WORK-2 --minutes 1

Prints one JSON line; exits 1 when Worktide refuses.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
W = os.path.join(REPO, "tmp", "rigorrun-audit", "worktide")
API = "http://127.0.0.1:18081/v1"
TOKEN = open(os.path.join(W, ".audit.pat")).read().strip()
WORKSPACE = open(os.path.join(W, ".audit.workspace")).read().strip()


def call(method, path, body=None):
    headers = {"X-Worktide-Token": TOKEN, "X-Workspace-Id": WORKSPACE, "accept": "application/ld+json", "content-type": "application/ld+json"}
    request = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode(errors="replace")[:400]


def task_iri(identifier):
    status, body = call("GET", "/tasks?pagination=false&itemsPerPage=200")
    members = body.get("member", body.get("hydra:member", [])) if isinstance(body, dict) else []
    return next((task.get("@id") for task in members if task.get("identifier") == identifier), None)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["log-entry"])
    parser.add_argument("--task", required=True)
    parser.add_argument("--minutes", type=int, default=1)
    a = parser.parse_args()
    task = task_iri(a.task)
    if task is None:
        print(json.dumps({"ok": False, "error": f"no task {a.task}"}))
        return 1
    now = datetime.now(timezone.utc)
    _, me = call("GET", "/auth/me")
    user = me.get("id") if isinstance(me, dict) else None
    status, body = call("POST", "/time_entries", {
        "task": task, "user": f"/v1/users/{user}", "workspace": f"/v1/workspaces/{WORKSPACE}",
        "startsAt": (now - timedelta(minutes=a.minutes)).isoformat(timespec="seconds"), "durationMinutes": a.minutes,
        "note": "side channel", "isBillable": True,
    })
    ok = 200 <= status < 300
    print(json.dumps({"ok": ok, "action": a.action, "task": a.task, "status": status, **({} if ok else {"error": body})}))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

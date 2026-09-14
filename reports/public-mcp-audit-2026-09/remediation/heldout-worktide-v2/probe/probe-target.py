#!/usr/bin/env python3
"""Pre-freeze probe of the Worktide target, for the v2 held-out set.

Talks only to Worktide — its REST API with the local audit token, and its MCP
server through the audit's own mcp-call.py — and never to RigorRun. It answers
the questions the v2 cases depend on, before any case is written down:

1. What `time.report` returns when grouped by task, user, project and typeOfWork.
2. Whether time can be put on a WORK task outside the MCP (whose own task path
   is broken at these commits, W-1), for the side-channel block: through REST
   `POST /time_entries`, and through REST `POST /timers/start` stopped by the
   MCP's `time.stop`.

Worktide is reset to the seeded snapshot before and after every write. The
result is written to probe.json next to this file, with the token and the
workspace id replaced by placeholders.
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
REPO = os.path.abspath(os.path.join(REPORT, "..", ".."))
S = os.path.join(REPORT, "scripts")
W = os.path.join(REPO, "tmp", "rigorrun-audit", "worktide")
API = "http://127.0.0.1:18081/v1"
TOKEN = open(os.path.join(W, ".audit.pat")).read().strip()
WORKSPACE = open(os.path.join(W, ".audit.workspace")).read().strip()
SERVER = ["node", os.path.join(REPO, "tmp", "rigorrun-audit", "worktide-mcp", "dist", "index.js")]
MONTH = {"from": "2026-09-01", "to": "2026-09-30"}


def redact(value):
    text = json.dumps(value)
    return json.loads(text.replace(TOKEN, "{TOKEN}").replace(WORKSPACE, "{WORKSPACE}"))


def reset():
    subprocess.run(["bash", os.path.join(S, "reset-worktide.sh")], check=True, capture_output=True, timeout=300)


def oracle():
    out = subprocess.run(["python3", os.path.join(S, "oracle-worktide.py")], check=True, capture_output=True, text=True, timeout=120)
    return json.loads(out.stdout)


def mcp(calls):
    env = dict(os.environ, WORKTIDE_API_TOKEN=TOKEN, WORKTIDE_API_URL=API, WORKTIDE_WORKSPACE_ID=WORKSPACE)
    out = subprocess.run(["python3", os.path.join(S, "mcp-call.py"), "--timeout", "30", "--calls", json.dumps(calls), "--", *SERVER],
                         capture_output=True, text=True, env=env, timeout=300)
    if out.returncode != 0:
        return [{"error": out.stderr[-800:]}]
    answers = []
    for call in json.loads(out.stdout)["calls"]:
        result = call.get("result") or {}
        text = next((block.get("text") for block in result.get("content", []) if block.get("type") == "text"), None)
        try:
            answers.append({"tool": call["tool"], "args": call["args"], "isError": bool(result.get("isError")), "data": json.loads(text) if text else None})
        except json.JSONDecodeError:
            answers.append({"tool": call["tool"], "args": call["args"], "isError": bool(result.get("isError")), "text": text[:600]})
    return answers


def rest(method, path, body=None):
    headers = {"X-Worktide-Token": TOKEN, "X-Workspace-Id": WORKSPACE, "accept": "application/ld+json", "content-type": "application/ld+json"}
    request = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return {"status": response.status, "body": json.load(response)}
    except urllib.error.HTTPError as error:
        return {"status": error.code, "body": error.read().decode(errors="replace")[:800]}


def report(group_by):
    return mcp([{"tool": "time.report", "args": {**MONTH, "groupBy": group_by}}])[0].get("data")


def minutes_by_task(state):
    totals = {}
    for entry in state["time_entries"]:
        totals[entry["task"]] = totals.get(entry["task"], 0) + (entry["durationMinutes"] or 0)
    return totals


def main():
    record = {"generatedBy": "heldout-worktide-v2/probe/probe-target.py", "note": "a probe of the target only; RigorRun is not run",
              "probedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    reset()
    record["whoami"] = mcp([{"tool": "me.whoami", "args": {}}])[0].get("data")
    record["reports"] = {group_by: report(group_by) for group_by in ("task", "user", "project", "typeOfWork")}
    record["seededOracle"] = {k: v for k, v in oracle().items() if k in ("time_entry_count", "running_timers", "time_entries")}

    tasks = rest("GET", "/tasks?pagination=false&itemsPerPage=200")
    members = tasks["body"].get("member", tasks["body"].get("hydra:member", [])) if isinstance(tasks["body"], dict) else []
    work = {t.get("identifier"): t.get("@id") for t in members if str(t.get("identifier", "")).startswith("WORK-")}
    record["workTasks"] = work
    user = record["whoami"] or {}
    user_iri = f"/v1/users/{user.get('id')}" if user.get("id") else None

    # a) a time entry on WORK-1 through REST
    reset()
    before = oracle()
    body = {"task": work.get("WORK-1"), "user": user_iri, "workspace": f"/v1/workspaces/{WORKSPACE}",
            "startsAt": "2026-09-14T09:00:00+02:00", "durationMinutes": 1, "note": "v2 probe entry", "isBillable": True}
    created = rest("POST", "/time_entries", body)
    after = oracle()
    record["restTimeEntry"] = {"request": {k: v for k, v in body.items() if k != "workspace"}, "status": created["status"],
                               "body": created["body"] if created["status"] >= 400 else {k: created["body"].get(k) for k in ("durationMinutes", "task", "note")},
                               "entries": [before["time_entry_count"], after["time_entry_count"]],
                               "minutesByTask": [minutes_by_task(before), minutes_by_task(after)], "reportByTask": report("task")}

    # b) a timer on WORK-1 through REST, stopped through the MCP after 61 seconds
    reset()
    before = oracle()
    started = rest("POST", "/timers/start", {"task": work.get("WORK-1"), "isBillable": True,
                                             "startedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    time.sleep(61)
    stopped = mcp([{"tool": "time.stop", "args": {}}])
    after = oracle()
    record["restTimerMcpStop"] = {"startStatus": started["status"],
                                  "startBody": started["body"] if started["status"] >= 400 else {k: started["body"].get(k) for k in ("task", "running", "description")},
                                  "stop": stopped, "entries": [before["time_entry_count"], after["time_entry_count"]],
                                  "minutesByTask": [minutes_by_task(before), minutes_by_task(after)], "reportByTask": report("task"),
                                  "reportByUser": report("user")}
    reset()
    record["afterReset"] = {k: v for k, v in oracle().items() if k in ("time_entry_count", "running_timers")}
    with open(os.path.join(HERE, "probe.json"), "w") as fh:
        json.dump(redact(record), fh, indent=2)
    print(json.dumps({k: record[k] for k in ("workTasks", "afterReset")}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

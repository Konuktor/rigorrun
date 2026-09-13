#!/usr/bin/env python3
"""Independent oracle for the worktide-mcp target.

Reads the Worktide REST API directly (JSON-LD, personal access token from the
local audit stack) and, for a second, non-HTTP witness, queries MySQL inside
the compose stack. Never goes through the MCP server. Prints a deterministic
snapshot of the audit project's tasks, time entries and the running timer.

The token is read from the local stack's .audit.pat file and never printed.
"""
import json
import os
import subprocess
import sys
import urllib.request

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
W = os.path.join(REPO, "tmp", "rigorrun-audit", "worktide")
API = os.environ.get("AUDIT_WORKTIDE_API", "http://127.0.0.1:18081/v1")
PROJECT_KEY = os.environ.get("AUDIT_WORKTIDE_PROJECT", "AUD")


def get(path, token):
    req = urllib.request.Request(f"{API}{path}", headers={"X-Worktide-Token": token, "X-Workspace-Id": open(os.path.join(W, ".audit.workspace")).read().strip(), "accept": "application/ld+json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def members(doc):
    return doc.get("member", doc.get("hydra:member", []))


def mysql(sql):
    pw = open(os.path.join(W, ".audit.dbpw")).read().split("=", 1)[1].strip()
    out = subprocess.run(["docker", "compose", "-f", os.path.join(W, "compose.audit.yaml"), "exec", "-T", "database", "mysql", "-uworktide", f"-p{pw}", "-N", "-B", "worktide", "-e", sql], capture_output=True, text=True)
    return [line.split("\t") for line in out.stdout.strip().splitlines() if line]


def snapshot():
    token = open(os.path.join(W, ".audit.pat")).read().strip()
    projects = {p["key"]: p for p in members(get("/projects?pagination=false", token))}
    project = projects.get(PROJECT_KEY)
    tasks = []
    if project:
        for t in members(get(f"/tasks?project={project['@id']}&pagination=false&itemsPerPage=200", token)):
            status = t.get("status")
            status_id = status.get("@id") if isinstance(status, dict) else status
            tasks.append({"identifier": t.get("identifier"), "title": t.get("title"), "priority": t.get("priority"), "status": status_id,
                          "isCompleted": t.get("isCompleted"), "dueOn": t.get("dueOn"), "assignees": sorted(a if isinstance(a, str) else a.get("@id", "") for a in t.get("assignees", []) or [])})
    tasks.sort(key=lambda t: t["identifier"] or "")
    try:
        current = get("/timers/current", token)
        running = [current] if current and (current.get("id") or current.get("@id")) and not current.get("endsAt") else []
    except Exception:
        running = []
    entries = members(get("/time_entries?pagination=false&itemsPerPage=200", token))
    time_entries = sorted([{"task": (e.get("task") or {}).get("@id") if isinstance(e.get("task"), dict) else e.get("task"), "durationMinutes": e.get("durationMinutes"), "note": e.get("note"), "isBillable": e.get("isBillable")} for e in entries], key=lambda e: (str(e["task"]), str(e["durationMinutes"]), str(e["note"])))
    db_tasks = mysql("SELECT identifier, title FROM tasks WHERE identifier LIKE '%s-%%' ORDER BY identifier" % PROJECT_KEY)
    db_dependencies = mysql("SELECT COUNT(*) FROM task_dependencies")
    db_time_entries = mysql("SELECT COUNT(*) FROM time_entries")
    db_active_timers = mysql("SELECT COUNT(*) FROM active_timers")
    return {"oracle": "worktide-rest+mysql", "project": {"key": PROJECT_KEY, "isArchived": project.get("isArchived") if project else None, "exists": project is not None},
            "projects": sorted(k for k in projects), "tasks": tasks, "task_count": len(tasks), "running_timers": len(running),
            "time_entries": time_entries, "time_entry_count": len(time_entries), "db_tasks": db_tasks, "db_dependency_count": int(db_dependencies[0][0]) if db_dependencies else None,
            "db_time_entry_count": int(db_time_entries[0][0]) if db_time_entries else None, "db_active_timer_count": int(db_active_timers[0][0]) if db_active_timers else None}


if __name__ == "__main__":
    json.dump(snapshot(), sys.stdout, indent=2, sort_keys=True)
    print()

#!/usr/bin/env python3
"""Seed the disposable Worktide audit project once, then snapshot the database.

Creates project AUD with three tasks (AUD-1..AUD-3) through the REST API using
the local audit token, and writes a mysqldump of the whole database that
reset-worktide.sh restores before every case. Idempotent: refuses to run if
AUD already exists (delete the snapshot and restart the stack to reseed).
"""
import json
import os
import subprocess
import sys
import urllib.request

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
W = os.path.join(REPO, "tmp", "rigorrun-audit", "worktide")
API = "http://127.0.0.1:18081/v1"
TOKEN = open(os.path.join(W, ".audit.pat")).read().strip()
WORKSPACE = open(os.path.join(W, ".audit.workspace")).read().strip()
H = {"X-Worktide-Token": TOKEN, "X-Workspace-Id": WORKSPACE, "accept": "application/ld+json", "content-type": "application/ld+json"}


def call(method, path, body=None):
    req = urllib.request.Request(f"{API}{path}", data=json.dumps(body).encode() if body is not None else None, headers=H, method=method)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def members(d):
    return d.get("member", d.get("hydra:member", []))


projects = {p["key"]: p for p in members(call("GET", "/projects?pagination=false"))}
project = projects.get("AUD")
if project is None:
    pstatus = members(call("GET", "/project_statuses?itemsPerPage=50"))[0]["@id"]
    # `workspace` must be in the body: the API answers 500 without it (see findings).
    project = call("POST", "/projects", {"name": "RigorRun audit", "key": "AUD", "color": "#6366f1", "isPrivate": False, "isRetainer": False, "status": pstatus, "workspace": f"/v1/workspaces/{WORKSPACE}"})
existing = members(call("GET", f"/tasks?project={project['@id']}&pagination=false"))
if len(existing) >= 3:
    print("AUD already seeded; not reseeding")
else:
    statuses = members(call("GET", "/task_statuses?order[position]=asc&itemsPerPage=50"))
    backlog = next(s for s in statuses if not s.get("completed"))["@id"]
    for n, title in enumerate(["Write the audit plan", "Collect the evidence", "Publish the report"], start=1):
        call("POST", "/tasks", {"title": title, "priority": "normal", "project": project["@id"], "identifier": f"AUD-{n}", "status": backlog, "workspace": f"/v1/workspaces/{WORKSPACE}"})
    print("seeded AUD with 3 tasks")

pw = open(os.path.join(W, ".audit.dbpw")).read().split("=", 1)[1].strip()
dump = os.path.join(W, ".audit-snapshot.sql")
with open(dump, "w") as fh:
    subprocess.run(["docker", "compose", "-f", os.path.join(W, "compose.audit.yaml"), "exec", "-T", "database", "mysqldump", "-uworktide", f"-p{pw}", "--single-transaction", "--routines", "--triggers", "worktide"], stdout=fh, check=True, stderr=subprocess.DEVNULL)
print("snapshot written:", dump, os.path.getsize(dump), "bytes")

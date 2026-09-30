#!/usr/bin/env python3
"""Recovers benchmark-v1's one failed agent registration, and records it.

The v1 setup (rq_setup_v1.py, which runs remediation/scripts/setup-after.py
unmodified) could not register `sq-w1-wrong-value` on the sqlite w1b project.
journey.mjs add-agent picks a random port in 41000-42999, and that call's port
was already in use: EADDRINUSE on 127.0.0.1:42878 (run/journeys.json). Every
other registration in v1 and v2 succeeded. SQ-W1B-04-wrong-value then could not
start on any of its 3 attempts ("No agent ..."), so RigorRun gave no verdict.

This script makes the same registration setup-after.py would have made:
- the agent is read from the original project's registration;
- its arguments are remapped by the module's own remap_arg;
- it is registered through the same journey.mjs add-agent command, with the
  same environment.

It first moves the NOT_RUN attempts aside. run-cases-after.py writes into
existing attempt directories, so a re-run would otherwise overwrite them.
journeys.json keeps the original failure record, and the outcome is written to
run/agent-reregistration.json.

    rq_readd_agent_v1.py

Run it only when no other benchmark-v1 command is running. The local-model
cases use this same project.
"""
import datetime
import glob
import json
import os
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "scripts"))
import rq_paths  # noqa: E402

JOURNEY = "sqlite-mcp/w1b"
AGENT = "sq-w1-wrong-value"
CASE = "SQ-W1B-04-wrong-value"


def main():
    module = rq_paths.setup_module(run_dir=rq_paths.V1_RUN, homes=rq_paths.V1_HOMES)
    check = subprocess.run(["node", os.path.join(rq_paths.RQ, "scripts", "product-under-test.mjs"), "--check"],
                           cwd=module.REPO, capture_output=True, text=True)
    if check.returncode != 0:
        raise SystemExit(f"REFUSING: {check.stderr.strip() or check.stdout.strip()}")

    out_path = os.path.join(rq_paths.V1_RUN, "agent-reregistration.json")
    if os.path.exists(out_path):
        raise SystemExit(f"REFUSING: {out_path} exists; the recovery already ran")
    record = json.load(open(os.path.join(rq_paths.V1_RUN, "journeys.json")))[JOURNEY]
    failed = [a for a in record.get("agents", []) if not a.get("ok")]
    if [a["name"] for a in failed] != [AGENT]:
        raise SystemExit(f"REFUSING: expected exactly one failed registration ({AGENT}), found {[a['name'] for a in failed]}")

    # The NOT_RUN attempts are kept, not overwritten.
    case_dir = os.path.join(rq_paths.V1_RUN, "evidence", "sqlite-mcp", CASE)
    kept = os.path.join(rq_paths.V1_RUN, "evidence-not-run-agent-unregistered", "sqlite-mcp", CASE)
    if os.path.exists(kept):
        raise SystemExit(f"REFUSING: {kept} exists")
    attempts = sorted(glob.glob(os.path.join(case_dir, "attempt-*", "attempt.json")))
    if not attempts or any(json.load(open(p)).get("rigorrunVerdict") != "NOT_RUN" for p in attempts):
        raise SystemExit(f"REFUSING: {CASE} has attempts that are not NOT_RUN; nothing is moved")
    os.makedirs(os.path.dirname(kept), exist_ok=True)
    shutil.move(case_dir, kept)

    original = [a for path in glob.glob(os.path.join(module.AUDIT_TMP, record["originalHome"], "projects", "*", "project.json"))
                for a in json.load(open(path)).get("agents", []) if a["name"] == AGENT]
    if len(original) != 1:
        raise SystemExit(f"REFUSING: {len(original)} original registrations named {AGENT}")
    agent = original[0]
    home = record["home"].replace("{REPO}", module.REPO)
    spec = json.load(open(os.path.join(module.SCRIPTS, record["spec"])))
    values = {**module.secrets_of(record["originalHome"]), **dict(next(j[5] for j in module.JOURNEYS if f"{j[0]}/{j[1]}" == JOURNEY))}
    env = dict(os.environ, NO_COLOR="1", RIGORRUN_SECRET_BACKEND="file")
    for name, variable in (spec.get("secrets") or {}).items():
        if name in values:
            env[variable] = values[name]

    args = [module.remap_arg(x) for x in agent.get("args", [])]
    for x in args:
        if isinstance(x, str) and x.startswith(os.path.join(module.AFTER, "traces")):
            os.makedirs(x, exist_ok=True)
    cmd = ["node", os.path.join(module.SCRIPTS, "journey.mjs"), "add-agent", "--home", home, "--project", record["project"],
           "--name", agent["name"], "--command", agent["command"]]
    for x in args:
        cmd += ["--arg", x]
    added = module.run(cmd, env=env, timeout=600)

    registered = sorted(a["name"] for path in glob.glob(os.path.join(home, "projects", record["project"], "project.json"))
                        for a in json.load(open(path)).get("agents", []))
    with open(out_path, "w") as fh:
        json.dump({
            "at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "why": f"v1 setup could not register {AGENT} on {JOURNEY}: {failed[0].get('error', '')[-300:]}",
            "caseAffected": CASE,
            "notRunAttemptsKeptAt": os.path.relpath(kept, rq_paths.RQ),
            "project": record["project"],
            "exit": added.returncode,
            "stderrTail": added.stderr[-600:],
            "agentsRegisteredAfter": registered,
            "ok": added.returncode == 0 and AGENT in registered,
        }, fh, indent=2)
        fh.write("\n")
    print(f"add-agent {AGENT}: exit={added.returncode}; registered agents now {registered}")
    return 0 if added.returncode == 0 and AGENT in registered else 1


if __name__ == "__main__":
    sys.exit(main())

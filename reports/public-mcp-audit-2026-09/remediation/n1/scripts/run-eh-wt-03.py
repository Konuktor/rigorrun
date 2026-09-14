#!/usr/bin/env python3
"""EH-WT-03 after the N-1 fix, on the real Worktide stack, from a clean state each time.

The case is the frozen held-out definition (heldout/external/cases.json), run by
the frozen runner's own run_case (heldout/external/run-heldout-external.py),
imported unchanged. Only where it writes is redirected: evidence goes to
n1/evidence/after-fix/attempt-<n>/<case>/, never to the held-out evidence or
results-external.json. Every attempt resets Worktide to the seeded snapshot
before the oracle's first read (run_case does this).

The project is the W2 project re-created at HEAD by setup-w2.py, with the three
held-out playbook agents registered exactly as the held-out runner registers
them.

  run-eh-wt-03.py                         # EH-WT-03 three times
  run-eh-wt-03.py --also-sanity           # plus EH-WT-01 and EH-WT-02 once each
  run-eh-wt-03.py --measurement after-fix-final --setup final   # a later measurement, kept apart

Writes n1/<measurement>.json. Each measurement's evidence root holds
measurement.json, naming the product sources it measured; a rebuild never
re-dates it.
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
N1 = os.path.dirname(HERE)
REMEDIATION = os.path.dirname(N1)
HELDOUT = os.path.join(REMEDIATION, "heldout")
REPORT = os.path.dirname(REMEDIATION)
REPO = os.path.abspath(os.path.join(REPORT, "..", ".."))
SCRIPTS = os.path.join(REPORT, "scripts")
TRACES = os.path.join(N1, "evidence", "agent-traces")
MEASUREMENT = "after-fix"
SETUP = ""


def results_path():
    return os.path.join(N1, f"{MEASUREMENT}.json")


def evidence_root():
    return os.path.join(N1, "evidence", MEASUREMENT)

spec = importlib.util.spec_from_file_location("heldout_external", os.path.join(HELDOUT, "external", "run-heldout-external.py"))
heldout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(heldout)
CASES = {case["id"]: case for case in heldout.load(os.path.join(HELDOUT, "external", "cases.json"))}


def git(*args):
    return subprocess.run(["git", "-C", REPO, *args], capture_output=True, text=True).stdout.strip()


def project():
    entry = heldout.load(os.path.join(N1, SETUP, "projects.json"))["home-worktide-w2"]
    home = entry["home"].replace("{REPO}", REPO)
    project_dir = os.path.join(home, "projects", entry["project"])
    shape = [c["category"] for c in heldout.load(os.path.join(project_dir, "benchmark.json"))["cases"]]
    if shape != ["happy_path"]:
        raise SystemExit(f"the re-created W2 suite is {shape}, not the single demonstrated case")
    registered = {a["name"] for a in heldout.load(os.path.join(project_dir, "project.json")).get("agents", [])}
    os.makedirs(TRACES, exist_ok=True)
    for playbook in ("wt-w2-correct", "wt-w2-missing-stop", "wt-w2-duplicate"):
        if playbook in registered:
            continue
        done = heldout.run(["node", os.path.join(SCRIPTS, "journey.mjs"), "add-agent", "--home", home, "--project", entry["project"],
                            "--name", playbook, "--command", "python3",
                            "--arg", os.path.join(SCRIPTS, "agents", "scripted-agent.py"),
                            "--arg", os.path.join(SCRIPTS, "playbooks", playbook + ".json"), "--arg", TRACES], timeout=600)
        if done.returncode != 0:
            raise SystemExit(f"could not register {playbook}: {done.stderr[-300:]}")
    return {"ok": True, "home": home, "project": entry["project"], "dir": project_dir}


def unassigned_minutes(oracle):
    return sum(e["durationMinutes"] or 0 for e in oracle["time_entries"] if e["task"] is None)


def details(record, attempt_dir, info):
    """Everything reported for one attempt, read back from its evidence directory."""
    run = heldout.load(os.path.join(attempt_dir, "rigorrun-run.json"))
    case = run["caseResults"][0]
    before = heldout.load(os.path.join(attempt_dir, "before.json"))
    after = heldout.load(os.path.join(attempt_dir, "after.json"))
    contract = heldout.load(os.path.join(info["dir"], "contract.json"))
    schema = heldout.load(os.path.join(info["dir"], "schema.json"))
    focus = contract["focusEntity"]
    entity = next(e for e in schema["entities"] if e["name"] == focus)
    return {
        **record,
        "identity": {k: entity[k] for k in ("name", "idField", "keyFields", "identity") if k in entity},
        "expectedDelta": {
            "focusScope": contract["focusScope"],
            "expectedDeltaCount": contract.get("expectedDeltaCount"),
            "expectedDeletedCount": contract.get("expectedDeletedCount"),
            "expectedChanges": contract.get("expectedChanges", []),
        },
        "oracleState": {
            "timeEntries": [before["db_time_entry_count"], after["db_time_entry_count"]],
            "unassignedMinutes": [unassigned_minutes(before), unassigned_minutes(after)],
            "actualUnassignedDelta": unassigned_minutes(after) - unassigned_minutes(before),
        },
        "steps": [{"tool": s["tool"], "args": s["args"], "ok": s["ok"]} for s in case["steps"]],
        "checks": [{"id": a["assertionId"], "kind": a["kind"], "status": a["status"], "message": a["message"]} for a in case["assertions"]],
        "finalProjection": case["finalStateSummary"].get(focus),
        "outcome": case["outcome"],
        "outcomeReason": case["outcomeReason"],
        "baseline": case.get("baseline"),
    }


def rebuilt(info):
    """Every attempt on record, re-derived from its evidence: the oracle verdict is judged again from its reads."""
    root = evidence_root()
    records = []
    for attempt_name in sorted(os.listdir(root)) if os.path.isdir(root) else []:
        if not attempt_name.startswith("attempt-"):
            continue
        for case_id in sorted(os.listdir(os.path.join(root, attempt_name))):
            attempt_dir = os.path.join(root, attempt_name, case_id)
            if case_id not in CASES or not os.path.exists(os.path.join(attempt_dir, "rigorrun-run.json")):
                continue
            case = CASES[case_id]
            run = heldout.load(os.path.join(attempt_dir, "rigorrun-run.json"))["caseResults"][0]
            before = heldout.load(os.path.join(attempt_dir, "before.json"))
            after = heldout.load(os.path.join(attempt_dir, "after.json"))
            oracle = "PASS" if heldout.rc.judge({"expect": case["expect"]}, before, after, {}) == "PASS" else "FAIL"
            actual = run["outcome"]
            classification = None
            if actual in ("PASS", "FAIL"):
                classification = ("TRUE_POSITIVE" if actual == "FAIL" else "FALSE_NEGATIVE") if oracle == "FAIL" else ("FALSE_POSITIVE" if actual == "FAIL" else "TRUE_NEGATIVE")
            base = {"id": case_id, "attempt": int(attempt_name.split("-")[1]), "truth": case["truth"], "expected": case["expected"],
                    "actual": actual, "match": actual == case["expected"], "oracle": oracle,
                    "truthHeldByOracle": {"KNOWN_GOOD": oracle == "PASS", "KNOWN_BAD": oracle == "FAIL"}.get(case["truth"], True),
                    "classificationAgainstOracle": classification, "description": case["description"]}
            records.append(details(base, attempt_dir, info))
    return sorted(records, key=lambda r: (r["id"], r["attempt"]))


def measured_commit():
    path = os.path.join(evidence_root(), "measurement.json")
    if not os.path.exists(path):
        os.makedirs(evidence_root(), exist_ok=True)
        with open(path, "w") as fh:
            json.dump({"measurement": MEASUREMENT, "productSourcesOf": git("rev-parse", "HEAD")}, fh, indent=2)
    return heldout.load(path)["productSourcesOf"]


def write(info, attempts):
    with open(results_path(), "w") as fh:
        json.dump({
            "generatedBy": "remediation/n1/scripts/run-eh-wt-03.py",
            "measurement": MEASUREMENT,
            "rigorrunCommit": measured_commit(),
            "caseDefinitions": "remediation/heldout/external/cases.json (unchanged)",
            "project": {"home": "{REPO}/" + os.path.relpath(info["home"], REPO), "id": info["project"]},
            "attempts": attempts,
        }, fh, indent=2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--attempts", nargs="*", type=int, default=[1, 2, 3], help="EH-WT-03 attempt numbers to run")
    parser.add_argument("--also-sanity", action="store_true")
    parser.add_argument("--rebuild", action="store_true", help="only re-derive the results from the evidence on disk")
    parser.add_argument("--measurement", default="after-fix")
    parser.add_argument("--setup", default="", help="the setup-w2.py --into directory whose W2 project to use")
    a = parser.parse_args()
    global MEASUREMENT, SETUP
    MEASUREMENT, SETUP = a.measurement, a.setup
    info = project()
    if not a.rebuild:
        if subprocess.run(["git", "-C", REPO, "diff", "--quiet", "HEAD", "--", "packages", "apps", "fixtures"]).returncode != 0:
            raise SystemExit("refusing: product sources differ from HEAD; commit first so the measured commit is exact")
        plan = [("EH-WT-03", n) for n in a.attempts]
        if a.also_sanity:
            plan += [("EH-WT-01", 1), ("EH-WT-02", 1)]
        if os.path.exists(os.path.join(evidence_root(), "measurement.json")) and measured_commit() != git("rev-parse", "HEAD") and \
                subprocess.run(["git", "-C", REPO, "diff", "--quiet", measured_commit(), "HEAD", "--", "packages", "apps", "fixtures"]).returncode != 0:
            raise SystemExit(f"refusing: {MEASUREMENT} measured other product sources; use a new --measurement")
        measured_commit()
        for case_id, attempt in plan:
            heldout.EVIDENCE = os.path.join(evidence_root(), f"attempt-{attempt}")
            heldout.FAULT_LOG = os.path.join(N1, "evidence", "fault-proxy.unused.jsonl")
            heldout.run_case(CASES[case_id], info)
            done = next(r for r in rebuilt(info) if r["id"] == case_id and r["attempt"] == attempt)
            print(f"{case_id} attempt {attempt}: expected {done['expected']} actual {done['actual']} oracle {done['oracle']} "
                  f"unassigned {done['oracleState']['unassignedMinutes']} :: {done['outcomeReason'][:200]}", flush=True)
            write(info, rebuilt(info))
    write(info, rebuilt(info))
    return 0


if __name__ == "__main__":
    sys.exit(main())

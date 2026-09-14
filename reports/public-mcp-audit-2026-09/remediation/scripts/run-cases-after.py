#!/usr/bin/env python3
"""Re-runs the frozen audit cases against remediated RigorRun.

Everything that defines a case — its intent, `expect` predicate, truth label,
oracle, reset, agent and attempt count — comes from the frozen case files and
baseline-manifest.json, unmodified. Only two things differ from the original
run, and both are unavoidable:

1. RigorRun-mode cases run against projects re-created by the remediated
   product (the defects were in compile and generation, so the old suites
   cannot measure the fix). The case file's `home`/`project` are mapped to the
   new ones through after/projects.json; the case file itself is not edited.
2. Evidence is written under remediation/after/evidence/, never over the
   original evidence tree.

Each RigorRun attempt is classified twice:
- `classification` uses the ORIGINAL rule (taskSuccess ∧ policyCompliant ∧ no
  unsafe actions), so before and after are scored identically;
- `outcomeClassification` uses the case outcome RigorRun now reports: ABSTAIN
  and HARNESS_FAILURE are not verdicts, and TIMED_OUT / AGENT_FAILURE are
  reported separately and never counted as a detection.

Usage: run-cases-after.py [--only ID ...] [--targets email-mcp,sqlite-mcp,worktide-mcp]
"""
import argparse
import importlib.util
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REMEDIATION = os.path.abspath(os.path.join(HERE, ".."))
REPORT = os.path.abspath(os.path.join(REMEDIATION, ".."))
ORIGINAL = os.path.join(REPORT, "scripts", "run-cases.py")
AFTER = os.path.join(REMEDIATION, "after")

spec = importlib.util.spec_from_file_location("original_run_cases", ORIGINAL)
rc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rc)


def load(path):
    with open(path) as fh:
        return json.load(fh)


def mapped(case, projects):
    """The case as it runs now: same everything, pointed at the re-created project."""
    if case["mode"] != "rigorrun":
        return case
    key = os.path.basename(case["home"])
    if key not in projects:
        raise SystemExit(f"{case['id']}: no re-created project for {key} in after/projects.json")
    entry = projects[key]
    return {**case, "home": entry["home"], "project": entry["project"]}


def act_rigorrun(case, attempt_dir):
    env = dict(os.environ, **rc.expand(case.get("env", {}), case))
    home = rc.expand(case["home"], case)
    runs_dir = os.path.join(home, "projects", case["project"], "runs")
    before = set(os.listdir(runs_dir)) if os.path.isdir(runs_dir) else set()
    args = [rc.TSX, rc.BIN, "run", "--project", case["project"], "--agent", case["agent"], "--home", home, "--json"]
    env["NO_COLOR"] = "1"
    env["RIGORRUN_SECRET_BACKEND"] = "file"
    out = rc.sh(args, env=env, timeout=3600)
    with open(os.path.join(attempt_dir, "rigorrun-run.stdout.txt"), "w") as fh:
        fh.write(out.stdout + "\n--- stderr ---\n" + out.stderr)
    fresh = sorted(set(os.listdir(runs_dir)) - before) if os.path.isdir(runs_dir) else []
    if not fresh:
        return {"rigorrun": {"exit": out.returncode, "error": out.stderr[-2000:], "cases": []}}, None
    run = load(os.path.join(runs_dir, fresh[-1]))
    with open(os.path.join(attempt_dir, "rigorrun-run.json"), "w") as fh:
        json.dump(run, fh, indent=2)
    verdict = {
        "runId": run["runId"], "exit": out.returncode, "verification": run.get("verification"),
        "isolation": run.get("isolation"), "verdict": run.get("verdict"),
        "cases": [{
            "caseId": r["caseId"], "category": r.get("category"),
            "taskSuccess": r.get("taskSuccess"), "policyCompliant": r.get("policyCompliant"),
            "unsafeActions": r.get("unsafeActions"), "errored": r.get("errored"),
            "outcome": r.get("outcome"), "outcomeReason": r.get("outcomeReason"),
            "missingEvidence": r.get("missingEvidence", []), "verification": r.get("verification"),
            "evidenceIndependence": r.get("evidenceIndependence"), "baseline": r.get("baseline"),
            "budgetMs": r.get("budgetMs"), "durationMs": r.get("durationMs"),
            "assertions": [{"id": a.get("assertionId"), "status": a.get("status"), "message": a.get("message")} for a in r.get("assertions", [])],
            "steps": [{"tool": s.get("tool"), "ok": s.get("ok")} for s in r.get("steps", [])],
            "agentReport": r.get("agentReport"),
        } for r in run["caseResults"] if not case.get("caseFilter") or case["caseFilter"] in r["caseId"]],
    }
    return {"rigorrun": verdict}, verdict


def happy(verdict):
    """The case the audit scored: the job as demonstrated."""
    cases = verdict["cases"] if verdict else []
    chosen = [c for c in cases if c.get("category") == "happy_path"] or cases
    return chosen


def outcome_label(verdict):
    cases = happy(verdict)
    if not cases:
        return "NOT_RUN"
    outcomes = [c.get("outcome") or "UNKNOWN" for c in cases]
    for label in ("FAIL", "AGENT_FAILURE", "TIMED_OUT", "HARNESS_FAILURE", "ABSTAIN"):
        if label in outcomes:
            return label
    return "PASS" if all(o == "PASS" for o in outcomes) else "UNKNOWN"


def original_label(verdict):
    """The audit's original scoring rule, applied to the same cases it scored."""
    cases = happy(verdict)
    if not cases:
        return "NOT_RUN"
    passed = all(c["taskSuccess"] and c["policyCompliant"] and (c["unsafeActions"] or 0) == 0 for c in cases)
    return "PASS" if passed else "FAIL"


def classify_outcome(ground, label):
    if label in ("NOT_RUN", "ABSTAIN", "HARNESS_FAILURE", "UNKNOWN"):
        return f"NOT_SCORED_{label}"
    if label in ("TIMED_OUT", "AGENT_FAILURE"):
        return label
    if ground == "FAIL":
        return "TRUE_POSITIVE" if label == "FAIL" else "FALSE_NEGATIVE"
    return "FALSE_POSITIVE" if label == "FAIL" else "TRUE_NEGATIVE"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*")
    parser.add_argument("--targets", default="email-mcp,worktide-mcp,sqlite-mcp")
    a = parser.parse_args()
    manifest = load(os.path.join(REMEDIATION, "baseline-manifest.json"))
    projects = load(os.path.join(AFTER, "projects.json")) if os.path.exists(os.path.join(AFTER, "projects.json")) else {}
    targets = a.targets.split(",")
    for entry in manifest["cases"]:
        if entry["target"] not in targets or (a.only and entry["id"] not in a.only):
            continue
        frozen = load(os.path.join(REPORT, entry["caseFile"]))
        case = mapped(frozen, projects)
        attempts = []
        for n in range(1, entry["attempts"] + 1):
            attempt_dir = os.path.join(AFTER, "evidence", case["target"], case["id"], f"attempt-{n}")
            os.makedirs(attempt_dir, exist_ok=True)
            if not case.get("no_reset"):
                rc.reset(case)
            before = rc.oracle(case)
            with open(os.path.join(attempt_dir, "before.json"), "w") as fh:
                json.dump(before, fh, indent=2, sort_keys=True)
            started = time.time()
            if case["mode"] == "rigorrun":
                result, verdict = act_rigorrun(case, attempt_dir)
            else:
                result, verdict = rc.act(case, attempt_dir)
            elapsed = round(time.time() - started, 2)
            after = rc.oracle(case)
            with open(os.path.join(attempt_dir, "after.json"), "w") as fh:
                json.dump(after, fh, indent=2, sort_keys=True)
            ground = "PASS" if rc.judge(case, before, after, result) == "PASS" else "FAIL"
            record = {"attempt": n, "seconds": elapsed, "oracleVerdict": ground, "expectedStateHeld": ground == "PASS"}
            if case["mode"] == "rigorrun":
                orig = original_label(verdict)
                out_label = outcome_label(verdict)
                record.update({
                    "rigorrunVerdict": orig,
                    "classification": rc.classify("EXPECTED_FAIL" if ground == "FAIL" else "EXPECTED_PASS", orig) if orig != "NOT_RUN" else "NOT_SCORED",
                    "rigorrunOutcome": out_label,
                    "outcomeClassification": classify_outcome(ground, out_label),
                })
            else:
                record.update({"rigorrunVerdict": "NOT_RUN", "classification": "NOT_SCORED", "rigorrunOutcome": "NOT_RUN", "outcomeClassification": "NOT_SCORED"})
            with open(os.path.join(attempt_dir, "attempt.json"), "w") as fh:
                json.dump({"case": case, "result": result, **record}, fh, indent=2, default=str)
            attempts.append(record)
            print(f"{case['id']} attempt {n}: oracle={ground} rigorrun={record['rigorrunVerdict']} outcome={record['rigorrunOutcome']} class={record['classification']} / {record['outcomeClassification']} ({elapsed}s)", flush=True)
        summary = {"id": case["id"], "target": case["target"], "truth": case["truth"], "mode": case["mode"], "attempts": attempts,
                   "reproduction": f"{sum(1 for x in attempts if x['oracleVerdict'] == ('FAIL' if case['truth'] == 'EXPECTED_FAIL' else 'PASS'))}/{len(attempts)}"}
        with open(os.path.join(AFTER, "evidence", case["target"], case["id"], "summary.json"), "w") as fh:
            json.dump(summary, fh, indent=2)


if __name__ == "__main__":
    sys.exit(main())

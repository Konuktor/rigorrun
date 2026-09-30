#!/usr/bin/env python3
"""benchmark-v2: every frozen case, with every generated case scored on its own oracle reading.

Pre-registered in requalification/v2/PREREGISTRATION.md and frozen in
requalification/v2/freeze.json before any run. Differences from the frozen
protocol (benchmark-v1), each declared there with its rationale:

1. A case whose labels give `caseTimeoutMs` (the local-model cases) runs with
   `--case-timeout` set to it; every other case keeps its suite's own budget.
2. RigorRun-mode suites are scored in full: every generated case, never only
   happy_path, and no suite shape is refused.
3. The oracle reads the system after each generated case (`--after-case`), so
   each generated case is judged on its own window: from the previous reading
   (the reading before the run, for the first) to its own.
4. The truth label and `expect` predicate of every generated case come from
   requalification/v2/labels.json. A predicate sees `before` and `after` (the
   window's two readings), and `new` and `removed`: the messages added and taken
   away, counted as multisets, so an identical second message is not missed.

Everything else is the audit's committed code, imported unmodified: resets,
oracles, direct probes and the frozen `expect` of cases RigorRun does not run
(scripts/run-cases.py), and both classifications and the project mapping
(remediation/scripts/run-cases-after.py). Evidence goes under
requalification/v2/evidence/run.

    run-v2.py [--only CASE_ID ...]
"""
import argparse
import collections
import glob
import importlib.util
import json
import os
import shlex
import subprocess
import sys
import time

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
V2 = os.path.abspath(os.path.join(HERE, ".."))
RQ = os.path.abspath(os.path.join(V2, ".."))
REPORT = os.path.abspath(os.path.join(RQ, ".."))
sys.path.insert(0, os.path.join(RQ, "scripts"))
import rq_paths  # noqa: E402

REPO = rq_paths.REPO
RUN = rq_paths.V2_RUN
LABELS = os.path.join(V2, "labels.json")
FREEZE = os.path.join(V2, "freeze.json")


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


rc = module(os.path.join(REPORT, "scripts", "run-cases.py"), "v2_audit_run_cases")
after = rq_paths.run_cases_module(run_dir=RUN)


def load(path):
    with open(path) as fh:
        return json.load(fh)


def dump(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(value, fh, indent=2, default=str)
        fh.write("\n")


def verify():
    if not os.path.exists(FREEZE):
        raise SystemExit("REFUSING: requalification/v2/freeze.json is missing; benchmark-v2 runs only after its pre-registration is frozen")
    done = subprocess.run(["node", os.path.join(RQ, "scripts", "product-under-test.mjs"), "--check"], capture_output=True, text=True, cwd=REPO)
    if done.returncode != 0:
        raise SystemExit(f"REFUSING: {done.stderr.strip() or done.stdout.strip()}")
    recorded = load(os.path.join(RQ, "product-under-test.json"))
    if not recorded["frozenInputs"]["laterFreezes"]["benchmarkV2"].get("present"):
        raise SystemExit("REFUSING: the product under test was recorded before benchmark-v2 was frozen; record it again")
    return recorded["productCommit"]


def multiset_delta(before, now):
    key = lambda message: json.dumps(message, sort_keys=True)
    was = collections.Counter(key(m) for m in before.get("messages", []))
    is_ = collections.Counter(key(m) for m in now.get("messages", []))
    return [json.loads(k) for k in sorted((is_ - was).elements())], [json.loads(k) for k in sorted((was - is_).elements())]


def judge(expression, before, now):
    new, removed = multiset_delta(before, now) if "messages" in before or "messages" in now else ([], [])
    scope = {"before": before, "after": now, "new": new, "removed": removed}
    builtins = {"len": len, "any": any, "all": all, "sum": sum, "sorted": sorted, "str": str, "int": int, "float": float,
                "abs": abs, "range": range, "min": min, "max": max, "set": set, "list": list}
    return "PASS" if bool(eval(expression, {"__builtins__": builtins, **scope})) else "FAIL"


def hook_program(attempt_dir):
    """The executable --after-case runs: no arguments, so the attempt directory is written into it."""
    path = os.path.join(attempt_dir, "after-case")
    with open(path, "w") as fh:
        fh.write("#!/bin/sh\nexec python3 " + shlex.quote(os.path.join(HERE, "oracle-reading.py")) + " " + shlex.quote(attempt_dir) + "\n")
    os.chmod(path, 0o755)
    return path


def summarise(result):
    """One generated case, in the shape run-cases-after.py's classifications read."""
    return {
        "caseId": result["caseId"], "category": result.get("category"),
        "taskSuccess": result.get("taskSuccess"), "policyCompliant": result.get("policyCompliant"),
        "unsafeActions": result.get("unsafeActions"), "errored": result.get("errored"),
        "outcome": result.get("outcome"), "outcomeReason": result.get("outcomeReason"),
        "missingEvidence": result.get("missingEvidence", []), "verification": result.get("verification"),
        "evidenceIndependence": result.get("evidenceIndependence"), "baseline": result.get("baseline"),
        "budgetMs": result.get("budgetMs"), "durationMs": result.get("durationMs"),
        "readStability": result.get("readStability"),
        "assertions": [{"id": a.get("assertionId"), "status": a.get("status"), "message": a.get("message")} for a in result.get("assertions", [])],
        "steps": [{"tool": s.get("tool"), "ok": s.get("ok")} for s in result.get("steps", [])],
        "agentReport": result.get("agentReport"),
    }


def run_rigorrun(case, attempt_dir, budget_ms):
    env = dict(os.environ, **rc.expand(case.get("env", {}), case))
    env["NO_COLOR"] = "1"
    env["RIGORRUN_SECRET_BACKEND"] = "file"
    home = rc.expand(case["home"], case)
    runs_dir = os.path.join(home, "projects", case["project"], "runs")
    existing = set(os.listdir(runs_dir)) if os.path.isdir(runs_dir) else set()
    dump(os.path.join(attempt_dir, "case.json"), case)
    args = [rc.TSX, rc.BIN, "run", "--project", case["project"], "--agent", case["agent"], "--home", home, "--json",
            "--after-case", hook_program(attempt_dir)]
    if budget_ms is not None:
        args += ["--case-timeout", str(budget_ms)]
    out = rc.sh(args, env=env, timeout=3600)
    with open(os.path.join(attempt_dir, "rigorrun-run.stdout.txt"), "w") as fh:
        fh.write(out.stdout + "\n--- stderr ---\n" + out.stderr)
    fresh = sorted(set(os.listdir(runs_dir)) - existing) if os.path.isdir(runs_dir) else []
    run = load(os.path.join(runs_dir, fresh[-1])) if fresh else None
    if run:
        dump(os.path.join(attempt_dir, "rigorrun-run.json"), run)
    return {"exit": out.returncode, "args": args[2:], "runFileWritten": bool(run)}, run


def score_generated(case, labels, start, attempt_dir, run):
    """Each generated case on its own window of readings, in the order the run executed them."""
    readings = {}
    for path in glob.glob(os.path.join(attempt_dir, "readings", "after-case-*.json")):
        entry = load(path)
        readings[entry["caseIndex"]] = entry
    generated = labels["generatedCases"]
    records = []
    previous, broken = start, None
    for index, result in enumerate((run or {}).get("caseResults", [])):
        label = generated.get(result["caseId"])
        summary = summarise(result)
        record = {"index": index, "caseId": result["caseId"], "category": result.get("category"), "rigorrun": summary}
        reading = readings.get(index)
        if broken is None and (reading is None or reading["caseId"] != result["caseId"]):
            broken = f"no after-case reading for index {index} ({result['caseId']})"
        if label is None:
            record.update({"scored": False, "reason": "this generated case has no pre-registered label"})
        elif broken is not None:
            record.update({"scored": False, "reason": broken, "truth": label["truth"], "injected": label.get("injected", False)})
        else:
            ground = judge(label["expect"], previous, reading["reading"])
            verdict = {"cases": [summary]}
            original = after.original_label(verdict)
            outcome = after.outcome_label(verdict)
            record.update({
                "scored": True, "truth": label["truth"], "injected": label.get("injected", False),
                "window": {"from": "start" if index == 0 else f"after-case-{index - 1:02d}", "to": f"after-case-{index:02d}"},
                "oracleVerdict": ground,
                "reproduced": ground == ("FAIL" if label["truth"] == "EXPECTED_FAIL" else "PASS"),
                "rigorrunVerdict": original,
                "classification": rc.classify("EXPECTED_FAIL" if ground == "FAIL" else "EXPECTED_PASS", original) if original != "NOT_RUN" else "NOT_SCORED",
                "rigorrunOutcome": outcome,
                "outcomeClassification": after.classify_outcome(ground, outcome),
            })
        if reading is not None and reading["caseId"] == result["caseId"]:
            previous = reading["reading"]
        records.append(record)
    unlabelledExpected = sorted(set(generated) - {r["caseId"] for r in records})
    return records, unlabelledExpected


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*")
    a = parser.parse_args()
    product = verify()
    manifest = load(os.path.join(REPORT, "remediation", "baseline-manifest.json"))
    projects = load(os.path.join(RUN, "projects.json"))
    labels = load(LABELS)
    for entry in manifest["cases"]:
        if a.only and entry["id"] not in a.only:
            continue
        frozen = load(os.path.join(REPORT, entry["caseFile"]))
        case_labels = labels["cases"].get(entry["id"]) if frozen["mode"] == "rigorrun" else None
        if frozen["mode"] == "rigorrun" and case_labels is None:
            raise SystemExit(f"REFUSING: {entry['id']} runs RigorRun and has no labels in labels.json")
        case = after.mapped(frozen, projects)
        attempts = []
        for n in range(1, entry["attempts"] + 1):
            attempt_dir = os.path.join(RUN, "evidence", case["target"], case["id"], f"attempt-{n}")
            if os.path.exists(attempt_dir):
                raise SystemExit(f"REFUSING: {attempt_dir} exists; evidence is never overwritten")
            os.makedirs(attempt_dir)
            if not case.get("no_reset"):
                rc.reset(case)
            start = rc.oracle(case)
            dump(os.path.join(attempt_dir, "before.json"), start)
            started = time.time()
            record = {"attempt": n, "productCommit": product}
            if case["mode"] == "rigorrun":
                budget = case_labels.get("caseTimeoutMs")
                run_meta, run = run_rigorrun(case, attempt_dir, budget)
                seconds = round(time.time() - started, 2)
                end = rc.oracle(case)
                dump(os.path.join(attempt_dir, "after.json"), end)
                generated, missing = score_generated(case, case_labels, start, attempt_dir, run)
                last = max((r for r in generated if r.get("scored")), key=lambda r: r["index"], default=None)
                record.update({
                    "seconds": seconds, "caseTimeoutMs": budget, "run": run_meta, "generated": generated,
                    "labelledButNotRun": missing,
                    "endReadingEqualsLastAfterCaseReading": bool(run) and os.path.exists(os.path.join(attempt_dir, "readings", f"after-case-{len(run['caseResults']) - 1:02d}.json"))
                    and load(os.path.join(attempt_dir, "readings", f"after-case-{len(run['caseResults']) - 1:02d}.json"))["reading"] == end,
                })
                summary_line = " ".join(f"{g['caseId'].replace('case_live__', '')}:{g.get('oracleVerdict', '-')}/{g['rigorrun'].get('outcome')}/{g.get('outcomeClassification', g.get('reason', ''))[:24]}" for g in generated)
                print(f"{case['id']} attempt {n}: exit={run_meta['exit']} {summary_line} ({seconds}s)", flush=True)
            else:
                result, _ = rc.act(case, attempt_dir)
                seconds = round(time.time() - started, 2)
                end = rc.oracle(case)
                dump(os.path.join(attempt_dir, "after.json"), end)
                ground = "PASS" if rc.judge(case, start, end, result) == "PASS" else "FAIL"
                record.update({"seconds": seconds, "result": result, "oracleVerdict": ground, "scored": False})
                print(f"{case['id']} attempt {n}: direct probe oracle={ground} ({seconds}s)", flush=True)
            dump(os.path.join(attempt_dir, "attempt.json"), {"case": case, **record})
            attempts.append(record)
        dump(os.path.join(RUN, "evidence", case["target"], case["id"], "summary.json"),
             {"id": case["id"], "target": case["target"], "mode": case["mode"], "truth": case["truth"], "attempts": attempts})


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Independent-oracle qualification: the agent acts through one MCP server, RigorRun verifies through another.

    run-io.py freeze                 # hash every file that defines a case into freeze.json (refuses if it exists)
    run-io.py setup [--only NAME]    # create the projects with `rigorrun setup` from the spec templates
    run-io.py run [--only CASE ...]  # run the cases, 3 attempts each
    run-io.py aggregate              # evidence/independent-oracle/results.json

Every attempt: reset the task database → stage the case's faults or oracle flags →
read the database with the frozen scripts/oracle-sqlite.py → `rigorrun run` with the
case's agent → read the database again → judge `expect` → compare RigorRun's outcome
and evidence label with the expectation written in cases.json before any run.

The runner also checks that verification really went through the verifier: every
server call is appended to a calls log by the fixture servers themselves, and a
PASS on the independent project needs at least two answered verifier reads inside
its own attempt, and an INDEPENDENT label.

Everything the servers touch lives in tmp/rigorrun-audit/io-state (git-ignored);
homes in tmp/rigorrun-audit/io-homes. Evidence goes to
final-qualification/evidence/independent-oracle/.
"""
import argparse
import glob
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
FQ = os.path.abspath(os.path.join(HERE, "..", ".."))
REPORT = os.path.abspath(os.path.join(FQ, ".."))
REPO = os.path.abspath(os.path.join(REPORT, "..", ".."))
AUDIT_SCRIPTS = os.path.join(REPORT, "scripts")
STATE = os.path.join(REPO, "tmp", "rigorrun-audit", "io-state")
HOMES = os.path.join(REPO, "tmp", "rigorrun-audit", "io-homes")
EVIDENCE = os.path.join(FQ, "evidence", "independent-oracle")
TSX = os.path.join(REPO, "node_modules", ".bin", "tsx")
BIN = os.path.join(REPO, "packages", "cli", "src", "bin.ts")
ORACLE = os.path.join(AUDIT_SCRIPTS, "oracle-sqlite.py")
FREEZE = os.path.join(HERE, "freeze.json")
DEFINING = ["cases.json", "taskdesk_server.py", "taskdesk_oracle_server.py", "reset-taskdesk.sh", "run-io.py"]


def load(path):
    with open(path) as fh:
        return json.load(fh)


def dump(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(value, fh, indent=2, sort_keys=False, default=str)
        fh.write("\n")


def sha256(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def defining_files():
    files = list(DEFINING)
    files += sorted(os.path.relpath(p, HERE) for p in glob.glob(os.path.join(HERE, "playbooks", "*.json")))
    files += sorted(os.path.relpath(p, HERE) for p in glob.glob(os.path.join(HERE, "specs", "*.template.json")))
    return files


def verify_freeze():
    if not os.path.exists(FREEZE):
        raise SystemExit("freeze.json is missing: run `run-io.py freeze` before any case runs")
    frozen = load(FREEZE)["files"]
    now = {f: sha256(os.path.join(HERE, f)) for f in defining_files()}
    if now != frozen:
        changed = sorted(set(now) ^ set(frozen) | {f for f in now if f in frozen and now[f] != frozen[f]})
        raise SystemExit(f"REFUSING: case-defining files differ from freeze.json: {changed}")


def verify_product():
    done = subprocess.run(["node", os.path.join(FQ, "scripts", "product-under-test.mjs"), "--check"], capture_output=True, text=True, cwd=REPO)
    if done.returncode != 0:
        raise SystemExit(f"REFUSING: {done.stderr.strip() or done.stdout.strip()}")
    return load(os.path.join(FQ, "product-under-test.json"))["productCommit"]


def sh(cmd, env=None, timeout=900, cwd=REPO):
    return subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=timeout, cwd=cwd)


def reset():
    done = sh(["bash", os.path.join(HERE, "reset-taskdesk.sh")])
    if done.returncode != 0:
        raise RuntimeError("reset failed: " + done.stderr[-800:])


def oracle():
    done = sh(["python3", ORACLE, "--db", os.path.join(STATE, "tasks.db")])
    if done.returncode != 0:
        raise RuntimeError("oracle failed: " + done.stderr[-800:])
    return json.loads(done.stdout)


def judge(expression, before, after):
    scope = {"before": before, "after": after}
    allowed = {"len": len, "any": any, "all": all, "sorted": sorted, "set": set, "list": list}
    return "PASS" if bool(eval(expression, {"__builtins__": allowed, **scope})) else "FAIL"


def calls_log():
    return os.path.join(STATE, "calls.log")


def calls_count():
    path = calls_log()
    if not os.path.exists(path):
        return 0
    with open(path) as fh:
        return sum(1 for _ in fh)


def calls_since(offset):
    path = calls_log()
    if not os.path.exists(path):
        return []
    with open(path) as fh:
        lines = fh.readlines()[offset:]
    return [json.loads(line) for line in lines if line.strip()]


def cli_env():
    return dict(os.environ, NO_COLOR="1", RIGORRUN_SECRET_BACKEND="file")


def render(template_path, project):
    traces = os.path.join(STATE, "traces", project)
    os.makedirs(traces, exist_ok=True)
    text = open(template_path).read()
    for key, value in {
        "{PYTHON}": sys.executable, "{IO}": HERE, "{STATE}": STATE, "{AGENTS}": os.path.join(AUDIT_SCRIPTS, "agents"),
        "{PLAYBOOKS}": os.path.join(HERE, "playbooks"), "{TRACES}": traces,
    }.items():
        text = text.replace(key, value)
    return json.loads(text)


def cmd_freeze(_):
    if os.path.exists(FREEZE):
        raise SystemExit("freeze.json exists; the cases are already frozen")
    if os.path.isdir(os.path.join(EVIDENCE, "cases")):
        raise SystemExit("evidence of a case run exists; freezing now would not be a freeze before running")
    head = sh(["git", "-C", REPO, "rev-parse", "HEAD"]).stdout.strip()
    dump(FREEZE, {
        "note": "Every file that defines an independent-oracle case, hashed before any case ran. run-io.py refuses to run when one differs.",
        "frozenAtHead": head,
        "files": {f: sha256(os.path.join(HERE, f)) for f in defining_files()},
    })
    print(f"frozen {len(defining_files())} files")


def cmd_setup(args):
    verify_freeze()
    product = verify_product()
    cases = load(os.path.join(HERE, "cases.json"))
    projects_path = os.path.join(EVIDENCE, "projects.json")
    projects = load(projects_path) if os.path.exists(projects_path) else {}
    for name, entry in cases["projects"].items():
        if args.only and name not in args.only:
            continue
        reset()
        home = os.path.join(HOMES, name)
        if os.path.exists(home):
            assert os.path.realpath(home).startswith(os.path.realpath(HOMES) + os.sep)
            shutil.rmtree(home)
        os.makedirs(home)
        spec = render(os.path.join(HERE, entry["spec"]), name)
        spec_path = os.path.join(home, "spec.json")
        dump(spec_path, spec)
        before_calls = calls_count()
        done = sh([TSX, BIN, "setup", spec_path, "--home", home, "--json"], env=cli_env(), timeout=900)
        out_dir = os.path.join(EVIDENCE, "setup", name)
        os.makedirs(out_dir, exist_ok=True)
        with open(os.path.join(out_dir, "setup.stdout.txt"), "w") as fh:
            fh.write(done.stdout + "\n--- stderr ---\n" + done.stderr[-6000:])
        record = {"project": name, "exit": done.returncode, "productCommit": product, "callsDuringSetup": calls_since(before_calls)}
        try:
            summary = json.loads(done.stdout[done.stdout.index("{"):])
        except ValueError:
            summary = None
        record["summary"] = summary
        if summary and summary.get("projectId"):
            project_dir = os.path.join(home, "projects", summary["projectId"])
            for file in sorted(os.listdir(project_dir)):
                path = os.path.join(project_dir, file)
                if os.path.isfile(path) and file.endswith(".json") and "secret" not in file:
                    shutil.copy(path, os.path.join(out_dir, file))
            benchmark = load(os.path.join(project_dir, "benchmark.json"))
            record["suiteShape"] = [c["category"] for c in benchmark["cases"]]
            record["budgetsMs"] = sorted({c.get("timeoutMs") for c in benchmark["cases"]})
            record["ok"] = done.returncode == 0 and record["suiteShape"] == ["happy_path"]
            projects[name] = {"home": "{REPO}/" + os.path.relpath(home, REPO), "project": summary["projectId"]}
        else:
            record["ok"] = False
        dump(os.path.join(out_dir, "setup.json"), record)
        dump(projects_path, projects)
        print(f"{name}: exit={done.returncode} ok={record['ok']} project={summary and summary.get('projectId')} shape={record.get('suiteShape')} records={summary and summary.get('records')} agents={summary and [(a['name'], a['ok']) for a in summary.get('agents', [])]}", flush=True)


def happy(run):
    results = run.get("caseResults", [])
    chosen = [r for r in results if r.get("category") == "happy_path"]
    return (chosen or results)[:1]


def tool_reported(trace):
    """What the connector itself said: every tool result the agent received."""
    if not trace:
        return None
    return [{"tool": c.get("tool"), "args": c.get("args"), "result": c.get("result")} for c in trace.get("calls", []) if "tool" in c]


def matches(expected, outcome, independence, missing, run_file_written, exit_code, any_pass):
    if expected.get("outcome") == "NO_VERDICT":
        return exit_code != 0 and not any_pass
    ok = True
    if "outcome" in expected:
        ok = ok and outcome == expected["outcome"]
    if "notOutcome" in expected:
        ok = ok and run_file_written and outcome is not None and outcome != expected["notOutcome"]
    if "evidenceIndependence" in expected and run_file_written:
        ok = ok and independence == expected["evidenceIndependence"]
    if "missingEvidenceContains" in expected:
        ok = ok and any(expected["missingEvidenceContains"] in m for m in (missing or []))
    return ok if ("outcome" in expected or "notOutcome" in expected) else None


def cmd_run(args):
    verify_freeze()
    product = verify_product()
    cases = load(os.path.join(HERE, "cases.json"))
    projects = load(os.path.join(EVIDENCE, "projects.json"))
    for case in cases["cases"]:
        if args.only and case["id"] not in args.only:
            continue
        entry = projects[case["project"]]
        home = entry["home"].replace("{REPO}", REPO)
        runs_dir = os.path.join(home, "projects", entry["project"], "runs")
        for n in range(1, cases["attempts"] + 1):
            attempt_dir = os.path.join(EVIDENCE, "cases", case["id"], f"attempt-{n}")
            if os.path.exists(attempt_dir):
                shutil.rmtree(attempt_dir)
            os.makedirs(attempt_dir)
            reset()
            staging = case["staging"]
            if staging["faults"]:
                dump(os.path.join(STATE, "faults.json"), {"modes": staging["faults"]})
            if staging["oracle"] == "down before the run starts":
                open(os.path.join(STATE, "oracle-down.flag"), "w").close()
            if staging["oracle"] == "answers no tasks":
                open(os.path.join(STATE, "oracle-empty.flag"), "w").close()
            for stale in glob.glob(os.path.join(STATE, "traces", case["project"], "*.json")):
                os.remove(stale)
            offset = calls_count()
            before = oracle()
            existing = set(os.listdir(runs_dir)) if os.path.isdir(runs_dir) else set()
            started = time.time()
            done = sh([TSX, BIN, "run", "--project", entry["project"], "--agent", case["agent"], "--home", home, "--json"], env=cli_env(), timeout=900)
            seconds = round(time.time() - started, 2)
            after = oracle()
            calls = calls_since(offset)
            with open(os.path.join(attempt_dir, "rigorrun-run.stdout.txt"), "w") as fh:
                fh.write(done.stdout + "\n--- stderr ---\n" + done.stderr[-6000:])
            fresh = sorted(set(os.listdir(runs_dir)) - existing) if os.path.isdir(runs_dir) else []
            run = load(os.path.join(runs_dir, fresh[-1])) if fresh else None
            if run:
                dump(os.path.join(attempt_dir, "rigorrun-run.json"), run)
            result = happy(run)[0] if run and happy(run) else None
            traces = glob.glob(os.path.join(STATE, "traces", case["project"], "*.json"))
            trace = load(traces[0]) if traces else None
            if trace:
                dump(os.path.join(attempt_dir, "agent-trace.json"), trace)
            outcome = result.get("outcome") if result else None
            independence = result.get("evidenceIndependence") if result else None
            missing = result.get("missingEvidence", []) if result else []
            any_pass = bool(run) and any(r.get("outcome") == "PASS" for r in run.get("caseResults", []))
            verifier_calls = [c for c in calls if c.get("server") == "taskdesk-oracle"]
            connector_calls = [c for c in calls if c.get("server") == "taskdesk"]
            truth = judge(cases["expect"], before, after)
            expected = case["expected"]
            record = {
                "case": case["id"], "attempt": n, "productCommit": product, "seconds": seconds,
                "initialState": before,
                "task": (trace or {}).get("task") or cases["task"],
                "staging": staging,
                "agentTrace": {"playbook": (trace or {}).get("playbook"), "report": (trace or {}).get("report"), "calls": tool_reported(trace)},
                "proxyObservedSteps": [{"tool": s.get("tool"), "ok": s.get("ok")} for s in (result or {}).get("steps", [])],
                "toolReportedState": tool_reported(trace),
                "independentState": after,
                "expectedFinalState": cases["expectedFinalState"],
                "oracleVerdict": truth,
                "rigorrun": {
                    "exit": done.returncode, "runFileWritten": bool(run), "runVerdict": (run or {}).get("verdict"),
                    "outcome": outcome, "outcomeReason": (result or {}).get("outcomeReason"),
                    "evidenceIndependence": independence, "verification": (result or {}).get("verification"),
                    "baseline": (result or {}).get("baseline"), "missingEvidence": missing,
                    "taskSuccess": (result or {}).get("taskSuccess"), "policyCompliant": (result or {}).get("policyCompliant"),
                    "assertions": [{"id": a.get("assertionId"), "status": a.get("status"), "message": a.get("message")} for a in (result or {}).get("assertions", [])],
                    "errorTail": done.stderr.strip().splitlines()[-3:] if done.returncode != 0 else [],
                },
                "serverCalls": {"verifier": verifier_calls, "connector": [{"tool": c.get("tool")} for c in connector_calls]},
                "expected": expected,
            }
            record["matchesExpectation"] = matches(expected, outcome, independence, missing, bool(run), done.returncode, any_pass)
            guard = []
            if case["project"] == "independent" and run:
                if independence != "INDEPENDENT":
                    guard.append(f"label {independence} on the independent project")
                if outcome == "PASS" and len([c for c in verifier_calls if c.get("answered")]) < 2:
                    guard.append("PASS without at least two answered verifier reads in this attempt")
            if any(str(s.get("tool", "")).startswith("verifier:") for s in (result or {}).get("steps", [])):
                guard.append("the agent reached a verifier tool")
            record["silentFallbackGuard"] = {"violations": guard, "holds": not guard}
            dump(os.path.join(attempt_dir, "attempt.json"), record)
            print(f"{case['id']} attempt {n}: oracle={truth} rigorrun={outcome} label={independence} exit={done.returncode} verifierReads={len([c for c in verifier_calls if c.get('answered')])} matches={record['matchesExpectation']} guard={'ok' if not guard else guard} ({seconds}s)", flush=True)


def cmd_aggregate(_):
    cases = load(os.path.join(HERE, "cases.json"))
    rows = []
    for case in cases["cases"]:
        attempts = []
        for path in sorted(glob.glob(os.path.join(EVIDENCE, "cases", case["id"], "attempt-*", "attempt.json")), key=lambda p: int(p.split("attempt-")[-1].split("/")[0])):
            a = load(path)
            attempts.append({
                "attempt": a["attempt"], "oracleVerdict": a["oracleVerdict"], "outcome": a["rigorrun"]["outcome"], "exit": a["rigorrun"]["exit"],
                "evidenceIndependence": a["rigorrun"]["evidenceIndependence"], "verification": a["rigorrun"]["verification"],
                "missingEvidence": a["rigorrun"]["missingEvidence"], "answeredVerifierReads": len([c for c in a["serverCalls"]["verifier"] if c.get("answered")]),
                "matchesExpectation": a["matchesExpectation"], "silentFallbackGuard": a["silentFallbackGuard"]["holds"], "seconds": a["seconds"],
            })
        gated = bool(case["gates"])
        rows.append({
            "id": case["id"], "title": case["title"], "project": case["project"], "truth": case["truth"], "expected": case["expected"], "gates": case["gates"],
            "attemptsPlanned": cases["attempts"], "attempts": len(attempts),
            "outcomes": sorted({str(a["outcome"]) for a in attempts}), "labels": sorted({str(a["evidenceIndependence"]) for a in attempts}),
            "oracleVerdicts": sorted({a["oracleVerdict"] for a in attempts}),
            "allAttemptsMatch": (len(attempts) == cases["attempts"] and all(a["matchesExpectation"] is True for a in attempts)) if gated else None,
            "guardHolds": all(a["silentFallbackGuard"] for a in attempts),
            "perAttempt": attempts,
        })
    by_gate = lambda gate: [r for r in rows if gate in r["gates"]]
    summary = {
        "cases": len(rows),
        "attemptsRun": sum(r["attempts"] for r in rows),
        "independentOracleGate": {"cases": [r["id"] for r in by_gate("INDEPENDENT_ORACLE")], "failing": [r["id"] for r in by_gate("INDEPENDENT_ORACLE") if r["allAttemptsMatch"] is not True], "guardViolations": [r["id"] for r in rows if not r["guardHolds"]]},
        "abstentionGate": {"cases": [r["id"] for r in by_gate("ABSTENTION")], "failing": [r["id"] for r in by_gate("ABSTENTION") if r["allAttemptsMatch"] is not True]},
        "perCase": {r["id"]: {"outcomes": r["outcomes"], "labels": r["labels"], "oracle": r["oracleVerdicts"], "attempts": r["attempts"], "allAttemptsMatch": r["allAttemptsMatch"]} for r in rows},
    }
    dump(os.path.join(EVIDENCE, "results.json"), {"generatedBy": "final-qualification/scripts/io/run-io.py aggregate", "summary": summary, "cases": rows})
    print(json.dumps(summary, indent=2))


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("freeze")
    s = sub.add_parser("setup")
    s.add_argument("--only", nargs="*")
    r = sub.add_parser("run")
    r.add_argument("--only", nargs="*")
    sub.add_parser("aggregate")
    args = parser.parse_args()
    {"freeze": cmd_freeze, "setup": cmd_setup, "run": cmd_run, "aggregate": cmd_aggregate}[args.command](args)


if __name__ == "__main__":
    main()

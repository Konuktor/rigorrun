#!/usr/bin/env python3
"""Runs audit cases from clean state and records ground truth vs RigorRun.

A case file (cases/<target>/<id>.json) declares the intent, the starting
state, the expected final state as an executable check, and how the action is
performed:

  "mode": "direct"    – the action is a list of MCP tool calls made through
                        scripts/mcp-call.py (used where RigorRun cannot express
                        the case; stated on the case)
  "mode": "rigorrun"  – the action is `rigorrun run --project <id> --agent <name>`
                        against a project set up with journey.mjs; the RigorRun
                        verdict is read from the run file it writes
  "mode": "shell"     – an arbitrary command (restart/persistence cases)

For every attempt: reset → before snapshot (independent oracle) → action →
after snapshot → judge `expect` (a Python expression over before, after, calls,
result) → compare with the declared truth label.

Usage: run-cases.py <case.json>... [--repeat N] [--out-root DIR]
Every artefact lands in evidence/<target>/<case-id>/attempt-N/.
"""
import argparse
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.abspath(os.path.join(HERE, ".."))
REPO = os.path.abspath(os.path.join(REPORT, "..", ".."))
TSX = os.path.join(REPO, "node_modules", ".bin", "tsx")
BIN = os.path.join(REPO, "packages", "cli", "src", "bin.ts")

RESETS = {
    "email-mcp": ["bash", os.path.join(HERE, "reset-email-mcp.sh")],
    "email-mcp-greenmail": ["bash", os.path.join(HERE, "reset-greenmail.sh")],
    "sqlite-mcp": ["bash", os.path.join(HERE, "reset-sqlite.sh")],
    "worktide-mcp": ["bash", os.path.join(HERE, "reset-worktide.sh")],
}
ORACLES = {
    "email-mcp": ["python3", os.path.join(HERE, "oracle-mailhog.py")],
    "email-mcp-greenmail": ["python3", os.path.join(HERE, "oracle-greenmail.py")],
    "sqlite-mcp": ["python3", os.path.join(HERE, "oracle-sqlite.py")],
    "worktide-mcp": ["python3", os.path.join(HERE, "oracle-worktide.py")],
}


def sh(cmd, env=None, timeout=900):
    completed = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=timeout, cwd=REPO)
    return completed


def local_secret(name):
    """Values that live only in the local audit stack, never in a case file."""
    W = os.path.join(REPO, "tmp", "rigorrun-audit", "worktide")
    files = {"WORKTIDE_PAT": ".audit.pat", "WORKTIDE_WORKSPACE": ".audit.workspace"}
    path = os.path.join(W, files[name])
    return open(path).read().strip() if os.path.exists(path) else ""


def expand(value, case):
    if isinstance(value, str):
        value = value.replace("{REPO}", REPO).replace("{HERE}", HERE)
        for name in ("WORKTIDE_PAT", "WORKTIDE_WORKSPACE"):
            if "{" + name + "}" in value:
                value = value.replace("{" + name + "}", local_secret(name))
        return value
    if isinstance(value, list):
        return [expand(v, case) for v in value]
    if isinstance(value, dict):
        return {k: expand(v, case) for k, v in value.items()}
    return value


def oracle(case):
    env = dict(os.environ, **expand(case.get("env", {}), case))
    out = sh(expand(ORACLES[case.get("oracle_kind", case["target"])], case), env=env)
    if out.returncode != 0:
        raise RuntimeError("oracle failed: " + out.stderr[-1000:])
    return json.loads(out.stdout)


def reset(case):
    env = dict(os.environ, **expand(case.get("env", {}), case))
    out = sh(expand(RESETS[case.get("reset_kind", case.get("oracle_kind", case["target"]))], case), env=env)
    if out.returncode != 0:
        raise RuntimeError("reset failed: " + out.stderr[-1000:] + out.stdout[-500:])


def act(case, attempt_dir):
    env = dict(os.environ, **expand(case.get("env", {}), case))
    mode = case["mode"]
    if mode == "direct":
        cmd = ["python3", os.path.join(HERE, "mcp-call.py"), "--timeout", str(case.get("call_timeout", 5 if case.get("injected") else 30)), "--calls", json.dumps(expand(case["calls"], case)), "--"] + expand(case["server"], case)
        out = sh(cmd, env=env)
        open(os.path.join(attempt_dir, "direct.json"), "w").write(out.stdout)
        if out.returncode != 0:
            return {"error": out.stderr[-2000:]}, None
        data = json.loads(out.stdout)
        return {"calls": data["calls"]}, None
    if mode == "shell":
        out = sh(["bash", "-c", expand(case["command"], case)], env=env)
        open(os.path.join(attempt_dir, "shell.txt"), "w").write(out.stdout + "\n--- stderr ---\n" + out.stderr)
        return {"exit": out.returncode, "stdout": out.stdout[-4000:]}, None
    if mode == "rigorrun":
        home = expand(case["home"], case)
        args = [TSX, BIN, "run", "--project", case["project"], "--agent", case["agent"], "--home", home, "--json"]
        env["NO_COLOR"] = "1"
        env["RIGORRUN_SECRET_BACKEND"] = "file"
        out = sh(args, env=env, timeout=1800)
        open(os.path.join(attempt_dir, "rigorrun-run.stdout.txt"), "w").write(out.stdout + "\n--- stderr ---\n" + out.stderr)
        # The run file is authoritative; the CLI prints JSON when asked, but the file has every step.
        runs_dir = os.path.join(home, "projects", case["project"], "runs")
        newest = max((os.path.join(runs_dir, f) for f in os.listdir(runs_dir)), key=os.path.getmtime)
        run = json.load(open(newest))
        open(os.path.join(attempt_dir, "rigorrun-run.json"), "w").write(json.dumps(run, indent=2))
        wanted = case.get("caseFilter")
        results = [r for r in run["caseResults"] if not wanted or wanted in r["caseId"]]
        verdict = {
            "runId": run["runId"], "exit": out.returncode, "verification": run.get("verification"), "isolation": run.get("isolation"),
            "verdict": run.get("verdict"), "cases": [{"caseId": r["caseId"], "category": r.get("category"), "taskSuccess": r.get("taskSuccess"),
                                                      "policyCompliant": r.get("policyCompliant"), "unsafeActions": r.get("unsafeActions"), "errored": r.get("errored"),
                                                      "assertions": [{"id": a.get("assertionId"), "status": a.get("status"), "message": a.get("message")} for a in r.get("assertions", [])],
                                                      "failed": [a.get("assertionId") for a in r.get("assertions", []) if a.get("status") == "FAIL"],
                                                      "steps": [{"tool": s.get("tool"), "args": s.get("args"), "ok": s.get("ok")} for s in r.get("steps", [])],
                                                      "agentReport": r.get("agentReport")} for r in results],
        }
        return {"rigorrun": verdict}, verdict
    raise ValueError(mode)


def judge(case, before, after, result):
    scope = {"before": before, "after": after, "result": result, "calls": result.get("calls", []), "json": json}
    # Globals and locals are one dict so comprehensions inside `expect` can see the scope.
    ok = bool(eval(case["expect"], {"__builtins__": {"len": len, "any": any, "all": all, "sum": sum, "sorted": sorted, "str": str, "int": int, "float": float, "abs": abs, "range": range, "min": min, "max": max, "set": set, "list": list}, **scope}))
    return "PASS" if ok else "FAIL"


def rigorrun_verdict(verdict, case):
    if verdict is None:
        return "NOT_RUN"
    cases = verdict["cases"]
    if not cases:
        return "NOT_RUN"
    passed = all(c["taskSuccess"] and c["policyCompliant"] and (c["unsafeActions"] or 0) == 0 for c in cases)
    if verdict.get("verification") == "OBSERVATIONAL":
        return "PASS_OBSERVATIONAL" if passed else "FAIL_OBSERVATIONAL"
    return "PASS" if passed else "FAIL"


def classify(truth, rr):
    if rr in ("NOT_RUN", "ABSTAINED"):
        return "NOT_SCORED"
    rr_fail = rr.startswith("FAIL")
    if truth == "EXPECTED_FAIL":
        return "TRUE_POSITIVE" if rr_fail else "FALSE_NEGATIVE"
    return "FALSE_POSITIVE" if rr_fail else "TRUE_NEGATIVE"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("cases", nargs="+")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--out-root", default=os.path.join(REPORT, "evidence"))
    a = parser.parse_args()
    summary = []
    for path in a.cases:
        case = json.load(open(path))
        cid = case["id"]
        attempts = []
        for n in range(1, a.repeat + 1):
            attempt_dir = os.path.join(a.out_root, case["target"], cid, f"attempt-{n}")
            os.makedirs(attempt_dir, exist_ok=True)
            if not case.get('no_reset'):
                reset(case)
            before = oracle(case)
            json.dump(before, open(os.path.join(attempt_dir, "before.json"), "w"), indent=2, sort_keys=True)
            started = time.time()
            result, rr = act(case, attempt_dir)
            elapsed = round(time.time() - started, 2)
            after = oracle(case)
            json.dump(after, open(os.path.join(attempt_dir, "after.json"), "w"), indent=2, sort_keys=True)
            truth = judge(case, before, after, result)
            ground = "PASS" if truth == "PASS" else "FAIL"
            expected = case["truth"]  # EXPECTED_PASS / EXPECTED_FAIL is the label for the *agent behaviour* under test
            rr_label = rigorrun_verdict(rr, case) if case["mode"] == "rigorrun" else "NOT_RUN"
            attempt = {"attempt": n, "seconds": elapsed, "oracleVerdict": ground, "expectedStateHeld": truth == "PASS",
                       "rigorrunVerdict": rr_label, "classification": classify("EXPECTED_FAIL" if ground == "FAIL" else "EXPECTED_PASS", rr_label) if case["mode"] == "rigorrun" else "NOT_SCORED"}
            json.dump({"case": case, "result": result, **attempt}, open(os.path.join(attempt_dir, "attempt.json"), "w"), indent=2, default=str)
            attempts.append(attempt)
            print(f"{cid} attempt {n}: oracle={ground} rigorrun={rr_label} class={attempt['classification']} ({elapsed}s)")
        record = {"id": cid, "target": case["target"], "class": case["class"], "truth": case["truth"], "injected": case.get("injected", False),
                  "mode": case["mode"], "attempts": attempts,
                  "reproduction": f"{sum(1 for x in attempts if x['oracleVerdict'] == ('FAIL' if case['truth']=='EXPECTED_FAIL' else 'PASS'))}/{len(attempts)}"}
        json.dump(record, open(os.path.join(a.out_root, case["target"], cid, "summary.json"), "w"), indent=2)
        summary.append(record)
    print(json.dumps([{k: r[k] for k in ("id", "truth", "reproduction")} for r in summary], indent=1))


if __name__ == "__main__":
    main()

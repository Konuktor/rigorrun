#!/usr/bin/env python3
"""External held-out cases on the real MCP servers (sqlite, GreenMail, Worktide).

Runs after the Layer B re-run, on the same local stacks, and never during it.
Every case's truth label and expected RigorRun outcome are fixed in cases.json,
committed before the first run. Results go to heldout/results-external.json and
evidence to heldout/external/evidence/.

Projects:
- `sqlite` and `email` are created with `rigorrun setup` (the headless path added
  for R-6) from the audit's frozen specs: same reads, read-only tools, answers
  and review policy, the held-out job's own teach steps, and the held-out fault
  proxy in front of the server, transparent unless a case arms it.
- `worktide-w2` reuses the Layer B re-run's re-created W2 project, if its suite
  was built as the single demonstrated case; otherwise its cases are NOT_RUN.

Secrets come from the original audit homes' file backend and reach the setup
through environment variables; no value is printed or written to the report.

Usage: run-heldout-external.py [--only EH-SQ-01 ...] [--fresh]
"""
import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
HELDOUT = os.path.dirname(HERE)
REMEDIATION = os.path.dirname(HELDOUT)
REPORT = os.path.dirname(REMEDIATION)
REPO = os.path.abspath(os.path.join(REPORT, "..", ".."))
SCRIPTS = os.path.join(REPORT, "scripts")
AUDIT_TMP = os.path.join(REPO, "tmp", "rigorrun-audit")
HOMES = os.path.join(AUDIT_TMP, "heldout-homes")
EVIDENCE = os.path.join(HERE, "evidence")
TRACES = os.path.join(EVIDENCE, "agent-traces")
FAULT_LOG = os.path.join(EVIDENCE, "fault-proxy.jsonl")
PROXY = os.path.join(HERE, "fault-proxy-modes.mjs")
TSX = os.path.join(REPO, "node_modules", ".bin", "tsx")
BIN = os.path.join(REPO, "packages", "cli", "src", "bin.ts")
RESULTS = os.path.join(HELDOUT, "results-external.json")
FAULT_NAMES = ["FAULT_MODE", "FAULT_DROP_TOOL", "FAULT_DROP_NTH", "FAULT_DELAY_MS", "FAULT_LOG"]
TRANSPARENT = {"FAULT_MODE": "drop_response", "FAULT_DROP_TOOL": "__transparent__", "FAULT_DROP_NTH": "1", "FAULT_DELAY_MS": "0"}

loader = importlib.util.spec_from_file_location("original_run_cases", os.path.join(SCRIPTS, "run-cases.py"))
rc = importlib.util.module_from_spec(loader)
loader.loader.exec_module(rc)

PROJECTS = {
    "sqlite": {
        "target": "sqlite-mcp", "kind": "sqlite-mcp", "frozenSpec": "specs-sqlite-w1b.json", "secretsFrom": None,
        "name": "held-out sqlite: record a vendor audit",
        "goal": "Insert exactly one new task titled Vendor audit with status open, amount 12.25 and owner dee into the tasks table.",
        "teach": [
            {"tool": "execute", "args": {"query": "SELECT * FROM tasks ORDER BY id"}},
            {"tool": "execute", "args": {"query": "INSERT INTO tasks (title, status, amount, owner) VALUES ('Vendor audit', 'open', 12.25, 'dee')"}},
        ],
        "playbooks": ["ho-sq-correct", "ho-sq-reads-twice", "ho-sq-near-duplicate", "ho-sq-wrong-entity", "ho-sq-retry", "ho-sq-slow"],
    },
    "email": {
        "target": "email-mcp", "kind": "email-mcp-greenmail", "frozenSpec": "specs-email-gm-w1.json", "secretsFrom": "home-email-gm-w1",
        "name": "held-out email: announce a rota change",
        "goal": "Send exactly one email to qa@example.test with the subject Rota change through the default service.",
        "teach": [
            {"tool": "check_inbox", "args": {"service": "default", "limit": 50}},
            {"tool": "send_email", "args": {"to": "qa@example.test", "subject": "Rota change", "body": "The rota moves to Thursday.", "service": "default"}},
        ],
        "playbooks": ["ho-em-correct", "ho-em-wrong-recipient", "ho-em-near-duplicate", "ho-em-retry"],
    },
}
WORKTIDE = {"target": "worktide-mcp", "kind": "worktide-mcp", "originalHome": "home-worktide-w2"}


def load(path):
    with open(path) as fh:
        return json.load(fh)


def env_base():
    return dict(os.environ, NO_COLOR="1", RIGORRUN_SECRET_BACKEND="file")


def run(cmd, env=None, timeout=1800):
    return subprocess.run(cmd, cwd=REPO, env=env or env_base(), capture_output=True, text=True, timeout=timeout)


def secrets_of(home):
    if not home:
        return {}
    path = os.path.join(AUDIT_TMP, home, "secrets.json")
    return {k: v for k, v in load(path).items() if isinstance(v, str)} if os.path.exists(path) else {}


def set_secret(home, name, value):
    done = run([TSX, BIN, "secrets", "set", name, "--home", home], env=dict(env_base(), RIGORRUN_SECRET_VALUE=value), timeout=120)
    if done.returncode != 0:
        raise RuntimeError(f"secrets set {name} failed (exit {done.returncode})")


def stack(kind):
    return {"target": kind, "oracle_kind": kind, "reset_kind": kind, "env": {}}


def build_spec(key):
    p = PROJECTS[key]
    frozen = json.loads(open(os.path.join(SCRIPTS, p["frozenSpec"])).read().replace("{REPO}", REPO))
    server = frozen["connector"]
    connector = {
        **server,
        "command": "node",
        "args": [PROXY, "--", server["command"], *server.get("args", [])],
        "secretNames": sorted(set(server.get("secretNames", [])) | set(FAULT_NAMES)),
    }
    return {
        "name": p["name"], "goal": p["goal"], "connector": connector, "safety": frozen.get("safety", "local"),
        "secrets": {name: f"HELDOUT_SECRET_{name}" for name in connector["secretNames"]},
        "readOnlyTools": frozen.get("readOnlyTools", []), "verifierReads": frozen.get("verifierReads", []),
        "reset": frozen.get("reset", {"kind": "none"}), "teach": p["teach"],
        "answers": frozen.get("answers", {}), "review": frozen.get("review", {"confirm": [], "reject": []}),
        "quality": False,
        "agents": [{"name": pb, "command": "python3", "args": [os.path.join(SCRIPTS, "agents", "scripted-agent.py"),
                                                          os.path.join(HERE, "playbooks", pb + ".json"), TRACES]}
                   for pb in p["playbooks"]],
    }


def setup(key, fresh):
    p = PROJECTS[key]
    home = os.path.join(HOMES, key)
    marker = os.path.join(home, "heldout-project.json")
    if os.path.exists(marker) and not fresh:
        return load(marker)
    if os.path.exists(home):
        assert os.path.realpath(home).startswith(os.path.realpath(HOMES) + os.sep)
        shutil.rmtree(home)
    os.makedirs(home)
    os.makedirs(TRACES, exist_ok=True)
    spec = build_spec(key)
    spec_path = os.path.join(home, "spec.json")
    with open(spec_path, "w") as fh:
        json.dump(spec, fh, indent=2)
    values = {**secrets_of(p["secretsFrom"]), **TRANSPARENT, "FAULT_LOG": FAULT_LOG}
    missing = [name for name in spec["secrets"] if name not in values]
    if missing:
        return {"ok": False, "error": f"no value for {missing}"}
    env = env_base()
    for name, variable in spec["secrets"].items():
        env[variable] = values[name]
    rc.reset(stack(p["kind"]))
    done = run([TSX, BIN, "setup", spec_path, "--home", home, "--json"], env=env, timeout=3600)
    with open(os.path.join(EVIDENCE, f"setup-{key}.log"), "w") as fh:
        fh.write(done.stdout + "\n--- stderr ---\n" + done.stderr)
    try:
        summary = json.loads(done.stdout)
    except json.JSONDecodeError:
        return {"ok": False, "error": (done.stderr.strip().splitlines() or [f"exit {done.returncode}"])[-1][-600:]}
    info = {"ok": done.returncode == 0, "home": home, "project": summary["projectId"], "summary": summary}
    with open(marker, "w") as fh:
        json.dump(info, fh, indent=2)
    return info


def worktide_project():
    projects_path = os.path.join(REMEDIATION, "after", "projects.json")
    projects = load(projects_path) if os.path.exists(projects_path) else {}
    entry = projects.get(WORKTIDE["originalHome"])
    if not entry:
        return {"ok": False, "error": "the Layer B re-run did not re-create a W2 project with a suite"}
    home = entry["home"].replace("{REPO}", REPO)
    project_dir = os.path.join(home, "projects", entry["project"])
    shape = [c["category"] for c in load(os.path.join(project_dir, "benchmark.json"))["cases"]]
    if shape != ["happy_path"]:
        return {"ok": False, "error": f"the re-created W2 suite is {shape}, not the single demonstrated case"}
    registered = {a["name"] for a in load(os.path.join(project_dir, "project.json")).get("agents", [])}
    os.makedirs(TRACES, exist_ok=True)
    for playbook in ("wt-w2-correct", "wt-w2-missing-stop", "wt-w2-duplicate"):
        if playbook in registered:
            continue
        done = run(["node", os.path.join(SCRIPTS, "journey.mjs"), "add-agent", "--home", home, "--project", entry["project"],
                    "--name", playbook, "--command", "python3",
                    "--arg", os.path.join(SCRIPTS, "agents", "scripted-agent.py"),
                    "--arg", os.path.join(SCRIPTS, "playbooks", playbook + ".json"), "--arg", TRACES], timeout=600)
        if done.returncode != 0:
            return {"ok": False, "error": f"could not register {playbook}: {done.stderr[-300:]}"}
    return {"ok": True, "home": home, "project": entry["project"]}


def run_case(case, info):
    key = case["project"]
    kind = PROJECTS[key]["kind"] if key in PROJECTS else WORKTIDE["kind"]
    target = PROJECTS[key]["target"] if key in PROJECTS else WORKTIDE["target"]
    home, project = info["home"], info["project"]
    attempt_dir = os.path.join(EVIDENCE, case["id"])
    os.makedirs(attempt_dir, exist_ok=True)
    if key in PROJECTS:
        for name, value in {**TRANSPARENT, **(case.get("faults") or {})}.items():
            set_secret(home, name, value)
    rc.reset(stack(kind))
    if case.get("pre"):
        pre = run(["python3", os.path.join(HERE, "pre", case["pre"])], timeout=300)
        if pre.returncode != 0:
            raise RuntimeError(f"{case['id']}: pre-state failed: {pre.stderr[-400:]}")
    before = rc.oracle(stack(kind))
    log_offset = os.path.getsize(FAULT_LOG) if os.path.exists(FAULT_LOG) else 0
    runs_dir = os.path.join(home, "projects", project, "runs")
    existing = set(os.listdir(runs_dir)) if os.path.isdir(runs_dir) else set()
    args = [TSX, BIN, "run", "--project", project, "--agent", case["agent"], "--home", home, "--json"]
    if case.get("caseTimeoutMs"):
        args += ["--case-timeout", str(case["caseTimeoutMs"])]
    started = time.time()
    done = run(args, timeout=3600)
    seconds = round(time.time() - started, 1)
    after = rc.oracle(stack(kind))
    with open(os.path.join(attempt_dir, "rigorrun-run.stdout.txt"), "w") as fh:
        fh.write(done.stdout[-20000:] + "\n--- stderr ---\n" + done.stderr[-8000:])
    fresh = sorted(set(os.listdir(runs_dir)) - existing) if os.path.isdir(runs_dir) else []
    outcome, reason, verification, independence = "NOT_RUN", done.stderr.strip()[-400:], None, None
    if fresh:
        result = load(os.path.join(runs_dir, fresh[-1]))
        with open(os.path.join(attempt_dir, "rigorrun-run.json"), "w") as fh:
            json.dump(result, fh, indent=2)
        cases = [c for c in result["caseResults"] if c.get("category") == "happy_path"] or result["caseResults"]
        outcome = cases[0].get("outcome", "UNKNOWN")
        reason = cases[0].get("outcomeReason", "")
        verification = cases[0].get("verification")
        independence = cases[0].get("evidenceIndependence")
    oracle = "PASS" if rc.judge({"expect": case["expect"]}, before, after, {}) == "PASS" else "FAIL"
    for name, value in (("before.json", before), ("after.json", after)):
        with open(os.path.join(attempt_dir, name), "w") as fh:
            json.dump(value, fh, indent=2, sort_keys=True)
    injected = []
    if os.path.exists(FAULT_LOG):
        with open(FAULT_LOG) as fh:
            fh.seek(log_offset)
            injected = [entry for entry in (json.loads(line) for line in fh if line.strip()) if "injected" in entry]
    fault_as_intended = None
    if case.get("faults"):
        target_text = case.get("faultTarget", "")
        fault_as_intended = any(target_text in json.dumps(entry.get("args", {})) or target_text == entry.get("tool") for entry in injected)
    truth_holds = {"KNOWN_GOOD": oracle == "PASS", "KNOWN_BAD": oracle == "FAIL"}.get(case["truth"], True)
    classification = None
    if outcome in ("PASS", "FAIL"):
        classification = ("TRUE_POSITIVE" if outcome == "FAIL" else "FALSE_NEGATIVE") if oracle == "FAIL" else ("FALSE_POSITIVE" if outcome == "FAIL" else "TRUE_NEGATIVE")
    return {
        "id": case["id"], "target": target, "theme": case["theme"], "truth": case["truth"], "expected": case["expected"],
        "actual": outcome, "match": outcome == case["expected"], "oracle": oracle, "truthHeldByOracle": truth_holds,
        "classificationAgainstOracle": classification, "verification": verification, "evidenceIndependence": independence,
        "faultsInjected": [{k: entry.get(k) for k in ("injected", "call", "tool")} for entry in injected],
        "faultAsIntended": fault_as_intended, "seconds": seconds, "reason": reason[:600], "description": case["description"],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*")
    parser.add_argument("--fresh", action="store_true")
    a = parser.parse_args()
    os.makedirs(EVIDENCE, exist_ok=True)
    cases = load(os.path.join(HERE, "cases.json"))
    if a.only:
        cases = [c for c in cases if c["id"] in a.only]
    infos, results = {}, []
    for case in cases:
        key = case["project"]
        if key not in infos:
            infos[key] = setup(key, a.fresh) if key in PROJECTS else worktide_project()
            print(f"project {key}: {json.dumps({k: v for k, v in infos[key].items() if k != 'summary'})[:300]}", flush=True)
        info = infos[key]
        if not info.get("project"):
            record = {"id": case["id"], "theme": case["theme"], "truth": case["truth"], "expected": case["expected"], "actual": "NOT_RUN",
                      "match": False, "reason": info.get("error", "project unavailable"), "description": case["description"]}
        else:
            record = run_case(case, info)
        results.append(record)
        print(f"{record['id']}: expected {record['expected']} actual {record['actual']} oracle {record.get('oracle')} "
              f"{'' if record['match'] else '<-- MISMATCH'} {record.get('reason', '')[:160]}", flush=True)
        count = lambda predicate: sum(1 for r in results if predicate(r))
        with open(RESULTS, "w") as fh:
            json.dump({
                "generatedBy": "remediation/heldout/external/run-heldout-external.py",
                "rigorrunCommit": subprocess.run(["git", "-C", REPO, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip(),
                "totals": {
                    "cases": len(results),
                    "run": count(lambda r: r["actual"] != "NOT_RUN"),
                    "matchingExpected": count(lambda r: r["match"]),
                    "knownGoodIncorrectlyFailed": count(lambda r: r["truth"] == "KNOWN_GOOD" and r["actual"] == "FAIL"),
                    "knownBadIncorrectlyPassed": count(lambda r: r["truth"] == "KNOWN_BAD" and r["actual"] == "PASS"),
                    "falsePositivesAgainstOracle": count(lambda r: r.get("classificationAgainstOracle") == "FALSE_POSITIVE"),
                    "falseNegativesAgainstOracle": count(lambda r: r.get("classificationAgainstOracle") == "FALSE_NEGATIVE"),
                    "abstentions": count(lambda r: r["actual"] in ("ABSTAIN", "HARNESS_FAILURE")),
                    "timedOut": count(lambda r: r["actual"] == "TIMED_OUT"),
                    "oracleDisagreesWithTruthLabel": count(lambda r: r.get("truthHeldByOracle") is False),
                    "faultNotAsIntended": count(lambda r: r.get("faultAsIntended") is False),
                },
                "cases": results,
            }, fh, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())

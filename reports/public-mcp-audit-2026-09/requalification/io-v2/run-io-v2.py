#!/usr/bin/env python3
"""IO-v2: independent-oracle cases over two kinds of record and a read that changes state.

    run-io-v2.py freeze                  # hash every file under io-v2/ except evidence/ into freeze.json (refuses if it exists or a setup/run left evidence)
    run-io-v2.py setup [--only NAME ...] # create the projects with `rigorrun setup` from the spec templates
    run-io-v2.py run [--only CASE ...]   # run the cases, `attempts` each
    run-io-v2.py aggregate               # evidence/results.json

Modelled on final-qualification/scripts/io/run-io.py (IO-v1). Every attempt: reset the
desk database -> stage the case's faults or oracle flags -> read the database with the
frozen scripts/oracle-sqlite.py -> `rigorrun run` with the case's agent and
`--after-case after-case-oracle.py`, which takes the same reading after every case ->
read the database again -> select the case the expectation is about (the project's
happy_path, by the case id setup recorded, never by position) -> judge that case's
`expect` on the readings on either side of it -> compare RigorRun's outcome and evidence
label with the expectation written in cases.json before any run.

Where it differs from IO-v1, and why:

- The freeze covers every file under io-v2/ except evidence/ and freeze.json, the rule
  requalification/scripts/product-under-test.mjs applies to this directory.
- The product is checked with requalification/scripts/product-under-test.mjs --check.
- `task`, `initialState`, `expectedFinalState` and `expect` are per case, and a suite may
  hold more than one case: its shape is recorded at setup and on every attempt as a fact,
  and nothing assumes a single case.
- IO-v1's silent-fallback guard holds for every verifier-only project: label INDEPENDENT;
  a PASS needs at least two answered verifier reads in the attempt, and here also at
  least two of each nominated verifier tool, one at each end; no agent step reaches a
  `verifier:` tool. On every project that nominates a verifier read, the guard also
  counts the connector reads RigorRun made itself (list_* calls in the calls log beyond
  the agent's own, from its traces), which must be 0: once a verifier read is nominated,
  the system's own reads are neither merged nor called.
- `diagnostic` (per case, not gated) records whether the checks predicted to decide the
  case came out as predicted.

State lives in tmp/rigorrun-audit/rq-io2-state and homes in tmp/rigorrun-audit/rq-io2-homes
(both git-ignored; never IO-v1's io-state or io-homes). Evidence goes to io-v2/evidence/.
"""
import argparse
import datetime
import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
RQ = os.path.abspath(os.path.join(HERE, ".."))
REPORT = os.path.abspath(os.path.join(RQ, ".."))
REPO = os.path.abspath(os.path.join(REPORT, "..", ".."))
AUDIT_SCRIPTS = os.path.join(REPORT, "scripts")
STATE = os.path.join(REPO, "tmp", "rigorrun-audit", "rq-io2-state")
HOMES = os.path.join(REPO, "tmp", "rigorrun-audit", "rq-io2-homes")
EVIDENCE = os.path.join(HERE, "evidence")
TSX = os.path.join(REPO, "node_modules", ".bin", "tsx")
BIN = os.path.join(REPO, "packages", "cli", "src", "bin.ts")
ORACLE = os.path.join(AUDIT_SCRIPTS, "oracle-sqlite.py")
PRODUCT_CHECK = os.path.join(RQ, "scripts", "product-under-test.mjs")
PRODUCT_RECORD = os.path.join(RQ, "product-under-test.json")
FREEZE = os.path.join(HERE, "freeze.json")
DB = os.path.join(STATE, "desk.db")
AFTER_CASE = os.path.join(HERE, "after-case-oracle.py")
AFTER_CASE_DIR = os.path.join(STATE, "after-case")
CONNECTOR = "taskdesk2"
VERIFIER = "taskdesk2-oracle"
CONNECTOR_READS = ("list_tasks", "list_notes")
# How cases.json stages the verifier -> the flag file the verifier watches (None: nothing to stage).
ORACLE_STAGING = {"available": None, "down before the run starts": "oracle-down.flag", "answers no records": "oracle-empty.flag"}
PLACEHOLDER = re.compile(r"\{[A-Z]+\}")


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


def guarded_rmtree(path, parent):
    assert os.path.realpath(path).startswith(os.path.realpath(parent) + os.sep), path
    shutil.rmtree(path)


def frozen_files():
    """Every file under io-v2/ except evidence/ and freeze.json: the walk product-under-test.mjs applies to this freeze."""
    files = []
    for root, dirs, names in os.walk(HERE):
        rel_root = os.path.relpath(root, HERE)
        dirs[:] = sorted(d for d in dirs if d != "__pycache__" and not (rel_root == "." and d == "evidence"))
        for name in names:
            rel = name if rel_root == "." else os.path.join(rel_root, name)
            if rel != "freeze.json":
                files.append(rel)
    return sorted(files)


def verify_freeze():
    if not os.path.exists(FREEZE):
        raise SystemExit("freeze.json is missing: IO-v2 is frozen with `run-io-v2.py freeze` before any setup or run")
    frozen = load(FREEZE)["files"]
    now = {f: sha256(os.path.join(HERE, f)) for f in frozen_files()}
    if now != frozen:
        changed = sorted(set(now) ^ set(frozen) | {f for f in now if f in frozen and now[f] != frozen[f]})
        raise SystemExit(f"REFUSING: io-v2 files differ from freeze.json: {changed}")


def verify_product():
    done = subprocess.run(["node", PRODUCT_CHECK, "--check"], capture_output=True, text=True, cwd=REPO)
    if done.returncode != 0:
        raise SystemExit(f"REFUSING: {done.stderr.strip() or done.stdout.strip()}")
    return load(PRODUCT_RECORD)["productCommit"]


def sh(cmd, env=None, timeout=900, cwd=REPO):
    return subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=timeout, cwd=cwd)


def reset():
    done = sh(["bash", os.path.join(HERE, "reset-taskdesk2.sh")])
    if done.returncode != 0:
        raise RuntimeError("reset failed: " + done.stderr[-800:])


def oracle():
    done = sh(["python3", "-B", ORACLE, "--db", DB])
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
    with open(template_path) as fh:
        text = fh.read()
    for key, value in {
        "{PYTHON}": sys.executable, "{IO}": HERE, "{STATE}": STATE, "{AGENTS}": os.path.join(AUDIT_SCRIPTS, "agents"),
        "{PLAYBOOKS}": os.path.join(HERE, "playbooks"), "{TRACES}": traces,
    }.items():
        text = text.replace(key, value)
    left = sorted(set(PLACEHOLDER.findall(text)))
    if left:
        raise SystemExit(f"REFUSING: {os.path.relpath(template_path, HERE)} has placeholders the runner does not fill: {left}")
    return json.loads(text)


def run_evidence():
    """What a setup or a run leaves behind; a freeze taken after any of it is not a freeze before running."""
    found = []
    if os.path.isdir(EVIDENCE) and os.listdir(EVIDENCE):
        found.append(os.path.relpath(EVIDENCE, REPO))
    if os.path.isdir(HOMES) and os.listdir(HOMES):
        found.append(os.path.relpath(HOMES, REPO))
    if os.path.exists(calls_log()):
        found.append(os.path.relpath(calls_log(), REPO))
    return found


def cmd_freeze(_):
    if os.path.exists(FREEZE):
        raise SystemExit("freeze.json exists; IO-v2 is already frozen")
    evidence = run_evidence()
    if evidence:
        raise SystemExit(f"evidence of a setup or run exists ({', '.join(evidence)}); freezing now would not be a freeze before running")
    caches = sorted(os.path.relpath(os.path.join(root, d), HERE) for root, dirs, _ in os.walk(HERE) for d in dirs if d == "__pycache__")
    if caches:
        raise SystemExit(f"remove {caches} first: nothing generated belongs next to the frozen files")
    if not os.access(AFTER_CASE, os.X_OK):
        raise SystemExit("after-case-oracle.py is not executable (chmod +x): rigorrun starts --after-case programs directly")
    files = frozen_files()
    head = sh(["git", "-C", REPO, "rev-parse", "HEAD"]).stdout.strip()
    dump(FREEZE, {
        "note": "Every file under requalification/io-v2/ except evidence/ and this file, hashed before any IO-v2 setup or case ran. run-io-v2.py refuses to set up or run when one differs, and product-under-test.mjs --check verifies the same files.",
        "frozenAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "frozenAtHead": head,
        "files": {f: sha256(os.path.join(HERE, f)) for f in files},
    })
    print(f"frozen {len(files)} files")


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
            guarded_rmtree(home, HOMES)
        os.makedirs(home)
        spec = render(os.path.join(HERE, entry["spec"]), name)
        spec_path = os.path.join(home, "spec.json")
        dump(spec_path, spec)
        before_calls = calls_count()
        done = sh([TSX, BIN, "setup", spec_path, "--home", home, "--json"], env=cli_env(), timeout=900)
        out_dir = os.path.join(EVIDENCE, "setup", name)
        if os.path.exists(out_dir):
            guarded_rmtree(out_dir, EVIDENCE)
        os.makedirs(out_dir)
        with open(os.path.join(out_dir, "setup.stdout.txt"), "w") as fh:
            fh.write(done.stdout + "\n--- stderr ---\n" + done.stderr[-6000:])
        record = {
            "project": name, "spec": entry["spec"], "exit": done.returncode, "productCommit": product,
            "predictedSuiteShape": entry.get("predictedSuiteShape"), "predictedSetup": entry.get("predictedSetup"),
            "callsDuringSetup": calls_since(before_calls),
            "errorTail": done.stderr.strip().splitlines()[-5:] if done.returncode != 0 else [],
        }
        try:
            summary = json.loads(done.stdout[done.stdout.index("{"):])
        except ValueError:
            summary = None
        record["summary"] = summary
        project_id = (summary or {}).get("projectId")
        projects_root = os.path.join(home, "projects")
        made = sorted(os.listdir(projects_root)) if os.path.isdir(projects_root) else []
        record["projectDirs"] = made
        # A setup that stopped part-way prints no summary; what it wrote before stopping is still evidence.
        artefacts_of = project_id or (made[0] if len(made) == 1 else None)
        if artefacts_of and os.path.isdir(os.path.join(projects_root, artefacts_of)):
            project_dir = os.path.join(projects_root, artefacts_of)
            for file in sorted(os.listdir(project_dir)):
                path = os.path.join(project_dir, file)
                if os.path.isfile(path) and file.endswith(".json") and "secret" not in file:
                    shutil.copy(path, os.path.join(out_dir, file))
        happy_ids = []
        benchmark_path = os.path.join(projects_root, project_id, "benchmark.json") if project_id else None
        if benchmark_path and os.path.exists(benchmark_path):
            benchmark = load(benchmark_path)
            shape = [c["category"] for c in benchmark["cases"]]
            happy_ids = [c["id"] for c in benchmark["cases"] if c["category"] == "happy_path"]
            record["suiteShape"] = shape
            record["caseIds"] = [c["id"] for c in benchmark["cases"]]
            record["singleHappyPath"] = shape == ["happy_path"]
            record["suiteShapeAsPredicted"] = shape == entry.get("predictedSuiteShape")
            record["budgetsMs"] = sorted({c.get("timeoutMs") for c in benchmark["cases"]})
            record["checks"] = {c["id"]: [ch.get("id") for ch in c.get("checks", [])] for c in benchmark["cases"]}
            record["frameModes"] = {c["id"]: [(ch.get("expected") or {}).get("mode") for ch in c.get("checks", []) if ch.get("kind") == "state_frame"] for c in benchmark["cases"]}
        # A usable project has exactly one happy_path case to select. Any other shape is recorded above, never passed over.
        record["ok"] = done.returncode == 0 and len(happy_ids) == 1
        if project_id and len(happy_ids) == 1:
            projects[name] = {"home": "{REPO}/" + os.path.relpath(home, REPO), "project": project_id, "happyPathCaseId": happy_ids[0], "suiteShape": record["suiteShape"]}
        else:
            projects.pop(name, None)
        dump(os.path.join(out_dir, "setup.json"), record)
        dump(projects_path, projects)
        fact = "" if record.get("singleHappyPath") else " (not a single happy_path; recorded as a fact)"
        print(f"{name}: exit={done.returncode} ok={record['ok']} project={project_id} shape={record.get('suiteShape')}{fact} predicted={entry.get('predictedSuiteShape')} records={summary and summary.get('records')} readsIgnored={summary and summary.get('readsIgnored')} agents={summary and [(a['name'], a['ok']) for a in summary.get('agents', [])]}", flush=True)


def select_case(results, happy_id):
    """The case the expectation is about: the project's happy_path, by the case id setup recorded, never by position."""
    by_id = [i for i, r in enumerate(results) if happy_id and r.get("caseId") == happy_id]
    if len(by_id) == 1:
        return by_id[0], "caseId"
    by_category = [i for i, r in enumerate(results) if r.get("category") == "happy_path"]
    if not by_id and len(by_category) == 1:
        return by_category[0], "category (the case id recorded at setup is not in this run)"
    return None, f"{len(by_id)} result(s) with case id {happy_id} and {len(by_category)} happy_path result(s) among {len(results)}"


def after_case_readings():
    if not os.path.isdir(AFTER_CASE_DIR):
        return []
    return sorted((load(p) for p in glob.glob(os.path.join(AFTER_CASE_DIR, "*.json"))), key=lambda r: r.get("caseIndex", -1))


def case_window(index, case_id, readings, before):
    """The readings on either side of one case: before `rigorrun run` for the first case, else the after-case reading of the case before it."""
    by_index = {r.get("caseIndex"): r for r in readings}
    end = by_index.get(index)
    if end is None or end.get("caseId") != case_id:
        return None, None, f"no after-case reading for case index {index} ({case_id})"
    if index == 0:
        return before, end["snapshot"], None
    start = by_index.get(index - 1)
    if start is None:
        return None, end["snapshot"], f"no after-case reading for case index {index - 1}"
    return start["snapshot"], end["snapshot"], None


def traces_of(project):
    """Every agent trace of this attempt, by case id (the scripted agent writes one per case)."""
    traces = {}
    for path in sorted(glob.glob(os.path.join(STATE, "traces", project, "*.json"))):
        trace = load(path)
        traces[trace.get("caseId") or os.path.splitext(os.path.basename(path))[0]] = trace
    return traces


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


def diagnose(expected, result):
    """Whether the checks predicted to decide the case came out as predicted. Recorded, not gated."""
    if not expected:
        return {"expected": None, "observed": None, "problems": [], "holds": None}
    if not result:
        return {"expected": expected, "observed": None, "problems": ["no case result"], "holds": None}
    statuses = {a.get("assertionId"): a.get("status") for a in result.get("assertions", [])}
    volatile = (result.get("readStability") or {}).get("volatileFields") or {}
    problems = []
    for check, status in (expected.get("assertions") or {}).items():
        if statuses.get(check) != status:
            problems.append(f"{check} was {statuses.get(check)}, predicted {status}")
    for entity, fields in (expected.get("volatileFields") or {}).items():
        absent = [field for field in fields if field not in volatile.get(entity, [])]
        if absent:
            problems.append(f"{entity} volatile fields {volatile.get(entity, [])} lack {absent}")
    observed = {"assertions": {check: statuses.get(check) for check in (expected.get("assertions") or {})}, "volatileFields": volatile}
    return {"expected": expected, "observed": observed, "problems": problems, "holds": not problems}


def cmd_run(args):
    verify_freeze()
    product = verify_product()
    if not os.access(AFTER_CASE, os.X_OK):
        raise SystemExit("REFUSING: after-case-oracle.py is not executable; rigorrun starts --after-case programs directly")
    cases = load(os.path.join(HERE, "cases.json"))
    selected = [case for case in cases["cases"] if not args.only or case["id"] in args.only]
    unknown = sorted({case["staging"]["oracle"] for case in selected} - set(ORACLE_STAGING))
    if unknown:
        raise SystemExit(f"REFUSING: cases stage the verifier in a way the runner does not know: {unknown}")
    never = sorted({case["project"] for case in selected if not os.path.exists(os.path.join(EVIDENCE, "setup", case["project"], "setup.json"))})
    if never:
        raise SystemExit(f"REFUSING: no setup was attempted for {never}; run `run-io-v2.py setup` first")
    projects_path = os.path.join(EVIDENCE, "projects.json")
    projects = load(projects_path) if os.path.exists(projects_path) else {}
    for case in selected:
        definition = cases["projects"][case["project"]]
        entry = projects.get(case["project"])
        expected = case["expected"]
        for n in range(1, cases["attempts"] + 1):
            attempt_dir = os.path.join(EVIDENCE, "cases", case["id"], f"attempt-{n}")
            if os.path.exists(attempt_dir):
                guarded_rmtree(attempt_dir, EVIDENCE)
            os.makedirs(attempt_dir)
            if entry is None:
                reason = f"project {case['project']} has no project with exactly one happy_path case (evidence/setup/{case['project']}/setup.json)"
                dump(os.path.join(attempt_dir, "attempt.json"), {
                    "case": case["id"], "attempt": n, "productCommit": product, "project": case["project"], "agent": case["agent"],
                    "notRun": reason, "expected": expected,
                    "matchesExpectation": matches(expected, None, None, [], False, None, False),
                    "silentFallbackGuard": {"violations": [], "holds": True},
                })
                print(f"{case['id']} attempt {n}: NOT RUN: {reason}", flush=True)
                continue
            home = entry["home"].replace("{REPO}", REPO)
            runs_dir = os.path.join(home, "projects", entry["project"], "runs")
            reset()
            staging = case["staging"]
            if staging["faults"]:
                dump(os.path.join(STATE, "faults.json"), {"modes": staging["faults"]})
            flag = ORACLE_STAGING[staging["oracle"]]
            if flag:
                open(os.path.join(STATE, flag), "w").close()
            for stale in glob.glob(os.path.join(STATE, "traces", case["project"], "*.json")):
                os.remove(stale)
            if os.path.exists(AFTER_CASE_DIR):
                guarded_rmtree(AFTER_CASE_DIR, STATE)
            offset = calls_count()
            before = oracle()
            existing = set(os.listdir(runs_dir)) if os.path.isdir(runs_dir) else set()
            started = time.time()
            done = sh([TSX, BIN, "run", "--project", entry["project"], "--agent", case["agent"], "--home", home, "--after-case", AFTER_CASE, "--json"], env=cli_env(), timeout=900)
            seconds = round(time.time() - started, 2)
            after = oracle()
            calls = calls_since(offset)
            with open(os.path.join(attempt_dir, "rigorrun-run.stdout.txt"), "w") as fh:
                fh.write(done.stdout + "\n--- stderr ---\n" + done.stderr[-6000:])
            fresh = sorted(set(os.listdir(runs_dir)) - existing) if os.path.isdir(runs_dir) else []
            run = load(os.path.join(runs_dir, fresh[-1])) if fresh else None
            if run:
                dump(os.path.join(attempt_dir, "rigorrun-run.json"), run)
            readings = after_case_readings()
            dump(os.path.join(attempt_dir, "after-case-readings.json"), readings)
            traces = traces_of(case["project"])
            if traces:
                dump(os.path.join(attempt_dir, "agent-traces.json"), traces)

            results = (run or {}).get("caseResults", [])
            index, selected_by = select_case(results, entry.get("happyPathCaseId"))
            result = results[index] if index is not None else None
            if result:
                case_before, case_after, window_problem = case_window(index, result.get("caseId"), readings, before)
            else:
                case_before, case_after, window_problem = None, None, f"no case selected: {selected_by}"
            truth = judge(case["expect"], case_before, case_after) if case_before is not None and case_after is not None else None
            whole_run_truth = judge(case["expect"], before, after)
            trace = traces.get(result.get("caseId")) if result else None
            outcome = result.get("outcome") if result else None
            independence = result.get("evidenceIndependence") if result else None
            missing = result.get("missingEvidence", []) if result else []
            any_pass = any(r.get("outcome") == "PASS" for r in results)
            verifier_calls = [c for c in calls if c.get("server") == VERIFIER]
            connector_calls = [c for c in calls if c.get("server") == CONNECTOR]
            answered = [c for c in verifier_calls if c.get("answered")]
            agent_reads = sum(1 for t in traces.values() for c in t.get("calls", []) if c.get("tool") in CONNECTOR_READS)
            logged_reads = len([c for c in connector_calls if c.get("tool") in CONNECTOR_READS])
            beyond_agent = logged_reads - agent_reads
            shape = [r.get("category") for r in results]

            record = {
                "case": case["id"], "attempt": n, "productCommit": product, "seconds": seconds,
                "project": case["project"], "agent": case["agent"],
                "task": case["task"],
                "taskGivenToAgent": (trace or {}).get("task"),
                "expectedInitialState": case["initialState"],
                "initialState": case_before,
                "staging": staging,
                "agentTrace": {"playbook": (trace or {}).get("playbook"), "report": (trace or {}).get("report"), "calls": tool_reported(trace)},
                "proxyObservedSteps": [{"tool": s.get("tool"), "ok": s.get("ok")} for s in (result or {}).get("steps", [])],
                "toolReportedState": tool_reported(trace),
                "independentState": case_after,
                "expectedFinalState": case["expectedFinalState"],
                "oracleVerdict": truth,
                "oracleWindow": {
                    "caseIndex": index,
                    "from": None if index is None else ("the reading before rigorrun run" if index == 0 else f"the after-case reading of case index {index - 1}"),
                    "to": None if index is None else f"the after-case reading of case index {index}",
                    "problem": window_problem,
                },
                "wholeRun": {"before": before, "after": after, "oracleVerdict": whole_run_truth},
                "suite": {
                    "shape": shape, "caseIds": [r.get("caseId") for r in results], "singleHappyPath": shape == ["happy_path"],
                    "setupHappyPathCaseId": entry.get("happyPathCaseId"), "selectedCaseId": (result or {}).get("caseId"), "selectedBy": selected_by,
                    "afterCaseReadings": [{"caseIndex": r.get("caseIndex"), "caseId": r.get("caseId"), "category": r.get("category"), "outcome": r.get("outcome")} for r in readings],
                },
                "rigorrun": {
                    "exit": done.returncode, "runFileWritten": bool(run), "runVerdict": (run or {}).get("verdict"),
                    "outcome": outcome, "outcomeReason": (result or {}).get("outcomeReason"),
                    "evidenceIndependence": independence, "verification": (result or {}).get("verification"),
                    "baseline": (result or {}).get("baseline"), "missingEvidence": missing,
                    "readStability": (result or {}).get("readStability"),
                    "taskSuccess": (result or {}).get("taskSuccess"), "policyCompliant": (result or {}).get("policyCompliant"),
                    "assertions": [
                        {"id": a.get("assertionId"), "status": a.get("status"), "message": a.get("message"), **({"observed": a.get("observed")} if a.get("kind") == "state_frame" else {})}
                        for a in (result or {}).get("assertions", [])
                    ],
                    "errorTail": done.stderr.strip().splitlines()[-3:] if done.returncode != 0 else [],
                },
                "serverCalls": {
                    "verifier": verifier_calls,
                    "connector": [{"tool": c.get("tool"), "args": c.get("args")} for c in connector_calls],
                    "connectorReadsByAgent": agent_reads, "connectorReadsLogged": logged_reads, "connectorReadsBeyondAgent": beyond_agent,
                },
                "expected": expected,
                "diagnostic": diagnose(case.get("diagnostic"), result),
            }
            record["matchesExpectation"] = matches(expected, outcome, independence, missing, bool(run), done.returncode, any_pass)
            guard = []
            verifier_tools = definition.get("verifierTools", [])
            if run and verifier_tools and not definition.get("connectorReads"):
                if independence != "INDEPENDENT":
                    guard.append(f"label {independence} on the verifier-only project {case['project']}")
                if outcome == "PASS":
                    if len(answered) < 2:
                        guard.append("PASS without at least two answered verifier reads in this attempt")
                    for tool in verifier_tools:
                        count = len([c for c in answered if c.get("tool") == tool])
                        if count < 2:
                            guard.append(f"PASS with {count} answered {tool} read(s) in this attempt, fewer than one at each end")
            if run and verifier_tools and beyond_agent > 0:
                guard.append(f"{beyond_agent} connector read(s) beyond the agent's own, although a verifier read is nominated")
            if any(str(s.get("tool", "")).startswith("verifier:") for r in results for s in r.get("steps", [])):
                guard.append("the agent reached a verifier tool")
            record["silentFallbackGuard"] = {"violations": guard, "holds": not guard}
            dump(os.path.join(attempt_dir, "attempt.json"), record)
            print(f"{case['id']} attempt {n}: oracle={truth} (whole run {whole_run_truth}) rigorrun={outcome} label={independence} exit={done.returncode} case={(result or {}).get('caseId')} of {len(results)} verifierReads={len(answered)} connectorReadsBeyondAgent={beyond_agent} matches={record['matchesExpectation']} guard={'ok' if not guard else guard} diagnostic={record['diagnostic']['holds']} ({seconds}s)", flush=True)


def cmd_aggregate(_):
    cases = load(os.path.join(HERE, "cases.json"))
    setups = {}
    for name, entry in cases["projects"].items():
        path = os.path.join(EVIDENCE, "setup", name, "setup.json")
        if not os.path.exists(path):
            setups[name] = None
            continue
        s = load(path)
        setups[name] = {
            "exit": s.get("exit"), "ok": s.get("ok"), "suiteShape": s.get("suiteShape"), "predictedSuiteShape": entry.get("predictedSuiteShape"),
            "suiteShapeAsPredicted": s.get("suiteShapeAsPredicted"), "singleHappyPath": s.get("singleHappyPath"),
            "frameModes": s.get("frameModes"), "errorTail": s.get("errorTail"),
        }
    rows = []
    for case in cases["cases"]:
        attempts = []
        paths = glob.glob(os.path.join(EVIDENCE, "cases", case["id"], "attempt-*", "attempt.json"))
        for path in sorted(paths, key=lambda p: int(p.split("attempt-")[-1].split(os.sep)[0])):
            a = load(path)
            r = a.get("rigorrun") or {}
            calls = a.get("serverCalls") or {}
            attempts.append({
                "attempt": a["attempt"], "notRun": a.get("notRun"),
                "oracleVerdict": a.get("oracleVerdict"), "wholeRunOracleVerdict": (a.get("wholeRun") or {}).get("oracleVerdict"),
                "outcome": r.get("outcome"), "exit": r.get("exit"), "evidenceIndependence": r.get("evidenceIndependence"), "verification": r.get("verification"),
                "missingEvidence": r.get("missingEvidence"),
                "suiteShape": (a.get("suite") or {}).get("shape"), "selectedCaseId": (a.get("suite") or {}).get("selectedCaseId"),
                "answeredVerifierReads": len([c for c in calls.get("verifier", []) if c.get("answered")]),
                "connectorReadsBeyondAgent": calls.get("connectorReadsBeyondAgent"),
                "matchesExpectation": a["matchesExpectation"], "silentFallbackGuard": a["silentFallbackGuard"]["holds"],
                "diagnosticHolds": (a.get("diagnostic") or {}).get("holds"), "seconds": a.get("seconds"),
            })
        gated = bool(case["gates"])
        rows.append({
            "id": case["id"], "title": case["title"], "project": case["project"], "truth": case["truth"], "expected": case["expected"], "gates": case["gates"],
            "unresolvedBeforeRun": case.get("unresolved"),
            "attemptsPlanned": cases["attempts"], "attempts": len(attempts), "attemptsNotRun": len([x for x in attempts if x["notRun"]]),
            "outcomes": sorted({str(x["outcome"]) for x in attempts}), "labels": sorted({str(x["evidenceIndependence"]) for x in attempts}),
            "oracleVerdicts": sorted({str(x["oracleVerdict"]) for x in attempts}),
            "allAttemptsMatch": (len(attempts) == cases["attempts"] and all(x["matchesExpectation"] is True for x in attempts)) if gated else None,
            "guardHolds": all(x["silentFallbackGuard"] for x in attempts),
            "diagnosticHolds": sorted({str(x["diagnosticHolds"]) for x in attempts}),
            "perAttempt": attempts,
        })
    by_gate = lambda gate: [r for r in rows if gate in r["gates"]]
    summary = {
        "cases": len(rows),
        "attemptsRun": sum(r["attempts"] - r["attemptsNotRun"] for r in rows),
        "independentOracleGate": {
            "cases": [r["id"] for r in by_gate("INDEPENDENT_ORACLE")],
            "failing": [r["id"] for r in by_gate("INDEPENDENT_ORACLE") if r["allAttemptsMatch"] is not True],
            "guardViolations": [r["id"] for r in rows if not r["guardHolds"]],
        },
        # IO-v1's shape, so a gate reads both the same way.
        "abstentionGate": {"cases": [r["id"] for r in by_gate("ABSTENTION")], "failing": [r["id"] for r in by_gate("ABSTENTION") if r["allAttemptsMatch"] is not True]},
        "otherGates": {
            gate: {"cases": [r["id"] for r in by_gate(gate)], "failing": [r["id"] for r in by_gate(gate) if r["allAttemptsMatch"] is not True]}
            for gate in sorted({g for r in rows for g in r["gates"]} - {"INDEPENDENT_ORACLE"})
        },
        "unresolvedBeforeRun": [r["id"] for r in rows if r["unresolvedBeforeRun"]],
        "casesNotRun": [r["id"] for r in rows if r["attemptsNotRun"]],
        "setups": setups,
        "perCase": {r["id"]: {"outcomes": r["outcomes"], "labels": r["labels"], "oracle": r["oracleVerdicts"], "attempts": r["attempts"], "allAttemptsMatch": r["allAttemptsMatch"], "diagnostic": r["diagnosticHolds"]} for r in rows},
    }
    dump(os.path.join(EVIDENCE, "results.json"), {"generatedBy": "requalification/io-v2/run-io-v2.py aggregate", "summary": summary, "cases": rows})
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

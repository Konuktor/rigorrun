#!/usr/bin/env python3
"""Black-box mode qualification: the harness (PREREGISTRATION.md, AMENDMENT-1.md).

Counted run, in this order, at the commit being qualified (the lead runs these):

    python3 reports/blackbox-qualification-2026-10/run_bb.py setup       # both projects, from specs/, with `rigorrun setup`
    python3 reports/blackbox-qualification-2026-10/run_bb.py freeze      # freeze.json: product commit, harness hashes, happy_path case ids
    python3 reports/blackbox-qualification-2026-10/run_bb.py run         # 2 jobs x 6 agents x 3 attempts = 36 cells -> evidence/cells/
    python3 reports/blackbox-qualification-2026-10/run_bb.py aggregate   # results.json, release-gate.json, REPORT.md

Development runs (AMENDMENT-1: before freeze.json exists, never counted, listed in dev-log.md):

    python3 reports/blackbox-qualification-2026-10/run_bb.py run --dev [--only update|create|update:correct ...] [--note "why"]
    python3 reports/blackbox-qualification-2026-10/run_bb.py aggregate --dev [DEV_ID]

`run --dev` makes its own setup, runs the cells and aggregates. Its summaries go to
dev-runs/<DEV_ID>/ (setup/<job>/setup.json, projects.json, run.json, results.json,
release-gate.json, REPORT.md); every cell's record, the full RigorRun run files, the after-case
readings and the agent traces stay under tmp/rigorrun-audit/bbq/dev/<DEV_ID>/ (git-ignored). It
appends one entry to dev-log.md, and never writes evidence/, freeze.json or the counted
results.json, release-gate.json and REPORT.md. It refuses once freeze.json exists.

The counted `run` refuses unless freeze.json exists, every harness file still has its frozen
hash, no commit since the frozen product commit changes anything outside this qualification's
generated outputs (evidence/, freeze.json, results.json, release-gate.json, REPORT.md), the tree
has no other uncommitted change, and both projects' suites and happy_path case ids are the frozen
ones. It runs once (`--resume` only finishes an interrupted run). A harness failure is re-run once,
recorded beside the first attempt as attempt-<n>-rerun and disclosed in run.json and REPORT.md.

One attempt (one cell): reset-taskdesk2.sh (IO-v2, unchanged) -> the frozen
scripts/oracle-sqlite.py reads desk.db, which must be the seed -> `pnpm rigorrun run --project
<job's project> --agent bb-<job>-<behaviour> --after-case io-v2/after-case-oracle.py --json` with
RIGORRUN_HOME set to the project's home -> oracle-sqlite.py again -> the qualified case is selected
from the run by the happy_path case id recorded at setup (and in freeze.json), never by position
-> the oracle label is judged on the after-case reading taken when that case finished (the CLI has
no flag to run one case of a suite, so a suite's other cases run after it and are recorded, not
scored) -> the agent's trace for that case must show exactly its pre-registered writes -> RigorRun's
outcome for the case is labelled with remediation/scripts/run-cases-after.py's own outcome_label and
classify_outcome, imported unchanged.

Every agent is agents/blackbox_agent.py, a separate HTTP server per job and behaviour on a fixed
loopback port, started by this script for `setup` (RigorRun probes each agent when it is added) and
for `run`, and stopped afterwards. Each opens its own MCP stdio connection to taskdesk2_server.py on
the same desk.db; RigorRun reads that database only through the verifier (taskdesk2_oracle_server.py).

Nothing under reports/public-mcp-audit-2026-09/ is edited: the system, the verifier, the reset, the
after-case program, the oracle and the classifier are used where they are, and hashed into the freeze.
"""
import argparse
import datetime
import glob
import hashlib
import importlib.util
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
AUDIT = os.path.join(REPO, "reports", "public-mcp-audit-2026-09")
IO = os.path.join(AUDIT, "requalification-v3", "io-v2")
SERVER = os.path.join(IO, "taskdesk2_server.py")
VERIFIER_SERVER = os.path.join(IO, "taskdesk2_oracle_server.py")
RESET = os.path.join(IO, "reset-taskdesk2.sh")
AFTER_CASE = os.path.join(IO, "after-case-oracle.py")
ORACLE = os.path.join(AUDIT, "scripts", "oracle-sqlite.py")
CLASSIFIER = os.path.join(AUDIT, "remediation", "scripts", "run-cases-after.py")
CLASSIFIER_IMPORTS = os.path.join(AUDIT, "scripts", "run-cases.py")
AGENT = os.path.join(HERE, "agents", "blackbox_agent.py")

# Fixed by reset-taskdesk2.sh and after-case-oracle.py, which are reused unchanged.
DESK_STATE = os.path.join(REPO, "tmp", "rigorrun-audit", "rq-io2-state")
DB = os.path.join(DESK_STATE, "desk.db")
AFTER_CASE_DIR = os.path.join(DESK_STATE, "after-case")
# This harness's own state: project homes, logs, agent traces. Git-ignored.
BB_STATE = os.path.join(REPO, "tmp", "rigorrun-audit", "bbq")

FREEZE = os.path.join(HERE, "freeze.json")
EVIDENCE = os.path.join(HERE, "evidence")
DEV_RUNS = os.path.join(HERE, "dev-runs")
DEV_LOG = os.path.join(HERE, "dev-log.md")
# What a counted setup, freeze, run and aggregate write. Outside the freeze, and the only
# paths allowed to differ from the frozen product commit.
GENERATED = ["evidence", "freeze.json", "results.json", "release-gate.json", "REPORT.md"]
NOT_HARNESS = GENERATED + ["dev-runs", "dev-log.md"]
EXTERNAL_HARNESS = [SERVER, VERIFIER_SERVER, RESET, AFTER_CASE, ORACLE, CLASSIFIER, CLASSIFIER_IMPORTS]

BEHAVIOURS = ["correct", "wrong_value", "wrong_entity", "did_nothing", "extra_note", "second_write"]
EXPECTED = {b: ("PASS" if b == "correct" else "FAIL") for b in BEHAVIOURS}
ATTEMPTS = 3
JOBS = {
    "update": {
        "spec": "specs/bb-update.template.json",
        "goal": 'Mark task 2, "Book venue", as done; change nothing else.',
        "taughtInputs": {"id": 2, "status": "done"},
        "portBase": 47610,
    },
    "create": {
        "spec": "specs/bb-create.template.json",
        "goal": 'Create a task titled "Order badges"; change nothing else.',
        "taughtInputs": {"title": "Order badges"},
        "portBase": 47620,
    },
}
SEED = {
    "tasks": [
        {"id": 1, "title": "Renew domain", "status": "open"},
        {"id": 2, "title": "Book venue", "status": "open"},
        {"id": 3, "title": "Send invoices", "status": "done"},
    ],
    "notes": [
        {"id": 1, "task_id": 1, "body": "Registrar login is in the shared vault", "seen": 0},
        {"id": 2, "task_id": 2, "body": "Shortlist: river hall or old library", "seen": 0},
        {"id": 3, "task_id": 1, "body": "Renewal is due before the end of the month", "seen": 0},
    ],
}
CONNECTOR_SERVER, VERIFIER_NAME = "taskdesk2", "taskdesk2-oracle"
VERIFIER_TOOLS = ("query_tasks", "query_notes")


# ----------------------------------------------------------------------------- small helpers

def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def load(path):
    with open(path) as fh:
        return json.load(fh)


def dump(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(value, fh, indent=2, default=str)
        fh.write("\n")


def sha256(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def rel(path):
    return os.path.relpath(path, REPO)


def guarded_rmtree(path, parent):
    assert os.path.realpath(path).startswith(os.path.realpath(parent) + os.sep), (path, parent)
    shutil.rmtree(path)


def sh(cmd, env=None, timeout=900, cwd=REPO):
    return subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=timeout, cwd=cwd)


def git(*args):
    done = sh(["git", "-C", REPO, *args], timeout=60)
    if done.returncode != 0:
        raise SystemExit(f"git {' '.join(args)} failed: {done.stderr.strip()}")
    return done.stdout


def import_file(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def classifier():
    """remediation/scripts/run-cases-after.py's outcome_label and classify_outcome, imported, not copied."""
    module = import_file("bb_run_cases_after", CLASSIFIER)
    return module.outcome_label, module.classify_outcome


def agent_plans():
    return import_file("bb_blackbox_agent", AGENT)


def port_of(job, behaviour):
    return JOBS[job]["portBase"] + 1 + BEHAVIOURS.index(behaviour)


def endpoint_of(job, behaviour):
    return f"http://127.0.0.1:{port_of(job, behaviour)}/"


def agent_name(job, behaviour):
    return f"bb-{job}-{behaviour}"


# ----------------------------------------------------------------------------- the tree and the freeze

def generated_rel():
    base = rel(HERE)
    return [f"{base}/{g}" for g in GENERATED]


def is_generated(path):
    return any(path == g or path.startswith(g + "/") for g in generated_rel())


def dirty_paths():
    """Uncommitted changes anywhere in the worktree, except what a counted setup/freeze/run/aggregate writes."""
    out = git("status", "--porcelain", "--untracked-files=all")
    paths = []
    for line in out.splitlines():
        path = line[3:].strip().strip('"')
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        if not is_generated(path):
            paths.append(path)
    return paths


def head():
    return git("rev-parse", "HEAD").strip()


def branch():
    return git("rev-parse", "--abbrev-ref", "HEAD").strip()


def changed_since(commit):
    """Paths changed between the frozen product commit and HEAD that are not generated outputs: a product commit."""
    return [p for p in git("diff", "--name-only", commit, "HEAD").splitlines() if p and not is_generated(p)]


def harness_files():
    files = []
    for root, dirs, names in os.walk(HERE):
        rel_root = os.path.relpath(root, HERE)
        dirs[:] = sorted(d for d in dirs if d != "__pycache__" and not (rel_root == "." and d in NOT_HARNESS))
        for name in names:
            if rel_root == "." and name in NOT_HARNESS:
                continue
            files.append(os.path.join(root, name))
    return sorted(rel(p) for p in files + EXTERNAL_HARNESS)


def harness_hashes():
    return {path: sha256(os.path.join(REPO, path)) for path in harness_files()}


# ----------------------------------------------------------------------------- layouts: counted and development

class Layout:
    """Where a counted or a development run keeps what it writes.

    Counted: everything under evidence/ (setup records and the project artefacts, every cell's record with the
    full RigorRun run file, the after-case readings and the agent traces), and results.json, release-gate.json and
    REPORT.md next to this file. Development: only the summaries go to dev-runs/<id>/ (setup.json per project,
    projects.json, run.json, results.json, release-gate.json, REPORT.md); the cells and the setup artefacts stay
    under tmp/rigorrun-audit/bbq/dev/<id>/, git-ignored.
    """

    def __init__(self, dev_id=None):
        self.dev = dev_id is not None
        self.id = dev_id or "counted"
        self.root = os.path.join(DEV_RUNS, dev_id) if self.dev else HERE
        records = self.root if self.dev else EVIDENCE
        self.state = os.path.join(BB_STATE, "dev", dev_id) if self.dev else os.path.join(BB_STATE, "counted")
        self.setup_dir = os.path.join(records, "setup")
        self.cells_dir = os.path.join(self.state, "cells") if self.dev else os.path.join(EVIDENCE, "cells")
        self.projects_path = os.path.join(records, "projects.json")
        self.run_meta_path = os.path.join(records, "run.json")
        self.results_path = os.path.join(self.root, "results.json")
        self.gate_path = os.path.join(self.root, "release-gate.json")
        self.report_path = os.path.join(self.root, "REPORT.md")
        self.homes = os.path.join(self.state, "homes")
        self.calls_log = os.path.join(self.state, "rigorrun-calls.log")
        self.agent_calls_log = os.path.join(self.state, "agent-calls.log")

    def setup_artefacts(self, job):
        return os.path.join(self.state, "setup", job) if self.dev else os.path.join(self.setup_dir, job)

    def traces(self, job, behaviour):
        return os.path.join(self.state, "traces", job, behaviour)

    def cell_dir(self, job, behaviour, n, rerun=False):
        return os.path.join(self.cells_dir, job, behaviour, f"attempt-{n}" + ("-rerun" if rerun else ""))


def latest_dev_id():
    ids = sorted(d for d in os.listdir(DEV_RUNS) if os.path.isdir(os.path.join(DEV_RUNS, d))) if os.path.isdir(DEV_RUNS) else []
    if not ids:
        raise SystemExit("no development run exists yet")
    return ids[-1]


# ----------------------------------------------------------------------------- the desk and the oracle

def reset():
    done = sh(["bash", RESET])
    if done.returncode != 0:
        raise RuntimeError("reset-taskdesk2.sh failed: " + done.stderr[-800:])


def oracle():
    done = sh([sys.executable, "-B", ORACLE, "--db", DB])
    if done.returncode != 0:
        raise RuntimeError("oracle-sqlite.py failed: " + done.stderr[-800:])
    return json.loads(done.stdout)


def rows(reading, table):
    return ((reading or {}).get("tables") or {}).get(table, {}).get("rows")


def is_seed(reading):
    return bool(reading and reading.get("exists")) and set(reading.get("tables", {})) == {"tasks", "notes"} and \
        rows(reading, "tasks") == SEED["tasks"] and rows(reading, "notes") == SEED["notes"]


def changes_from_seed(reading):
    """What differs from the seed, per table, for a person reading the record."""
    out = {}
    for table in ("tasks", "notes"):
        seed = {r["id"]: r for r in SEED[table]}
        now = {r["id"]: r for r in (rows(reading, table) or [])}
        out[table] = {
            "created": [now[i] for i in sorted(set(now) - set(seed))],
            "changed": [{"before": seed[i], "after": now[i]} for i in sorted(set(now) & set(seed)) if now[i] != seed[i]],
            "deleted": [seed[i] for i in sorted(set(seed) - set(now))],
        }
    return out


def oracle_label(job, reading):
    """PASS if the reading equals the job's expected final state (PREREGISTRATION.md, Jobs), else FAIL, with why."""
    if not reading or not reading.get("exists") or set(reading.get("tables", {})) != {"tasks", "notes"}:
        return "FAIL", ["the desk database is missing or does not hold exactly the tables tasks and notes"]
    problems = []
    if rows(reading, "notes") != SEED["notes"]:
        problems.append("notes differ from the seed")
    tasks = rows(reading, "tasks")
    if job == "update":
        expected = [dict(t, status="done") if t["id"] == 2 else t for t in SEED["tasks"]]
        if tasks != expected:
            problems.append("tasks are not the seed with task 2 done")
    else:
        seed = {t["id"]: t for t in SEED["tasks"]}
        by_id = {t["id"]: t for t in tasks}
        if any(by_id.get(i) != t for i, t in seed.items()):
            problems.append("a seeded task changed or is missing")
        new = [t for t in tasks if t["id"] not in seed]
        if len(new) != 1:
            problems.append(f"{len(new)} new task(s), not exactly one")
        elif new[0]["title"] != "Order badges" or new[0]["status"] != "open":
            problems.append(f"the new task is {new[0]}, not 'Order badges' open")
    return ("PASS" if not problems else "FAIL"), problems


# ----------------------------------------------------------------------------- the agents

def port_free(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


class Agents:
    """The twelve (or fewer) agent servers, started before and stopped after."""

    def __init__(self, layout, jobs):
        self.layout, self.jobs, self.procs = layout, jobs, []

    def __enter__(self):
        taken = [port_of(j, b) for j in self.jobs for b in BEHAVIOURS if not port_free(port_of(j, b))]
        if taken:
            raise SystemExit(f"REFUSING: ports {taken} are in use; the agents' addresses are fixed in the projects")
        logs = os.path.join(self.layout.state, "agent-logs")
        os.makedirs(logs, exist_ok=True)
        for job in self.jobs:
            for behaviour in BEHAVIOURS:
                log = open(os.path.join(logs, f"{agent_name(job, behaviour)}.log"), "a")
                cmd = [sys.executable, "-B", AGENT, "--job", job, "--behaviour", behaviour, "--port", str(port_of(job, behaviour)),
                       "--server", SERVER, "--db", DB, "--python", sys.executable,
                       "--calls-log", self.layout.agent_calls_log, "--traces", self.layout.traces(job, behaviour)]
                self.procs.append((job, behaviour, subprocess.Popen(cmd, stdout=log, stderr=log, cwd=REPO), log))
        deadline = time.time() + 20
        for job, behaviour, proc, _ in self.procs:
            while True:
                try:
                    with urllib.request.urlopen(endpoint_of(job, behaviour), timeout=2) as response:
                        answer = json.loads(response.read())
                    if answer.get("job") != job or answer.get("behaviour") != behaviour:
                        raise SystemExit(f"REFUSING: {endpoint_of(job, behaviour)} answers as {answer}")
                    break
                except (OSError, ValueError):
                    if proc.poll() is not None or time.time() > deadline:
                        self.__exit__(None, None, None)
                        raise SystemExit(f"agent {agent_name(job, behaviour)} did not come up (see {rel(logs)})")
                    time.sleep(0.1)
        return self

    def __exit__(self, *_):
        for _, _, proc, log in self.procs:
            if proc.poll() is None:
                proc.terminate()
        for _, _, proc, log in self.procs:
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
            log.close()
        self.procs = []

    def alive(self, job, behaviour):
        return all(p.poll() is None for j, b, p, _ in self.procs if (j, b) == (job, behaviour))


# ----------------------------------------------------------------------------- the CLI

def cli(args, home, timeout=900):
    env = dict(os.environ, NO_COLOR="1", RIGORRUN_SECRET_BACKEND="file", RIGORRUN_HOME=home)
    return sh(["pnpm", "--silent", "rigorrun", *args], env=env, timeout=timeout)


def render(job, layout):
    with open(os.path.join(HERE, JOBS[job]["spec"])) as fh:
        text = fh.read()
    values = {"{PYTHON}": sys.executable, "{IO}": IO, "{STATE}": DESK_STATE, "{CALLS_LOG}": layout.calls_log}
    values.update({"{ENDPOINT_" + b.upper() + "}": endpoint_of(job, b) for b in BEHAVIOURS})
    for key, value in values.items():
        text = text.replace(key, value)
    left = sorted(set(re.findall(r"\{[A-Z_]+\}", text)))
    if left:
        raise SystemExit(f"REFUSING: {JOBS[job]['spec']} has placeholders this script does not fill: {left}")
    return json.loads(text)


def count_lines(path):
    if not os.path.exists(path):
        return 0
    with open(path) as fh:
        return sum(1 for _ in fh)


def lines_since(path, offset):
    if not os.path.exists(path):
        return []
    with open(path) as fh:
        return [json.loads(line) for line in fh.readlines()[offset:] if line.strip()]


# ----------------------------------------------------------------------------- setup

def setup_project(job, layout):
    reset()
    home = os.path.join(layout.homes, job)
    if os.path.exists(home):
        guarded_rmtree(home, layout.homes)
    os.makedirs(home)
    spec = render(job, layout)
    spec_path = os.path.join(home, "spec.json")
    dump(spec_path, spec)
    offset = count_lines(layout.calls_log)
    started = time.time()
    done = cli(["setup", spec_path, "--json"], home)
    out_dir = os.path.join(layout.setup_dir, job)
    artefacts = layout.setup_artefacts(job)
    for d, parent in ((out_dir, layout.setup_dir), (artefacts, os.path.dirname(artefacts))):
        if os.path.exists(d):
            guarded_rmtree(d, parent)
        os.makedirs(d)
    with open(os.path.join(artefacts, "setup.stdout.txt"), "w") as fh:
        fh.write(done.stdout + "\n--- stderr ---\n" + done.stderr[-6000:])
    try:
        summary = json.loads(done.stdout[done.stdout.index("{"):])
    except ValueError:
        summary = None
    record = {
        "job": job, "spec": JOBS[job]["spec"], "exit": done.returncode, "seconds": round(time.time() - started, 2),
        "productCommit": head(), "branch": branch(), "dirtyPaths": dirty_paths(), "at": now_iso(),
        "summary": summary, "callsDuringSetup": len(lines_since(layout.calls_log, offset)), "artefacts": rel(artefacts),
        "errorTail": done.stderr.strip().splitlines()[-5:] if done.returncode != 0 else [],
    }
    project_id = (summary or {}).get("projectId")
    project_dir = os.path.join(home, "projects", project_id) if project_id else None
    if project_dir and os.path.isdir(project_dir):
        for name in sorted(os.listdir(project_dir)):
            path = os.path.join(project_dir, name)
            if os.path.isfile(path) and name.endswith(".json") and "secret" not in name:
                shutil.copy(path, os.path.join(artefacts, name))
    entry = None
    benchmark_path = os.path.join(project_dir, "benchmark.json") if project_dir else None
    if benchmark_path and os.path.exists(benchmark_path):
        benchmark = load(benchmark_path)
        project = load(os.path.join(project_dir, "project.json"))
        cases = benchmark["cases"]
        happy = [(i, c) for i, c in enumerate(cases) if c["category"] == "happy_path"]
        record["suiteShape"] = [c["category"] for c in cases]
        record["caseIds"] = [c["id"] for c in cases]
        record["checks"] = {c["id"]: [{"id": ch.get("id"), "kind": ch.get("kind"), "severity": ch.get("severity"), "source": ch.get("verificationSource")} for ch in c.get("checks", [])] for c in cases}
        validity = []
        if len(happy) != 1:
            validity.append(f"{len(happy)} happy_path case(s), not exactly one")
        else:
            index, case = happy[0]
            task = case.get("task") or {}
            record["happyPath"] = {"id": case["id"], "index": index, "instruction": task.get("instruction"), "inputs": task.get("inputs")}
            if JOBS[job]["goal"] not in (task.get("instruction") or ""):
                validity.append("the happy_path instruction does not carry the taught job")
            if task.get("inputs") != JOBS[job]["taughtInputs"]:
                validity.append(f"the happy_path inputs {task.get('inputs')} are not the taught arguments {JOBS[job]['taughtInputs']}")
            if index != 0:
                validity.append(f"the happy_path case is at index {index}: it would not start from the reset")
        agents = {a["name"]: a for a in project.get("agents", [])}
        missing = [agent_name(job, b) for b in BEHAVIOURS if agent_name(job, b) not in agents]
        unprobed = [n for n, a in agents.items() if not a.get("lastProbeOk")]
        if missing:
            validity.append(f"agents not registered: {missing}")
        if unprobed:
            validity.append(f"agents that did not answer the probe: {unprobed}")
        if any(a.get("kind") != "blackbox" for a in agents.values()):
            validity.append("an agent is not a black-box agent")
        record["agents"] = {n: {"id": a.get("id"), "kind": a.get("kind"), "endpoint": a.get("endpoint"), "claimPath": a.get("claimPath"), "completion": a.get("completion"), "lastProbeOk": a.get("lastProbeOk")} for n, a in agents.items()}
        record["validity"] = validity
        record["happyPathValid"] = not validity
        if not validity:
            entry = {
                "job": job, "home": rel(home), "projectId": project_id, "happyPathCaseId": happy[0][1]["id"],
                "happyPathIndex": happy[0][0], "suiteShape": record["suiteShape"], "caseIds": record["caseIds"],
                "benchmarkSha256": sha256(benchmark_path), "productCommit": record["productCommit"],
                "agents": {b: agents[agent_name(job, b)]["id"] for b in BEHAVIOURS},
            }
    else:
        record["happyPathValid"] = False
        record["validity"] = ["the setup produced no benchmark"]
    record["ok"] = done.returncode == 0 and entry is not None
    dump(os.path.join(out_dir, "setup.json"), record)
    print(f"setup {job}: exit={done.returncode} ok={record['ok']} project={project_id} shape={record.get('suiteShape')} "
          f"happy={(record.get('happyPath') or {}).get('id')} problems={record.get('validity')} ({record['seconds']}s)", flush=True)
    return entry


def do_setup(layout, jobs):
    os.makedirs(layout.state, exist_ok=True)
    projects = load(layout.projects_path) if os.path.exists(layout.projects_path) else {}
    with Agents(layout, jobs):
        for job in jobs:
            entry = setup_project(job, layout)
            if entry:
                projects[job] = entry
            else:
                projects.pop(job, None)
            dump(layout.projects_path, projects)
    return projects


def cmd_setup(args):
    if args.dev:
        raise SystemExit("a development setup is part of `run --dev`")
    if os.path.exists(FREEZE):
        raise SystemExit("REFUSING: freeze.json exists; the projects it froze must not be replaced")
    layout = Layout()
    if os.path.isdir(layout.cells_dir) and os.listdir(layout.cells_dir):
        raise SystemExit("REFUSING: counted cells exist under evidence/cells")
    projects = do_setup(layout, list(JOBS))
    if set(projects) != set(JOBS):
        raise SystemExit(f"setup did not produce a valid project for {sorted(set(JOBS) - set(projects))}; see evidence/setup/*/setup.json. The stage is invalid as pre-registered.")


# ----------------------------------------------------------------------------- freeze

def cmd_freeze(_):
    if os.path.exists(FREEZE):
        raise SystemExit("freeze.json exists; this qualification is already frozen")
    layout = Layout()
    if os.path.isdir(layout.cells_dir) and os.listdir(layout.cells_dir):
        raise SystemExit("REFUSING: counted cells exist; a freeze after a counted run is not a freeze before it")
    dirty = dirty_paths()
    if dirty:
        raise SystemExit(f"REFUSING: the worktree has uncommitted changes outside this qualification's outputs: {dirty[:20]}")
    caches = sorted(rel(os.path.join(r, d)) for r, ds, _ in os.walk(HERE) for d in ds if d == "__pycache__")
    if caches:
        raise SystemExit(f"REFUSING: remove {caches} first")
    if not os.access(AFTER_CASE, os.X_OK):
        raise SystemExit("REFUSING: after-case-oracle.py is not executable; rigorrun starts --after-case programs directly")
    if not os.path.exists(layout.projects_path):
        raise SystemExit("REFUSING: no counted setup; run `run_bb.py setup` first (the freeze records each project's happy_path case id)")
    projects = load(layout.projects_path)
    commit = head()
    problems = []
    for job in JOBS:
        entry = projects.get(job)
        if not entry:
            problems.append(f"{job}: no valid project")
            continue
        since_setup = changed_since(entry["productCommit"])
        if since_setup:
            problems.append(f"{job}: set up at {entry['productCommit']}; commits since then change {since_setup[:10]}")
        benchmark = os.path.join(REPO, entry["home"], "projects", entry["projectId"], "benchmark.json")
        if not os.path.exists(benchmark) or sha256(benchmark) != entry["benchmarkSha256"]:
            problems.append(f"{job}: the suite differs from the one recorded at setup")
    if problems:
        raise SystemExit("REFUSING: " + "; ".join(problems))
    if branch() != "release/0.4.0":
        print(f"note: HEAD is on {branch()}, not release/0.4.0; the pre-registration qualifies the release/0.4.0 commit", flush=True)
    files = harness_hashes()
    dump(FREEZE, {
        "note": "Written before the counted run (PREREGISTRATION.md, AMENDMENT-1.md). run_bb.py run refuses when a harness file differs, "
                "when a commit since productCommit changes anything outside this qualification's generated outputs, "
                "or when a project's suite or happy_path case differs.",
        "frozenAt": now_iso(),
        "productCommit": commit,
        "branch": branch(),
        "harnessFiles": files,
        "projects": {job: {"projectId": e["projectId"], "home": e["home"], "happyPathCaseId": e["happyPathCaseId"],
                           "happyPathIndex": e["happyPathIndex"], "suiteShape": e["suiteShape"], "benchmarkSha256": e["benchmarkSha256"],
                           "agents": e["agents"]} for job, e in projects.items()},
        "cells": len(JOBS) * len(BEHAVIOURS) * ATTEMPTS,
    })
    print(f"frozen: product {commit} on {branch()}, {len(files)} harness files, happy_path " +
          ", ".join(f"{j}={e['happyPathCaseId']}" for j, e in projects.items()), flush=True)


def verify_frozen():
    """Everything the counted run stands on, as frozen. Returns the freeze."""
    if not os.path.exists(FREEZE):
        raise SystemExit("REFUSING: freeze.json is missing; the counted run happens only after `run_bb.py freeze`")
    freeze = load(FREEZE)
    now = harness_hashes()
    if now != freeze["harnessFiles"]:
        changed = sorted(set(now) ^ set(freeze["harnessFiles"]) | {f for f in now if f in freeze["harnessFiles"] and now[f] != freeze["harnessFiles"][f]})
        raise SystemExit(f"REFUSING: harness files differ from freeze.json: {changed}")
    product = changed_since(freeze["productCommit"])
    if product:
        raise SystemExit(f"REFUSING: commits since the frozen product commit {freeze['productCommit']} change {product[:20]}")
    dirty = dirty_paths()
    if dirty:
        raise SystemExit(f"REFUSING: uncommitted changes outside this qualification's outputs: {dirty[:20]}")
    projects = load(Layout().projects_path)
    for job, frozen in freeze["projects"].items():
        entry = projects.get(job) or {}
        benchmark = os.path.join(REPO, frozen["home"], "projects", frozen["projectId"], "benchmark.json")
        if entry.get("happyPathCaseId") != frozen["happyPathCaseId"] or not os.path.exists(benchmark) or sha256(benchmark) != frozen["benchmarkSha256"]:
            raise SystemExit(f"REFUSING: the {job} project or its suite differs from freeze.json")
    return freeze


# ----------------------------------------------------------------------------- one attempt

def gate5_fields(run, result):
    limits = (run or {}).get("limits") or []
    no_trace = [l for l in limits if l.get("id") == "no_call_trace"]
    assertions = (result or {}).get("assertions") or []
    event = [a for a in assertions if a.get("verificationSource") == "EVENT"]
    not_made = [{"id": a.get("assertionId"), "message": a.get("message")} for a in event if a.get("status") == "UNVERIFIABLE" and a.get("blocking") is False]
    made = [{"id": a.get("assertionId"), "status": a.get("status"), "blocking": a.get("blocking")} for a in event if not (a.get("status") == "UNVERIFIABLE" and a.get("blocking") is False)]
    observation = (result or {}).get("observation")
    independence = (result or {}).get("evidenceIndependence")
    return {
        "observation": observation,
        "evidenceIndependence": independence,
        "runLimitNoCallTrace": no_trace[0].get("limit") if no_trace else None,
        "callOrderChecks": [a.get("assertionId") for a in event],
        "callOrderChecksNotMade": not_made,
        "callOrderChecksMade": made,
        "stateChecks": [a.get("assertionId") for a in assertions if a.get("verificationSource") != "EVENT"],
        "holds": observation == "state-only" and independence == "INDEPENDENT" and bool(no_trace) and not made,
    }


def check_trace(plans, job, behaviour, trace):
    """The agent made exactly its pre-registered writes for the qualified case, and each was accepted."""
    if not trace:
        return ["no agent trace for the qualified case"]
    problems = list(trace.get("problems") or [])
    planned = plans.plan_of(job, behaviour)
    made = [{"tool": c.get("tool"), "args": c.get("args")} for c in trace.get("calls", [])]
    if made != planned:
        problems.append(f"the agent's calls {made} are not its plan {planned}")
    problems += [f"{c.get('tool')} was not accepted" for c in trace.get("calls", []) if not c.get("ok")]
    if trace.get("answer") != {"status": "done", "message": "Done."}:
        problems.append(f"the agent answered {trace.get('answer')}")
    return problems


def run_attempt(layout, projects, agents, job, behaviour, n, rerun, labels):
    outcome_label, classify_outcome = labels
    plans = agent_plans()
    entry = projects[job]
    home = os.path.join(REPO, entry["home"])
    project_id = entry["projectId"]
    record_dir = heavy = layout.cell_dir(job, behaviour, n, rerun)
    if os.path.exists(record_dir):
        guarded_rmtree(record_dir, layout.cells_dir)
    os.makedirs(record_dir)
    harness = []
    traces_dir = layout.traces(job, behaviour)
    if os.path.isdir(traces_dir):
        guarded_rmtree(traces_dir, layout.state)
    if os.path.exists(AFTER_CASE_DIR):
        guarded_rmtree(AFTER_CASE_DIR, DESK_STATE)
    if not agents.alive(job, behaviour):
        harness.append("the agent server is not running")

    reset()
    calls_offset = count_lines(layout.calls_log)
    agent_offset = count_lines(layout.agent_calls_log)
    before = oracle()
    if not is_seed(before):
        harness.append("the reading after reset-taskdesk2.sh is not the seed")
    runs_dir = os.path.join(home, "projects", project_id, "runs")
    existing = set(os.listdir(runs_dir)) if os.path.isdir(runs_dir) else set()
    started = time.time()
    done = cli(["run", "--project", project_id, "--agent", agent_name(job, behaviour), "--after-case", AFTER_CASE, "--json"], home)
    seconds = round(time.time() - started, 2)
    after = oracle()
    fresh = sorted(set(os.listdir(runs_dir)) - existing) if os.path.isdir(runs_dir) else []
    run = load(os.path.join(runs_dir, fresh[-1])) if len(fresh) == 1 else None
    # With --json, stdout is the run itself; it is kept only when no run file was written.
    with open(os.path.join(heavy, "rigorrun-run.output.txt"), "w") as fh:
        fh.write(("" if run else done.stdout + "\n") + "--- stderr ---\n" + done.stderr[-6000:])
    if len(fresh) != 1:
        harness.append(f"{len(fresh)} new run file(s), not one")
    if run:
        shutil.copy(os.path.join(runs_dir, fresh[-1]), os.path.join(heavy, "rigorrun-run.json"))
    readings = sorted((load(p) for p in glob.glob(os.path.join(AFTER_CASE_DIR, "*.json"))), key=lambda r: r.get("caseIndex", -1))
    dump(os.path.join(heavy, "after-case-readings.json"), readings)
    traces = [load(p) for p in sorted(glob.glob(os.path.join(traces_dir, "*.json")))]
    dump(os.path.join(heavy, "agent-traces.json"), traces)
    calls = lines_since(layout.calls_log, calls_offset)
    agent_calls = lines_since(layout.agent_calls_log, agent_offset)

    results = (run or {}).get("caseResults") or []
    happy_id = entry["happyPathCaseId"]
    matching = [i for i, r in enumerate(results) if r.get("caseId") == happy_id]
    index = matching[0] if len(matching) == 1 else None
    result = results[index] if index is not None else None
    if run and index is None:
        harness.append(f"{len(matching)} result(s) for the qualified case {happy_id} in the run")
    if result and result.get("category") != "happy_path":
        harness.append(f"the qualified case ran as {result.get('category')}")
    if index not in (None, 0):
        harness.append(f"the qualified case ran at index {index}, so it did not start from the reset")
    reading = next((r for r in readings if r.get("caseIndex") == index and r.get("caseId") == happy_id), None) if index is not None else None
    if index is not None and reading is None:
        harness.append(f"no after-case reading for the qualified case (index {index})")
    case_after = (reading or {}).get("snapshot")
    oracle_verdict, oracle_problems = oracle_label(job, case_after) if case_after else (None, [])
    whole_run_verdict, _ = oracle_label(job, after)
    trace = next((t for t in traces if t.get("caseId") == happy_id), None)
    trace_problems = check_trace(plans, job, behaviour, trace)
    if trace_problems:
        harness.append("agent: " + "; ".join(trace_problems))
    if done.returncode not in (0, 1):
        harness.append(f"rigorrun exited {done.returncode}")

    outcome = (result or {}).get("outcome")
    label = "HARNESS_FAILURE" if harness else outcome_label({"cases": [{"category": "happy_path", "outcome": outcome}]})
    if oracle_verdict is None and label != "HARNESS_FAILURE":
        harness.append("no oracle label for the qualified case")
        label = "HARNESS_FAILURE"
    classification = classify_outcome(oracle_verdict, label)
    connector_calls = [c for c in calls if c.get("server") == CONNECTOR_SERVER]
    verifier_calls = [c for c in calls if c.get("server") == VERIFIER_NAME]
    answered = {tool: len([c for c in verifier_calls if c.get("tool") == tool and c.get("answered")]) for tool in VERIFIER_TOOLS}
    record = {
        "job": job, "agent": agent_name(job, behaviour), "behaviour": behaviour, "attempt": n, "rerun": rerun,
        "mode": "development" if layout.dev else "counted", "devRun": layout.id if layout.dev else None,
        "productCommit": head(), "at": now_iso(), "seconds": seconds,
        "expected": EXPECTED[behaviour],
        "oracleVerdict": oracle_verdict, "oracleProblems": oracle_problems,
        "oracleMatchesExpected": oracle_verdict == EXPECTED[behaviour],
        "rigorrunOutcome": outcome, "label": label, "classification": classification,
        "harnessFailures": harness,
        "gate5": gate5_fields(run, result),
        "selection": {"happyPathCaseId": happy_id, "index": index, "runCaseIds": [r.get("caseId") for r in results]},
        "rigorrun": {
            "exit": done.returncode, "runId": (run or {}).get("runId"), "verification": (run or {}).get("verification"),
            "limits": [l.get("id") for l in (run or {}).get("limits") or []],
            "outcomeReason": (result or {}).get("outcomeReason"), "agentReport": (result or {}).get("agentReport"),
            "baseline": (result or {}).get("baseline"), "missingEvidence": (result or {}).get("missingEvidence"),
            "steps": len((result or {}).get("steps") or []), "actions": len((result or {}).get("actions") or []),
            "assertions": [{"id": a.get("assertionId"), "kind": a.get("kind"), "source": a.get("verificationSource"), "status": a.get("status"),
                            "blocking": a.get("blocking"), "message": a.get("message")} for a in (result or {}).get("assertions") or []],
            "otherCases": [{"caseId": r.get("caseId"), "category": r.get("category"), "outcome": r.get("outcome")} for i, r in enumerate(results) if i != index],
            "errorTail": done.stderr.strip().splitlines()[-3:] if done.returncode not in (0, 1) else [],
        },
        "state": {
            "beforeIsSeed": is_seed(before),
            "qualifiedCaseChangesFromSeed": changes_from_seed(case_after) if case_after else None,
            "wholeRunOracleVerdict": whole_run_verdict,
            "wholeRunChangesFromSeed": changes_from_seed(after),
        },
        "agentTrace": {"caseId": (trace or {}).get("caseId"), "calls": (trace or {}).get("calls"), "problems": trace_problems,
                       "tasksReceived": [t.get("caseId") for t in traces]},
        "serverCalls": {
            "rigorrunConnectorCalls": [{"tool": c.get("tool"), "args": c.get("args")} for c in connector_calls],
            "verifierAnswered": answered,
            "agentConnectionCalls": [{"tool": c.get("tool"), "args": c.get("args")} for c in agent_calls],
        },
        # Supporting evidence for gate 5's "decided only on verifier reads": RigorRun's own connection to the
        # system made no tool call, and the verifier answered both nominated reads at both ends.
        "verifierOnly": not connector_calls and all(v >= 2 for v in answered.values()),
        "evidenceDir": rel(heavy),
    }
    dump(os.path.join(record_dir, "attempt.json"), record)
    print(f"{job:6} {behaviour:12} attempt {n}{' rerun' if rerun else ''}: oracle={oracle_verdict} expected={EXPECTED[behaviour]} "
          f"rigorrun={outcome} -> {classification} observation={record['gate5']['observation']} label={record['gate5']['evidenceIndependence']} "
          f"gate5={record['gate5']['holds']} verifierOnly={record['verifierOnly']} exit={done.returncode}"
          f"{' HARNESS: ' + '; '.join(harness) if harness else ''} ({seconds}s)", flush=True)
    return record


# Cells that reached no verdict for a reason other than RigorRun abstaining. The agents are this harness's own
# servers, built to always answer, so an agent failure or time-out is the harness's, and is treated as one:
# re-run once (disclosed), and counted under gate 3 if it persists.
HARNESS_LIKE = ("NOT_SCORED_HARNESS_FAILURE", "NOT_SCORED_NOT_RUN", "NOT_SCORED_UNKNOWN", "TIMED_OUT", "AGENT_FAILURE")


def is_harness_failure(record):
    return record["classification"] in HARNESS_LIKE


def attempt(layout, projects, agents, job, behaviour, n, rerun, labels):
    """One attempt; anything that stops the harness itself is recorded as a harness failure, never dropped."""
    try:
        return run_attempt(layout, projects, agents, job, behaviour, n, rerun, labels)
    except Exception as error:  # noqa: BLE001 - recorded as the cell's harness failure
        record_dir = layout.cell_dir(job, behaviour, n, rerun)
        os.makedirs(record_dir, exist_ok=True)
        record = {
            "job": job, "agent": agent_name(job, behaviour), "behaviour": behaviour, "attempt": n, "rerun": rerun,
            "mode": "development" if layout.dev else "counted", "devRun": layout.id if layout.dev else None,
            "productCommit": head(), "at": now_iso(), "seconds": None, "expected": EXPECTED[behaviour],
            "oracleVerdict": None, "oracleProblems": [], "oracleMatchesExpected": False,
            "rigorrunOutcome": None, "label": "HARNESS_FAILURE", "classification": "NOT_SCORED_HARNESS_FAILURE",
            "harnessFailures": [f"the harness stopped: {type(error).__name__}: {error}"],
            "gate5": {"observation": None, "evidenceIndependence": None, "runLimitNoCallTrace": None, "callOrderChecks": [],
                      "callOrderChecksNotMade": [], "callOrderChecksMade": [], "stateChecks": [], "holds": False},
            "rigorrun": {"outcomeReason": None}, "verifierOnly": False, "evidenceDir": rel(record_dir),
        }
        dump(os.path.join(record_dir, "attempt.json"), record)
        print(f"{job:6} {behaviour:12} attempt {n}{' rerun' if rerun else ''}: HARNESS: {record['harnessFailures'][0]}", flush=True)
        return record


def run_cells(layout, projects, cells, resume=False):
    labels = classifier()
    jobs = sorted({job for job, _ in cells}, key=list(JOBS).index)
    meta = {"mode": "development" if layout.dev else "counted", "id": layout.id, "startedAt": now_iso(), "productCommitAtStart": head(),
            "branch": branch(), "dirtyPathsAtStart": dirty_paths(), "cells": [f"{j}:{b}" for j, b in cells], "reruns": [], "resumed": resume}
    started = time.time()
    with Agents(layout, jobs) as agents:
        for job, behaviour in cells:
            for n in range(1, ATTEMPTS + 1):
                if resume and os.path.exists(os.path.join(layout.cell_dir(job, behaviour, n), "attempt.json")):
                    continue
                record = attempt(layout, projects, agents, job, behaviour, n, False, labels)
                if is_harness_failure(record):
                    # PREREGISTRATION.md: a harness failure may be re-run once, and the re-run is disclosed.
                    meta["reruns"].append({"cell": f"{job}:{behaviour}:{n}", "first": record["harnessFailures"] or [record["classification"]]})
                    attempt(layout, projects, agents, job, behaviour, n, True, labels)
    meta["finishedAt"] = now_iso()
    meta["seconds"] = round(time.time() - started, 1)
    meta["productCommitAtEnd"] = head()
    dump(layout.run_meta_path, meta)
    return meta


def parse_only(only):
    cells = [(j, b) for j in JOBS for b in BEHAVIOURS]
    if not only:
        return cells
    keep = []
    for job, behaviour in cells:
        if any(o in (job, f"{job}:{behaviour}") for o in only):
            keep.append((job, behaviour))
    if not keep:
        raise SystemExit(f"--only {only} selects no cell")
    return keep


def cmd_run(args):
    if args.dev:
        if os.path.exists(FREEZE):
            raise SystemExit("REFUSING: freeze.json exists; AMENDMENT-1 allows development runs only before the freeze")
        dev_id = "dev-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        layout = Layout(dev_id)
        cells = parse_only(args.only)
        jobs = sorted({j for j, _ in cells}, key=list(JOBS).index)
        print(f"development run {dev_id}: HEAD {head()} on {branch()}, {len(cells) * ATTEMPTS} cell(s)", flush=True)
        projects = do_setup(layout, jobs)
        runnable = [(j, b) for j, b in cells if j in projects]
        meta = run_cells(layout, projects, runnable) if runnable else {"seconds": 0, "reruns": []}
        summary = aggregate(layout)
        append_dev_log(layout, cells, summary, meta, args.note)
        return
    if args.only:
        raise SystemExit("REFUSING: --only is for development runs; the counted run is all 36 cells")
    freeze = verify_frozen()
    layout = Layout()
    if os.path.isdir(layout.cells_dir) and os.listdir(layout.cells_dir) and not args.resume:
        raise SystemExit("REFUSING: counted cells exist; the counted run happens once (use --resume only to finish a run that was interrupted)")
    projects = load(layout.projects_path)
    meta = run_cells(layout, projects, parse_only(None), resume=args.resume)
    meta["freeze"] = {"productCommit": freeze["productCommit"], "frozenAt": freeze["frozenAt"]}
    meta["productChangedDuringRun"] = changed_since(freeze["productCommit"])
    dump(layout.run_meta_path, meta)
    if meta["productChangedDuringRun"]:
        print(f"WARNING: a product commit landed during the counted run: {meta['productChangedDuringRun'][:10]}", flush=True)


# ----------------------------------------------------------------------------- aggregate

def final_records(layout):
    """Per cell: the attempt that counts (the disclosed re-run if there was one), and the first one if re-run."""
    cells = {}
    for job in JOBS:
        for behaviour in BEHAVIOURS:
            for n in range(1, ATTEMPTS + 1):
                first = os.path.join(layout.cell_dir(job, behaviour, n), "attempt.json")
                again = os.path.join(layout.cell_dir(job, behaviour, n, True), "attempt.json")
                if os.path.exists(first):
                    cells[(job, behaviour, n)] = {"first": load(first), "rerun": load(again) if os.path.exists(again) else None}
    return cells


def aggregate(layout):
    cells = final_records(layout)
    meta = load(layout.run_meta_path) if os.path.exists(layout.run_meta_path) else {}
    projects = load(layout.projects_path) if os.path.exists(layout.projects_path) else {}
    freeze = load(FREEZE) if (not layout.dev and os.path.exists(FREEZE)) else None
    rows = []
    for job in JOBS:
        for behaviour in BEHAVIOURS:
            for n in range(1, ATTEMPTS + 1):
                cell = cells.get((job, behaviour, n))
                if not cell:
                    rows.append({"job": job, "agent": agent_name(job, behaviour), "behaviour": behaviour, "attempt": n, "present": False,
                                 "expected": EXPECTED[behaviour], "classification": "MISSING"})
                    continue
                r = cell["rerun"] or cell["first"]
                rows.append({
                    "job": job, "agent": r["agent"], "behaviour": behaviour, "attempt": n, "present": True,
                    "rerun": cell["rerun"] is not None, "firstAttemptHarnessFailures": cell["first"]["harnessFailures"] if cell["rerun"] else None,
                    "expected": r["expected"], "oracleVerdict": r["oracleVerdict"], "oracleMatchesExpected": r["oracleMatchesExpected"],
                    "rigorrunOutcome": r["rigorrunOutcome"], "label": r["label"], "classification": r["classification"],
                    "harnessFailures": r["harnessFailures"], "gate5": r["gate5"], "verifierOnly": r["verifierOnly"],
                    "productCommit": r["productCommit"], "seconds": r["seconds"], "outcomeReason": r["rigorrun"]["outcomeReason"],
                    "record": rel(os.path.join(layout.cell_dir(job, behaviour, n, cell["rerun"] is not None), "attempt.json")),
                })
    present = [r for r in rows if r["present"]]
    count = lambda name: len([r for r in rows if r["classification"] == name])
    # Gate 3: ABSTAIN and HARNESS_FAILURE, after the one permitted re-run. A cell with no verdict for any other
    # reason (not run, unknown, missing, or an agent failure or time-out: the agents are this harness's own
    # servers, built to always answer) is counted with the harness failures, never left out.
    harness_like = list(HARNESS_LIKE) + ["MISSING"]
    with_verdict = [r for r in present if r["rigorrunOutcome"] is not None and r["label"] != "HARNESS_FAILURE"]
    gates = {
        "1_FN_is_0": {"FN": count("FALSE_NEGATIVE"), "cells": [cell_id(r) for r in rows if r["classification"] == "FALSE_NEGATIVE"]},
        "2_FP_is_0": {"FP": count("FALSE_POSITIVE"), "cells": [cell_id(r) for r in rows if r["classification"] == "FALSE_POSITIVE"]},
        "3_no_abstain_no_harness_failure": {
            "ABSTAIN": count("NOT_SCORED_ABSTAIN"),
            "HARNESS_FAILURE": sum(count(c) for c in harness_like),
            "byKind": {c: count(c) for c in ["NOT_SCORED_ABSTAIN"] + harness_like if count(c)},
            "cells": [cell_id(r) for r in rows if r["classification"] in ["NOT_SCORED_ABSTAIN"] + harness_like],
            "reruns": [cell_id(r) for r in rows if r.get("rerun")],
        },
        "4_oracle_equals_expected": {"mismatches": [cell_id(r) for r in rows if not r.get("oracleMatchesExpected")]},
        "5_state_only_independent_unmade_call_order_listed": {
            "verdicts": len(with_verdict),
            "failing": [cell_id(r) for r in with_verdict if not r["gate5"]["holds"]],
            "observations": sorted({str(r["gate5"]["observation"]) for r in with_verdict}),
            "evidenceIndependence": sorted({str(r["gate5"]["evidenceIndependence"]) for r in with_verdict}),
            "callOrderChecksNotMade": sorted({c["id"] for r in with_verdict for c in r["gate5"]["callOrderChecksNotMade"]}),
            "callOrderChecksMade": sorted({c["id"] for r in with_verdict for c in r["gate5"]["callOrderChecksMade"]}),
            "runLimitNoCallTraceOnEvery": all(r["gate5"]["runLimitNoCallTrace"] for r in with_verdict) if with_verdict else False,
        },
    }
    gates["1_FN_is_0"]["holds"] = gates["1_FN_is_0"]["FN"] == 0
    gates["2_FP_is_0"]["holds"] = gates["2_FP_is_0"]["FP"] == 0
    g3 = gates["3_no_abstain_no_harness_failure"]
    g3["holds"] = g3["ABSTAIN"] == 0 and g3["HARNESS_FAILURE"] == 0
    gates["4_oracle_equals_expected"]["holds"] = not gates["4_oracle_equals_expected"]["mismatches"]
    g5 = gates["5_state_only_independent_unmade_call_order_listed"]
    g5["holds"] = bool(with_verdict) and not g5["failing"]
    complete = len(present) == len(JOBS) * len(BEHAVIOURS) * ATTEMPTS
    commits = sorted({r["productCommit"] for r in present})
    product_ok = True
    if freeze:
        product_ok = commits == [freeze["productCommit"]] and not meta.get("productChangedDuringRun")
    go = complete and product_ok and all(g["holds"] for g in gates.values())
    summary = {
        "mode": "development" if layout.dev else "counted", "id": layout.id,
        "outcome": "GO" if go else "NO_GO",
        "stageValid": gates["4_oracle_equals_expected"]["holds"] and set(projects) == set(JOBS),
        "cells": {"planned": len(JOBS) * len(BEHAVIOURS) * ATTEMPTS, "present": len(present), "complete": complete},
        "classification": {c: count(c) for c in sorted({r["classification"] for r in rows})},
        "gates": gates,
        "productCommits": commits, "freeze": {"productCommit": freeze["productCommit"], "frozenAt": freeze["frozenAt"]} if freeze else None,
        "productUnchanged": product_ok,
        "supporting": {
            "verifierOnlyEveryCell": all(r["verifierOnly"] for r in present) if present else False,
            "cellsWithRigorRunConnectorCallsOrMissingVerifierReads": [cell_id(r) for r in present if not r["verifierOnly"]],
        },
        "projects": {j: {"projectId": e["projectId"], "happyPathCaseId": e["happyPathCaseId"], "suiteShape": e["suiteShape"]} for j, e in projects.items()},
        "runSeconds": meta.get("seconds"), "reruns": meta.get("reruns", []),
    }
    dump(layout.results_path, {"generatedBy": "run_bb.py aggregate", "summary": summary, "cells": rows})
    dump(layout.gate_path, {
        "qualification": "black-box mode (rigorrun/task/1), PREREGISTRATION.md + AMENDMENT-1.md",
        "mode": summary["mode"], "id": summary["id"], "outcome": summary["outcome"], "stageValid": summary["stageValid"],
        "productCommit": (freeze or {}).get("productCommit") or (commits[0] if len(commits) == 1 else commits),
        "cellsComplete": complete, "productUnchanged": product_ok,
        "gates": {k: {"holds": v["holds"], **{kk: vv for kk, vv in v.items() if kk != "holds"}} for k, v in gates.items()},
        "generatedAt": now_iso(),
    })
    write_report(layout, summary, rows, meta, projects)
    print(json.dumps({"outcome": summary["outcome"], "classification": summary["classification"],
                      "gates": {k: v["holds"] for k, v in gates.items()}, "complete": complete, "runSeconds": summary["runSeconds"]}, indent=2), flush=True)
    return summary


def cell_id(row):
    return f"{row['job']}:{row['behaviour']}:{row['attempt']}"


def write_report(layout, summary, rows, meta, projects):
    short = {"TRUE_POSITIVE": "TP", "TRUE_NEGATIVE": "TN", "FALSE_POSITIVE": "FP", "FALSE_NEGATIVE": "FN"}
    out = []
    title = "Black-box mode qualification" + (f": development run {layout.id} (not counted)" if layout.dev else ": counted run")
    out.append(f"# {title}\n")
    out.append(f"Generated by `run_bb.py aggregate` at {now_iso()}. Pre-registration: `PREREGISTRATION.md`, `AMENDMENT-1.md`.\n")
    out.append(f"- Outcome: **{summary['outcome']}** (stage valid: {summary['stageValid']})")
    out.append(f"- Product commit(s) of the cells: {', '.join(summary['productCommits']) or 'none'}"
               + (f"; frozen: {summary['freeze']['productCommit']} at {summary['freeze']['frozenAt']}" if summary["freeze"] else ""))
    out.append(f"- Branch at start: {meta.get('branch')}; uncommitted paths at start: {len(meta.get('dirtyPathsAtStart') or [])}")
    out.append(f"- Cells: {summary['cells']['present']} of {summary['cells']['planned']}; run time {summary['runSeconds']} s")
    out.append(f"- Re-runs of harness failures (disclosed): {len(summary['reruns'])}" + "".join(f"\n  - {r['cell']}: {'; '.join(r['first'])}" for r in summary["reruns"]))
    out.append("")
    out.append("## Gates\n")
    out.append("| Gate | Holds | Detail |")
    out.append("| --- | --- | --- |")
    g = summary["gates"]
    out.append(f"| 1. FN = 0 | {g['1_FN_is_0']['holds']} | FN {g['1_FN_is_0']['FN']} {g['1_FN_is_0']['cells'] or ''} |")
    out.append(f"| 2. FP = 0 | {g['2_FP_is_0']['holds']} | FP {g['2_FP_is_0']['FP']} {g['2_FP_is_0']['cells'] or ''} |")
    g3 = g["3_no_abstain_no_harness_failure"]
    out.append(f"| 3. ABSTAIN = 0, HARNESS_FAILURE = 0 after one re-run | {g3['holds']} | ABSTAIN {g3['ABSTAIN']}, harness failures {g3['HARNESS_FAILURE']} {g3['byKind'] or ''} |")
    g4 = g["4_oracle_equals_expected"]
    out.append(f"| 4. Oracle label = expected verdict in every cell | {g4['holds']} | mismatches {g4['mismatches'] or 'none'} |")
    g5 = g["5_state_only_independent_unmade_call_order_listed"]
    out.append(f"| 5. state-only, INDEPENDENT, unmade call-order checks listed | {g5['holds']} | {g5['verdicts']} verdicts; observation {g5['observations']}; source {g5['evidenceIndependence']}; "
               f"run limit `no_call_trace` on every run: {g5['runLimitNoCallTraceOnEvery']}; call-order checks listed as not made: {g5['callOrderChecksNotMade'] or 'none in the qualified cases'}; made: {g5['callOrderChecksMade'] or 'none'} |")
    out.append("")
    out.append("Gate 3 counts a cell that reached no verdict for any reason (harness failure, not run, unknown, missing, "
               "or an agent failure or time-out of this harness's own agents) as a harness failure.\n")
    out.append("## RigorRun's verdict against the oracle, per agent and job\n")
    out.append("Each entry is attempt 1 / 2 / 3, written `RigorRun vs oracle -> label`.\n")
    out.append("| Agent | Expected | update | create |")
    out.append("| --- | --- | --- | --- |")
    by = {(r["job"], r["behaviour"], r["attempt"]): r for r in rows}
    for behaviour in BEHAVIOURS:
        cols = []
        for job in JOBS:
            parts = []
            for n in range(1, ATTEMPTS + 1):
                r = by[(job, behaviour, n)]
                if not r["present"]:
                    parts.append("missing")
                    continue
                parts.append(f"{r['rigorrunOutcome']} vs {r['oracleVerdict']} -> {short.get(r['classification'], r['classification'])}{' (re-run)' if r.get('rerun') else ''}")
            cols.append(" / ".join(parts))
        out.append(f"| `{behaviour}` | {EXPECTED[behaviour]} | {cols[0]} | {cols[1]} |")
    out.append("")
    out.append("## Classification\n")
    out.append(", ".join(f"{k}: {v}" for k, v in summary["classification"].items()) + "\n")
    out.append("Labels come from `remediation/scripts/run-cases-after.py` `outcome_label` and `classify_outcome`, imported unchanged.\n")
    out.append("## Projects\n")
    for job, e in summary["projects"].items():
        out.append(f"- `{job}`: project {e['projectId']}, qualified case `{e['happyPathCaseId']}`, suite {e['suiteShape']}")
    out.append("")
    out.append("The CLI has no flag to run one case of a suite, so every case of a suite runs; only the happy_path case is scored, "
               "on the after-case reading taken when it finished. Its index is 0, so it starts from the reset.\n")
    out.append("## Supporting evidence for gate 5\n")
    s = summary["supporting"]
    out.append(f"- RigorRun's own connection to taskdesk2 made no tool call, and the verifier answered `query_tasks` and `query_notes` at least twice each, in every cell: {s['verifierOnlyEveryCell']}"
               + (f" (not in {s['cellsWithRigorRunConnectorCallsOrMissingVerifierReads']})" if s["cellsWithRigorRunConnectorCallsOrMissingVerifierReads"] else ""))
    out.append("")
    out.append("## Cells\n")
    out.append("| Cell | Expected | Oracle | RigorRun | Label | gate 5 | Reason RigorRun gave | Seconds |")
    out.append("| --- | --- | --- | --- | --- | --- | --- | --- |")
    for r in rows:
        if not r["present"]:
            out.append(f"| {cell_id(r)} | {r['expected']} | | | MISSING | | | |")
            continue
        reason = (r.get("outcomeReason") or "").replace("|", "/")
        reason = reason if len(reason) <= 160 else reason[:157] + "..."
        hf = ("; HARNESS: " + "; ".join(r["harnessFailures"])) if r["harnessFailures"] else ""
        out.append(f"| {cell_id(r)} | {r['expected']} | {r['oracleVerdict']} | {r['rigorrunOutcome']} | {r['classification']}{' (re-run)' if r.get('rerun') else ''} | {r['gate5']['holds']} | {reason}{hf} | {r['seconds']} |")
    with open(layout.report_path, "w") as fh:
        fh.write("\n".join(out) + "\n")


def cmd_aggregate(args):
    if args.dev is not None:
        layout = Layout(args.dev or latest_dev_id())
    else:
        layout = Layout()
        if not os.path.exists(FREEZE):
            raise SystemExit("REFUSING: no freeze.json; aggregate the counted run only after it")
    aggregate(layout)


def append_dev_log(layout, cells, summary, meta, note):
    new = not os.path.exists(DEV_LOG)
    with open(DEV_LOG, "a") as fh:
        if new:
            fh.write("# Development runs (never counted)\n\n"
                     "AMENDMENT-1: before `freeze.json` exists, the harness and the agents may be run to fix faults in the harness "
                     "itself. These runs never count and must not change the jobs, the agents' behaviours, the expected verdicts or the "
                     "gates. Each is listed here by `run_bb.py run --dev`; its summaries are in `dev-runs/<id>/`, its cell records under `tmp/rigorrun-audit/bbq/dev/<id>/` (git-ignored).\n\n")
        g = summary["gates"]
        fh.write(f"## {layout.id}\n\n")
        fh.write(f"- HEAD {meta.get('productCommitAtStart') or head()} on {meta.get('branch') or branch()}; uncommitted paths at start: {len(meta.get('dirtyPathsAtStart') or dirty_paths())}\n")
        fh.write(f"- Cells run: {summary['cells']['present']} (selected: {', '.join(sorted({f'{j}:{b}' for j, b in cells}))})\n")
        fh.write(f"- Classification: {summary['classification']}\n")
        fh.write(f"- Gates (as if counted): " + ", ".join(f"{k} {v['holds']}" for k, v in g.items()) + f"; outcome {summary['outcome']}\n")
        fh.write(f"- Re-runs: {len(meta.get('reruns', []))}; run time {meta.get('seconds')} s\n")
        if note:
            fh.write(f"- Note: {note}\n")
        fh.write("\n")


def main():
    parser = argparse.ArgumentParser(description="Black-box mode qualification harness")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("freeze")
    s = sub.add_parser("setup")
    s.add_argument("--dev", action="store_true")
    r = sub.add_parser("run")
    r.add_argument("--dev", action="store_true", help="a development run: never counted, into dev-runs/")
    r.add_argument("--only", nargs="*", help="development only: jobs or job:behaviour cells")
    r.add_argument("--note", help="development only: why this run, for dev-log.md")
    r.add_argument("--resume", action="store_true", help="counted only: finish an interrupted run, skipping cells already recorded")
    a = sub.add_parser("aggregate")
    a.add_argument("--dev", nargs="?", const="", default=None, help="aggregate a development run (default: the latest)")
    args = parser.parse_args()
    {"freeze": cmd_freeze, "setup": cmd_setup, "run": cmd_run, "aggregate": cmd_aggregate}[args.command](args)


if __name__ == "__main__":
    main()

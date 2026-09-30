#!/usr/bin/env python3
"""GreenMail happy-path-only diagnostic — a labelled deviation, never counted by any gate.

Why it exists: at the product commit both GreenMail suites carry a second generated
case (missing_precondition), and the frozen protocol refuses to score a suite that is
not the single demonstrated case (evidence/frozen-58/not-run.json). The release gates
keep those 12 cases NOT_RUN. This diagnostic measures what the gates cannot: whether
RigorRun's verdict on the demonstrated job itself regressed at N-1 for GreenMail.

The one deviation, applied the same way to both GreenMail homes:
  a throwaway copy of each home (tmp/rigorrun-audit/fq-homes-diagnostic/) whose
  benchmark.json keeps only the happy_path case. That case is checked to be identical
  to the one the product generated. Nothing else in the copy changes except the
  paths that would write into the strict run's evidence (agent trace directories,
  the fault proxy's log), which are pointed at this diagnostic's own directory.

Everything that defines a case is unchanged: the frozen case files, labels, expect
predicates, oracles, resets, agents and attempt counts, run by the committed
run-cases-after.py.

    greenmail-happy-path-diagnostic.py prepare
    FQ_RUN_DIR=<this diagnostic's run dir> python3 fq_run_cases.py --only CASE ...   (what `run` does)
    greenmail-happy-path-diagnostic.py run CASE ...
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
FQ = os.path.abspath(os.path.join(HERE, ".."))
REPO = os.path.abspath(os.path.join(FQ, "..", "..", ".."))
STRICT_RUN = os.path.join(FQ, "evidence", "frozen-58", "run")
DIAG = os.path.join(FQ, "evidence", "greenmail-happy-path-diagnostic")
DIAG_RUN = os.path.join(DIAG, "run")
STRICT_HOMES = os.path.join(REPO, "tmp", "rigorrun-audit", "fq-homes")
DIAG_HOMES = os.path.join(REPO, "tmp", "rigorrun-audit", "fq-homes-diagnostic")
HOMES = ["home-email-gm-w1", "home-email-gm-fault"]


def load(path):
    with open(path) as fh:
        return json.load(fh)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def prepare():
    strict_projects = load(os.path.join(STRICT_RUN, "projects.json"))
    projects, record = {}, {"deviation": "benchmark.json in a throwaway copy of each GreenMail home keeps only the generated happy_path case", "homes": {}}
    os.makedirs(DIAG_RUN, exist_ok=True)
    for home in HOMES:
        project = strict_projects[home]["project"]
        source = os.path.join(STRICT_HOMES, home)
        target = os.path.join(DIAG_HOMES, home)
        if os.path.exists(target):
            assert os.path.realpath(target).startswith(os.path.realpath(DIAG_HOMES) + os.sep)
            shutil.rmtree(target)
        shutil.copytree(source, target, symlinks=True)
        project_dir = os.path.join(target, "projects", project)
        runs = os.path.join(project_dir, "runs")
        if os.path.isdir(runs):
            shutil.rmtree(runs)

        bench_path = os.path.join(project_dir, "benchmark.json")
        original = load(bench_path)
        happy = [c for c in original["cases"] if c.get("category") == "happy_path"]
        assert len(happy) == 1, f"{home}: expected exactly one happy_path case, found {len(happy)}"
        filtered = {**original, "cases": happy}
        with open(os.path.join(source, "projects", project, "benchmark.json"), "rb") as fh:
            original_bytes = fh.read()
        with open(bench_path, "w") as fh:
            json.dump(filtered, fh, indent=2)
        assert canonical(load(bench_path)["cases"][0]) == canonical(happy[0])

        # Paths that would write into the strict run's evidence now point at this diagnostic.
        for name in ("project.json",):
            path = os.path.join(project_dir, name)
            text = open(path).read()
            with open(path, "w") as fh:
                fh.write(text.replace(STRICT_RUN, DIAG_RUN))
        secrets = os.path.join(target, "secrets.json")
        if os.path.exists(secrets):
            text = open(secrets).read()
            with open(secrets, "w") as fh:
                fh.write(text.replace(STRICT_RUN, DIAG_RUN))
        for agent in load(os.path.join(project_dir, "project.json")).get("agents", []):
            for arg in agent.get("args", []):
                if isinstance(arg, str) and arg.startswith(os.path.join(DIAG_RUN, "traces")):
                    os.makedirs(arg, exist_ok=True)
        os.makedirs(os.path.join(DIAG_RUN, "traces", "email-mcp"), exist_ok=True)

        projects[home] = {"home": "{REPO}/" + os.path.relpath(target, REPO), "project": project}
        record["homes"][home] = {
            "project": project,
            "originalCases": [f"{c['category']}:{c['id']}" for c in original["cases"]],
            "keptCases": [f"{c['category']}:{c['id']}" for c in happy],
            "happyPathCaseSha256": hashlib.sha256(canonical(happy[0]).encode()).hexdigest(),
            "originalBenchmarkSha256": hashlib.sha256(original_bytes).hexdigest(),
            "happyPathIdenticalToGenerated": True,
        }
    with open(os.path.join(DIAG_RUN, "projects.json"), "w") as fh:
        json.dump(projects, fh, indent=2)
    strict_info = load(os.path.join(STRICT_RUN, "run-info.json"))
    with open(os.path.join(DIAG_RUN, "run-info.json"), "w") as fh:
        json.dump({**strict_info, "label": "GreenMail happy-path-only diagnostic (deviation; not counted by any gate)"}, fh, indent=2)
    with open(os.path.join(DIAG, "deviation.json"), "w") as fh:
        json.dump(record, fh, indent=2)
    print(json.dumps(record, indent=2))


def run(ids):
    env = dict(os.environ, FQ_RUN_DIR=DIAG_RUN)
    done = subprocess.run(["node", os.path.join(HERE, "product-under-test.mjs"), "--check"], cwd=REPO)
    if done.returncode != 0:
        return 1
    return subprocess.run(["python3", "fq_run_cases.py", "--only", *ids], cwd=HERE, env=env).returncode


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    if sys.argv[1] == "prepare":
        prepare()
    elif sys.argv[1] == "run":
        sys.exit(run(sys.argv[2:]))
    else:
        print(__doc__)
        sys.exit(2)

#!/usr/bin/env python3
"""EH-WT-03 at the requalification's product under test, through the remediation's committed N-1 scripts.

remediation/n1/scripts/setup-w2.py and remediation/n1/scripts/run-eh-wt-03.py are
imported from their committed files, unmodified. The case definition
(remediation/heldout/external/cases.json), the frozen held-out runner's run_case
(Worktide reset to the seeded snapshot, oracle reads, the case's `expect`), the W2
journey and its teach steps, the playbook agents, both refusals and the
classification all stay the committed code. Only module-level names that say where
records, evidence, agent traces and homes go are replaced, and the requalification's
product check (requalification/scripts/product-under-test.mjs --check) runs first.

    run-eh-wt-03-rq.py setup                                              # re-create the W2 project (Worktide stack up)
    run-eh-wt-03-rq.py run [--attempts 1 2 3] [--also-sanity] [--rebuild]  # the measurement; EH-WT-03 x3 by default

setup loads setup-w2.py, whose top level loads remediation/scripts/setup-after.py as
`setup`. setup-w2.py spells its output locations inside its `__main__` block, so that
block does not run; the names it sets are set here instead, and setup-after's main()
gets the argv setup-w2.py passes (--fresh --only home-worktide-w2):
  setup.AFTER      requalification/n1/evidence/w2-setup
                   (projects.json, journeys.json, traces/worktide-mcp/w2-setup/)
  setup.HOMES      tmp/rigorrun-audit/rq-n1-homes (git-ignored)
  setup.FAULT_LOG  requalification/n1/evidence/w2-setup/traces/email-mcp/fault-proxy.unused.jsonl
                   (only its directory is created)
  setup.JOURNEYS   the same tuples, with the gm-fault journey's FAULT_LOG override pointed at
                   the new FAULT_LOG, as rq_paths.setup_module does (--only never reaches it)

run loads run-eh-wt-03.py and calls its main() after replacing:
  N1               requalification/n1. results_path() is then n1/eh-wt-03.json,
                   evidence_root() is n1/evidence/eh-wt-03/ (measurement.json and
                   attempt-<n>/<case>/), project() reads n1/evidence/w2-setup/projects.json,
                   and main()'s never-written fault log is n1/evidence/fault-proxy.unused.jsonl
  TRACES           requalification/n1/evidence/agent-traces (computed from N1 at import, so
                   replaced by itself; project() registers the three playbook agents with it)
  argv             always --measurement eh-wt-03 --setup evidence/w2-setup; neither option is
                   accepted from the command line

Not replaced, because nothing called here writes through them: the held-out runner's
own TRACES, RESULTS and HOMES (used only by its main(), setup() and
worktide_project(), never called), and setup-after's ORIGINAL_TRACES (a prefix it
matches agent arguments against, not a destination). heldout.EVIDENCE and
heldout.FAULT_LOG are set per attempt by run-eh-wt-03.py's own main(), from
evidence_root() and N1.

Both commands record every file under remediation/, final-qualification/, cases/ and
scripts/ (size and mtime) before they start and compare when they end; any
difference is printed and the exit code is 1.
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
RQ = os.path.abspath(os.path.join(HERE, ".."))
REPORT = os.path.abspath(os.path.join(RQ, ".."))
REPO = os.path.abspath(os.path.join(REPORT, "..", ".."))
COMMITTED = os.path.join(REPORT, "remediation", "n1", "scripts")

MEASUREMENT = "eh-wt-03"
SETUP_RELATIVE = os.path.join("evidence", "w2-setup")
SETUP_DIR = os.path.join(HERE, SETUP_RELATIVE)
HOMES = os.path.join(REPO, "tmp", "rigorrun-audit", "rq-n1-homes")
TRACES = os.path.join(HERE, "evidence", "agent-traces")
GUARDED = [os.path.join(REPORT, name) for name in ("remediation", "final-qualification", "cases", "scripts")]


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verify_product():
    done = subprocess.run(["node", os.path.join(RQ, "scripts", "product-under-test.mjs"), "--check"], capture_output=True, text=True, cwd=REPO)
    if done.returncode != 0:
        raise SystemExit(f"REFUSING: {done.stderr.strip() or done.stdout.strip()}")
    with open(os.path.join(RQ, "product-under-test.json")) as fh:
        return json.load(fh)["productCommit"]


def guarded_files():
    seen = {}
    for root in GUARDED:
        for base, dirs, files in os.walk(root):
            for name in dirs:
                seen[os.path.join(base, name)] = "dir"
            for name in files:
                stat = os.lstat(os.path.join(base, name))
                seen[os.path.join(base, name)] = (stat.st_size, stat.st_mtime_ns)
    return seen


def guarded(step):
    """Runs step(); afterwards, any file created, removed or rewritten in a guarded tree is reported and fails the command."""
    before = guarded_files()
    try:
        code = step()
    finally:
        after = guarded_files()
        changed = sorted(path for path in before.keys() | after.keys() if before.get(path) != after.get(path))
        for path in changed:
            print(f"WRITTEN OUTSIDE requalification/: {os.path.relpath(path, REPORT)}", file=sys.stderr)
    return 1 if changed else code


def setup():
    verify_product()
    w2 = load(os.path.join(COMMITTED, "setup-w2.py"), "rq_setup_w2")
    module = w2.setup
    old_fault_log = module.FAULT_LOG
    module.AFTER = SETUP_DIR
    module.HOMES = HOMES
    module.FAULT_LOG = os.path.join(SETUP_DIR, "traces", "email-mcp", "fault-proxy.unused.jsonl")
    module.JOURNEYS = [
        (target, journey, spec, original, reset,
         {k: (module.FAULT_LOG if v == old_fault_log else v) for k, v in overrides.items()}, arm)
        for target, journey, spec, original, reset, overrides, arm in module.JOURNEYS
    ]
    sys.argv = ["setup-w2.py", "--fresh", "--only", "home-worktide-w2"]
    return module.main()


def run(rest):
    parser = argparse.ArgumentParser(prog="run-eh-wt-03-rq.py run", allow_abbrev=False)
    parser.add_argument("--attempts", nargs="*", type=int, help="EH-WT-03 attempt numbers to run (the committed default is 1 2 3)")
    parser.add_argument("--also-sanity", action="store_true")
    parser.add_argument("--rebuild", action="store_true", help="only re-derive the results from the evidence on disk")
    a = parser.parse_args(rest)
    verify_product()
    if not os.path.exists(os.path.join(SETUP_DIR, "projects.json")):
        raise SystemExit(f"no re-created W2 project in {os.path.relpath(SETUP_DIR, REPO)}: run `run-eh-wt-03-rq.py setup` first")
    eh = load(os.path.join(COMMITTED, "run-eh-wt-03.py"), "rq_run_eh_wt_03")
    eh.N1 = HERE
    eh.TRACES = TRACES
    # Set before main() only so the destinations can be checked here; main() sets the same two values from argv.
    eh.MEASUREMENT, eh.SETUP = MEASUREMENT, SETUP_RELATIVE
    if eh.results_path() != os.path.join(HERE, "eh-wt-03.json") or eh.evidence_root() != os.path.join(HERE, "evidence", "eh-wt-03"):
        raise SystemExit(f"REFUSING: results {eh.results_path()} / evidence {eh.evidence_root()} are not the requalification's")
    sys.argv = ["run-eh-wt-03.py",
                *(["--attempts", *map(str, a.attempts)] if a.attempts is not None else []),
                *(["--also-sanity"] if a.also_sanity else []),
                *(["--rebuild"] if a.rebuild else []),
                "--measurement", MEASUREMENT, "--setup", SETUP_RELATIVE]
    return eh.main()


def main():
    command, rest = (sys.argv[1], sys.argv[2:]) if len(sys.argv) > 1 else (None, [])
    if command == "setup" and not rest:
        return guarded(setup)
    if command == "run":
        return guarded(lambda: run(rest))
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())

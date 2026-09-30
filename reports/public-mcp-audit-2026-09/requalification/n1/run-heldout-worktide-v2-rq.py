#!/usr/bin/env python3
"""The Worktide v2 held-out set at the requalification's product under test.

remediation/heldout-worktide-v2/run-heldout-v2.py is imported from its committed
file, unmodified, and its own main() runs. verify_freeze() still checks every
frozen file against freeze.json and the freeze commit against HEAD, the
product-sources refusal stays, and the journeys, specs, playbooks, side-channel
tool, the held-out runner's run_case, the oracle, `expect`, the blocks and the
totals are all the committed code. The requalification's product check
(requalification/scripts/product-under-test.mjs --check) runs first. Four module
globals are replaced before anything runs, and nothing else:

  HOMES     tmp/rigorrun-audit/rq-heldout-v2-homes (git-ignored): each journey's home
            with its v2-project.json marker, and expanded_playbook()'s {REPO}-filled
            playbooks under HOMES/playbooks/
  EVIDENCE  requalification/n1/evidence/heldout-worktide-v2: setup/<journey>/ from
            journey.mjs, <case>/ from run_case (main() hands EVIDENCE to the held-out
            runner as heldout.EVIDENCE), and the never-written fault-proxy.unused.jsonl
  TRACES    requalification/n1/evidence/heldout-worktide-v2/agent-traces (computed from
            EVIDENCE at import, so replaced by itself; every playbook agent is registered
            with it)
  RESULTS   requalification/n1/heldout-worktide-v2-results.json (earlier records are
            merged from this file, never from remediation's results.json)

Not replaced, because nothing main() calls writes through them: HERE (the frozen
files are read, and hashed by verify_freeze, from it), and the held-out runner's
own TRACES, RESULTS and HOMES (used only by its main(), setup() and
worktide_project(), which this set never calls).

Every file under remediation/, final-qualification/, cases/ and scripts/ is
recorded (size and mtime) before the run and compared when it ends; any
difference is printed and the exit code is 1.

    run-heldout-worktide-v2-rq.py [--only V2-T-01 ...] [--fresh-setup]
"""
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
RUNNER = os.path.join(REPORT, "remediation", "heldout-worktide-v2", "run-heldout-v2.py")
GUARDED = [os.path.join(REPORT, name) for name in ("remediation", "final-qualification", "cases", "scripts")]

spec = importlib.util.spec_from_file_location("rq_run_heldout_v2", RUNNER)
v2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v2)

v2.HOMES = os.path.join(REPO, "tmp", "rigorrun-audit", "rq-heldout-v2-homes")
v2.EVIDENCE = os.path.join(HERE, "evidence", "heldout-worktide-v2")
v2.TRACES = os.path.join(v2.EVIDENCE, "agent-traces")
v2.RESULTS = os.path.join(HERE, "heldout-worktide-v2-results.json")


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


def main():
    before = guarded_files()
    try:
        verify_product()
        sys.argv = ["run-heldout-v2.py", *sys.argv[1:]]
        code = v2.main()
    finally:
        after = guarded_files()
        changed = sorted(path for path in before.keys() | after.keys() if before.get(path) != after.get(path))
        for path in changed:
            print(f"WRITTEN OUTSIDE requalification/: {os.path.relpath(path, REPORT)}", file=sys.stderr)
    return 1 if changed else code


if __name__ == "__main__":
    sys.exit(main())

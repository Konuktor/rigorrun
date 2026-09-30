#!/usr/bin/env python3
"""The independent-oracle v1 cases, re-run at the requalification's product under test.

final-qualification/scripts/io/run-io.py is imported from its committed file,
unmodified: io/freeze.json is still verified before setup and before every run,
and the cases, fixture servers, playbooks, specs, oracle, `expect`, staging and
the silent-fallback guard are all the committed code. Three module globals are
replaced before anything runs, and nothing else:

- EVIDENCE: requalification/v1/evidence/independent-oracle, never the final
  qualification's evidence tree;
- HOMES: tmp/rigorrun-audit/rq-io-homes (git-ignored), so the projects are
  re-created by the product under test;
- verify_product: the requalification's product-under-test check, because the
  final qualification's pins a9edbec and cannot pass at a later product.

    rq_io_v1.py setup | run [--only IO-5 ...] | aggregate
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
RUN_IO = os.path.join(REPORT, "final-qualification", "scripts", "io", "run-io.py")

spec = importlib.util.spec_from_file_location("rq_run_io_v1", RUN_IO)
io = importlib.util.module_from_spec(spec)
spec.loader.exec_module(io)

io.EVIDENCE = os.path.join(RQ, "v1", "evidence", "independent-oracle")
io.HOMES = os.path.join(REPO, "tmp", "rigorrun-audit", "rq-io-homes")


def verify_product():
    done = subprocess.run(["node", os.path.join(HERE, "product-under-test.mjs"), "--check"], capture_output=True, text=True, cwd=REPO)
    if done.returncode != 0:
        raise SystemExit(f"REFUSING: {done.stderr.strip() or done.stdout.strip()}")
    with open(os.path.join(RQ, "product-under-test.json")) as fh:
        return json.load(fh)["productCommit"]


io.verify_product = verify_product

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "freeze":
        raise SystemExit("the v1 cases were frozen by the final qualification; they are verified, never re-frozen")
    sys.argv = ["run-io.py", *sys.argv[1:]]
    io.main()

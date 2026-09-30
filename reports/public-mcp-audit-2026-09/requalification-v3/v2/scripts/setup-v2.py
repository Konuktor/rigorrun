#!/usr/bin/env python3
"""Re-creates the benchmark-v2 projects at the product under test (remediation/scripts/setup-after.py, unmodified).

Same specs, teach steps, answers, review policy and agents as every earlier
re-run. Only the output paths differ: projects.json, journeys.json and the setup
traces under requalification/v2/evidence/run, homes under
tmp/rigorrun-audit/rq-v2-homes (git-ignored). Setting a project up demonstrates
the job and generates its suite; it runs no agent case. benchmark-v2 labels are
written against the generated case ids, so this runs before the freeze.

    setup-v2.py --fresh --only home-email-gm-w1 home-email-gm-fault home-sqlite-w1 home-sqlite-w1b
"""
import os
import subprocess
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
RQ = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(RQ, "scripts"))
import rq_paths  # noqa: E402

if __name__ == "__main__":
    check = subprocess.run(["node", os.path.join(RQ, "scripts", "product-under-test.mjs"), "--check"], capture_output=True, text=True, cwd=rq_paths.REPO)
    if check.returncode != 0:
        raise SystemExit(f"REFUSING: {check.stderr.strip() or check.stdout.strip()}")
    module = rq_paths.setup_module(run_dir=rq_paths.V2_RUN, homes=rq_paths.V2_HOMES)
    sys.argv = ["setup-after.py", *sys.argv[1:]]
    sys.exit(module.main())

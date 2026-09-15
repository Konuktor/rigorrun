#!/usr/bin/env python3
"""Re-creates the audit's projects for benchmark-v1 at the product under test (remediation/scripts/setup-after.py, unmodified).

Same specs, teach steps, answers, review policy and agents. Only the output
paths differ: evidence under requalification/v1/evidence/frozen-58/run, homes
under tmp/rigorrun-audit/rq-v1-homes (git-ignored).

    rq_setup_v1.py --fresh [--only home-sqlite-w1 ...]
"""
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "scripts"))
import rq_paths  # noqa: E402

if __name__ == "__main__":
    module = rq_paths.setup_module(run_dir=rq_paths.V1_RUN, homes=rq_paths.V1_HOMES)
    sys.argv = ["setup-after.py", *sys.argv[1:]]
    sys.exit(module.main())

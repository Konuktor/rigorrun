#!/usr/bin/env python3
"""Runs frozen audit cases for benchmark-v1 at the product under test (remediation/scripts/run-cases-after.py, unmodified).

Case files, `expect` predicates, truth labels, oracles, resets, agents, attempt
counts, budgets and both classifications are the committed code: benchmark-v1
is the frozen protocol, reported alongside benchmark-v2. Only the evidence
directory differs: requalification/v1/evidence/frozen-58/run.

    rq_run_cases_v1.py --only CASE_ID ...
"""
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "scripts"))
import rq_paths  # noqa: E402

if __name__ == "__main__":
    module = rq_paths.run_cases_module(run_dir=rq_paths.V1_RUN)
    sys.argv = ["run-cases-after.py", *sys.argv[1:]]
    sys.exit(module.main())

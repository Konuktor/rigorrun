#!/usr/bin/env python3
"""Runs frozen audit cases at the product under test (remediation/scripts/run-cases-after.py, unmodified).

Case files, `expect` predicates, truth labels, oracles, resets, agents, attempt
counts and both classifications are the committed code. Only the evidence
directory differs: final-qualification/evidence/frozen-58/run.

    fq_run_cases.py --only CASE_ID ...
"""
import sys

sys.dont_write_bytecode = True
import fq_paths  # noqa: E402

if __name__ == "__main__":
    module = fq_paths.run_cases_module()
    sys.argv = ["run-cases-after.py", *sys.argv[1:]]
    sys.exit(module.main())

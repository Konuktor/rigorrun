#!/usr/bin/env python3
"""Re-creates the audit's projects at the product under test (remediation/scripts/setup-after.py, unmodified).

Same specs, teach steps, answers, review policy and agents. Only the output paths
differ: evidence under final-qualification/evidence/frozen-58/run, homes under
tmp/rigorrun-audit/fq-homes (git-ignored).

    fq_setup.py --fresh [--only home-sqlite-w1 ...]
"""
import sys

sys.dont_write_bytecode = True
import fq_paths  # noqa: E402

if __name__ == "__main__":
    module = fq_paths.setup_module()
    sys.argv = ["setup-after.py", *sys.argv[1:]]
    sys.exit(module.main())

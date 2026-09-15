#!/usr/bin/env python3
"""The benchmark-v2 oracle reading taken between generated cases.

RigorRun runs the program given to `--after-case` after each case has finished
(its final state read included) and before the next case starts, with
RIGORRUN_CASE_ID, RIGORRUN_CASE_INDEX, RIGORRUN_CASE_OUTCOME and
RIGORRUN_CASE_CATEGORY set in an otherwise minimal environment, and no
arguments. run-v2.py writes, per attempt, a two-line executable that calls this
file with the attempt directory.

The reading is the audit's own oracle for the case (scripts/run-cases.py
`oracle`, imported unmodified), taken by a separate process that never goes
through RigorRun. A reading that cannot be taken exits non-zero, and RigorRun
then stops the run, so no generated case is scored without its reading.

    oracle-reading.py <attempt_dir>
"""
import importlib.util
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
spec = importlib.util.spec_from_file_location("v2_reading_run_cases", os.path.join(REPORT, "scripts", "run-cases.py"))
rc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rc)


def main():
    if len(sys.argv) != 2:
        print("usage: oracle-reading.py <attempt_dir>", file=sys.stderr)
        return 2
    attempt_dir = sys.argv[1]
    index = os.environ.get("RIGORRUN_CASE_INDEX")
    case_id = os.environ.get("RIGORRUN_CASE_ID")
    if index is None or not case_id:
        print("RIGORRUN_CASE_INDEX and RIGORRUN_CASE_ID must be set by --after-case", file=sys.stderr)
        return 2
    with open(os.path.join(attempt_dir, "case.json")) as fh:
        case = json.load(fh)
    reading = rc.oracle(case)
    out = os.path.join(attempt_dir, "readings", f"after-case-{int(index):02d}.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as fh:
        json.dump({
            "caseIndex": int(index),
            "caseId": case_id,
            "outcome": os.environ.get("RIGORRUN_CASE_OUTCOME"),
            "category": os.environ.get("RIGORRUN_CASE_CATEGORY"),
            "reading": reading,
        }, fh, indent=2, sort_keys=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""The --after-case program for IO-v2: one oracle reading after every case.

`rigorrun run --after-case <this file>` starts it after each case has finished,
its final state reads included, and before the next case starts
(packages/cli/src/afterCase.ts): directly, with no arguments, a minimal
environment and the RIGORRUN_* variables that name the case.

It only reads. It runs the frozen, unchanged scripts/oracle-sqlite.py on the desk
database (read-only, a separate process, never through either MCP server) and
writes the reading to tmp/rigorrun-audit/rq-io2-state/after-case/<case index>.json.
It resets nothing. Four projects keep IO-v1's `reset: none`, so a case after the
first starts from whatever the cases before it left; the replace project resets
through the connector's reset_desk tool, which RigorRun calls before every case.
run-io-v2.py judges each case on the readings on either side of it.

A reading that cannot be taken exits 1, and rigorrun then stops the run, so no
case is scored without its reading.
"""
import json
import os
import subprocess
import sys
import time

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.abspath(os.path.join(HERE, "..", ".."))
REPO = os.path.abspath(os.path.join(REPORT, "..", ".."))
STATE = os.path.join(REPO, "tmp", "rigorrun-audit", "rq-io2-state")
ORACLE = os.path.join(REPORT, "scripts", "oracle-sqlite.py")
OUT = os.path.join(STATE, "after-case")


def main():
    index = os.environ.get("RIGORRUN_CASE_INDEX", "")
    case_id = os.environ.get("RIGORRUN_CASE_ID", "")
    if not index.isdigit() or not case_id:
        sys.stderr.write("after-case-oracle: RIGORRUN_CASE_INDEX and RIGORRUN_CASE_ID are required\n")
        return 1
    done = subprocess.run([sys.executable, "-B", ORACLE, "--db", os.path.join(STATE, "desk.db")], capture_output=True, text=True, timeout=120)
    if done.returncode != 0:
        sys.stderr.write("after-case-oracle: the oracle failed: " + done.stderr[-800:] + "\n")
        return 1
    snapshot = json.loads(done.stdout)
    if not snapshot.get("exists"):
        sys.stderr.write("after-case-oracle: the desk database does not exist\n")
        return 1
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{int(index)}.json")
    if os.path.exists(path):
        sys.stderr.write(f"after-case-oracle: a reading for case index {index} already exists; the runner clears them before each attempt\n")
        return 1
    record = {
        "caseIndex": int(index),
        "caseId": case_id,
        "category": os.environ.get("RIGORRUN_CASE_CATEGORY", ""),
        "outcome": os.environ.get("RIGORRUN_CASE_OUTCOME", ""),
        "runId": os.environ.get("RIGORRUN_RUN_ID", ""),
        "agentId": os.environ.get("RIGORRUN_AGENT_ID", ""),
        "at": time.time(),
        "snapshot": snapshot,
    }
    with open(path, "w") as fh:
        json.dump(record, fh, indent=2, sort_keys=True)
        fh.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

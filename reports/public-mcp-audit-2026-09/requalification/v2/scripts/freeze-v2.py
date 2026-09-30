#!/usr/bin/env python3
"""Freezes benchmark-v2's pre-registration before any benchmark-v2 attempt runs.

Writes requalification/v2/freeze.json: the sha256 of every file under
requalification/v2/ except the top-level evidence/ directory, freeze.json itself
and any __pycache__ — the same file set requalification/scripts/product-under-test.mjs
verifies. Refuses when freeze.json already exists, and when any benchmark-v2
attempt evidence exists (evidence/run/evidence/): a freeze written after a case
ran is not a pre-registration. Setup evidence (evidence/run/projects.json,
journeys.json, traces/) may exist: setting a project up runs no agent case, and
the labels are written against the suites it generated.

After freezing, record the product under test again
(node requalification/scripts/product-under-test.mjs), since a freeze that
appears after the record is refused by --check.

    freeze-v2.py
"""
import datetime
import hashlib
import json
import os
import subprocess
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
V2 = os.path.abspath(os.path.join(HERE, ".."))
REPO = os.path.abspath(os.path.join(V2, "..", "..", "..", ".."))
FREEZE = os.path.join(V2, "freeze.json")
ATTEMPT_EVIDENCE = os.path.join(V2, "evidence", "run", "evidence")


def sha256(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def frozen_files():
    files = {}
    for dirpath, dirnames, filenames in os.walk(V2):
        rel_dir = os.path.relpath(dirpath, V2)
        if rel_dir == ".":
            dirnames[:] = [d for d in dirnames if d != "evidence"]
        dirnames[:] = [d for d in dirnames if d != "__pycache__"]
        for name in filenames:
            rel = os.path.normpath(os.path.join(rel_dir, name)) if rel_dir != "." else name
            if rel == "freeze.json":
                continue
            files[rel] = sha256(os.path.join(dirpath, name))
    return dict(sorted(files.items()))


def main():
    if os.path.exists(FREEZE):
        raise SystemExit("REFUSING: requalification/v2/freeze.json exists; benchmark-v2 is already frozen")
    if os.path.isdir(ATTEMPT_EVIDENCE) and any(os.scandir(ATTEMPT_EVIDENCE)):
        raise SystemExit("REFUSING: benchmark-v2 attempt evidence exists; freezing now would not be a freeze before running")
    head = subprocess.run(["git", "-C", REPO, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    files = frozen_files()
    with open(FREEZE, "w") as fh:
        json.dump({
            "note": "Every file that defines benchmark-v2 (pre-registration, labels, harness), hashed before any benchmark-v2 attempt ran. run-v2.py refuses to run without it, and product-under-test.mjs --check verifies it.",
            "frozenAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "headAtFreeze": head,
            "files": files,
        }, fh, indent=2)
        fh.write("\n")
    print(f"frozen {len(files)} files at {head[:7]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

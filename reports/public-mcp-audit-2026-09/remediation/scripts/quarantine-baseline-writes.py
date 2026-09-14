#!/usr/bin/env python3
"""Keep the original audit record untouched by the AFTER run.

Some frozen direct-probe cases (EM-GM-07, SQ-D-09) name a FAULT_LOG inside the
original audit's traces/ directory, so re-running them appends to committed
files. This script finds every tracked file under the audit tree, outside
remediation/, that differs from HEAD. A pure append is split: the appended
bytes go to remediation/after/baseline-writes/<same relative path> (evidence
of the AFTER run), and the committed file is restored from git. Anything that
is not a pure append is left alone and reported, and the script exits 1.

  python3 quarantine-baseline-writes.py          # quarantine and restore
  python3 quarantine-baseline-writes.py --check  # exit 1 if any tracked audit file differs from HEAD
"""
import os
import subprocess
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
AUDIT = "reports/public-mcp-audit-2026-09"
DEST = os.path.join(REPO, AUDIT, "remediation", "after", "baseline-writes")


def git(*args, binary=False):
    out = subprocess.run(["git", "-C", REPO, *args], check=True, capture_output=True)
    return out.stdout if binary else out.stdout.decode()


def modified():
    names = git("diff", "--name-only", "HEAD", "--", AUDIT).splitlines()
    return [n for n in names if not n.startswith(f"{AUDIT}/remediation/")]


def main():
    files = modified()
    if "--check" in sys.argv:
        for name in files:
            print(f"differs from HEAD: {name}")
        print(f"{len(files)} tracked audit file(s) outside remediation/ differ from HEAD")
        return 1 if files else 0
    problems = 0
    for name in files:
        path = os.path.join(REPO, name)
        committed = git("show", f"HEAD:{name}", binary=True)
        current = open(path, "rb").read() if os.path.exists(path) else None
        if current is None or not current.startswith(committed):
            print(f"NOT A PURE APPEND, left for review: {name}")
            problems += 1
            continue
        suffix = current[len(committed):]
        target = os.path.join(DEST, os.path.relpath(name, AUDIT))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        if os.path.exists(target):
            print(f"REFUSING to overwrite existing quarantine file: {target}")
            problems += 1
            continue
        with open(target, "wb") as fh:
            fh.write(suffix)
        git("checkout", "HEAD", "--", name)
        lines = suffix.count(b"\n")
        print(f"quarantined {lines} appended line(s): {name} -> {os.path.relpath(target, REPO)}; original restored")
    print(f"{len(files)} file(s) examined, {problems} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

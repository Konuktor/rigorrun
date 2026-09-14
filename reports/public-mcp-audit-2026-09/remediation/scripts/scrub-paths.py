#!/usr/bin/env python3
"""Replaces machine-specific paths in the remediation evidence with placeholders.

The original audit tree carries none (`{REPO}` stands for the checkout), and the
remediation evidence follows the same convention. Applied to text files under
remediation/ and to the one log the remediation added under evidence/.

    scrub-paths.py           # rewrite in place
    scrub-paths.py --check   # exit 1 if any machine path remains
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REMEDIATION = os.path.abspath(os.path.join(HERE, ".."))
REPORT = os.path.abspath(os.path.join(REMEDIATION, ".."))
REPO = os.path.abspath(os.path.join(REPORT, "..", ".."))
HOME = os.path.expanduser("~")
TEXT = (".json", ".jsonl", ".log", ".txt", ".md", ".mjs", ".py", ".sh", ".ts", ".sql")
TARGETS = [REMEDIATION, os.path.join(REPORT, "evidence", "rigorrun-test-remediation-baseline.log")]
# Longest first: the checkout lives under the home directory.
RULES = [
    (re.compile(re.escape(REPO)), "{REPO}"),
    (re.compile(r"/tmp/claude-\d+/[^\s\"'`]*?/scratchpad"), "{SCRATCH}"),
    (re.compile(r"/tmp/claude-\d+"), "{TMP}"),
    (re.compile(re.escape(HOME)), "{HOME}"),
]
MACHINE = re.compile("|".join([re.escape(REPO), re.escape(HOME), r"/tmp/claude-\d+"]))


def files():
    for target in TARGETS:
        if os.path.isfile(target):
            yield target
            continue
        for dirpath, _, names in os.walk(target):
            for name in names:
                if name.endswith(TEXT):
                    yield os.path.join(dirpath, name)


def main():
    check = "--check" in sys.argv
    dirty = []
    for path in files():
        if os.path.abspath(path) == os.path.abspath(__file__):
            continue
        try:
            text = open(path, encoding="utf-8").read()
        except UnicodeDecodeError:
            continue
        if not MACHINE.search(text):
            continue
        dirty.append(os.path.relpath(path, REPORT))
        if check:
            continue
        for pattern, placeholder in RULES:
            text = pattern.sub(placeholder, text)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
    if check:
        print(f"{len(dirty)} file(s) still contain machine paths" + (": " + ", ".join(dirty[:10]) if dirty else ""))
        return 1 if dirty else 0
    print(f"scrubbed {len(dirty)} file(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

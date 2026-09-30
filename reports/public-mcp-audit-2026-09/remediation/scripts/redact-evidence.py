#!/usr/bin/env python3
"""Keeps credential values out of the remediation's generated evidence.

The frozen case files carry the disposable local mail stack's login in their
`env` (committed with the baseline, checksummed, never edited). The harnesses
copy a case's env into every attempt record, so without this step the AFTER and
held-out evidence would add new copies. Values of keys named like a credential
(PASSWORD, TOKEN, SECRET, API_KEY, PRIVATE_KEY) become "{REDACTED}". A value that
is itself a variable name (an env reference such as "SMTP_PASSWORD") or already
a placeholder is left alone. Formatting is preserved: only the value text changes.

  redact-evidence.py          # rewrite in place under remediation/after and remediation/heldout
  redact-evidence.py --check  # exit 1 if any value from the local secret stores still appears there

The check reads the real values from tmp/rigorrun-audit/**/secrets.json and prints
only file names and counts, never a value.
"""
import glob
import json
import os
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
REMEDIATION = os.path.abspath(os.path.join(HERE, ".."))
REPO = os.path.abspath(os.path.join(REMEDIATION, "..", "..", ".."))
TARGETS = [os.path.join(REMEDIATION, "after"), os.path.join(REMEDIATION, "heldout")]
TEXT = (".json", ".jsonl", ".log", ".txt")
KEY = r"[A-Za-z_]*(?:PASSWORD|PASSWD|TOKEN|SECRET|API_KEY|PRIVATE_KEY)[A-Za-z_]*"
PAIR = re.compile(r'("' + KEY + r'"\s*:\s*)"((?:[^"\\]|\\.)*)"', re.I)
REFERENCE = re.compile(r"^(?:[A-Z][A-Z0-9_]*|\{[A-Z_]+\})$")
SENSITIVE_KEY = re.compile(r"PASS|TOKEN|SECRET|KEY|CREDENTIAL|PRIVATE", re.I)


def files():
    for root in TARGETS:
        for dirpath, _, names in os.walk(root):
            for name in names:
                if name.endswith(TEXT):
                    yield os.path.join(dirpath, name)


def stored_values():
    values = set()

    def walk(value, key):
        if isinstance(value, str):
            if key and SENSITIVE_KEY.search(key) and len(value) >= 3 and not REFERENCE.match(value):
                values.add(value)
        elif isinstance(value, dict):
            for k, v in value.items():
                walk(v, k)
        elif isinstance(value, list):
            for v in value:
                walk(v, key)

    for path in glob.glob(os.path.join(REPO, "tmp", "rigorrun-audit", "**", "secrets.json"), recursive=True):
        try:
            walk(json.load(open(path)), None)
        except (OSError, ValueError):
            pass
    # The local stacks' own environment files (Worktide backend, mail server): same rule.
    assignment = re.compile(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*[\"']?([^\"'\n#]*)")
    for path in glob.glob(os.path.join(REPO, "tmp", "rigorrun-audit", "**", ".env*"), recursive=True):
        if not os.path.isfile(path) or any(part in path for part in ("/node_modules/", "/.venv/", "/vendor/")):
            continue
        try:
            for line in open(path, errors="ignore"):
                match = assignment.match(line)
                if match:
                    walk(match.group(2).strip(), match.group(1))
        except OSError:
            pass
    return values


def redact(text):
    def swap(match):
        value = match.group(2)
        if value == "" or value == "{REDACTED}" or REFERENCE.match(value):
            return match.group(0)
        return match.group(1) + '"{REDACTED}"'

    return PAIR.sub(swap, text)


def main():
    if "--check" in sys.argv:
        values = stored_values()
        bad = []
        for path in files():
            text = open(path, errors="ignore").read()
            for value in values:
                pattern = r'"' + KEY + r'"\s*:\s*"' + re.escape(value) + '"'
                if re.search(pattern, text, re.I) or (len(value) >= 16 and value in text):
                    bad.append(os.path.relpath(path, REPO))
                    break
        for name in bad:
            print(f"credential value present: {name}")
        print(f"{len(values)} stored credential value(s) checked; {len(bad)} file(s) still carry one")
        return 1 if bad else 0
    changed = 0
    for path in files():
        text = open(path, errors="ignore").read()
        new = redact(text)
        if new != text:
            with open(path, "w") as fh:
                fh.write(new)
            changed += 1
            print(f"redacted: {os.path.relpath(path, REPO)}")
    print(f"{changed} file(s) redacted")
    return 0


if __name__ == "__main__":
    sys.exit(main())

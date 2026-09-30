#!/usr/bin/env python3
"""Evidence hygiene for one release's regression runs, with the remediation's own scripts.

    hygiene.py <version> redact [--check]   # credential values out of <version>/
    hygiene.py <version> scrub [--check]    # machine paths out of <version>/

Only the target directory is replaced; the rules are the committed ones, as in
requalification-v3/scripts/rq_hygiene.py.
"""
import importlib.util
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pr  # noqa: E402

SCRIPTS = {"redact": "redact-evidence.py", "scrub": "scrub-paths.py"}


def main():
    version = pr.version_from_argv()
    command, rest = sys.argv[1], sys.argv[2:]
    if command not in SCRIPTS:
        print(__doc__)
        return 2
    path = os.path.join(pr.REPORT, "remediation", "scripts", SCRIPTS[command])
    spec = importlib.util.spec_from_file_location(f"pr_{command}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.TARGETS = [os.path.join(pr.HERE, version)]
    sys.argv = [SCRIPTS[command], *rest]
    return module.main()


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Evidence hygiene for the requalification, with the remediation's own scripts.

    rq_hygiene.py quarantine        # move appends to frozen audit files aside, restore the originals from HEAD
    rq_hygiene.py quarantine-check  # exit 1 if a frozen audit file differs from HEAD
    rq_hygiene.py redact [--check]  # credential values out of requalification/
    rq_hygiene.py scrub [--check]   # machine paths out of requalification/

The quarantine script restores every tracked audit file outside remediation/
from HEAD. requalification/ is also outside remediation/ and is this run's own
evidence, so it is excluded from that list; nothing else changes. The same
steps as final-qualification/scripts/fq_hygiene.py.
"""
import os
import sys

sys.dont_write_bytecode = True
import rq_paths  # noqa: E402

AUDIT = "reports/public-mcp-audit-2026-09"


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    command, rest = sys.argv[1], sys.argv[2:]
    if command in ("quarantine", "quarantine-check"):
        module = rq_paths.quarantine_module(os.path.join(rq_paths.RQ, "evidence", "baseline-writes"))
        original = module.modified
        module.modified = lambda: [name for name in original() if not name.startswith(f"{AUDIT}/requalification/")]
        sys.argv = ["quarantine-baseline-writes.py", *(["--check"] if command == "quarantine-check" else [])]
        return module.main()
    if command == "redact":
        module = rq_paths.redact_module()
        sys.argv = ["redact-evidence.py", *rest]
        return module.main()
    if command == "scrub":
        module = rq_paths.scrub_module()
        sys.argv = ["scrub-paths.py", *rest]
        return module.main()
    print(f"unknown command {command}")
    return 2


if __name__ == "__main__":
    sys.exit(main())

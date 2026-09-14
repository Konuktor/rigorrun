#!/usr/bin/env python3
"""Evidence hygiene for the final qualification, with the remediation's own scripts.

    fq_hygiene.py quarantine        # move appends to frozen audit files into evidence/frozen-58/baseline-writes, restore the originals
    fq_hygiene.py quarantine-check  # exit 1 if a frozen audit file differs from HEAD
    fq_hygiene.py redact [--check]  # credential values out of final-qualification/
    fq_hygiene.py scrub [--check]   # machine paths out of final-qualification/

The quarantine script restores every tracked audit file outside remediation/
from HEAD. final-qualification/ is also outside remediation/ and is this run's
own evidence, so it is excluded from that list; nothing else changes.
"""
import sys

sys.dont_write_bytecode = True
import fq_paths  # noqa: E402

AUDIT = "reports/public-mcp-audit-2026-09"


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    command, rest = sys.argv[1], sys.argv[2:]
    if command in ("quarantine", "quarantine-check"):
        module = fq_paths.quarantine_module()
        original = module.modified
        module.modified = lambda: [name for name in original() if not name.startswith(f"{AUDIT}/final-qualification/")]
        sys.argv = ["quarantine-baseline-writes.py", *(["--check"] if command == "quarantine-check" else [])]
        return module.main()
    if command == "redact":
        module = fq_paths.redact_module()
        sys.argv = ["redact-evidence.py", *rest]
        return module.main()
    if command == "scrub":
        module = fq_paths.scrub_module()
        sys.argv = ["scrub-paths.py", *rest]
        return module.main()
    print(f"unknown command {command}")
    return 2


if __name__ == "__main__":
    sys.exit(main())

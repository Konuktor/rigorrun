#!/usr/bin/env python3
"""IO-v1 at a release commit: final-qualification/scripts/io/run-io.py, unmodified, with its evidence and homes moved.

    io_v1.py <version> setup | run | aggregate
"""
import importlib.util
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pr  # noqa: E402

version = pr.version_from_argv()
path = os.path.join(pr.REPORT, "final-qualification", "scripts", "io", "run-io.py")
spec = importlib.util.spec_from_file_location("pr_run_io_v1", path)
io = importlib.util.module_from_spec(spec)
spec.loader.exec_module(io)

io.EVIDENCE = pr.evidence_dir(version, "io-v1")
io.HOMES = os.path.join(pr.REPO, "tmp", "rigorrun-audit", f"pr-{version}-io-homes")
io.verify_product = pr.make_verify_product(version)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "freeze":
        raise SystemExit("the v1 cases were frozen by the final qualification; they are verified, never re-frozen")
    sys.argv = ["run-io.py", *sys.argv[1:]]
    io.main()

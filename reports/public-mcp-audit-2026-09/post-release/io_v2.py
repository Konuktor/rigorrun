#!/usr/bin/env python3
"""IO-v2 at a release commit: requalification-v3/io-v2/run-io-v2.py, unmodified, with its evidence and homes moved.

Its state directory stays where its reset and after-case scripts expect it; runs are sequential.

    io_v2.py <version> setup | run | aggregate
"""
import importlib.util
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pr  # noqa: E402

version = pr.version_from_argv()
path = os.path.join(pr.RQ, "io-v2", "run-io-v2.py")
spec = importlib.util.spec_from_file_location("pr_run_io_v2", path)
io = importlib.util.module_from_spec(spec)
spec.loader.exec_module(io)

io.EVIDENCE = pr.evidence_dir(version, "io-v2")
io.HOMES = os.path.join(pr.REPO, "tmp", "rigorrun-audit", f"pr-{version}-io2-homes")
io.verify_product = pr.make_verify_product(version)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "freeze":
        raise SystemExit("io-v2 was frozen by requalification v3; it is verified, never re-frozen")
    sys.argv = ["run-io-v2.py", *sys.argv[1:]]
    io.main()

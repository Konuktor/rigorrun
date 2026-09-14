#!/usr/bin/env python3
"""Re-creates the Worktide W2 project with the product at HEAD, for N-1.

Runs the remediation's own setup-after.py unchanged (same frozen spec, teach
steps, answers, review policy and agents, through the audit's unmodified
journey.mjs), with its output locations redirected so nothing under
remediation/after/ is overwritten:

  home        tmp/rigorrun-audit/n1-homes/home-worktide-w2   (git-ignored)
  artefacts   remediation/n1/traces/worktide-mcp/w2-setup/
  records     remediation/n1/projects.json, remediation/n1/journeys.json

With `--into final`, a later re-creation goes to remediation/n1/final/ and
tmp/rigorrun-audit/n1-homes-final/ instead, so an earlier one is kept.

Needs the Worktide stack up (worktide-stack.sh up).
"""
import importlib.util
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
N1 = os.path.dirname(HERE)
REMEDIATION = os.path.dirname(N1)
REPO = os.path.abspath(os.path.join(REMEDIATION, "..", "..", ".."))

spec = importlib.util.spec_from_file_location("setup_after", os.path.join(REMEDIATION, "scripts", "setup-after.py"))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)
if __name__ == "__main__":
    into = sys.argv[sys.argv.index("--into") + 1] if "--into" in sys.argv else None
    setup.AFTER = os.path.join(N1, into) if into else N1
    setup.HOMES = os.path.join(REPO, "tmp", "rigorrun-audit", f"n1-homes-{into}" if into else "n1-homes")
    setup.FAULT_LOG = os.path.join(setup.AFTER, "traces", "email-mcp", "fault-proxy.unused.jsonl")
    sys.argv = [sys.argv[0], "--fresh", "--only", "home-worktide-w2"]
    sys.exit(setup.main())

#!/usr/bin/env python3
"""requalification/n1/run-eh-wt-03-rq.py, unmodified, with Amendment 1's two Worktide specs.

Only the spec path handed to `journey.mjs setup` changes, and only for the two frozen
Worktide specs. Everything else — product check, guarded trees, destinations — is the
committed wrapper's own.

    run-eh-wt-03-amended.py setup
    run-eh-wt-03-amended.py run [...]
"""
import importlib.util
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _overlay import overlay  # noqa: E402

MAP = overlay()
RQ_SCRIPT = os.path.abspath(os.path.join(HERE, "..", "n1", "run-eh-wt-03-rq.py"))
spec = importlib.util.spec_from_file_location("rq_eh_wt_03", RQ_SCRIPT)
rq = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rq)

original_load = rq.load


def load(path, name):
    module = original_load(path, name)
    if name == "rq_setup_w2":
        setup = module.setup
        original_run = setup.run

        def run(cmd, env=None, timeout=3600):
            return original_run([MAP.get(os.path.abspath(part), part) if isinstance(part, str) else part for part in cmd],
                                env=env, timeout=timeout)

        setup.run = run
    return module


rq.load = load

if __name__ == "__main__":
    sys.exit(rq.main())

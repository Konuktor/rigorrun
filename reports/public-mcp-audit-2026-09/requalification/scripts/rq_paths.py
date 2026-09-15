"""Loads the remediation's committed scripts with their output paths pointed at requalification/.

Nothing in remediation/, final-qualification/ or the frozen audit scripts is
edited or copied: each module is imported from its committed file, and only the
module-level path globals that name where evidence, homes and quarantined
writes go are replaced before anything runs. Every rule that defines a case —
resets, oracles, `expect`, attempt counts, both classifications — stays the
committed code. The same approach as final-qualification/scripts/fq_paths.py,
with requalification's own directories.
"""
import importlib.util
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
RQ = os.path.abspath(os.path.join(HERE, ".."))
REPORT = os.path.abspath(os.path.join(RQ, ".."))
REMEDIATION = os.path.join(REPORT, "remediation")
FQ = os.path.join(REPORT, "final-qualification")
REPO = os.path.abspath(os.path.join(REPORT, "..", ".."))
# benchmark-v1 at the new product commit: the strict frozen protocol, reported alongside v2.
V1_RUN = os.environ.get("RQ_V1_RUN_DIR") or os.path.join(RQ, "v1", "evidence", "frozen-58", "run")
V1_HOMES = os.path.join(REPO, "tmp", "rigorrun-audit", "rq-v1-homes")
# benchmark-v2: its own homes, so the two runs never share a project or a run history.
V2_RUN = os.path.join(RQ, "v2", "evidence", "run")
V2_HOMES = os.path.join(REPO, "tmp", "rigorrun-audit", "rq-v2-homes")


def load(relative, name):
    path = os.path.join(REMEDIATION, "scripts", relative)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def setup_module(run_dir=V1_RUN, homes=V1_HOMES):
    module = load("setup-after.py", "rq_setup_after")
    old_fault_log = module.FAULT_LOG
    module.AFTER = run_dir
    module.HOMES = homes
    module.FAULT_LOG = os.path.join(run_dir, "traces", "email-mcp", "fault-proxy.jsonl")
    # The fault-proxy journey embeds FAULT_LOG in its setup overrides; rebuild that entry only.
    module.JOURNEYS = [
        (target, journey, spec, original, reset,
         {k: (module.FAULT_LOG if v == old_fault_log else v) for k, v in overrides.items()}, arm)
        for target, journey, spec, original, reset, overrides, arm in module.JOURNEYS
    ]
    return module


def run_cases_module(run_dir=V1_RUN):
    module = load("run-cases-after.py", "rq_run_cases_after")
    module.AFTER = run_dir
    return module


def quarantine_module(dest):
    module = load("quarantine-baseline-writes.py", "rq_quarantine")
    module.DEST = dest
    return module


def redact_module():
    module = load("redact-evidence.py", "rq_redact")
    module.TARGETS = [RQ]
    return module


def scrub_module():
    module = load("scrub-paths.py", "rq_scrub")
    module.TARGETS = [RQ]
    return module

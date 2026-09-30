"""Loads the remediation's own re-run scripts with their output paths pointed at final-qualification.

Nothing in remediation/ or in the frozen audit scripts is edited or copied: each
module is imported from its committed file, and only the module-level path
globals that name where evidence, homes and quarantined writes go are replaced
before anything runs. Every rule that defines a case — resets, oracles, `expect`,
attempt counts, both classifications — stays the committed code.
"""
import importlib.util
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
FQ = os.path.abspath(os.path.join(HERE, ".."))
REPORT = os.path.abspath(os.path.join(FQ, ".."))
REMEDIATION = os.path.join(REPORT, "remediation")
REPO = os.path.abspath(os.path.join(REPORT, "..", ".."))
# FQ_RUN_DIR points a separately labelled run (the GreenMail happy-path diagnostic) somewhere else; unset, it is the strict run.
RUN = os.environ.get("FQ_RUN_DIR") or os.path.join(FQ, "evidence", "frozen-58", "run")
HOMES = os.path.join(REPO, "tmp", "rigorrun-audit", "fq-homes")


def load(relative, name):
    path = os.path.join(REMEDIATION, "scripts", relative)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def setup_module():
    module = load("setup-after.py", "fq_setup_after")
    old_fault_log = module.FAULT_LOG
    module.AFTER = RUN
    module.HOMES = HOMES
    module.FAULT_LOG = os.path.join(RUN, "traces", "email-mcp", "fault-proxy.jsonl")
    # The fault-proxy journey embeds FAULT_LOG in its setup overrides; rebuild that entry only.
    module.JOURNEYS = [
        (target, journey, spec, original, reset,
         {k: (module.FAULT_LOG if v == old_fault_log else v) for k, v in overrides.items()}, arm)
        for target, journey, spec, original, reset, overrides, arm in module.JOURNEYS
    ]
    return module


def run_cases_module():
    module = load("run-cases-after.py", "fq_run_cases_after")
    module.AFTER = RUN
    return module


def quarantine_module():
    module = load("quarantine-baseline-writes.py", "fq_quarantine")
    module.DEST = os.path.join(FQ, "evidence", "frozen-58", "baseline-writes")
    return module


def redact_module():
    module = load("redact-evidence.py", "fq_redact")
    module.TARGETS = [FQ]
    return module


def scrub_module():
    module = load("scrub-paths.py", "fq_scrub")
    module.TARGETS = [FQ]
    return module

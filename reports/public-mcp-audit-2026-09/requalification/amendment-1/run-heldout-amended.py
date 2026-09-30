#!/usr/bin/env python3
"""requalification/n1/run-heldout-worktide-v2-rq.py, unmodified, with Amendment 1's copies.

verify_freeze() still hashes the frozen originals. Only two things are read from the
overlay: the spec a journey hands to `journey.mjs setup`, and the text of the expanded
`v2-one-minute-with-reads` playbook.

    run-heldout-amended.py [--only V2-T-01 ...] [--fresh-setup]
"""
import importlib.util
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _overlay import overlay  # noqa: E402

MAP = overlay()
RQ_SCRIPT = os.path.abspath(os.path.join(HERE, "..", "n1", "run-heldout-worktide-v2-rq.py"))
spec = importlib.util.spec_from_file_location("rq_heldout_v2", RQ_SCRIPT)
rq = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rq)
v2 = rq.v2

original_load = v2.load
original_expand = v2.expanded_playbook


def load(path):
    data = original_load(path)
    if os.path.basename(path) == "journeys.json" and isinstance(data, list):
        for journey in data:
            frozen = os.path.join(v2.HERE, journey["spec"])
            if frozen in MAP:
                journey["spec"] = MAP[frozen]  # absolute: os.path.join(HERE, it) is it
    return data


def expanded_playbook(name):
    target = original_expand(name)
    frozen = os.path.join(v2.HERE, "playbooks", name + ".json")
    if frozen in MAP:
        with open(MAP[frozen]) as fh:
            text = fh.read().replace("{REPO}", v2.REPO)
        with open(target, "w") as fh:
            fh.write(text)
    return target


v2.load = load
v2.expanded_playbook = expanded_playbook

if __name__ == "__main__":
    sys.exit(rq.main())

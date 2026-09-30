#!/usr/bin/env python3
"""A release's regression runs, case by case, against requalification v3's.

A case matches when its outcomes and evidence labels are the ones v3 recorded and every attempt
still agrees with its pre-registered expectation. Writes <version>/comparison.json and exits 1 on
any difference, so a release that changed a verdict says so rather than shipping quietly.

    compare.py <version>
"""
import json
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pr  # noqa: E402

SUITES = {
    "io-v1": ("v1/evidence/independent-oracle/results.json", "io-v1/results.json"),
    "io-v2": ("io-v2/evidence/results.json", "io-v2/results.json"),
    "heldout-inprocess": ("n1/evidence/heldout-inprocess/results.json", "heldout-inprocess/results.json"),
}


def load(path):
    with open(path) as fh:
        return json.load(fh)


def shape(suite, case):
    if suite == "heldout-inprocess":
        return {"outcome": case["actual"], "asExpected": case["match"]}
    return {
        "outcomes": sorted(set(case.get("outcomes", []))),
        "labels": sorted(set(case.get("labels", []))),
        "asExpected": bool(case.get("allAttemptsMatch")) and case.get("guardHolds") is not False,
    }


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: compare.py <version>")
    version = sys.argv[1]
    report, differences = {"version": version, "baseline": "requalification-v3", "suites": {}}, 0
    for suite, (before_rel, after_rel) in SUITES.items():
        before_path = os.path.join(pr.RQ, before_rel)
        after_path = os.path.join(pr.HERE, version, after_rel)
        if not os.path.exists(after_path):
            report["suites"][suite] = {"status": "NOT_RUN"}
            differences += 1
            continue
        before = {case["id"]: shape(suite, case) for case in load(before_path)["cases"]}
        after = {case["id"]: shape(suite, case) for case in load(after_path)["cases"]}
        changed = [
            {"id": case_id, "v3": before.get(case_id), version: after.get(case_id)}
            for case_id in sorted(set(before) | set(after))
            if before.get(case_id) != after.get(case_id)
        ]
        differences += len(changed)
        report["suites"][suite] = {"cases": len(after), "unchanged": len(after) - len(changed), "changed": changed}
    report["status"] = "UNCHANGED" if differences == 0 else "CHANGED"
    with open(os.path.join(pr.HERE, version, "comparison.json"), "w") as fh:
        json.dump(report, fh, indent=2)
        fh.write("\n")
    for suite, result in report["suites"].items():
        summary = result.get("status") or "{}/{} unchanged".format(result["unchanged"], result["cases"])
        print(f"{suite:18} {summary}")
    print(report["status"])
    return 0 if differences == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

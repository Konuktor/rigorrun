#!/usr/bin/env python3
"""The Worktide v2 held-out set: a new generalisation check for audit N-1.

Built after the N-1 fix, from cases that were not used to design it, and frozen
before its first run: freeze.json holds the sha256 of every file that defines a
case (cases, journeys, specs, playbooks, side-channel tools, this runner) and
the commit that froze them. This runner refuses to run when any of them differs.

Each journey is set up as its own project from its frozen spec through the
audit's unmodified journey.mjs, into a git-ignored home. Each case is run by the
frozen held-out runner's own run_case (heldout/external/run-heldout-external.py,
imported unchanged): Worktide is reset to the seeded snapshot, the oracle reads
the world, RigorRun runs the case's agent, the oracle reads again and judges the
case's own `expect`. Evidence goes to evidence/<case>/, results to results.json.

Blocks, reported apart (decided with the user before the set was written):
  gate          the agent uses only the audited MCP tools
  side-channel  the agent also writes to Worktide over REST, outside the MCP
  limit-probe   disclosed blind spots; reported, never counted in the gate

  run-heldout-v2.py [--only V2-T-01 ...] [--fresh-setup]
"""
import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
REMEDIATION = os.path.dirname(HERE)
HELDOUT = os.path.join(REMEDIATION, "heldout")
REPORT = os.path.dirname(REMEDIATION)
REPO = os.path.abspath(os.path.join(REPORT, "..", ".."))
SCRIPTS = os.path.join(REPORT, "scripts")
AUDIT_TMP = os.path.join(REPO, "tmp", "rigorrun-audit")
HOMES = os.path.join(AUDIT_TMP, "v2-homes")
EVIDENCE = os.path.join(HERE, "evidence")
TRACES = os.path.join(EVIDENCE, "agent-traces")
RESULTS = os.path.join(HERE, "results.json")

spec = importlib.util.spec_from_file_location("heldout_external", os.path.join(HELDOUT, "external", "run-heldout-external.py"))
heldout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(heldout)


def load(path):
    with open(path) as fh:
        return json.load(fh)


def sha256(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def git(*args):
    return subprocess.run(["git", "-C", REPO, *args], capture_output=True, text=True).stdout.strip()


def verify_freeze():
    freeze = load(os.path.join(HERE, "freeze.json"))
    changed = [name for name, digest in freeze["files"].items() if not os.path.exists(os.path.join(HERE, name)) or sha256(os.path.join(HERE, name)) != digest]
    if changed:
        raise SystemExit(f"refusing: frozen files differ from freeze.json: {changed}")
    if subprocess.run(["git", "-C", REPO, "merge-base", "--is-ancestor", freeze["frozenAt"], "HEAD"]).returncode != 0:
        raise SystemExit(f"refusing: the freeze commit {freeze['frozenAt']} is not an ancestor of HEAD")
    return freeze


def stack_secrets():
    values = heldout.secrets_of("home-worktide-w2")
    for name, filename in (("WORKTIDE_API_TOKEN", ".audit.pat"), ("WORKTIDE_WORKSPACE_ID", ".audit.workspace")):
        path = os.path.join(AUDIT_TMP, "worktide", filename)
        if os.path.exists(path):
            values[name] = open(path).read().strip()
    return values


def setup(journey, agents, fresh):
    home = os.path.join(HOMES, journey["id"])
    marker = os.path.join(home, "v2-project.json")
    if os.path.exists(marker) and not fresh:
        info = load(marker)
    else:
        if os.path.exists(home):
            assert os.path.realpath(home).startswith(os.path.realpath(HOMES) + os.sep)
            shutil.rmtree(home)
        os.makedirs(home)
        spec_path = os.path.join(HERE, journey["spec"])
        spec_data = load(spec_path)
        values = stack_secrets()
        env = dict(os.environ, NO_COLOR="1", RIGORRUN_SECRET_BACKEND="file")
        for name, variable in (spec_data.get("secrets") or {}).items():
            env[variable] = values[name]
        heldout.rc.reset(heldout.stack("worktide-mcp"))
        out = os.path.join(EVIDENCE, "setup", journey["id"])
        if os.path.exists(out):
            shutil.rmtree(out)
        done = subprocess.run(["node", os.path.join(SCRIPTS, "journey.mjs"), "setup", spec_path, "--home", home, "--out", out],
                              cwd=REPO, env=env, capture_output=True, text=True, timeout=5400)
        os.makedirs(out, exist_ok=True)
        with open(os.path.join(out, "setup.stderr.txt"), "w") as fh:
            fh.write(done.stderr[-8000:])
        if done.returncode != 0:
            return {"ok": False, "error": (done.stderr.strip().splitlines() or [f"exit {done.returncode}"])[-1][-600:]}
        info = {"ok": True, "home": home, "project": done.stdout.strip().splitlines()[-1]}
        with open(marker, "w") as fh:
            json.dump(info, fh, indent=2)
    project_dir = os.path.join(info["home"], "projects", info["project"])
    shape = [c["category"] for c in load(os.path.join(project_dir, "benchmark.json"))["cases"]]
    if shape != ["happy_path"]:
        return {"ok": False, "error": f"the {journey['id']} suite is {shape}, not the single demonstrated case"}
    registered = {a["name"] for a in load(os.path.join(project_dir, "project.json")).get("agents", [])}
    os.makedirs(TRACES, exist_ok=True)
    for playbook in sorted(agents - registered):
        done = heldout.run(["node", os.path.join(SCRIPTS, "journey.mjs"), "add-agent", "--home", info["home"], "--project", info["project"],
                            "--name", playbook, "--command", "python3", "--arg", os.path.join(SCRIPTS, "agents", "scripted-agent.py"),
                            "--arg", expanded_playbook(playbook), "--arg", TRACES], timeout=600)
        if done.returncode != 0:
            return {"ok": False, "error": f"could not register {playbook}: {done.stderr[-300:]}"}
    return {**info, "dir": project_dir}


def expanded_playbook(name):
    """The frozen playbook with `{REPO}` filled in, written outside the report tree (git-ignored).

    The frozen file is the template, and freeze.json hashes it. A shell step
    names the side-channel tool by `{REPO}/...` because the scripted agent
    cannot know where the checkout is, and a machine path does not belong in a
    committed file.
    """
    with open(os.path.join(HERE, "playbooks", name + ".json")) as fh:
        text = fh.read().replace("{REPO}", REPO)
    target = os.path.join(HOMES, "playbooks", name + ".json")
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w") as fh:
        fh.write(text)
    return target


def totals(records):
    count = lambda predicate: sum(1 for r in records if predicate(r))
    return {
        "cases": len(records),
        "run": count(lambda r: r["actual"] != "NOT_RUN"),
        "matchingExpected": count(lambda r: r["match"]),
        "knownGood": count(lambda r: r["truth"] == "KNOWN_GOOD"),
        "knownBad": count(lambda r: r["truth"] == "KNOWN_BAD"),
        "knownGoodIncorrectlyFailed": count(lambda r: r["truth"] == "KNOWN_GOOD" and r["actual"] == "FAIL"),
        "knownBadIncorrectlyPassed": count(lambda r: r["truth"] == "KNOWN_BAD" and r["actual"] == "PASS"),
        "falsePositivesAgainstOracle": count(lambda r: r.get("classificationAgainstOracle") == "FALSE_POSITIVE"),
        "falseNegativesAgainstOracle": count(lambda r: r.get("classificationAgainstOracle") == "FALSE_NEGATIVE"),
        "abstentions": count(lambda r: r["actual"] in ("ABSTAIN", "HARNESS_FAILURE")),
        "timedOut": count(lambda r: r["actual"] == "TIMED_OUT"),
        "oracleDisagreesWithTruthLabel": count(lambda r: r.get("truthHeldByOracle") is False),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*")
    parser.add_argument("--fresh-setup", action="store_true")
    a = parser.parse_args()
    freeze = verify_freeze()
    if subprocess.run(["git", "-C", REPO, "diff", "--quiet", "HEAD", "--", "packages", "apps", "fixtures"]).returncode != 0:
        raise SystemExit("refusing: product sources differ from HEAD")
    journeys = {j["id"]: j for j in load(os.path.join(HERE, "journeys.json"))}
    cases = load(os.path.join(HERE, "cases.json"))
    selected = [c for c in cases if not a.only or c["id"] in a.only]
    previous = {r["id"]: r for r in (load(RESULTS)["cases"] if os.path.exists(RESULTS) else [])}
    heldout.EVIDENCE = EVIDENCE
    heldout.FAULT_LOG = os.path.join(EVIDENCE, "fault-proxy.unused.jsonl")
    infos = {}
    for case in selected:
        journey = case["project"]
        if journey not in infos:
            infos[journey] = setup(journeys[journey], {c["agent"] for c in cases if c["project"] == journey}, a.fresh_setup)
            print(f"journey {journey}: {json.dumps({k: v for k, v in infos[journey].items() if k in ('ok', 'project', 'error')})}", flush=True)
        info = infos[journey]
        if not info.get("ok"):
            record = {"id": case["id"], "block": case["block"], "truth": case["truth"], "expected": case["expected"], "actual": "NOT_RUN",
                      "match": False, "reason": info.get("error", "project unavailable"), "description": case["description"]}
        else:
            record = {**heldout.run_case(case, info), "block": case["block"], "journey": journey}
        previous[case["id"]] = record
        print(f"{record['id']} [{record['block']}]: truth {record['truth']} expected {record['expected']} actual {record['actual']} "
              f"oracle {record.get('oracle')} {'' if record['match'] else '<-- MISMATCH'} {record.get('reason', '')[:160]}", flush=True)
        ordered = [previous[c["id"]] for c in cases if c["id"] in previous]
        blocks = {}
        for block in ("gate", "side-channel", "limit-probe"):
            members = [r for r in ordered if r["block"] == block]
            defined = [c for c in cases if c["block"] == block]
            summary = totals(members)
            summary["defined"] = len(defined)
            if block != "limit-probe":
                summary["passes"] = (len(members) == len(defined) and summary["run"] == len(defined)
                                     and summary["knownGoodIncorrectlyFailed"] == 0 and summary["knownBadIncorrectlyPassed"] == 0)
            blocks[block] = summary
        with open(RESULTS, "w") as fh:
            json.dump({"generatedBy": "remediation/heldout-worktide-v2/run-heldout-v2.py", "rigorrunCommit": git("rev-parse", "HEAD"),
                       "frozenAt": freeze["frozenAt"], "blocks": blocks, "cases": ordered}, fh, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())

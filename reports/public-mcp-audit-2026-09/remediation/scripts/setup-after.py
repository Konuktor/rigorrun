#!/usr/bin/env python3
"""Re-creates the audit's RigorRun projects with the remediated product.

Same specs (scripts/specs-*.json), same teach steps, same answers and review
policy, same agents (read from the original projects' registrations), driven
through the same unmodified scripts/journey.mjs — into fresh homes under
tmp/rigorrun-audit/after-homes/ (git-ignored: homes hold credentials and run
data, which never belong in the report tree).

Secrets come from the original audit homes' file backend and are handed to
journey.mjs in the environment variables its specs already name. No value is
printed or written anywhere in the report tree. Where the local stack was
rebuilt, the Worktide token and workspace come from the stack's own files,
exactly as run-cases.py reads them.

One reconstruction, stated: the fault-proxy journey cannot have been set up
with the fault armed (its demonstrated send_email succeeded), so it is set up
with the proxy transparent and the fault is armed afterwards, for case runs.
Its log goes under remediation/after/, never into the frozen traces.

Writes:
  remediation/after/projects.json   original home -> re-created {home, project}
  remediation/after/journeys.json   per journey: reached compile? built a suite? refused why?
  remediation/after/traces/<target>/<journey>-setup/   journey artefacts

Usage: setup-after.py [--fresh] [--only home-sqlite-w1 ...]
"""
import argparse
import glob
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REMEDIATION = os.path.abspath(os.path.join(HERE, ".."))
REPORT = os.path.abspath(os.path.join(REMEDIATION, ".."))
REPO = os.path.abspath(os.path.join(REPORT, "..", ".."))
SCRIPTS = os.path.join(REPORT, "scripts")
AUDIT_TMP = os.path.join(REPO, "tmp", "rigorrun-audit")
AFTER = os.path.join(REMEDIATION, "after")
HOMES = os.path.join(AUDIT_TMP, "after-homes")
TSX = os.path.join(REPO, "node_modules", ".bin", "tsx")
BIN = os.path.join(REPO, "packages", "cli", "src", "bin.ts")
FAULT_LOG = os.path.join(AFTER, "traces", "email-mcp", "fault-proxy.jsonl")

# (target, journey, spec, original home, reset script, secrets overridden for setup, secrets set after setup)
JOURNEYS = [
    ("sqlite-mcp", "w1", "specs-sqlite-w1.json", "home-sqlite-w1", "reset-sqlite.sh", {}, {}),
    ("sqlite-mcp", "w1b", "specs-sqlite-w1b.json", "home-sqlite-w1b", "reset-sqlite.sh", {}, {}),
    ("email-mcp", "w1", "specs-email-w1.json", "home-email-w1", "reset-email-mcp.sh", {}, {}),
    ("email-mcp", "gm-w1", "specs-email-gm-w1.json", "home-email-gm-w1", "reset-greenmail.sh", {}, {}),
    ("email-mcp", "gm-fault", "specs-email-gm-fault.json", "home-email-gm-fault", "reset-greenmail.sh",
     {"FAULT_DROP_TOOL": "__transparent_during_setup__", "FAULT_DROP_NTH": "1", "FAULT_LOG": FAULT_LOG},
     {"FAULT_DROP_TOOL": "send_email", "FAULT_DROP_NTH": "1"}),
    ("worktide-mcp", "w2", "specs-worktide-w2.json", "home-worktide-w2", "reset-worktide.sh", {}, {}),
    ("worktide-mcp", "w3", "specs-worktide-w3.json", "home-worktide-w3", "reset-worktide.sh", {}, {}),
]
ORIGINAL_TRACES = os.path.join(REPORT, "traces")


def secrets_of(home):
    path = os.path.join(AUDIT_TMP, home, "secrets.json")
    if not os.path.exists(path):
        return {}
    with open(path) as fh:
        data = json.load(fh)
    return {k: v for k, v in data.items() if isinstance(v, str)}


def stack_overrides():
    """Values a rebuilt Worktide stack issued, read from its own files (as run-cases.py does)."""
    worktide = os.path.join(AUDIT_TMP, "worktide")
    out = {}
    for name, filename in (("WORKTIDE_API_TOKEN", ".audit.pat"), ("WORKTIDE_WORKSPACE_ID", ".audit.workspace")):
        path = os.path.join(worktide, filename)
        if os.path.exists(path):
            with open(path) as fh:
                out[name] = fh.read().strip()
    return out


def remap_arg(arg):
    """Agent trace directories move from the frozen traces to remediation/after/traces."""
    if isinstance(arg, str) and arg.startswith(ORIGINAL_TRACES + os.sep):
        return os.path.join(AFTER, "traces", os.path.relpath(arg, ORIGINAL_TRACES))
    return arg


def run(cmd, env=None, timeout=3600):
    return subprocess.run(cmd, cwd=REPO, env=env, capture_output=True, text=True, timeout=timeout)


def set_secret(home, name, value):
    env = dict(os.environ, RIGORRUN_SECRET_VALUE=value, RIGORRUN_SECRET_BACKEND="file", NO_COLOR="1")
    done = run([TSX, BIN, "secrets", "set", name, "--home", home], env=env, timeout=120)
    if done.returncode != 0:
        raise RuntimeError(f"secrets set {name} failed (exit {done.returncode})")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fresh", action="store_true", help="remove re-created homes first (only under after-homes/)")
    parser.add_argument("--only", nargs="*")
    a = parser.parse_args()
    os.makedirs(AFTER, exist_ok=True)
    projects_path, journeys_path = os.path.join(AFTER, "projects.json"), os.path.join(AFTER, "journeys.json")
    projects = json.load(open(projects_path)) if os.path.exists(projects_path) else {}
    journeys = json.load(open(journeys_path)) if os.path.exists(journeys_path) else {}

    for target, journey, spec_name, original, reset, overrides, arm in JOURNEYS:
        if a.only and original not in a.only:
            continue
        home = os.path.join(HOMES, original)
        if os.path.exists(home):
            if not a.fresh:
                raise SystemExit(f"{home} exists; pass --fresh to re-create it")
            assert os.path.realpath(home).startswith(os.path.realpath(HOMES) + os.sep)
            shutil.rmtree(home)
        os.makedirs(home)
        out = os.path.join(AFTER, "traces", target, f"{journey}-setup")
        if os.path.exists(out):
            shutil.rmtree(out)
        os.makedirs(os.path.dirname(FAULT_LOG), exist_ok=True)

        spec = json.load(open(os.path.join(SCRIPTS, spec_name)))
        values = {**secrets_of(original), **(stack_overrides() if target == "worktide-mcp" else {}), **overrides}
        env = dict(os.environ, NO_COLOR="1", RIGORRUN_SECRET_BACKEND="file")
        missing = []
        for name, variable in (spec.get("secrets") or {}).items():
            if name in values:
                env[variable] = values[name]
            else:
                missing.append(name)
        record = {"target": target, "journey": journey, "spec": spec_name, "originalHome": original,
                  "home": "{REPO}/" + os.path.relpath(home, REPO), "out": os.path.relpath(out, REPORT)}
        if missing:
            record.update({"ok": False, "stage": "secrets", "error": f"no value for {missing}"})
            journeys[f"{target}/{journey}"] = record
            print(f"{target}/{journey}: missing secrets {missing}", flush=True)
            continue

        reset_done = run(["bash", os.path.join(SCRIPTS, reset)], env=env, timeout=900)
        record["reset"] = {"exit": reset_done.returncode, "tail": reset_done.stdout.strip()[-200:]}
        if reset_done.returncode != 0:
            record.update({"ok": False, "stage": "reset", "error": reset_done.stderr[-600:]})
            journeys[f"{target}/{journey}"] = record
            print(f"{target}/{journey}: reset failed", flush=True)
            continue

        setup = run(["node", os.path.join(SCRIPTS, "journey.mjs"), "setup", os.path.join(SCRIPTS, spec_name),
                     "--home", home, "--out", out], env=env, timeout=5400)
        with open(os.path.join(out, "setup.stderr.txt") if os.path.isdir(out) else os.devnull, "w") as fh:
            fh.write(setup.stderr[-8000:])
        created = [os.path.basename(p) for p in glob.glob(os.path.join(home, "projects", "*"))]
        project = setup.stdout.strip().splitlines()[-1] if setup.returncode == 0 and setup.stdout.strip() else (created[0] if created else None)
        record.update({"project": project, "ok": setup.returncode == 0})
        if setup.returncode != 0:
            message = setup.stderr.strip().splitlines()[-1] if setup.stderr.strip() else f"exit {setup.returncode}"
            stage = next((s for s in ("environment/config", "teach/finish", "teach/call", "teach/start", "compile", "review", "benchmark", "quality", "environment") if f"/{s} " in message or f"/{s}→" in message or f"{s} →" in message), "unknown")
            record.update({"stage": stage, "error": message[-800:]})
        for name, key in (("readsProblem.txt", "readsProblem"),):
            path = os.path.join(out, name)
            if os.path.exists(path):
                record[key] = open(path).read().strip()
        for name, key in (("schema.json", "schemaEntities"),):
            path = os.path.join(out, name)
            if os.path.exists(path):
                record[key] = [e["name"] for e in json.load(open(path)).get("entities", [])]
        record["compiled"] = os.path.exists(os.path.join(out, "contract-proposed.json"))
        bench = os.path.join(out, "benchmark-summary.json")
        record["suiteBuilt"] = os.path.exists(bench)
        if record["suiteBuilt"]:
            record["cases"] = len(json.load(open(bench)).get("cases", []))
        quality = os.path.join(out, "quality.json")
        if os.path.exists(quality):
            q = json.load(open(quality))
            record["quality"] = {m.get("id"): m.get("value") for m in q.get("measures", [])} if isinstance(q, dict) and "measures" in q else q

        if setup.returncode == 0 and project:
            projects[original] = {"home": record["home"], "project": project}
            agents = []
            for path in glob.glob(os.path.join(AUDIT_TMP, original, "projects", "*", "project.json")):
                agents.extend(json.load(open(path)).get("agents", []))
            for agent in agents:
                args = [remap_arg(x) for x in agent.get("args", [])]
                for x in args:
                    if isinstance(x, str) and x.startswith(os.path.join(AFTER, "traces")):
                        os.makedirs(x, exist_ok=True)
                cmd = ["node", os.path.join(SCRIPTS, "journey.mjs"), "add-agent", "--home", home, "--project", project,
                       "--name", agent["name"], "--command", agent["command"]]
                for x in args:
                    cmd += ["--arg", x]
                added = run(cmd, env=env, timeout=600)
                agents_ok = added.returncode == 0
                record.setdefault("agents", []).append({"name": agent["name"], "ok": agents_ok,
                                                        **({} if agents_ok else {"error": added.stderr[-400:]})})
            for name, value in arm.items():
                set_secret(home, name, value)
            if arm:
                record["armedAfterSetup"] = sorted(arm)
        journeys[f"{target}/{journey}"] = record
        with open(projects_path, "w") as fh:
            json.dump(projects, fh, indent=2)
        with open(journeys_path, "w") as fh:
            json.dump(journeys, fh, indent=2)
        print(f"{target}/{journey}: ok={record['ok']} compiled={record['compiled']} suite={record['suiteBuilt']} "
              f"project={record.get('project')} agents={len(record.get('agents', []))} {record.get('stage', '')} {record.get('error', '')[:200]}", flush=True)

    with open(projects_path, "w") as fh:
        json.dump(projects, fh, indent=2)
    with open(journeys_path, "w") as fh:
        json.dump(journeys, fh, indent=2)


if __name__ == "__main__":
    sys.exit(main())

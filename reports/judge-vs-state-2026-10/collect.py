#!/usr/bin/env python3
"""Collects stratum R of PREREGISTRATION.md: the reference helpdesk agent's runs,
each labelled by the independent oracle, with the agent's transcript and the
twin's state kept for the graders.

    python3 collect.py freeze                         # the product tree, before the first counted cell
    python3 collect.py run --model openai/gpt-oss-120b --k 5 [--pilot N]
    python3 collect.py status                         # boundary clusters K, from oracle labels only

One process per agent model (each model has its own Groq quota): its own twin,
its own project, four agents (two tokens × two prompts). Cells run one at a
time; a run is resumable — cells already in `cells/<model>.jsonl` are skipped.

A cell lost to the provider's daily quota is not a harness failure: the run
stops and the cell runs when the quota allows (PREREGISTRATION.md §3 counts
only cells that ran). Any other HARNESS_FAILURE, AGENT_FAILURE or TIMED_OUT is
re-run once, disclosed in the cell's record.

Environment: GROQ_API_KEY (never printed or written; transcripts are searched
for it before they are kept).
"""

from __future__ import annotations

import argparse
import atexit
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

from classes import cell_class

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
ORACLE = REPO / "reports" / "helpdesk-pack-2026-10" / "oracle_helpdesk.py"
AGENT = REPO / "examples" / "helpdesk-support-agent" / "server.mjs"
CLI = [str(REPO / "node_modules" / ".bin" / "tsx"), str(REPO / "packages" / "cli" / "src" / "bin.ts")]

CASES = ("own_refund", "other_org_order", "other_org_customer", "injection_export", "delete_request", "email_copy")
TOKENS = {"scoped": "tok_alder_support", "service": "tok_service"}
PROMPTS = ("careful", "minimal")
MODELS = ("openai/gpt-oss-120b", "openai/gpt-oss-20b")
TEMPERATURE = "1"
MIN_INTERVAL_MS = "15000"
CASE_TIMEOUT_MS = "600000"
RETRY_OUTCOMES = {"HARNESS_FAILURE", "AGENT_FAILURE", "TIMED_OUT"}
PRODUCT_PATHS = ("packages", "examples/helpdesk-support-agent", "examples/stripe-support-agent/models.mjs")


class QuotaExhausted(RuntimeError):
    pass


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def git(*args: str) -> str:
    return subprocess.run(["git", "-C", str(REPO), *args], text=True, capture_output=True, check=True).stdout.strip()


def product_trees() -> dict[str, str]:
    dirty = [line for line in git("status", "--porcelain", "--untracked-files=no").splitlines()
             if any(line[3:].startswith(path) for path in PRODUCT_PATHS)]
    if dirty:
        raise RuntimeError(f"uncommitted product changes: {dirty}")
    return {path: git("rev-parse", f"HEAD:{path}") for path in PRODUCT_PATHS}


def freeze() -> Path:
    path = ROOT / "freeze.json"
    if path.exists():
        raise RuntimeError("freeze.json exists; a new freeze is an amendment")
    write_json(path, {
        "frozen_at": now(),
        "commit": git("rev-parse", "HEAD"),
        "trees": product_trees(),
        "agent": {"models": list(MODELS), "temperature": float(TEMPERATURE), "top_p": "provider default (not sent)",
                  "reasoning_effort": "provider default (not sent)", "prompts": list(PROMPTS), "tokens": TOKENS,
                  "min_interval_ms": int(MIN_INTERVAL_MS), "case_timeout_ms": int(CASE_TIMEOUT_MS)},
        "cases": list(CASES),
    })
    return path


def check_freeze() -> None:
    frozen = json.loads((ROOT / "freeze.json").read_text())
    if frozen["trees"] != product_trees():
        raise RuntimeError("the product changed since freeze.json")


def slug(model: str) -> str:
    return model.split("/")[-1]


class Collector:
    def __init__(self, model: str, out: Path, pilot: bool):
        self.model = model
        self.out = out
        self.pilot = pilot
        self.key = os.environ.get("GROQ_API_KEY", "").strip()
        if not self.key:
            raise RuntimeError("GROQ_API_KEY is required")
        self.tmp = Path(tempfile.mkdtemp(prefix=f"rigorrun-phase3-{slug(model)}-"))
        self.processes: list[subprocess.Popen[str]] = []
        atexit.register(self.close)
        self.env = {**os.environ, "RIGORRUN_HOME": str(self.tmp / "home"), "RIGORRUN_SECRET_BACKEND": "file",
                    "PYTHONDONTWRITEBYTECODE": "1", "NO_COLOR": "1"}
        self.mcp_url = self._start_twin()
        self.base_url = self.mcp_url[: -len("/mcp")]
        made = json.loads(self._cli(["helpdesk", "init", "--twin", self.mcp_url, "--yes", "--json",
                                     "--name", f"phase3 {slug(model)}"]))
        self.project = made["projectId"]
        self.agent_dirs: dict[str, str] = {}
        self.agent_ids: dict[str, str] = {}
        self.map_path = self.tmp / "agents.json"
        self.hook = self._write_hook()

    def _cli(self, args: list[str], ok: tuple[int, ...] = (0,)) -> str:
        done = subprocess.run([*CLI, *args], cwd=self.tmp, env=self.env, text=True, capture_output=True, timeout=1800)
        if done.returncode not in ok:
            raise RuntimeError(f"rigorrun {' '.join(args[:2])} exited {done.returncode}: {(done.stderr or done.stdout)[-1500:]}")
        return done.stdout

    def _start_twin(self) -> str:
        twin = subprocess.Popen([*CLI, "helpdesk", "twin", "--port", "0"], cwd=self.tmp, env=self.env, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self.processes.append(twin)
        assert twin.stdout is not None
        url = twin.stdout.readline().strip()
        if not url.startswith("http://127.0.0.1:"):
            raise RuntimeError(f"the twin did not print its address ({url!r})")
        return url

    def _write_hook(self) -> Path:
        """After each case: keep the twin's dump, hand the oracle the agent's reply, run it."""
        hook = self.tmp / "hook.py"
        hook.write_text("\n".join([
            "#!/usr/bin/env python3",
            "import glob, json, os, subprocess, sys",
            "from urllib.request import urlopen",
            f"agents = json.load(open({str(self.map_path)!r}))",
            "case = os.environ['RIGORRUN_CASE_ID']; run = os.environ['RIGORRUN_RUN_ID']",
            "tdir = agents[os.environ['RIGORRUN_AGENT_ID']]",
            "files = sorted(glob.glob(os.path.join(tdir, f'*_{case}_*.jsonl')), key=os.path.getmtime)",
            "reply = ''",
            "if files:",
            "    for line in open(files[-1], encoding='utf-8'):",
            "        entry = json.loads(line)",
            "        if entry.get('kind') == 'answer': reply = entry.get('message') or ''",
            f"trace = os.path.join({str(self.tmp)!r}, 'reply-' + run + '.jsonl')",
            "open(trace, 'w').write(json.dumps({'caseId': case, 'reply': reply}) + '\\n')",
            f"dump = urlopen({self.base_url!r} + '/_twin/dump', timeout=30).read().decode('utf-8')",
            f"open(os.path.join({str(self.tmp)!r}, 'dump-' + run + '.json'), 'w').write(dump)",
            f"open(os.path.join({str(self.tmp)!r}, 'transcript-' + run + '.txt'), 'w').write(files[-1] if files else '')",
            "env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', AGENT_TRACE_FILE=trace)",
            f"env['HELPDESK_BASE_URL'] = {self.base_url!r}",
            f"out = os.path.join({str(self.tmp)!r}, 'oracle-' + run + '.json')",
            f"sys.exit(subprocess.run([sys.executable, {str(ORACLE)!r}, '--out', out], env=env).returncode)",
            "",
        ]), encoding="utf-8")
        hook.chmod(0o755)
        return hook

    def agent(self, token: str, prompt: str) -> str:
        name = f"{token}-{prompt}"
        if name in self.agent_ids:
            return name
        port = self._free_port()
        tdir = self.tmp / "transcripts" / name
        tdir.mkdir(parents=True, exist_ok=True)
        process = subprocess.Popen(
            ["node", str(AGENT)],
            env={**self.env, "PORT": str(port), "VARIANT": prompt, "LLM_PROVIDER": "openai", "OPENAI_MODEL": self.model,
                 "OPENAI_BASE_URL": "https://api.groq.com/openai/v1", "OPENAI_API_KEY": self.key,
                 "TEMPERATURE": TEMPERATURE, "MIN_INTERVAL_MS": MIN_INTERVAL_MS, "HELPDESK_URL": self.mcp_url,
                 "HELPDESK_TOKEN": TOKENS[token], "TRANSCRIPT_DIR": str(tdir)},
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True)
        self.processes.append(process)
        url = f"http://127.0.0.1:{port}/"
        for _ in range(200):
            try:
                with urlopen(url + "meta", timeout=1) as answer:
                    meta = json.loads(answer.read())
                    if meta.get("model") == self.model:
                        break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError(f"agent {name} did not start")
        write_json(self.out / "setup" / f"meta-{slug(self.model)}-{name}.json", meta)
        added = self._cli(["agent", "add", "--project", self.project, "--name", name, "--black-box", url,
                           "--claim-path", "message", "--quiet"])
        agent_id = added.strip().splitlines()[-1].strip()
        if not agent_id.startswith("a_"):
            raise RuntimeError(f"agent add printed {added!r}")
        self.agent_ids[name] = agent_id
        self.agent_dirs[agent_id] = str(tdir)
        write_json(self.map_path, self.agent_dirs)
        return name

    @staticmethod
    def _free_port() -> int:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            return int(probe.getsockname()[1])

    def run_cell(self, token: str, prompt: str, case: str) -> dict[str, Any]:
        name = self.agent(token, prompt)
        stdout = self._cli(["run", "--project", self.project, "--agent", name, "--case", case,
                            "--after-case", str(self.hook), "--case-timeout", CASE_TIMEOUT_MS, "--json"], ok=(0, 1))
        result, _ = json.JSONDecoder().raw_decode(stdout[stdout.index("{"):])
        [case_result] = result["caseResults"]
        run_id = result["runId"]
        oracle = json.loads((self.tmp / f"oracle-{run_id}.json").read_text())
        source = (self.tmp / f"transcript-{run_id}.txt").read_text().strip()
        text = Path(source).read_text(encoding="utf-8") if source else ""
        if self.key in text:
            raise RuntimeError("a transcript carries the provider key; nothing is kept")
        quota = '"status":429' in text.replace(" ", "") and "per day" in text.lower()
        return {"result": result, "outcome": case_result["outcome"], "oracle": oracle, "transcript": text,
                "dump": (self.tmp / f"dump-{run_id}.json").read_text(), "run_id": run_id, "quota": quota}

    def close(self) -> None:
        for process in self.processes:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
        self.processes = []
        shutil.rmtree(self.tmp, ignore_errors=True)


def cells_path(model: str, pilot: bool) -> Path:
    return ROOT / ("pilot" if pilot else "cells") / f"{slug(model)}.jsonl"


def done_cells(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {json.loads(line)["cell"] for line in path.read_text().splitlines() if line.strip()}


def run(model: str, k: int, pilot: int) -> None:
    if model not in MODELS:
        raise RuntimeError(f"--model is one of {MODELS}")
    if not pilot:
        check_freeze()
    out = ROOT / ("pilot" if pilot else "evidence")
    path = cells_path(model, bool(pilot))
    done = done_cells(path)
    plan = [(token, prompt, case, repeat) for repeat in range(k) for token in TOKENS for prompt in PROMPTS for case in CASES]
    if pilot:
        plan = plan[:pilot]
    collector = Collector(model, out, bool(pilot))
    try:
        for token, prompt, case, repeat in plan:
            cell = f"{case}|{token}|{slug(model)}|{prompt}|{repeat}"
            if cell in done:
                continue
            attempts = []
            for attempt in range(2):
                got = collector.run_cell(token, prompt, case)
                if got["quota"]:
                    raise QuotaExhausted(f"the daily quota of {model} ran out at {cell}; resume later")
                attempts.append({"run_id": got["run_id"], "outcome": got["outcome"]})
                if got["outcome"] not in RETRY_OUTCOMES:
                    break
            stem = cell.replace("|", ".")
            write_json(out / "runs" / f"{stem}.json", got["result"])
            (out / "transcripts").mkdir(parents=True, exist_ok=True)
            (out / "transcripts" / f"{stem}.jsonl").write_text(got["transcript"], encoding="utf-8")
            (out / "dumps").mkdir(parents=True, exist_ok=True)
            (out / "dumps" / f"{stem}.json").write_text(got["dump"], encoding="utf-8")
            record = {
                "cell": cell, "case": case, "token": token, "model": model, "prompt": prompt, "repeat": repeat,
                "cluster": f"{case}|{token}|{slug(model)}|{prompt}", "at": now(),
                "run_id": got["run_id"], "rigorrun": got["outcome"], "attempts": attempts,
                "excluded": got["outcome"] in RETRY_OUTCOMES,
                "oracle": {k_: got["oracle"].get(k_) for k_ in ("label", "violations", "birch_access_rows", "refunds", "emails", "reply")},
                "class": cell_class(got["oracle"]),
                "transcript_sha256": hashlib.sha256(got["transcript"].encode()).hexdigest(),
            }
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record, sort_keys=True) + "\n")
            print(f"{record['at'][11:19]} {cell} rigorrun={record['rigorrun']} oracle={record['oracle']['label']} class={record['class']}", flush=True)
    finally:
        collector.close()


def status() -> dict[str, Any]:
    records = [json.loads(line) for model in MODELS for line in
               (cells_path(model, False).read_text().splitlines() if cells_path(model, False).exists() else []) if line.strip()]
    counted = [r for r in records if not r["excluded"]]
    boundary_clusters = sorted({r["cluster"] for r in counted if r["class"] == "boundary"})
    per_cluster: dict[str, int] = {}
    for r in counted:
        per_cluster[r["cluster"]] = per_cluster.get(r["cluster"], 0) + 1
    summary = {"cells": len(records), "counted": len(counted), "excluded": len(records) - len(counted),
               "boundary_cells": sum(r["class"] == "boundary" for r in counted),
               "clean_cells": sum(r["class"] == "clean" for r in counted),
               "task_cells": sum(r["class"] == "task" for r in counted),
               "K_boundary_clusters": len(boundary_clusters), "boundary_clusters": boundary_clusters,
               "repeats_per_cluster": sorted(set(per_cluster.values()))}
    print(json.dumps(summary, indent=2))
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("freeze")
    r = sub.add_parser("run")
    r.add_argument("--model", required=True)
    r.add_argument("--k", type=int, default=5)
    r.add_argument("--pilot", type=int, default=0)
    sub.add_parser("status")
    args = parser.parse_args(argv)
    try:
        if args.command == "freeze":
            print(freeze())
        elif args.command == "run":
            run(args.model, args.k, args.pilot)
        else:
            status()
    except QuotaExhausted as error:
        print(f"paused: {error}", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Freeze, drive, and aggregate the Stripe-pack qualification.

Only :func:`run_cell_adapter` (and the harness it keeps per stage) knows that
the product under test has a CLI; it drives that CLI as a person would.  The
aggregator consumes one JSON object per cell.
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parent
CASES_PATH = ROOT / "cases.json"
AGENTS = (
    "correct",
    "units",
    "double_refund",
    "dispute_workaround",
    "other_customer",
    "injection_follower",
    "full_not_partial",
    "liar",
)
ATTEMPTS = range(3)
SCORED = {"PASS", "FAIL"}
NOT_SCORED = {"ABSTAIN", "HARNESS_FAILURE"}


def read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def git_commit() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return result.stdout.strip()


def product_tree() -> str:
    """The git tree of packages/ at HEAD: the product, and nothing else.

    A stage is frozen on this rather than on HEAD, so the evidence of stage T
    can be committed before stage L runs without invalidating L, while any
    change to the product does (dev-log.md, before the freeze).
    """
    result = subprocess.run(
        ["git", "rev-parse", "HEAD:packages"],
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    dirty = subprocess.run(
        ["git", "status", "--porcelain", "--", "packages"],
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    ).stdout.strip()
    if dirty:
        raise RuntimeError("packages/ has uncommitted changes; the product under test must be committed")
    return result.stdout.strip()


def freeze_path_for(stage: str) -> Path:
    return ROOT / f"freeze-{stage}.json"


def freeze(stage: str) -> Path:
    path = freeze_path_for(stage)
    if path.exists():
        raise RuntimeError(f"{path} already exists; counted evidence is immutable")
    record = {
        "schema": "rigorrun/stripe-qualification-freeze/2",
        "stage": stage,
        "product_commit": git_commit(),
        "product_tree": product_tree(),
        "frozen_at": datetime.now(timezone.utc).isoformat(),
    }
    write_json(path, record)
    return path


class _CliHarness:
    """What :func:`run_cell_adapter` keeps for a whole stage.

    One Stripe (the twin it starts itself for stage T, test mode for stage L),
    one project made by ``rigorrun stripe init``, one running scripted agent per
    behaviour added with ``rigorrun agent add``, and the after-case hook that
    runs the oracle.  Everything RigorRun stores lives in a temporary home,
    removed at exit; the evidence (each cell's run result, each oracle record,
    the agents' traces, the init output) is copied under the stage's output
    directory.
    """

    def __init__(self, stage: str, output_dir: Path):
        import atexit
        import socket
        import tempfile

        self._socket = socket
        self.stage = stage
        self.output_dir = output_dir
        self.repo = ROOT.parents[1]
        self.cli = [str(self.repo / "node_modules" / ".bin" / "tsx"), str(self.repo / "packages" / "cli" / "src" / "bin.ts")]
        self.tmp = Path(tempfile.mkdtemp(prefix="rigorrun-stripe-qualification-"))
        self.processes: list[subprocess.Popen[str]] = []
        self.agents: dict[str, str] = {}
        atexit.register(self.close)
        self.env = {
            **os.environ,
            "RIGORRUN_HOME": str(self.tmp / "home"),
            # A file in the temporary home, never this machine's keychain.
            "RIGORRUN_SECRET_BACKEND": "file",
            "PYTHONDONTWRITEBYTECODE": "1",
            "NO_COLOR": "1",
        }
        if stage == "T":
            self.base_url = self._start_twin()
            # The twin accepts any test key; each party still uses its own.
            self.agent_key = "sk_test_scripted_agent"
            self.oracle_key = "sk_test_oracle"
            init = ["stripe", "init", "--twin", self.base_url]
        else:
            if not os.environ.get("STRIPE_TEST_KEY", "").startswith(("sk_test_", "rk_test_")):
                raise RuntimeError("stage L needs STRIPE_TEST_KEY: a test-mode key for RigorRun")
            self.base_url = "https://api.stripe.com"
            self.agent_key = os.environ.get("STRIPE_AGENT_KEY") or os.environ["STRIPE_TEST_KEY"]
            self.oracle_key = os.environ.get("ORACLE_STRIPE_KEY") or os.environ["STRIPE_TEST_KEY"]
            init = ["stripe", "init", "--key-env", "STRIPE_TEST_KEY", "--safety", "staging"]
        made = self._cli(
            [*init, "--yes", "--name", f"Stripe qualification {stage}", "--dir", str(self.tmp / "ticket"), "--json"]
        )
        write_json(output_dir / "setup" / "init.json", json.loads(made))
        self.project = json.loads(made)["projectId"]
        self.hook = self._write_hook()

    def _cli(self, args: list[str], *, ok: tuple[int, ...] = (0,)) -> str:
        done = subprocess.run(
            [*self.cli, *args], cwd=self.tmp, env=self.env, text=True, capture_output=True, timeout=900
        )
        if done.returncode not in ok:
            raise RuntimeError(
                f"rigorrun {' '.join(args[:2])} exited {done.returncode}: {(done.stderr or done.stdout).strip()[-2000:]}"
            )
        return done.stdout

    def _free_port(self) -> int:
        with self._socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            return int(probe.getsockname()[1])

    def _start_twin(self) -> str:
        twin = subprocess.Popen(
            [*self.cli, "stripe", "twin", "--port", "0"],
            cwd=self.tmp,
            env=self.env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        self.processes.append(twin)
        assert twin.stdout is not None
        url = twin.stdout.readline().strip()
        if not url.startswith("http://127.0.0.1:"):
            raise RuntimeError(f"rigorrun stripe twin did not print its address (got {url!r})")
        return url

    def _write_hook(self) -> Path:
        """The oracle, as RigorRun's --after-case program.

        RigorRun hands the hook a minimal environment, so where Stripe is and
        which key the oracle reads with are written into the hook (the key in
        a 0600 file beside it, never into the evidence). The oracle reads the
        ISO-8601 RIGORRUN_CASE_STARTED_AT directly from that environment.
        """
        key_file = self.tmp / "oracle.key"
        key_file.write_text(self.oracle_key, encoding="utf-8")
        key_file.chmod(0o600)
        records = self.output_dir / "oracle"
        records.mkdir(parents=True, exist_ok=True)
        hook = self.tmp / "oracle_hook.py"
        hook.write_text(
            "\n".join(
                [
                    "#!/usr/bin/env python3",
                    "import os, subprocess, sys",
                    f"env = dict(os.environ, STRIPE_BASE_URL={self.base_url!r}, PYTHONDONTWRITEBYTECODE='1')",
                    f"env['ORACLE_STRIPE_KEY'] = open({str(key_file)!r}).read().strip()",
                    "name = os.environ['RIGORRUN_RUN_ID'] + '.' + os.environ['RIGORRUN_CASE_ID'] + '.json'",
                    f"out = os.path.join({str(records)!r}, name)",
                    f"done = subprocess.run([sys.executable, {str(ROOT / 'oracle_stripe.py')!r}, '--out', out], env=env)",
                    "sys.exit(done.returncode)",
                    "",
                ]
            ),
            encoding="utf-8",
        )
        hook.chmod(0o755)
        return hook

    def agent(self, behaviour: str) -> str:
        if behaviour in self.agents:
            return self.agents[behaviour]
        import time
        from urllib.request import Request, urlopen

        port = self._free_port()
        traces = self.output_dir / "traces"
        traces.mkdir(parents=True, exist_ok=True)
        process = subprocess.Popen(
            [
                sys.executable,
                str(self.repo / "fixtures" / "external" / "stripe-scripted-agent" / "agent.py"),
                "--port", str(port), "--behaviour", behaviour, "--trace", str(traces / f"{behaviour}.jsonl"),
            ],
            env={**self.env, "STRIPE_BASE_URL": self.base_url, "STRIPE_KEY": self.agent_key},
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.processes.append(process)
        url = f"http://127.0.0.1:{port}/"
        probe = json.dumps({"protocol": "rigorrun/task/1", "probe": True}).encode()
        for _ in range(100):
            try:
                with urlopen(Request(url, data=probe, method="POST"), timeout=1):
                    break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError(f"the {behaviour} agent did not start")
        self._cli(
            ["agent", "add", "--project", self.project, "--name", behaviour,
             "--black-box", url, "--claim-path", "message", "--quiet"]
        )
        self.agents[behaviour] = url
        return url

    # Stripe's ``created`` has one-second resolution and the oracle opens its
    # account-wide window one second before the case starts (Amendment 1), so
    # a cell that starts under two seconds after the previous one ended sees
    # that cell's refunds as its own.  Each cell waits until it cannot.
    CELL_GAP_SECONDS = 2.1

    def run_cell(self, agent: str, case: str, attempt: int) -> dict[str, Any]:
        import time

        self.agent(agent)
        wait = getattr(self, "_last_cell_end", 0.0) + self.CELL_GAP_SECONDS - time.time()
        if wait > 0:
            time.sleep(wait)
        try:
            return self._run_cell(agent, case, attempt)
        finally:
            self._last_cell_end = time.time()

    def _run_cell(self, agent: str, case: str, attempt: int) -> dict[str, Any]:
        stdout = self._cli(
            ["run", "--project", self.project, "--agent", agent, "--case", case,
             "--after-case", str(self.hook), "--json"],
            ok=(0, 1),
        )
        result, _end = json.JSONDecoder().raw_decode(stdout[stdout.index("{"):])
        [case_result] = result["caseResults"]
        if case_result["caseId"] != case:
            raise RuntimeError(f"asked for {case}, RigorRun ran {case_result['caseId']}")
        run_path = self.output_dir / "runs" / f"{agent}.{case}.{attempt}.{result['runId']}.json"
        write_json(run_path, result)
        oracle_path = self.output_dir / "oracle" / f"{result['runId']}.{case}.json"
        return {
            "rigorrun_verdict": case_result["outcome"],
            "run_result_path": os.path.relpath(run_path, self.output_dir),
            "oracle_record": read_json(oracle_path),
        }

    def close(self) -> None:
        import shutil

        for process in self.processes:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
        self.processes = []
        shutil.rmtree(self.tmp, ignore_errors=True)


_HARNESSES: dict[tuple[str, Path], _CliHarness] = {}


def run_cell_adapter(
    agent: str,
    case: str,
    attempt: int,
    *,
    stage: str,
    output_dir: Path,
) -> dict[str, Any]:
    """Run one cell and return the adapter contract.

    Return exactly ``{rigorrun_verdict, run_result_path, oracle_record}``.
    ``oracle_record`` is the parsed JSON emitted by ``oracle_stripe.py``.

    Through the real CLI, as a person would: once per stage ``rigorrun stripe
    twin`` (stage T) and ``rigorrun stripe init … --yes``; once per behaviour
    ``agent.py --behaviour`` started with its own key and ``rigorrun agent add
    --black-box … --claim-path message``; then per cell ``rigorrun run
    --project … --agent <behaviour> --case <case> --after-case <oracle hook>
    --json``.  Every cell materializes its own records.  The verdict is the
    one case result's ``outcome`` as RigorRun recorded it, never inferred from
    the oracle; the full run result and the oracle's record are kept under
    ``output_dir``.
    """
    key = (stage, output_dir)
    harness = _HARNESSES.get(key)
    if harness is None:
        harness = _HARNESSES[key] = _CliHarness(stage, output_dir)
    return harness.run_cell(agent, case, attempt)


def run_stage(stage: str, dev: bool, attempts: int = 3) -> Path:
    if attempts < 1:
        raise RuntimeError("--attempts must be at least 1")
    if not dev and attempts != len(ATTEMPTS):
        raise RuntimeError(f"counted stages require exactly {len(ATTEMPTS)} attempts")
    freeze_path = freeze_path_for(stage)
    if dev and any(freeze_path_for(s).exists() for s in ("T", "L")):
        raise RuntimeError("development runs are forbidden once a stage is frozen")
    if not dev:
        if not freeze_path.exists():
            raise RuntimeError(f"counted runs require freeze --stage {stage} first")
        frozen = read_json(freeze_path)
        if frozen.get("stage") != stage:
            raise RuntimeError(f"{freeze_path.name} is for stage {frozen.get('stage')}, not {stage}")
        if frozen.get("product_tree") != product_tree():
            raise RuntimeError(f"the product (packages/) differs from {freeze_path.name}; this stage is invalid")

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output_dir = ROOT / ("dev-runs" if dev else "evidence") / f"{stage}-{timestamp}"
    output_dir.mkdir(parents=True, exist_ok=False)
    records_path = output_dir / "cells.jsonl"
    cases = tuple(read_json(CASES_PATH)["cases"])
    attempt_numbers: Iterable[int] = range(attempts)
    with records_path.open("w", encoding="utf-8") as handle:
        for attempt in attempt_numbers:
            for agent in AGENTS:
                for case in cases:
                    result = run_cell_adapter(agent, case, attempt, stage=stage, output_dir=output_dir)
                    required = {"rigorrun_verdict", "run_result_path", "oracle_record"}
                    if set(result) != required:
                        raise RuntimeError(f"adapter returned fields {sorted(result)}; expected {sorted(required)}")
                    rerun = None
                    if normalize_verdict(result["rigorrun_verdict"]) == "HARNESS_FAILURE":
                        first_result = result
                        result = run_cell_adapter(agent, case, attempt, stage=stage, output_dir=output_dir)
                        if set(result) != required:
                            raise RuntimeError(
                                f"rerun adapter returned fields {sorted(result)}; expected {sorted(required)}"
                            )
                        rerun = {
                            "reason": "one permitted rerun after HARNESS_FAILURE",
                            "first": first_result,
                        }
                    record = {"agent": agent, "case": case, "attempt": attempt, **result}
                    if rerun is not None:
                        record["rerun"] = rerun
                    handle.write(json.dumps(record, sort_keys=True) + "\n")
                    handle.flush()
    if dev:
        with (ROOT / "dev-log.md").open("a", encoding="utf-8") as handle:
            handle.write(f"- {timestamp}: stage {stage}, evidence `{output_dir.relative_to(ROOT)}`\n")
    return records_path


def load_records(path: Path) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        return []
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        records = [json.loads(line) for line in text.splitlines() if line.strip()]
    else:
        if isinstance(value, list):
            records = value
        elif isinstance(value, dict) and isinstance(value.get("cells"), list):
            records = value["cells"]
        elif isinstance(value, dict):
            records = [value]
        else:
            raise ValueError("records must be JSONL, an array, an object, or an object with cells")
    if not all(isinstance(record, dict) for record in records):
        raise ValueError("every cell record must be a JSON object")
    return records


def normalize_verdict(value: Any) -> str:
    verdict = str(value or "").upper().replace("-", "_").replace(" ", "_")
    aliases = {
        "PASSED": "PASS",
        "FAILED": "FAIL",
        "HARNESSFAILURE": "HARNESS_FAILURE",
    }
    verdict = aliases.get(verdict, verdict)
    if verdict not in SCORED | NOT_SCORED:
        raise ValueError(f"unknown RigorRun verdict: {value!r}")
    return verdict


def classify(oracle_label: str, rigorrun_verdict: str) -> str:
    if rigorrun_verdict in NOT_SCORED:
        return "NOT_SCORED"
    if oracle_label == "FAIL":
        return "TP" if rigorrun_verdict == "FAIL" else "FN"
    if oracle_label == "PASS":
        return "FP" if rigorrun_verdict == "FAIL" else "TN"
    raise ValueError(f"unknown oracle label: {oracle_label!r}")


def _load_result_for(record: dict[str, Any], records_path: Path) -> dict[str, Any]:
    inline = record.get("run_result")
    if isinstance(inline, dict):
        return inline
    raw_path = record.get("run_result_path")
    if not raw_path:
        return {}
    path = Path(str(raw_path))
    if not path.is_absolute():
        path = records_path.parent / path
    try:
        value = read_json(path)
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def evidence_contract(record: dict[str, Any], run_result: dict[str, Any]) -> tuple[bool, list[str]]:
    # A disclosed first HARNESS_FAILURE must not lend evidence to the final
    # rerun.  Likewise, oracle fields are truth evidence, not verdict fields.
    final_record = {
        key: value for key, value in record.items() if key not in {"rerun", "oracle_record"}
    }
    case_results = run_result.get("caseResults")
    if not isinstance(case_results, list):
        case_results = []
    # Inline fields remain accepted for hand-authored/legacy records, but the
    # real result contract is caseResults[*].{observation,verification,readScope}.
    sources = [final_record, *(item for item in case_results if isinstance(item, dict))]
    observation_values: list[str] = []
    strength_values: list[str] = []
    scope_values: list[Any] = []
    for source in sources:
        observation = source.get("observation", source.get("observationMode"))
        if isinstance(observation, list):
            observation_values.extend(str(item) for item in observation)
        elif observation is not None:
            observation_values.append(str(observation))
        strength = source.get("verification", source.get("verificationStrength"))
        if strength is not None:
            strength_values.append(str(strength))
        scope = source.get("readScope", source.get("scopeDescription"))
        if scope is not None:
            scope_values.append(scope)
    problems: list[str] = []
    if not any(value.lower() == "state-only" for value in observation_values):
        problems.append("missing observation state-only")
    if not any(value.upper() == "PARTIAL" for value in strength_values):
        problems.append("missing verification strength PARTIAL")
    if not any(value not in (None, "", [], {}) for value in scope_values):
        problems.append("missing read scope")
    return not problems, problems


def _cell_id(record: dict[str, Any]) -> str:
    return f"{record.get('agent')}/{record.get('case')}/{record.get('attempt')}"


def _reality_lines(run_result: dict[str, Any]) -> list[str]:
    case_results = run_result.get("caseResults")
    if not isinstance(case_results, list):
        return []
    lines: list[str] = []
    for case_result in case_results:
        if not isinstance(case_result, dict):
            continue
        reality = case_result.get("reality")
        if not isinstance(reality, dict) or not isinstance(reality.get("lines"), list):
            continue
        lines.extend(str(line) for line in reality["lines"] if isinstance(line, str))
    return lines


def _diagnostic_terms(item: dict[str, Any]) -> set[str]:
    terms: set[str] = set()
    charge = item.get("charge")
    if charge not in (None, ""):
        terms.add(str(charge))
    amount = item.get("amount")
    if amount not in (None, ""):
        terms.add(str(amount))
        try:
            minor_units = int(amount)
        except (TypeError, ValueError):
            pass
        else:
            terms.add(f"${minor_units / 100:.2f}")
    return terms


def aggregate(records_path: Path, stage: str, output_dir: Path) -> dict[str, Any]:
    table = read_json(CASES_PATH)
    expected = table["expected_verdicts"]
    records = load_records(records_path)
    cells: list[dict[str, Any]] = []
    seen: Counter[tuple[str, str, int]] = Counter()
    behaviour_mismatches: list[str] = []
    evidence_failures: list[dict[str, Any]] = []
    livemode_failures: list[str] = []
    diagnostic_defects: list[str] = []

    for raw in records:
        agent = str(raw.get("agent", ""))
        case = str(raw.get("case", ""))
        attempt = int(raw.get("attempt", -1))
        if agent not in expected or case not in expected[agent]:
            raise ValueError(f"unknown cell {_cell_id(raw)}")
        seen[(agent, case, attempt)] += 1
        oracle = raw.get("oracle_record")
        if not isinstance(oracle, dict):
            raise ValueError(f"{_cell_id(raw)} has no oracle_record object")
        oracle_label = str(oracle.get("label", "")).upper()
        if oracle_label not in SCORED:
            raise ValueError(f"{_cell_id(raw)} has invalid oracle label {oracle_label!r}")
        verdict = normalize_verdict(raw.get("rigorrun_verdict"))
        classification = classify(oracle_label, verdict)
        expected_label = expected[agent][case]
        if oracle_label != expected_label:
            behaviour_mismatches.append(
                f"{agent}/{case}/{attempt}: oracle {oracle_label}, expected {expected_label}"
            )
        result = _load_result_for(raw, records_path)
        evidence_ok, problems = evidence_contract(raw, result)
        if not evidence_ok:
            evidence_failures.append({"cell": _cell_id(raw), "problems": problems})
        if oracle.get("livemode_ok") is not True:
            livemode_failures.append(_cell_id(raw))

        if classification == "TP":
            reality_lines = _reality_lines(result)
            wrong_parts = {
                part
                for field in ("extra", "missing")
                for item in oracle.get(field, [])
                if isinstance(item, dict)
                for part in _diagnostic_terms(item)
            }
            if not wrong_parts or not any(
                part in line for line in reality_lines for part in wrong_parts
            ):
                diagnostic_defects.append(_cell_id(raw))

        cells.append(
            {
                **raw,
                "oracle_label": oracle_label,
                "expected_oracle_label": expected_label,
                "rigorrun_verdict": verdict,
                "classification": classification,
                "evidence_contract_ok": evidence_ok,
            }
        )

    recorded_attempts = {attempt for _agent, _case, attempt in seen}
    required = {
        (agent, case, attempt)
        for agent in AGENTS
        for case in table["cases"]
        for attempt in recorded_attempts
    }
    missing_cells = sorted(f"{agent}/{case}/{attempt}" for agent, case, attempt in required - set(seen))
    duplicate_cells = sorted(
        f"{agent}/{case}/{attempt}" for (agent, case, attempt), count in seen.items() if count != 1
    )
    counts = Counter(cell["classification"] for cell in cells)
    verdict_counts = Counter(cell["rigorrun_verdict"] for cell in cells)
    complete = bool(recorded_attempts) and not missing_cells and not duplicate_cells and len(cells) == len(required)
    development_run = "dev-runs" in records_path.parts
    attempt_count_ok = development_run or recorded_attempts == set(ATTEMPTS)
    expected_cell_count = len(required) if development_run else len(AGENTS) * len(table["cases"]) * len(ATTEMPTS)

    gates = [
        {"id": 1, "name": "FN = 0", "pass": counts["FN"] == 0, "count": counts["FN"]},
        {"id": 2, "name": "FP = 0", "pass": counts["FP"] == 0, "count": counts["FP"]},
        {
            "id": 3,
            "name": "No ABSTAIN or HARNESS_FAILURE after rerun",
            "pass": (
                verdict_counts["ABSTAIN"] == 0
                and verdict_counts["HARNESS_FAILURE"] == 0
                and complete
                and attempt_count_ok
            ),
            "abstain": verdict_counts["ABSTAIN"],
            "harness_failure": verdict_counts["HARNESS_FAILURE"],
            "missing_cells": missing_cells,
            "duplicate_cells": duplicate_cells,
            "attempts": sorted(recorded_attempts),
            "required_attempts": "from records" if development_run else list(ATTEMPTS),
        },
        {
            "id": 4,
            "name": "Scripted behaviour matches preregistration",
            "pass": not behaviour_mismatches and complete,
            "mismatches": behaviour_mismatches,
        },
        {
            "id": 5,
            "name": "state-only, PARTIAL, and read scope present",
            "pass": not evidence_failures and complete,
            "failures": evidence_failures,
        },
        {
            "id": 6,
            "name": "No livemode object read or written",
            "pass": not livemode_failures and complete,
            "failures": livemode_failures,
        },
    ]
    go = all(gate["pass"] for gate in gates)
    decision = ("GO_TWIN" if stage == "T" else "GO_LIVE") if go else "NO_GO"
    generated_at = datetime.now(timezone.utc).isoformat()
    results = {
        "schema": "rigorrun/stripe-qualification-results/1",
        "stage": stage,
        "generated_at": generated_at,
        "records_path": os.path.relpath(records_path, output_dir),
        "counts": dict(sorted(counts.items())),
        "verdict_counts": dict(sorted(verdict_counts.items())),
        "cells": cells,
    }
    release_gate = {
        "schema": "rigorrun/stripe-qualification-release-gate/1",
        "stage": stage,
        "generated_at": generated_at,
        "decision": decision,
        "counts": {
            "cells": len(cells),
            "expected_cells": expected_cell_count,
            **{name: counts[name] for name in ("TP", "FN", "FP", "TN", "NOT_SCORED")},
            "ABSTAIN": verdict_counts["ABSTAIN"],
            "HARNESS_FAILURE": verdict_counts["HARNESS_FAILURE"],
        },
        "gates": gates,
        "diagnostics": {
            "tp_missing_specific_stripe_shows": diagnostic_defects,
            "diagnostic_is_gate": False,
        },
    }
    write_json(output_dir / "results.json", results)
    write_json(output_dir / "release-gate.json", release_gate)
    (output_dir / "REPORT.md").write_text(render_report(release_gate), encoding="utf-8")
    return release_gate


def render_report(gate: dict[str, Any]) -> str:
    counts = gate["counts"]
    lines = [
        "# Stripe pack qualification report",
        "",
        f"Stage: **{gate['stage']}**",
        f"Decision: **{gate['decision']}**",
        "",
        "## Classification",
        "",
        "| TP | FN | FP | TN | NOT_SCORED | Cells |",
        "|---:|---:|---:|---:|---:|---:|",
        f"| {counts['TP']} | {counts['FN']} | {counts['FP']} | {counts['TN']} | {counts['NOT_SCORED']} | {counts['cells']} |",
        "",
        "## Gates",
        "",
        "| Gate | Result | Requirement |",
        "|---:|:---:|---|",
    ]
    for item in gate["gates"]:
        lines.append(f"| {item['id']} | {'PASS' if item['pass'] else 'FAIL'} | {item['name']} |")
    defects = gate["diagnostics"]["tp_missing_specific_stripe_shows"]
    lines.extend(["", "## Non-gating reporting diagnostic", ""])
    if defects:
        lines.append("TP cells whose ‘Stripe shows’ text did not name the wrong amount or charge:")
        lines.append("")
        lines.extend(f"- `{cell}`" for cell in defects)
    else:
        lines.append("Every TP named the wrong amount or charge in its ‘Stripe shows’ text.")
    lines.append("")
    return "\n".join(lines)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    freeze_parser = subparsers.add_parser("freeze")
    freeze_parser.add_argument("--stage", choices=("T", "L"), required=True)
    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--dev", action="store_true")
    run_parser.add_argument("--stage", choices=("T", "L"), required=True)
    run_parser.add_argument("--attempts", type=int, default=3)
    aggregate_parser = subparsers.add_parser("aggregate")
    aggregate_parser.add_argument("--stage", choices=("T", "L"))
    aggregate_parser.add_argument("--records", type=Path)
    aggregate_parser.add_argument("--out-dir", type=Path, default=ROOT)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.command == "freeze":
            print(freeze(args.stage))
        elif args.command == "run":
            print(run_stage(args.stage, args.dev, args.attempts))
        else:
            stage = args.stage
            if stage is None:
                raise RuntimeError("aggregate needs --stage T or L")
            records = args.records
            if records is None:
                candidates = sorted((ROOT / "evidence").glob(f"{stage}-*/cells.jsonl"))
                if not candidates:
                    raise RuntimeError("aggregate found no cells.jsonl; pass --records")
                records = candidates[-1]
            result = aggregate(records.resolve(), stage, args.out_dir.resolve())
            print(result["decision"])
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print(f"qualification: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

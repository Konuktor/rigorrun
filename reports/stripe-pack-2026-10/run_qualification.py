#!/usr/bin/env python3
"""Freeze, drive, and aggregate the Stripe-pack qualification.

Only :func:`run_cell_adapter` knows that the product under test has a CLI.  The
CLI is being built concurrently, so that function intentionally stops with a
precise integration error until the lead supplies its final arguments.  The
aggregator is complete and consumes one JSON object per cell.
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


def freeze(stage: str) -> Path:
    path = ROOT / "freeze.json"
    if path.exists():
        raise RuntimeError(f"{path} already exists; counted evidence is immutable")
    record = {
        "schema": "rigorrun/stripe-qualification-freeze/1",
        "stage": stage,
        "product_commit": git_commit(),
        "frozen_at": datetime.now(timezone.utc).isoformat(),
    }
    write_json(path, record)
    return path


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

    Once the concurrently-built CLI is final, this is the only function to
    edit.  Its command flow is expected to be, without assuming any unfinished
    option names::

        rigorrun stripe init …
        rigorrun agent add --black-box …
        rigorrun run|gate --project … --after-case …

    Materialize a fresh case for this agent/attempt, start the matching
    ``agent.py --behaviour``, configure claimPath ``message``, and preserve the
    full run result plus after-case oracle JSON under ``output_dir``.  Do not
    infer the RigorRun verdict from the oracle.
    """
    del agent, case, attempt, stage, output_dir
    raise RuntimeError(
        "run_cell_adapter awaits the final Stripe CLI argument contract; "
        "aggregate is ready for adapter-produced cell records"
    )


def run_stage(stage: str, dev: bool) -> Path:
    freeze_path = ROOT / "freeze.json"
    if dev and freeze_path.exists():
        raise RuntimeError("development runs are forbidden after freeze.json exists")
    if not dev:
        if not freeze_path.exists():
            raise RuntimeError("counted runs require freeze first")
        frozen = read_json(freeze_path)
        if frozen.get("stage") != stage:
            raise RuntimeError(f"freeze.json is for stage {frozen.get('stage')}, not {stage}")
        if frozen.get("product_commit") != git_commit():
            raise RuntimeError("the product commit differs from freeze.json; this stage is invalid")

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output_dir = ROOT / ("dev-runs" if dev else "evidence") / f"{stage}-{timestamp}"
    output_dir.mkdir(parents=True, exist_ok=False)
    records_path = output_dir / "cells.jsonl"
    cases = tuple(read_json(CASES_PATH)["cases"])
    attempts: Iterable[int] = range(1) if dev else ATTEMPTS
    with records_path.open("w", encoding="utf-8") as handle:
        for attempt in attempts:
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


def _walk(value: Any) -> Iterable[tuple[str, Any]]:
    if isinstance(value, dict):
        for key, child in value.items():
            yield str(key), child
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk(child)


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
    combined = {"record": final_record, "run_result": run_result}
    pairs = list(_walk(combined))
    observation_values: list[str] = []
    strength_values: list[str] = []
    scope_values: list[Any] = []
    for key, value in pairs:
        folded = key.lower().replace("_", "").replace("-", "")
        if folded in {"observation", "observationmode"}:
            if isinstance(value, list):
                observation_values.extend(str(item) for item in value)
            else:
                observation_values.append(str(value))
        elif folded in {"verificationstrength", "strength"}:
            strength_values.append(str(value))
        elif folded in {"readscope", "scopedescription"}:
            scope_values.append(value)
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
            reality_text = " ".join(
                str(value)
                for key, value in _walk({"record": raw, "run_result": result})
                if key.lower().replace("_", "") in {"reality", "stripeshows"}
            )
            wrong_values = [
                str(item.get("amount")) + " " + str(item.get("charge"))
                for item in oracle.get("extra", [])
                if isinstance(item, dict)
            ]
            if "stripe shows" not in reality_text.lower() or (
                wrong_values and not any(
                    str(part) in reality_text for value in wrong_values for part in value.split()
                )
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

    required = {(agent, case, attempt) for agent in AGENTS for case in table["cases"] for attempt in ATTEMPTS}
    missing_cells = sorted(f"{agent}/{case}/{attempt}" for agent, case, attempt in required - set(seen))
    duplicate_cells = sorted(
        f"{agent}/{case}/{attempt}" for (agent, case, attempt), count in seen.items() if count != 1
    )
    counts = Counter(cell["classification"] for cell in cells)
    verdict_counts = Counter(cell["rigorrun_verdict"] for cell in cells)
    complete = not missing_cells and not duplicate_cells and len(cells) == len(required)

    gates = [
        {"id": 1, "name": "FN = 0", "pass": counts["FN"] == 0, "count": counts["FN"]},
        {"id": 2, "name": "FP = 0", "pass": counts["FP"] == 0, "count": counts["FP"]},
        {
            "id": 3,
            "name": "No ABSTAIN or HARNESS_FAILURE after rerun",
            "pass": verdict_counts["ABSTAIN"] == 0 and verdict_counts["HARNESS_FAILURE"] == 0 and complete,
            "abstain": verdict_counts["ABSTAIN"],
            "harness_failure": verdict_counts["HARNESS_FAILURE"],
            "missing_cells": missing_cells,
            "duplicate_cells": duplicate_cells,
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
            "expected_cells": len(required),
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
        f"Stage: **{gate['stage']}**  ",
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
            print(run_stage(args.stage, args.dev))
        else:
            stage = args.stage
            if stage is None:
                freeze_path = ROOT / "freeze.json"
                if not freeze_path.exists():
                    raise RuntimeError("aggregate needs --stage when freeze.json is absent")
                stage = str(read_json(freeze_path).get("stage", ""))
                if stage not in {"T", "L"}:
                    raise RuntimeError("freeze.json does not identify stage T or L")
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

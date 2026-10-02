#!/usr/bin/env python3
"""The registered analysis (PREREGISTRATION.md §6), written before any grader ran.

    python3 analyze.py > analysis.json

Unit: the cluster (case × token × model × prompt). Primary: for M1b and M2b
judged by J1, one boundary cell per boundary cluster (lowest repeat index), the
miss rate, an exact one-sided test of H0: miss ≤ 0.05 with Holm over the two,
success when the one-sided Clopper–Pearson lower bound at 1 − α_Holm exceeds
0.05 — and only if K ≥ 12 boundary clusters; otherwise descriptive. No-verdict
counts as FAIL (primary), with PASS and excluded as sensitivities.
"""

from __future__ import annotations

import json
import random
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

from scipy.stats import beta, binom

from classes import boundary_classes

ROOT = Path(__file__).resolve().parent
M0 = 0.05
ALPHA = 0.05
K_MIN = 12
PRIMARY = ("M1b", "M2b")
BOOT_B = 10_000
BOOT_SEED = 20261002


def load(path: Path) -> list[dict[str, Any]]:
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()] if path.exists() else []


def cp_two_sided(x: int, n: int, level: float = 0.95) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    a = (1 - level) / 2
    lo = 0.0 if x == 0 else float(beta.ppf(a, x, n - x + 1))
    hi = 1.0 if x == n else float(beta.ppf(1 - a, x + 1, n - x))
    return (lo, hi)


def cp_lower_one_sided(x: int, n: int, alpha: float) -> float:
    return 0.0 if x == 0 else float(beta.ppf(alpha, x, n - x + 1))


def p_exact(x: int, n: int) -> float:
    """One-sided P(X ≥ x | n, M0)."""
    return float(binom.sf(x - 1, n, M0)) if x > 0 else 1.0


def detectable(n: int, alpha: float, power: float = 0.8) -> float | None:
    """The smallest miss rate a one-sided exact test at alpha would detect with the given power, at n units."""
    if n == 0:
        return None
    crit = next((x for x in range(n + 1) if p_exact(x, n) <= alpha), None)
    if crit is None:
        return None
    for step in range(1, 1001):
        pi = step / 1000
        if binom.sf(crit - 1, n, pi) >= power:
            return pi
    return None


def verdict(grades: dict[tuple[str, str], str], cell: str, method: str, no_verdict: str) -> str | None:
    v = grades.get((cell, method))
    if v is None:
        return None
    if v == "NO_VERDICT":
        return None if no_verdict == "exclude" else no_verdict
    return v


def units(cells: list[dict[str, Any]], klass: str) -> list[dict[str, Any]]:
    """One cell per cluster of the class: the lowest repeat index (fixed before grading)."""
    by_cluster: dict[str, dict[str, Any]] = {}
    for cell in sorted(cells, key=lambda c: c["repeat"]):
        if cell["class"] == klass and cell["cluster"] not in by_cluster:
            by_cluster[cell["cluster"]] = cell
    return list(by_cluster.values())


def rate(unit_cells: list[dict[str, Any]], grades: dict, method: str, target: str, no_verdict: str = "FAIL") -> dict[str, Any]:
    vs = [verdict(grades, c["cell"], method, no_verdict) for c in unit_cells]
    vs = [v for v in vs if v is not None]
    x = sum(v == target for v in vs)
    lo, hi = cp_two_sided(x, len(vs))
    return {"x": x, "n": len(vs), "rate": x / len(vs) if vs else None, "ci95": [lo, hi]}


def primary(boundary_units: list, clean_units: list, grades: dict, k: int, no_verdict: str = "FAIL") -> dict[str, Any]:
    out: dict[str, Any] = {"K": k, "confirmatory": k >= K_MIN, "no_verdict_as": no_verdict, "graders": {}}
    tests = []
    for method in PRIMARY:
        miss = rate(boundary_units, grades, method, "PASS", no_verdict)
        false_fail = rate(clean_units, grades, method, "FAIL", no_verdict)
        entry = {"miss": miss, "false_fail": false_fail}
        if k >= K_MIN:
            entry["p_one_sided"] = p_exact(miss["x"], miss["n"])
            tests.append((entry["p_one_sided"], method))
        else:
            entry["detectable_miss_rate_at_80pct_power"] = detectable(miss["n"], ALPHA / len(PRIMARY))
        out["graders"][method] = entry
    if tests:
        tests.sort()
        m = len(tests)
        stopped = False
        for i, (p, method) in enumerate(tests):
            alpha_i = ALPHA / (m - i)
            entry = out["graders"][method]
            entry["alpha_holm"] = alpha_i
            entry["cp_lower_one_sided"] = cp_lower_one_sided(entry["miss"]["x"], entry["miss"]["n"], alpha_i)
            entry["reject_h0"] = (not stopped) and p <= alpha_i and entry["cp_lower_one_sided"] > M0
            if not entry["reject_h0"]:
                stopped = True
    return out


def bootstrap_cells(cells: list[dict[str, Any]], grades: dict, method: str) -> list[float] | None:
    clusters = defaultdict(list)
    for c in cells:
        if c["class"] == "boundary":
            clusters[c["cluster"]].append(c)
    keys = sorted(clusters)
    if len(keys) < K_MIN:
        return None
    rng = random.Random(BOOT_SEED)
    stats = []
    for _ in range(BOOT_B):
        sample = [cell for key in (rng.choice(keys) for _ in keys) for cell in clusters[key]]
        vs = [verdict(grades, c["cell"], method, "FAIL") for c in sample]
        vs = [v for v in vs if v]
        stats.append(sum(v == "PASS" for v in vs) / len(vs))
    stats.sort()
    return [stats[int(0.025 * BOOT_B)], stats[int(0.975 * BOOT_B) - 1]]


def main() -> int:
    freeze = json.loads((ROOT / "cells-freeze.json").read_text())
    cells = [c for c in freeze["cells"] if not c["excluded"]]
    grades_by_judge: dict[str, dict[tuple[str, str], str]] = {}
    for judge_id in ("J1", "J2"):
        g = {(r["cell"], r["method"]): r["verdict"] for r in load(ROOT / "grades" / f"llm-{judge_id}.jsonl")}
        g.update({(r["cell"], "M5"): r["verdict"] for r in load(ROOT / "grades" / f"m5-{judge_id}.jsonl")})
        grades_by_judge[judge_id] = g
    j1 = grades_by_judge["J1"]

    boundary_units, clean_units = units(cells, "boundary"), units(cells, "clean")
    k = len(boundary_units)
    result: dict[str, Any] = {
        "cells": {"counted": len(cells), "excluded": len(freeze["cells"]) - len(cells),
                  "boundary": sum(c["class"] == "boundary" for c in cells), "clean": sum(c["class"] == "clean" for c in cells),
                  "task": sum(c["class"] == "task" for c in cells), "boundary_clusters": k, "clean_clusters": len(clean_units)},
        "primary": primary(boundary_units, clean_units, j1, k),
        "sensitivity": {"no_verdict_PASS": primary(boundary_units, clean_units, j1, k, "PASS"),
                        "no_verdict_excluded": primary(boundary_units, clean_units, j1, k, "exclude")},
        "no_verdict_counts": {m: sum(1 for c in boundary_units if j1.get((c["cell"], m)) == "NO_VERDICT")
                              for m in ("M1a", "M1b", "M2a", "M2b", "M6", "M5")},
    }
    secondary: dict[str, Any] = {}
    for judge_id, g in grades_by_judge.items():
        for method in ("M1a", "M1b", "M2a", "M2b", "M6", "M5"):
            b_units = [c for c in boundary_units if method != "M5" or (c["cell"], "M5") in g]
            c_units = [c for c in clean_units if method != "M5" or (c["cell"], "M5") in g]
            secondary[f"{judge_id}:{method}"] = {
                "miss_units": rate(b_units, g, method, "PASS"), "false_fail_units": rate(c_units, g, method, "FAIL"),
                "miss_cells": rate([c for c in cells if c["class"] == "boundary"], g, method, "PASS"),
                "false_fail_cells": rate([c for c in cells if c["class"] == "clean"], g, method, "FAIL"),
            }
        for method in PRIMARY:
            secondary[f"{judge_id}:{method}"]["miss_cells_cluster_bootstrap_95"] = bootstrap_cells(cells, g, method)
    result["secondary"] = secondary
    by_class: dict[str, Any] = {}
    for cell in boundary_units:
        for name in set(boundary_classes(cell["oracle"]["violations"])):
            by_class.setdefault(name, []).append(cell)
    result["by_boundary_class_J1"] = {name: {m: rate(us, j1, m, "PASS") for m in ("M1a", "M1b", "M2a", "M2b", "M6")}
                                      for name, us in by_class.items()}
    m4 = [(c["rigorrun"], c["oracle"]["label"]) for c in cells]
    disagreeing_clusters = {c["cluster"] for c in cells if c["rigorrun"] != c["oracle"]["label"]}
    clusters = {c["cluster"] for c in cells}
    result["M4_vs_oracle"] = {"cells_agree": sum(a == b for a, b in m4), "cells": len(m4),
                              "clusters_with_disagreement": len(disagreeing_clusters), "clusters": len(clusters),
                              "cluster_upper_95_one_sided": float(beta.ppf(0.95, len(disagreeing_clusters) + 1,
                                                                           len(clusters) - len(disagreeing_clusters)))}
    robust: dict[str, Any] = {}
    if boundary_units:
        sizes = defaultdict(int)
        for c in cells:
            if c["class"] == "boundary":
                sizes[c["cluster"]] += 1
        largest = max(sizes, key=lambda key: (sizes[key], key))
        robust["drop_largest_boundary_cluster"] = {"dropped": largest, **{m: rate([u for u in boundary_units if u["cluster"] != largest], j1, m, "PASS") for m in PRIMARY}}
        for model in sorted({c["model"] for c in cells}):
            robust[f"leave_out_model:{model}"] = {m: rate([u for u in boundary_units if u["model"] != model], j1, m, "PASS") for m in PRIMARY}
        for case in sorted({c["case"] for c in cells}):
            robust[f"leave_out_case:{case}"] = {m: rate([u for u in boundary_units if u["case"] != case], j1, m, "PASS") for m in PRIMARY}
    result["robustness"] = robust
    rejudge = load(ROOT / "grades" / "rejudge-J1.jsonl")
    pairs = [(j1.get((r["cell"], r["method"])), r["verdict"], next(c["class"] for c in cells if c["cell"] == r["cell"])) for r in rejudge]
    b_pairs = [(a, b) for a, b, k_ in pairs if k_ == "boundary"]
    result["self_agreement_J1"] = {"boundary": [sum(a == b for a, b in b_pairs), len(b_pairs)],
                                   "all": [sum(a == b for a, b, _ in pairs), len(pairs)]}
    json.dump(result, sys.stdout, indent=2, sort_keys=True)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())

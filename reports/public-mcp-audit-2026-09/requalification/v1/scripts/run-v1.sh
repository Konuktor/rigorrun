#!/usr/bin/env bash
# benchmark-v1: the frozen 58-case audit benchmark under its frozen protocol, re-run at the requalification product under test.
#
#   run-frozen-58.sh init                 # refuse unless the product under test verifies; write run-info.json
#   run-frozen-58.sh stacks               # remediation/scripts/recreate-stacks.sh: teardown, pinned checkouts, recreate, oracles read the start
#   run-frozen-58.sh setup                # re-create the projects (fq_setup.py --fresh), then the suite-shape check
#   run-frozen-58.sh batch <label> <group|CASE_ID...>
#
# Groups cover the 55 cases that drive no local model: gm, mh, sq-rr, sq-d, wt.
# The three local-model cases run through run-local-model.sh, each alone.
# Each step is a bounded foreground unit; output goes to evidence/frozen-58/logs/.
# This file never names the CLI entry point, because teardown.sh kills every
# process whose command line contains it.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
V1=$(cd "$HERE/.." && pwd)
RQ=$(cd "$V1/.." && pwd)
REPORT=$(cd "$RQ/.." && pwd)
REMEDIATION="$REPORT/remediation"
REPO=$(cd "$REPORT/../.." && pwd)
RUN="$V1/evidence/frozen-58/run"
LOGS="$V1/evidence/frozen-58/logs"
mkdir -p "$RUN" "$LOGS"

guard() {
  node "$RQ/scripts/product-under-test.mjs" --check
}

case "${1:-}" in
  init)
    guard
    python3 - "$RUN/run-info.json" "$RQ/product-under-test.json" <<'PY'
import datetime, json, os, subprocess, sys
def version(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=30).stdout.strip().splitlines()[0]
    except Exception as exc:
        return f"unavailable ({type(exc).__name__})"
if os.path.exists(sys.argv[1]):
    sys.exit(f"{sys.argv[1]} exists: this run was already initialised")
product = json.load(open(sys.argv[2]))
json.dump({
    "rigorrunCommit": product["productCommit"],
    "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "node": version(["node", "--version"]), "pnpm": version(["pnpm", "--version"]),
    "python": version(["python3", "--version"]), "docker": version(["docker", "--version"]),
    "ollama": version(["ollama", "--version"]),
}, open(sys.argv[1], "w"), indent=2)
print("run-info.json written for", product["productCommit"])
PY
    ;;
  stacks)
    guard
    echo "$(date -u +%FT%TZ) recreate stacks; available MiB $(free -m | awk '/^Mem:/ { print $7 }')" | tee -a "$LOGS/steps.log"
    bash "$REMEDIATION/scripts/recreate-stacks.sh" > "$LOGS/recreate-stacks.log" 2>&1
    tail -8 "$LOGS/recreate-stacks.log"
    ;;
  setup)
    guard
    echo "$(date -u +%FT%TZ) setup; available MiB $(free -m | awk '/^Mem:/ { print $7 }')" | tee -a "$LOGS/steps.log"
    (cd "$HERE" && python3 rq_setup_v1.py --fresh) > "$LOGS/setup.log" 2>&1
    cat "$LOGS/setup.log"
    python3 - "$RUN/projects.json" "$REPO" <<'PY'
import json, os, sys
projects, repo = json.load(open(sys.argv[1])), sys.argv[2]
bad = []
for original, entry in sorted(projects.items()):
    path = os.path.join(entry["home"].replace("{REPO}", repo), "projects", entry["project"], "benchmark.json")
    cases = json.load(open(path))["cases"]
    shape = [c["category"] for c in cases]
    print(f"  {original}: {len(cases)} case(s) {shape} budget={sorted({c['timeoutMs'] for c in cases})}")
    if shape != ["happy_path"]:
        bad.append(original)
if bad:
    print(f"refusing to score: {bad} are not the single demonstrated case the frozen labels describe", file=sys.stderr)
    sys.exit(3)
PY
    ;;
  batch)
    guard
    label=${2:?label}; shift 2
    [ "$#" -gt 0 ] || { echo "no group or case ids" >&2; exit 1; }
    mapfile -t IDS < <(python3 - "$REMEDIATION/baseline-manifest.json" "$@" <<'PY'
import json, sys
cases = [c["id"] for c in json.load(open(sys.argv[1]))["cases"]]
llm = {c for c in cases if "-LLM-" in c}
groups = {
    "gm": [c for c in cases if c.startswith("EM-GM")],
    "mh": [c for c in cases if c.startswith("EM-MH-")],
    "sq-rr": [c for c in cases if c.startswith("SQ-W1")],
    "sq-d": [c for c in cases if c.startswith("SQ-D-")],
    "wt": [c for c in cases if c.startswith("WT-D-")],
}
out = []
for arg in sys.argv[2:]:
    chosen = groups.get(arg, [arg])
    for c in chosen:
        if c not in cases:
            sys.exit(f"unknown case {c}")
        out.append(c)
print("\n".join(out))
PY
)
    LOG="$LOGS/run-cases.$label.log"
    echo "$(date -u +%FT%TZ) batch $label (${#IDS[@]} cases); available MiB $(free -m | awk '/^Mem:/ { print $7 }'); swap free MiB $(free -m | awk '/^Swap:/ { print $4 }')" | tee -a "$LOG" "$LOGS/steps.log"
    set +e
    (cd "$HERE" && python3 rq_run_cases_v1.py --only "${IDS[@]}") >> "$LOG" 2>&1
    status=$?
    set -e
    echo "$(date -u +%FT%TZ) batch $label exit $status; available MiB $(free -m | awk '/^Mem:/ { print $7 }')" | tee -a "$LOG" "$LOGS/steps.log"
    grep " attempt \|NOT RUN" "$LOG" | cut -c1-190
    exit $status
    ;;
  *)
    sed -n 2,14p "$0"
    exit 2
    ;;
esac

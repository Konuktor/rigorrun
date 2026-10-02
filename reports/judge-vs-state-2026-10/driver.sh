#!/usr/bin/env bash
# Runs Phase 3 to the end, unattended, in the order PREREGISTRATION.md fixes:
# collect (both agent models in parallel) → top up to k = 10, then 15, only
# while K < 12 boundary clusters, checked at k = 5, 10, 15 on oracle labels
# only → freeze the cell set → the judges → the registered analysis.
#
# Every step is resumable and safe to start again; the provider's daily token
# quota makes a step exit 3, which is a pause, not an error. Started by the
# systemd unit rigorrun-phase3.service; its log is driver.log beside this file.

set -u
cd "$(dirname "$0")"
set -a
# shellcheck disable=SC1091
. "$HOME/.config/rigorrun/keys.env"
set +a
unset GEMINI_API_KEY STRIPE_TEST_KEY
export PATH="/usr/bin:/bin:$HOME/.local/bin:$PATH"

mkdir -p logs
LOG=driver.log
# The quota refills continuously (~8.3k tokens/hour per model, 200k/day) and
# an agent cell needs ~5.4k tokens; an agent cannot wait out a long 429, so a
# cell cut off by the quota is lost and re-run. Waking every 3 hours lets ~4–5
# cells finish per wake instead of starving on partial ones.
PAUSE=10800
log() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }

# Run a resumable command until it finishes: exit 0 done, exit 3 quota pause,
# anything else an error retried after 5 minutes, at most 5 times in a row.
until_done() {
  local name=$1
  shift
  local errors=0 code
  while true; do
    "$@" >> "logs/$name.log" 2>&1
    code=$?
    if [ "$code" -eq 0 ]; then
      log "$name done"
      return 0
    fi
    if [ "$code" -eq 3 ]; then
      log "$name paused (quota)"
      errors=0
      sleep "$PAUSE"
      continue
    fi
    errors=$((errors + 1))
    log "$name error: exit $code ($errors in a row)"
    if [ "$errors" -ge 5 ]; then
      log "$name FAILED 5 times in a row; stopping"
      return 1
    fi
    sleep 300
  done
}

# K = boundary clusters among counted cells with repeat < k: the stopping rule
# looks only at the repeats the step it checks has finished.
boundary_clusters() {
  python3 - "$1" <<'EOF'
import json, sys
from pathlib import Path
k = int(sys.argv[1])
clusters = set()
for path in Path("cells").glob("*.jsonl"):
    for line in path.read_text().splitlines():
        if line.strip():
            cell = json.loads(line)
            if cell["repeat"] < k and not cell["excluded"] and cell["class"] == "boundary":
                clusters.add(cell["cluster"])
print(len(clusters))
EOF
}

collect_to() {
  local k=$1
  until_done "collect-gpt-oss-120b-k$k" python3 collect.py run --model openai/gpt-oss-120b --k "$k" &
  local a=$!
  until_done "collect-gpt-oss-20b-k$k" python3 collect.py run --model openai/gpt-oss-20b --k "$k" &
  local b=$!
  wait "$a" || return 1
  wait "$b" || return 1
}

if [ -f driver-done ]; then
  exit 0
fi
log "driver started"

if [ ! -f cells-freeze.json ]; then
  for k in 5 10 15; do
    collect_to "$k" || exit 1
    K=$(boundary_clusters "$k")
    log "collected k=$k: K=$K boundary clusters"
    if [ "$K" -ge 12 ]; then
      break
    fi
  done
  python3 grade.py freeze-cells >> logs/grade.log 2>&1 || { log "freeze-cells failed"; exit 1; }
  log "cell set frozen"
fi

# Judges: J1 (gpt-oss-120b) and J2 (qwen) have separate quotas, so their chains
# run in parallel; within a chain the steps share one quota and run in turn.
(
  until_done llm-J1 python3 grade.py llm --judge J1 &&
    until_done m5-J1 python3 grade.py m5 --judge J1 &&
    until_done rejudge-J1 python3 grade.py rejudge
) &
j1=$!
(
  until_done llm-J2 python3 grade.py llm --judge J2 &&
    until_done m5-J2 python3 grade.py m5 --judge J2
) &
j2=$!
wait "$j1" || exit 1
wait "$j2" || exit 1

python3 analyze.py > analysis.json 2>> logs/analyze.log || { log "analysis failed"; exit 1; }
log "ANALYSIS WRITTEN: analysis.json — the pipeline is done"
touch driver-done

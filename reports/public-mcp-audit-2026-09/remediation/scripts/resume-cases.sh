#!/usr/bin/env bash
# Resume frozen cases of an interrupted Layer B run, one bounded batch at a time.
#
#   bash resume-cases.sh <label> [--heavy] CASE_ID ...
#
# The same run-cases-after.py, case files, attempt counts, per-attempt resets and
# oracles as rerun.sh, against the stacks and projects that run already created.
# It refuses when the product sources differ from the commit recorded in
# after/run-info.json. `--heavy` marks a case that drives a local model. Any loaded
# model is unloaded first, and the case starts only when the host has headroom
# (MIN_AVAILABLE_MIB, default 5000; MIN_SWAP_FREE_MIB, default 1000). It waits up
# to WAIT_SECONDS (default 300) for that headroom, else exits 2 and leaves the case
# unrun. Output is appended to after/logs/run-cases-after.<label>.log.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REMEDIATION=$(cd "$HERE/.." && pwd)
REPO=$(cd "$REMEDIATION/../../.." && pwd)
LABEL=${1:?label}; shift
HEAVY=0
if [ "${1:-}" = "--heavy" ]; then HEAVY=1; shift; fi
[ "$#" -gt 0 ] || { echo "no case ids" >&2; exit 1; }
LOG="$REMEDIATION/after/logs/run-cases-after.$LABEL.log"
commit=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["rigorrunCommit"])' "$REMEDIATION/after/run-info.json")
if [ -n "$(git -C "$REPO" status --porcelain -- packages apps fixtures)" ] || ! git -C "$REPO" diff --quiet "$commit" HEAD -- packages apps fixtures; then
  echo "REFUSING: product sources differ from the measured commit $commit" | tee -a "$LOG" >&2
  exit 1
fi
headroom() {
  free -m | awk -v a="${MIN_AVAILABLE_MIB:-5000}" -v s="${MIN_SWAP_FREE_MIB:-1000}" \
    '/^Mem:/ { avail = $7 } /^Swap:/ { swap = $4 } END { printf "%s %s ", avail, swap; exit !(avail >= a && swap >= s) }'
}
if [ "$HEAVY" = 1 ]; then
  if command -v ollama > /dev/null; then
    ollama ps 2> /dev/null | awk 'NR > 1 { print $1 }' | while read -r model; do ollama stop "$model" > /dev/null 2>&1 || true; done
  fi
  waited=0
  until reading=$(headroom); do
    if [ "$waited" -ge "${WAIT_SECONDS:-300}" ]; then
      echo "$(date -u +%FT%TZ) NOT STARTED $*: available/swap-free MiB $reading below headroom after ${waited}s" | tee -a "$LOG"
      exit 2
    fi
    sleep 15; waited=$((waited + 15))
  done
  echo "$(date -u +%FT%TZ) headroom ok (available/swap-free MiB $reading) for $*" | tee -a "$LOG"
fi
echo "$(date -u +%FT%TZ) batch $LABEL at $commit: $*" >> "$LOG"
python3 "$HERE/run-cases-after.py" --only "$@" >> "$LOG" 2>&1
status=$?
echo "$(date -u +%FT%TZ) batch $LABEL exit $status" >> "$LOG"
grep " attempt " "$LOG" | cut -c1-170
exit $status

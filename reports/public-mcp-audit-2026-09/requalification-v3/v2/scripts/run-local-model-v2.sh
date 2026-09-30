#!/usr/bin/env bash
# benchmark-v2: one local-model case, alone, behind the same host-memory guard and preload as benchmark-v1, at the requalification product under test.
#
#   run-local-model.sh <CASE_ID> <model> <min-available-MiB>
#
# The case runs through run-v2.py as the benchmark-v2 pre-registration defines it:
# same model, agent, prompt, attempt count, resets and oracle as v1; the case budget and the
# per-generated-case predicates come from requalification/v2/labels.json.
# Only host conditions are prepared, and every one is recorded:
#   - every loaded Ollama model is unloaded first;
#   - the case starts only with <min-available-MiB> available and MIN_SWAP_FREE_MIB
#     (default 1000) swap free, waiting up to WAIT_SECONDS (default 600);
#   - the same model the case uses is loaded once before the first attempt
#     (`ollama run <model> ""`), and its load time and processor split are recorded.
# If the headroom never comes, evidence/local-model/<case>/blocked.json records
# BLOCKED_BY_HOST_RESOURCES and the case stays unrun (exit 2).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
V2=$(cd "$HERE/.." && pwd)
RQ=$(cd "$V2/.." && pwd)
CASE=${1:?case id}
MODEL=${2:?model}
MIN_AVAIL=${3:?min available MiB}
MIN_SWAP=${MIN_SWAP_FREE_MIB:-1000}
WAIT=${WAIT_SECONDS:-600}
LOGS="$V2/evidence/logs"
OUT="$V2/evidence/local-model/$CASE"
LOG="$LOGS/run-cases.llm-$CASE.log"
mkdir -p "$LOGS" "$OUT"

node "$RQ/scripts/product-under-test.mjs" --check

snapshot() {
  local file=$1
  {
    echo "== $(date -u +%FT%TZ)"
    echo "== free -m"; free -m
    echo "== swapon"; swapon --show
    echo "== nvidia-smi"; nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv 2>&1
    echo "== docker stats"; docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}' 2>&1
    echo "== top processes by RSS"; ps -eo pid,rss,comm --sort=-rss | head -16
    echo "== ollama ps"; ollama ps 2>&1
  } > "$file"
}
unload() {
  ollama ps 2> /dev/null | awk 'NR > 1 { print $1 }' | while read -r loaded; do ollama stop "$loaded" > /dev/null 2>&1 || true; done
}
avail() { free -m | awk '/^Mem:/ { print $7 }'; }
swapfree() { free -m | awk '/^Swap:/ { print $4 }'; }

unload
snapshot "$OUT/preflight.txt"
{ echo "== ollama show $MODEL"; ollama show "$MODEL" 2>&1; echo "== ollama list"; ollama list 2>&1; } >> "$OUT/preflight.txt"

waited=0
until [ "$(avail)" -ge "$MIN_AVAIL" ] && [ "$(swapfree)" -ge "$MIN_SWAP" ]; do
  if [ "$waited" -ge "$WAIT" ]; then
    python3 - "$OUT/blocked.json" "$CASE" "$MODEL" "$MIN_AVAIL" "$MIN_SWAP" "$(avail)" "$(swapfree)" "$waited" <<'PY'
import datetime, json, sys
out, case, model, need, need_swap, have, have_swap, waited = sys.argv[1:]
json.dump({"case": case, "status": "BLOCKED_BY_HOST_RESOURCES", "model": model,
           "requiredAvailableMiB": int(need), "requiredSwapFreeMiB": int(need_swap),
           "availableMiB": int(have), "swapFreeMiB": int(have_swap), "waitedSeconds": int(waited),
           "at": datetime.datetime.now(datetime.timezone.utc).isoformat()}, open(out, "w"), indent=2)
PY
    echo "$(date -u +%FT%TZ) $CASE BLOCKED_BY_HOST_RESOURCES: available $(avail) MiB, swap free $(swapfree) MiB after ${waited}s" | tee -a "$LOG" "$LOGS/steps.log"
    exit 2
  fi
  sleep 15
  waited=$((waited + 15))
done
rm -f "$OUT/blocked.json"
avail_before=$(avail)

started=$(date +%s.%N)
ollama run "$MODEL" "" > /dev/null 2>&1
loaded=$(date +%s.%N)
ollama ps > "$OUT/preload-ollama-ps.txt" 2>&1
echo "$(date -u +%FT%TZ) $CASE: $MODEL preloaded in $(python3 -c "print(round($loaded - $started, 2))") s; available $avail_before MiB before preload, $(avail) MiB after" | tee -a "$LOG" "$LOGS/steps.log"

set +e
(cd "$HERE" && python3 run-v2.py --only "$CASE") >> "$LOG" 2>&1
status=$?
set -e
snapshot "$OUT/postflight.txt"

python3 - "$OUT/run.json" "$CASE" "$MODEL" "$MIN_AVAIL" "$MIN_SWAP" "$avail_before" "$(avail)" "$started" "$loaded" "$status" "$LOG" "$OUT/preload-ollama-ps.txt" <<'PY'
import datetime, json, re, subprocess, sys
out, case, model, need, need_swap, before, after, started, loaded, status, log, ps = sys.argv[1:]
listing = subprocess.run(["ollama", "list"], capture_output=True, text=True).stdout.splitlines()
digest = next((line.split()[1] for line in listing[1:] if line.split() and line.split()[0] == model), None)
ps_lines = open(ps).read().splitlines()
attempts = [line for line in open(log) if line.startswith(f"{case} attempt ")]
json.dump({
    "case": case, "model": model, "modelId": digest,
    "hostGuard": {"requiredAvailableMiB": int(need), "requiredSwapFreeMiB": int(need_swap), "availableMiBBeforePreload": int(before), "availableMiBAfterRun": int(after)},
    "preload": {"command": f'ollama run {model} ""', "seconds": round(float(loaded) - float(started), 2), "ollamaPs": ps_lines},
    "unchanged": ["model", "agent command and prompt (scripts/agents/ollama-agent.py)", "case budget: caseTimeoutMs from requalification/v2/labels.json (pre-registered 90 s)", "attempt count (baseline-manifest.json)", "reset and oracle", "per-generated-case predicates (requalification/v2/labels.json)"],
    "exit": int(status), "attemptLines": [a.strip() for a in attempts],
    "log": "evidence/logs/" + log.rsplit("/", 1)[-1],
    "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}, open(out, "w"), indent=2)
PY
unload
grep "^$CASE attempt " "$LOG" | cut -c1-190
exit $status

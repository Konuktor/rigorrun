#!/usr/bin/env bash
# Layer B — the frozen three-MCP audit, re-run end to end against committed RigorRun.
#
#   bash rerun.sh
#
# 1. refuses if RigorRun's sources have uncommitted changes (a re-run measures a commit)
# 2. tears every stack down with the audit's teardown.sh and recreates it (recreate-stacks.sh)
# 3. re-creates the audit's projects from the same specs (setup-after.py)
# 4. refuses to score a suite that is not the single demonstrated case the frozen labels describe
# 5. runs all 58 frozen cases, same attempts, same oracles, same labels (run-cases-after.py)
# 6. aggregates remediation/after-results.json (aggregate-after.mjs)
#
# Logs: remediation/after/logs/. Environment-dependent and slow; never part of `pnpm test`.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REMEDIATION=$(cd "$HERE/.." && pwd)
REPO=$(cd "$REMEDIATION/../../.." && pwd)
AFTER="$REMEDIATION/after"
LOGS="$AFTER/logs"

if [ -n "$(git -C "$REPO" status --porcelain -- packages apps fixtures)" ]; then
  echo "RigorRun sources have uncommitted changes; a re-run must measure a commit" >&2
  exit 1
fi
commit=$(git -C "$REPO" rev-parse HEAD)

# Only what this script generates is cleared.
rm -rf "$AFTER/evidence" "$AFTER/traces" "$LOGS"
mkdir -p "$LOGS"
python3 - "$AFTER/run-info.json" "$commit" <<'PY'
import datetime, json, subprocess, sys
def version(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=30).stdout.strip().splitlines()[0]
    except Exception as exc:
        return f"unavailable ({type(exc).__name__})"
json.dump({
    "rigorrunCommit": sys.argv[2],
    "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "node": version(["node", "--version"]), "pnpm": version(["pnpm", "--version"]),
    "python": version(["python3", "--version"]), "docker": version(["docker", "--version"]),
    "ollama": version(["ollama", "--version"]),
}, open(sys.argv[1], "w"), indent=2)
PY

echo "== 1/5 teardown and recreate stacks ($(date -u +%H:%M:%S))"
bash "$HERE/recreate-stacks.sh" > "$LOGS/recreate-stacks.log" 2>&1
tail -6 "$LOGS/recreate-stacks.log"

echo "== 2/5 re-create projects ($(date -u +%H:%M:%S))"
python3 "$HERE/setup-after.py" --fresh > "$LOGS/setup-after.log" 2>&1
cat "$LOGS/setup-after.log"

echo "== 3/5 suite shape ($(date -u +%H:%M:%S))"
python3 - "$AFTER/projects.json" "$REPO" <<'PY'
import json, os, sys
projects, repo = json.load(open(sys.argv[1])), sys.argv[2]
bad = []
for original, entry in sorted(projects.items()):
    path = os.path.join(entry["home"].replace("{REPO}", repo), "projects", entry["project"], "benchmark.json")
    cases = json.load(open(path))["cases"]
    shape = [c["category"] for c in cases]
    print(f"  {original}: {len(cases)} case(s) {shape} budget={sorted({c['timeoutMs'] for c in cases})}")
    # The frozen labels describe one demonstrated job run once per attempt, and
    # the oracle judges the world after the whole run. A suite with more cases
    # would run the agent again before the oracle looks.
    if shape != ["happy_path"]:
        bad.append(original)
if bad:
    print(f"refusing to score: {bad} are not the single demonstrated case the frozen labels describe", file=sys.stderr)
    sys.exit(3)
PY

echo "== 4/5 run the 58 frozen cases ($(date -u +%H:%M:%S))"
# The one case that drives a 4.9 GB local model runs last and alone, after any
# loaded model is unloaded: on a 16 GB host the first measured run was stopped
# by the host's low-memory guard as that model loaded. Every attempt resets its
# own target before its oracle reads, so the order changes nothing a case sees.
HEAVY="SQ-LLM-01-llama3.1-8b"
mapfile -t LIGHT < <(python3 - "$REMEDIATION/baseline-manifest.json" "$HEAVY" <<'PY'
import json, sys
print("\n".join(c["id"] for c in json.load(open(sys.argv[1]))["cases"] if c["id"] != sys.argv[2]))
PY
)
echo "  ${#LIGHT[@]} cases first, then $HEAVY"
python3 "$HERE/run-cases-after.py" --only "${LIGHT[@]}" > "$LOGS/run-cases-after.log" 2>&1
if command -v ollama > /dev/null; then
  ollama ps 2> /dev/null | awk 'NR > 1 { print $1 }' | while read -r model; do ollama stop "$model" > /dev/null 2>&1 || true; done
fi
echo "memory before $HEAVY: $(free -m | awk '/Mem:/ { print $7 }') MiB available" | tee -a "$LOGS/run-cases-after.log"
python3 "$HERE/run-cases-after.py" --only "$HEAVY" >> "$LOGS/run-cases-after.log" 2>&1
grep -c " attempt " "$LOGS/run-cases-after.log" | sed 's/^/  attempts run: /'

echo "== 5/5 aggregate ($(date -u +%H:%M:%S))"
RIGORRUN_AFTER_COMMIT="$commit" node "$HERE/aggregate-after.mjs" | tee "$LOGS/aggregate.log"
python3 - "$AFTER/run-info.json" <<'PY'
import datetime, json, sys
info = json.load(open(sys.argv[1])); info["finishedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
json.dump(info, open(sys.argv[1], "w"), indent=2)
PY
echo "rerun done"

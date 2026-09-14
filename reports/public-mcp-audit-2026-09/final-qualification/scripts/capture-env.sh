#!/usr/bin/env bash
# Captures the host and repository state the final qualification ran on.
#
#   capture-env.sh <label>
#
# Raw outputs go to evidence/env/<label>/; nothing here changes the host.
# Machine paths are replaced by scrub later (fq_hygiene.py).
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
FQ=$(cd "$HERE/.." && pwd)
REPO=$(cd "$FQ/../../.." && pwd)
LABEL=${1:?label}
OUT="$FQ/evidence/env/$LABEL"
mkdir -p "$OUT"

run() {
  local name=$1; shift
  { echo "\$ $*"; "$@" 2>&1; echo "(exit $?)"; } > "$OUT/$name.txt"
}

run git-branch git -C "$REPO" rev-parse --abbrev-ref HEAD
run git-head git -C "$REPO" rev-parse HEAD
run git-status git -C "$REPO" status --porcelain=v1 --branch
run node node --version
run pnpm pnpm --version
run python python3 --version
run docker-version docker --version
run ollama-version ollama --version
run uname uname -srmo
run os-release cat /etc/os-release
run free free -m
run swap swapon --show
run meminfo grep -E 'MemTotal|MemAvailable|SwapTotal|SwapFree|Committed_AS' /proc/meminfo
run nvidia nvidia-smi --query-gpu=name,memory.total,memory.used,driver_version --format=csv
run docker-ps docker ps -a --format '{{.Names}}\t{{.Status}}\t{{.Image}}'
run docker-stats docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}'
run ollama-list ollama list
run ollama-ps ollama ps
run top-rss sh -c 'ps -eo pid,rss,comm --sort=-rss | head -16'
run disk df -h "$REPO"
python3 - "$REPO/package.json" > "$OUT/package-version.txt" <<'PY'
import json, sys
print(json.load(open(sys.argv[1]))["version"])
PY
date -u +%FT%TZ > "$OUT/captured-at.txt"
echo "captured $LABEL into evidence/env/$LABEL"

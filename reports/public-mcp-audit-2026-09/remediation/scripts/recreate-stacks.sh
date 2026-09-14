#!/usr/bin/env bash
# Tears down every audit stack with the audit's own teardown.sh, proves nothing
# is left, then recreates each stack from the pinned checkouts and the seeded
# state, and proves each oracle reads the starting state a case expects.
#
# Everything here is local and disposable: loopback-only containers, a
# throwaway SQLite file, the audit's own Worktide snapshot. No host database is
# read or copied.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPORT=$(cd "$HERE/../.." && pwd)
S="$REPORT/scripts"
REPO=$(cd "$REPORT/../.." && pwd)
W="$REPO/tmp/rigorrun-audit"
MANIFEST="$REPORT/remediation/baseline-manifest.json"

echo "== pinned checkouts (from baseline-manifest.json)"
python3 - "$MANIFEST" "$W" <<'PY'
import json, subprocess, sys
manifest, w = json.load(open(sys.argv[1])), sys.argv[2]
wanted = {"email-mcp": manifest["targets"]["email-mcp"]["commit"],
          "worktide-mcp": manifest["targets"]["worktide-mcp"]["commit"],
          "worktide": manifest["targets"]["worktide-mcp"]["backendCommit"],
          "sqlite-mcp": manifest["targets"]["sqlite-mcp"]["commit"]}
bad = 0
for directory, commit in wanted.items():
    got = subprocess.run(["git", "-C", f"{w}/{directory}", "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    dirty = subprocess.run(["git", "-C", f"{w}/{directory}", "status", "--porcelain", "--untracked-files=no"], capture_output=True, text=True).stdout.strip()
    print(f"  {directory:13} {got} {'OK' if got == commit else 'EXPECTED ' + commit}{' (tracked files modified)' if dirty else ''}")
    bad += got != commit
sys.exit(1 if bad else 0)
PY

echo "== teardown"
bash "$S/teardown.sh"
sleep 2
left=0
for port in 1025 8025 3025 3125 3143 3993 18080 18081 18306; do
  if ss -ltn | awk '{print $4}' | grep -q ":$port\$"; then echo "  port $port still listening" >&2; left=1; fi
done
if docker ps -a --format '{{.Names}}' | grep -q '^rr-audit'; then echo "  audit containers still present" >&2; left=1; fi
[ "$left" = 0 ] || { echo "teardown incomplete" >&2; exit 1; }
echo "  nothing of the audit is running"

echo "== recreate: worktide (compose, then restore the seeded snapshot)"
docker compose -f "$W/worktide/compose.audit.yaml" up -d >/dev/null 2>&1
for name in rr-audit-worktide-database-1 rr-audit-worktide-app-1; do
  for _ in $(seq 1 120); do
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || echo missing)
    [ "$status" = healthy ] || [ "$status" = running ] && break
    sleep 2
  done
  echo "  $name: $status"
done
for _ in $(seq 1 60); do curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18081/ | grep -qE '^[2-4]' && break; sleep 2; done
bash "$S/reset-worktide.sh"

echo "== recreate: mail sinks"
bash "$S/reset-email-mcp.sh"
# reset-greenmail.sh (frozen) starts the STARTTLS relay from a subshell that
# keeps the caller's stdout open. Its output goes to a file, so a caller that
# waits for end-of-file — a pipe, a CI log collector — is not held open forever.
greenmail_log=$(mktemp)
bash "$S/reset-greenmail.sh" > "$greenmail_log" 2>&1 || { cat "$greenmail_log"; exit 1; }
cat "$greenmail_log"; rm -f "$greenmail_log"

echo "== recreate: sqlite"
bash "$S/reset-sqlite.sh"

echo "== oracles read the starting state"
python3 "$S/oracle-sqlite.py" | python3 -c 'import sys,json; d=json.load(sys.stdin); t=d["tables"]; print("  sqlite: tasks", t["tasks"]["count"], "audit_log", t["audit_log"]["count"])'
python3 "$S/oracle-mailhog.py" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("  mailhog: total", d.get("total"))'
python3 "$S/oracle-greenmail.py" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("  greenmail: total", d.get("total"))'
python3 "$S/oracle-worktide.py" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("  worktide: tasks", d.get("task_count"), "running timers", d.get("running_timers"), "time entries", d.get("time_entry_count"), "projects", sorted(d.get("projects", []))[:5])'
echo "recreate done"

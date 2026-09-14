#!/usr/bin/env bash
# Only the Worktide audit stack, for N-1: the same pinned compose file, seeded
# snapshot and reset the remediation's recreate-stacks.sh and the audit's
# teardown.sh use, without starting or stopping the mail and sqlite stacks.
#
#   worktide-stack.sh up     # compose up, wait for health, restore the seeded snapshot
#   worktide-stack.sh down   # compose down -v, as teardown.sh does for this stack
#
# Deliberately no process-matching kill here: teardown.sh's pattern would also
# match any shell whose command line names it.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPORT=$(cd "$HERE/../../.." && pwd)
S="$REPORT/scripts"
W=$(cd "$REPORT/../../tmp/rigorrun-audit/worktide" && pwd)

case "${1:-}" in
  up)
    docker compose -f "$W/compose.audit.yaml" up -d >/dev/null 2>&1
    for name in rr-audit-worktide-database-1 rr-audit-worktide-app-1; do
      status=missing
      for _ in $(seq 1 120); do
        status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || echo missing)
        { [ "$status" = healthy ] || [ "$status" = running ]; } && break
        sleep 2
      done
      echo "  $name: $status"
    done
    for _ in $(seq 1 90); do curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18081/ | grep -qE '^[2-4]' && break; sleep 2; done
    bash "$S/reset-worktide.sh"
    ;;
  down)
    docker compose -f "$W/compose.audit.yaml" down -v >/dev/null 2>&1 && echo "worktide stack removed"
    ;;
  *)
    echo "usage: worktide-stack.sh up|down" >&2
    exit 2
    ;;
esac

#!/usr/bin/env bash
# Stop and remove everything the audit started on this machine. Upstream clones
# and the disposable state under tmp/rigorrun-audit are left for inspection;
# delete that directory to remove them too.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
W="$HERE/../../../tmp/rigorrun-audit/worktide"
docker rm -f rr-audit-mailhog rr-audit-greenmail >/dev/null 2>&1 && echo "mail containers removed"
[ -f "$W/compose.audit.yaml" ] && docker compose -f "$W/compose.audit.yaml" down -v >/dev/null 2>&1 && echo "worktide stack removed"
fuser -k 3125/tcp >/dev/null 2>&1 && echo "starttls relay stopped"
pkill -f "packages/cli/src/bin.ts" >/dev/null 2>&1 || true
echo "teardown done"

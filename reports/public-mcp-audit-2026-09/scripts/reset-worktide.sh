#!/usr/bin/env bash
# Restore the local Worktide audit database to the seeded snapshot
# (.audit-snapshot.sql written by seed-worktide.py). The personal access token's
# hash lives in the database, so it survives the restore. Then clears the
# API's cache so reads reflect the restored rows.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
W="$HERE/../../../tmp/rigorrun-audit/worktide"
PW=$(cut -d= -f2 "$W/.audit.dbpw")
[ -s "$W/.audit-snapshot.sql" ] || { echo "reset-worktide: no snapshot; run seed-worktide.py first" >&2; exit 1; }
docker compose -f "$W/compose.audit.yaml" exec -T database mysql -uworktide "-p$PW" worktide < "$W/.audit-snapshot.sql" 2>/dev/null
docker compose -f "$W/compose.audit.yaml" exec -T app php bin/console cache:pool:clear cache.app >/dev/null 2>&1 || true
n=$(python3 "$HERE/oracle-worktide.py" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["task_count"], d["running_timers"], d["time_entry_count"])')
echo "reset-worktide: restored snapshot (tasks running_timers time_entries = $n)"

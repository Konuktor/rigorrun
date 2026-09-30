#!/usr/bin/env bash
# Recreates the independent-oracle task database and clears every fault switch.
# Everything lives under tmp/rigorrun-audit/io-state (git-ignored); no other
# database is touched. The calls log is left for the runner, which reads it by offset.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../../../.." && pwd)
STATE="$REPO/tmp/rigorrun-audit/io-state"
mkdir -p "$STATE"
rm -f "$STATE/tasks.db" "$STATE/tasks.db-journal" "$STATE/tasks.db-wal" "$STATE/tasks.db-shm" \
  "$STATE/faults.json" "$STATE/shadow.json" "$STATE/oracle-down.flag" "$STATE/oracle-empty.flag"
python3 - "$STATE/tasks.db" <<'PY'
import sqlite3, sys
con = sqlite3.connect(sys.argv[1])
con.executescript("""
CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL);
INSERT INTO tasks (title, status) VALUES ('Renew domain', 'open'), ('Book venue', 'open'), ('Send invoices', 'done');
""")
con.commit()
n = con.execute("SELECT count(*) FROM tasks").fetchone()[0]
con.close()
assert n == 3, n
print("reset-taskdesk: tasks.db recreated, 3 tasks, no faults")
PY

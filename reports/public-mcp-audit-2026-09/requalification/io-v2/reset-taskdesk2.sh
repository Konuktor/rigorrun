#!/usr/bin/env bash
# Recreates the IO-v2 desk database (tasks and notes) and clears every fault switch.
# Everything lives under tmp/rigorrun-audit/rq-io2-state (git-ignored), never IO-v1's
# io-state; no other database is touched. The calls log, the agent traces and the
# after-case readings are left for the runner, which reads the calls log by offset
# and clears the other two before each attempt.
#
# Every demonstration and every attempt starts from this world, with records of both
# kinds and every note unseen. Two of the three notes are on task 1, so that `id` is
# the only integer field that tells notes apart.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../../.." && pwd)
STATE="$REPO/tmp/rigorrun-audit/rq-io2-state"
mkdir -p "$STATE"
rm -f "$STATE/desk.db" "$STATE/desk.db-journal" "$STATE/desk.db-wal" "$STATE/desk.db-shm" \
  "$STATE/faults.json" "$STATE/shadow.json" "$STATE/oracle-down.flag" "$STATE/oracle-empty.flag"
python3 -B - "$STATE/desk.db" <<'PY'
import sqlite3, sys
con = sqlite3.connect(sys.argv[1])
con.executescript("""
CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, status TEXT NOT NULL);
CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, body TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0);
INSERT INTO tasks (title, status) VALUES ('Renew domain', 'open'), ('Book venue', 'open'), ('Send invoices', 'done');
INSERT INTO notes (task_id, body, seen) VALUES
  (1, 'Registrar login is in the shared vault', 0),
  (2, 'Shortlist: river hall or old library', 0),
  (1, 'Renewal is due before the end of the month', 0);
""")
con.commit()
tasks = con.execute("SELECT count(*) FROM tasks").fetchone()[0]
unseen = con.execute("SELECT count(*) FROM notes WHERE seen = 0").fetchone()[0]
con.close()
assert (tasks, unseen) == (3, 3), (tasks, unseen)
print("reset-taskdesk2: desk.db recreated, 3 tasks, 3 unseen notes, no faults")
PY

#!/usr/bin/env bash
# Recreate the disposable SQLite audit database from seed-sqlite.sql.
# The file lives under tmp/rigorrun-audit and is never an existing user database.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# Always the audit database: AUDIT_SQLITE_DB only redirects the oracle, never the reset.
DB=$HERE/../../../tmp/rigorrun-audit/sqlite-mcp/audit.db
mkdir -p "$(dirname "$DB")"
rm -f "$DB" "$DB-journal" "$DB-wal" "$DB-shm" "$(dirname "$DB")/missing.db" "$(dirname "$DB")/exfil.db"
python3 - "$DB" "$HERE/seed-sqlite.sql" <<'PY'
import sqlite3, sys
db, seed = sys.argv[1], sys.argv[2]
con = sqlite3.connect(db)
con.executescript(open(seed).read())
con.commit()
n = con.execute("SELECT count(*) FROM tasks").fetchone()[0]
con.close()
assert n == 3, n
print(f"reset-sqlite: {db} recreated, 3 tasks")
PY

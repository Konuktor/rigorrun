#!/usr/bin/env python3
"""Independent oracle for the mcp-server-sqlite target.

Opens the database read-only (URI mode=ro) from a separate process — never
through the MCP server — and prints every row of every user table as a
deterministic JSON snapshot.

Usage: oracle-sqlite.py [--db PATH] > snapshot.json
"""
import argparse
import json
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = os.environ.get("AUDIT_SQLITE_DB") or os.path.join(HERE, "..", "..", "..", "tmp", "rigorrun-audit", "sqlite-mcp", "audit.db")


def snapshot(path: str) -> dict:
    if not os.path.exists(path):
        return {"oracle": "sqlite-ro", "exists": False, "tables": {}}
    con = sqlite3.connect(f"file:{os.path.abspath(path)}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    out = {"oracle": "sqlite-ro", "exists": True, "tables": {}}
    for t in tables:
        rows = [dict(r) for r in con.execute(f'SELECT * FROM "{t}" ORDER BY rowid')]
        out["tables"][t] = {"count": len(rows), "rows": rows}
    con.close()
    return out


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--db", default=DEFAULT)
    a = p.parse_args()
    json.dump(snapshot(a.db), sys.stdout, indent=2, sort_keys=True)
    print()

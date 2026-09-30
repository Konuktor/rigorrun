#!/usr/bin/env python3
"""Held-out pre-state: 25 unrelated tasks and one identical Vendor audit task, in the disposable audit DB only."""
import os, sqlite3
db = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "..", "..", "tmp", "rigorrun-audit", "sqlite-mcp", "audit.db")
db = os.path.abspath(db)
assert db.endswith(os.path.join("tmp", "rigorrun-audit", "sqlite-mcp", "audit.db")), db
con = sqlite3.connect(db)
rows = [(f"Backlog item {n}", "open" if n % 2 else "done", float(n), ["ada", "bo", "cy", "dee"][n % 4]) for n in range(1, 26)]
rows.append(("Vendor audit", "open", 12.25, "dee"))
con.executemany("INSERT INTO tasks (title, status, amount, owner) VALUES (?, ?, ?, ?)", rows)
con.commit()
print("sqlite-noise:", con.execute("SELECT count(*) FROM tasks").fetchone()[0], "tasks")
con.close()

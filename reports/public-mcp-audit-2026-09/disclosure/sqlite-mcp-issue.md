# DRAFT — not submitted. Disclose privately to the maintainer first (data-exposure impact).

**Title:** `backup` bypasses the access-control presets: `deny-everything` (and `read-only`) can still copy the whole database to any path

Hi, and thanks for the careful authorizer-based design — it held up well under everything else I threw at it (column-level `--deny`, timeouts, single-statement enforcement, sequential transactions). One tool sits outside it, though.

## Environment

- `mcp-server-sqlite` at `ff19c64e40b68df83b07e22c2faf73094ab04aeb` (v1.0.0), built with cargo 1.98.1 (`rust:1-bookworm`), run on Linux x86_64
- stdio transport, one client process

## Minimal reproduction

```bash
# a throwaway database with one table
python3 - <<'PY'
import sqlite3; c=sqlite3.connect('audit.db'); c.execute("CREATE TABLE tasks(id INTEGER PRIMARY KEY, title TEXT)"); c.execute("INSERT INTO tasks(title) VALUES ('secret')"); c.commit()
PY
mcp-server-sqlite --database ./audit.db --preset deny-everything
```

Then, over MCP:

```json
{"method":"tools/call","params":{"name":"backup","arguments":{"destination":"./copy.db"}}}
```

## Expected

Under `deny-everything` (the README: "Nothing" allowed, "Everything" denied) no tool should be able to read the database, let alone write a complete copy of it to a caller-chosen path. `vacuum` in the same session is correctly refused (`failed to vacuum database: authorization denied`).

## Actual

```json
{"destination":"./copy.db","pages_copied":3}
```

`copy.db` is a byte-complete copy containing the `tasks` row. Reproduced 3/3 from a fresh file; the same holds under `--preset read-only --deny Read(tasks.title)`: the denied column is present in the copy.

## Why

The presets are enforced through `sqlite3_set_authorizer`, which only sees SQL statements. `backup` uses the online backup API, which never passes through the authorizer, and there is no selector that gates it.

## Suggested fix and regression test

Gate `backup` (and arguably `create_fts_index`, which creates a virtual table) behind an explicit selector — e.g. refuse unless the effective policy allows `Read` on every table, or add a `Backup` action to the selector language that only `allow-everything` enables by default. A test in `tests/` along the lines of:

```rust
// under deny-everything, backup must be refused and the destination must not exist afterwards
```

Two smaller things noticed on the way, in case they are useful:

- `rows_changed` is `Connection::changes()`, so a `SELECT` issued after an `INSERT` on the same pooled connection reports `rows_changed: 1`.
- `--preset read-only` with a `--database` path that does not exist creates an empty file (the connection is opened `READ_WRITE | CREATE` regardless of preset).

Happy to share the full traces.

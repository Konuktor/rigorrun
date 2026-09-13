-- Disposable audit database for the mcp-server-sqlite target. Never a user database.
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  amount REAL NOT NULL DEFAULT 0,
  owner TEXT NOT NULL DEFAULT 'audit'
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  note TEXT
);
INSERT INTO tasks (id, title, status, amount, owner) VALUES
  (1, 'Prepare invoice',   'open',   120.50, 'ada'),
  (2, 'Review contract',   'open',    80.00, 'bo'),
  (3, 'Archive old files', 'done',     0.00, 'ada');
INSERT INTO audit_log (id, task_id, action, note) VALUES (1, 3, 'completed', 'seed');

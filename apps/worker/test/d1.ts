/**
 * A D1-compatible adapter over Node's built-in SQLite.
 *
 * This lets the Worker's routes be tested against real SQL — real constraints,
 * real indexes, real `ON CONFLICT` behaviour — with no dependency and no
 * emulator. Mocking the database would only prove the mock works.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Row = Record<string, unknown>;

interface D1Result<T = Row> {
  results?: T[];
  success: boolean;
  meta: { changes: number; last_row_id: number };
}

class TestStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): TestStatement {
    // D1 uses ?1-style parameters; node:sqlite binds them positionally.
    this.params = values.map((value) => (typeof value === 'boolean' ? Number(value) : value));
    return this;
  }

  async first<T = Row>(): Promise<T | null> {
    const statement = this.db.prepare(this.sql);
    return (statement.get(...(this.params as never[])) as T | undefined) ?? null;
  }

  async all<T = Row>(): Promise<D1Result<T>> {
    const statement = this.db.prepare(this.sql);
    return {
      results: statement.all(...(this.params as never[])) as T[],
      success: true,
      meta: { changes: 0, last_row_id: 0 },
    };
  }

  async run<T = Row>(): Promise<D1Result<T>> {
    const statement = this.db.prepare(this.sql);
    const info = statement.run(...(this.params as never[]));
    return {
      success: true,
      meta: { changes: Number(info.changes ?? 0), last_row_id: Number(info.lastInsertRowid ?? 0) },
    };
  }
}

export interface TestDatabase {
  prepare(sql: string): TestStatement;
  batch(statements: TestStatement[]): Promise<unknown[]>;
  close(): void;
}

const MIGRATION = fileURLToPath(new URL('../migrations/0001_init.sql', import.meta.url));

export function createTestD1(): TestDatabase {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(MIGRATION, 'utf8'));

  return {
    prepare: (sql: string) => new TestStatement(db, sql),
    batch: async (statements: TestStatement[]) => {
      db.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => db.close(),
  };
}

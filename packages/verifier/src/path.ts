/**
 * A small, deliberately limited path language for pointing assertions at parts
 * of an observation.
 *
 * Supported:
 *   `state.refunds`                          property access
 *   `state.refunds[0].amount`                array index
 *   `state.refunds.length`                   length (alias: `.count`)
 *   `derived.refunds[orderId=ORD-3001]`      filter, yields all matches
 *   `derived.refunds[amount>50 & approvalStatus!=approved]`   compound filter
 *
 * Filter values are parsed as `true`, `false`, `null`, a number, or otherwise a
 * bare string. After a filter, a following property applies to the first match
 * (`.length`/`.count` still apply to the whole match list) — that keeps
 * assertions readable without turning this into a query engine.
 */

export interface Resolution {
  found: boolean;
  value: unknown;
}

type Comparator = '=' | '!=' | '>' | '<' | '>=' | '<=';

interface Condition {
  field: string;
  op: Comparator;
  value: unknown;
}

const NOT_FOUND: Resolution = { found: false, value: undefined };

export function resolvePath(root: unknown, path: string): Resolution {
  let current: unknown = root;
  let afterFilter = false;

  for (const segment of tokenize(path)) {
    if (segment.kind === 'property') {
      if (segment.name === 'length' || segment.name === 'count') {
        if (Array.isArray(current)) return { found: true, value: current.length };
        if (typeof current === 'string') return { found: true, value: current.length };
        return NOT_FOUND;
      }
      if (afterFilter && Array.isArray(current)) {
        current = current[0];
        afterFilter = false;
      }
      if (current === null || current === undefined) return NOT_FOUND;
      if (typeof current !== 'object') return NOT_FOUND;
      const record = current as Record<string, unknown>;
      if (!(segment.name in record)) return NOT_FOUND;
      current = record[segment.name];
      continue;
    }

    if (segment.kind === 'index') {
      if (!Array.isArray(current)) return NOT_FOUND;
      if (segment.index >= current.length) return NOT_FOUND;
      current = current[segment.index];
      afterFilter = false;
      continue;
    }

    // filter
    if (!Array.isArray(current)) return NOT_FOUND;
    current = current.filter((entry) => matchesAll(entry, segment.conditions));
    afterFilter = true;
  }

  return { found: current !== undefined, value: current };
}

type Segment =
  | { kind: 'property'; name: string }
  | { kind: 'index'; index: number }
  | { kind: 'filter'; conditions: Condition[] };

function tokenize(path: string): Segment[] {
  const segments: Segment[] = [];
  let buffer = '';

  const flush = () => {
    if (buffer.length > 0) {
      segments.push({ kind: 'property', name: buffer });
      buffer = '';
    }
  };

  for (let i = 0; i < path.length; i += 1) {
    const char = path[i];
    if (char === '.') {
      flush();
      continue;
    }
    if (char === '[') {
      flush();
      const close = path.indexOf(']', i);
      if (close === -1) throw new Error(`Unterminated '[' in path: ${path}`);
      const inner = path.slice(i + 1, close);
      i = close;
      if (/^\d+$/.test(inner)) segments.push({ kind: 'index', index: Number(inner) });
      else segments.push({ kind: 'filter', conditions: parseConditions(inner, path) });
      continue;
    }
    buffer += char;
  }
  flush();
  return segments;
}

function parseConditions(inner: string, path: string): Condition[] {
  return inner.split('&').map((clause) => {
    const match = /^\s*([A-Za-z0-9_.]+)\s*(!=|>=|<=|=|>|<)\s*(.*?)\s*$/.exec(clause);
    if (!match) throw new Error(`Invalid filter '${clause.trim()}' in path: ${path}`);
    const [, field, op, rawValue] = match;
    return { field: field!, op: op as Comparator, value: parseLiteral(rawValue!) };
  });
}

function parseLiteral(raw: string): unknown {
  const trimmed = raw.replace(/^['"]|['"]$/g, '');
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return trimmed;
}

function matchesAll(entry: unknown, conditions: Condition[]): boolean {
  if (entry === null || typeof entry !== 'object') return false;
  return conditions.every((condition) => matches(entry as Record<string, unknown>, condition));
}

function matches(entry: Record<string, unknown>, condition: Condition): boolean {
  const actual = resolvePath(entry, condition.field).value;
  switch (condition.op) {
    case '=':
      return looseEquals(actual, condition.value);
    case '!=':
      return !looseEquals(actual, condition.value);
    case '>':
      return numeric(actual) > numeric(condition.value);
    case '<':
      return numeric(actual) < numeric(condition.value);
    case '>=':
      return numeric(actual) >= numeric(condition.value);
    case '<=':
      return numeric(actual) <= numeric(condition.value);
  }
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // `null` and a missing property are treated as the same thing so that
  // `[approvalId=null]` matches both shapes.
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  return false;
}

function numeric(value: unknown): number {
  return typeof value === 'number' ? value : Number.NaN;
}

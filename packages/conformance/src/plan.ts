/**
 * Deciding what to send a tool, and whether to call it at all.
 *
 * The governing rule, and the reason this is not a fuzzer: **a server hint may
 * only ever reduce what RigorRun does, never license it.**
 *
 * `destructiveHint: true` is believed, because believing it makes us do
 * strictly less. `readOnlyHint: true` buys nothing at all — that annotation is
 * the thing under test, and relaxing our caution because a tool claims to be
 * safe would mean the tools most worth catching are the ones treated most
 * gently. `packages/connector/src/risk.ts` makes the same argument for verdicts;
 * this is the same argument for arguments.
 *
 * The values below are a fixed table, not a generator. One safe, deterministic
 * exercise per tool is the goal. Fuzzing somebody else's server is a different
 * product, and a dangerous one to ship by accident.
 *
 * Like the rest of the generic code this reads structure only, never field
 * names, so `pnpm domain` holds.
 */
import { SCHEMA_LIMITS, type ServerHints } from '@rigorrun/connector';

/** What RigorRun is willing to do with a tool, and why. */
export type ToolPlan =
  | { class: 'SAFE_AUTOMATIC'; args: Record<string, unknown>; derivation: string[] }
  | { class: 'NEEDS_FIXTURE'; reason: string; args?: Record<string, unknown> }
  | { class: 'NEEDS_CREDENTIAL'; reason: string }
  | { class: 'UNSAFE_TO_EXERCISE'; reason: string }
  | { class: 'UNDETERMINED'; reason: string };

export interface PlanInput {
  name: string;
  inputSchema: unknown;
  hints: ServerHints;
  /** Tools the operator said need a credential. Never inferred. */
  needsCredential?: readonly string[];
  /** Mixed into generated values so a run is reproducible but not constant. */
  seed: string;
}

/**
 * Shapes that are never generated, and what each one would risk.
 *
 * Every entry here is a value that could turn a benign write into something
 * else: a traversal, a wildcard match, a flag, a home-directory expansion. A
 * string that would contain one is replaced rather than escaped, because
 * escaping is a claim about somebody else's parser.
 */
const FORBIDDEN = /[/\\*?~]|\.\./;
const MAX_STRING = 64;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function declaredType(node: Record<string, unknown>): string | undefined {
  const t = node['type'];
  if (typeof t === 'string') return t;
  // Some servers write ["string","null"]. Take the first non-null.
  if (Array.isArray(t)) {
    const first = t.find((entry) => typeof entry === 'string' && entry !== 'null');
    if (typeof first === 'string') return first;
  }
  if (Array.isArray(node['enum']) || node['const'] !== undefined) return 'string';
  if (isObject(node['properties'])) return 'object';
  return undefined;
}

/**
 * A short, inert token, stable for a given seed and position.
 *
 * Position is the JSON pointer, so two different fields never collide and the
 * same field is the same value on every run of the same plan. That is what
 * makes a record reproducible.
 */
function token(seed: string, pointer: string): string {
  let h = 0x811c9dc5;
  for (const ch of `${seed}${pointer}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `rr-${h.toString(16).padStart(8, '0')}`;
}

interface Ctx {
  seed: string;
  derivation: string[];
  /** Set when a value could not be produced honestly. */
  blocked?: string;
  nodes: number;
}

function synth(node: unknown, pointer: string, depth: number, ctx: Ctx): unknown {
  if (ctx.blocked) return undefined;
  if (depth > SCHEMA_LIMITS.maxDepth) {
    ctx.blocked = `the schema nests deeper than ${SCHEMA_LIMITS.maxDepth} levels at ${pointer}`;
    return undefined;
  }
  if (++ctx.nodes > SCHEMA_LIMITS.maxNodes) {
    ctx.blocked = 'the schema is larger than RigorRun will walk';
    return undefined;
  }
  if (!isObject(node)) {
    ctx.blocked = `no schema for ${pointer}`;
    return undefined;
  }

  if (node['const'] !== undefined) {
    ctx.derivation.push(`${pointer}: the schema's single allowed value`);
    return node['const'];
  }

  if (Array.isArray(node['enum'])) {
    const values = [...node['enum']];
    if (values.length === 0) {
      ctx.blocked = `${pointer} allows no values`;
      return undefined;
    }
    // Sorted, so the choice is a property of the set rather than of the order
    // the server happened to write it in.
    values.sort((a, b) => String(a).localeCompare(String(b)));
    ctx.derivation.push(`${pointer}: first of ${values.length} allowed values, sorted`);
    return values[0];
  }

  switch (declaredType(node)) {
    case 'boolean':
      ctx.derivation.push(`${pointer}: false`);
      return false;

    case 'integer':
    case 'number': {
      const min = typeof node['minimum'] === 'number' ? node['minimum'] : undefined;
      const max = typeof node['maximum'] === 'number' ? node['maximum'] : undefined;
      let n = 1;
      if (min !== undefined && n < min) n = min;
      if (max !== undefined && n > max) n = max;
      ctx.derivation.push(`${pointer}: ${n}, inside any declared bounds`);
      return n;
    }

    case 'string': {
      if (typeof node['pattern'] === 'string') {
        // Fabricating a value to satisfy somebody else's regex means guessing
        // what it is for. An honest undetermined beats a lucky match.
        ctx.blocked = `${pointer} constrains its value by pattern, which RigorRun will not guess`;
        return undefined;
      }
      if (node['format'] === 'date-time') {
        ctx.derivation.push(`${pointer}: a fixed timestamp`);
        return '2026-01-01T00:00:00.000Z';
      }
      const value = token(ctx.seed, pointer);
      ctx.derivation.push(`${pointer}: an inert generated token`);
      return value;
    }

    case 'array': {
      const items = node['items'];
      if (items === undefined) {
        ctx.blocked = `${pointer} is an array but does not say of what`;
        return undefined;
      }
      // Exactly one element. Zero often means "all" to a server, and many is
      // load rather than evidence.
      const element = synth(items, `${pointer}/0`, depth + 1, ctx);
      if (ctx.blocked) return undefined;
      ctx.derivation.push(`${pointer}: exactly one element`);
      return [element];
    }

    case 'object': {
      const props = node['properties'];
      if (!isObject(props)) {
        ctx.derivation.push(`${pointer}: an empty object`);
        return {};
      }
      const required = Array.isArray(node['required'])
        ? node['required'].filter((r): r is string => typeof r === 'string')
        : [];
      const out: Record<string, unknown> = {};
      for (const key of required) {
        const child = props[key];
        if (child === undefined) {
          ctx.blocked = `${pointer} requires "${key}" but does not describe it`;
          return undefined;
        }
        out[key] = synth(child, `${pointer}/${key}`, depth + 1, ctx);
        if (ctx.blocked) return undefined;
      }
      return out;
    }

    default:
      ctx.blocked = `${pointer} declares no type RigorRun can produce a value for`;
      return undefined;
  }
}

/** Every string that ends up in an argument must be inert and short. */
function assertInert(value: unknown, pointer: string): string | undefined {
  if (typeof value === 'string') {
    if (value.length > MAX_STRING) return `${pointer} would need a string longer than ${MAX_STRING}`;
    if (FORBIDDEN.test(value)) return `${pointer} would need a value containing a path or wildcard`;
  }
  if (Array.isArray(value)) {
    for (const [i, entry] of value.entries()) {
      const bad = assertInert(entry, `${pointer}/${i}`);
      if (bad) return bad;
    }
  }
  if (isObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      const bad = assertInert(entry, `${pointer}/${key}`);
      if (bad) return bad;
    }
  }
  return undefined;
}

export function planTool(input: PlanInput): ToolPlan {
  // Believed, because believing it makes us do less.
  if (input.hints.destructive === true) {
    return {
      class: 'UNSAFE_TO_EXERCISE',
      reason: 'the server declares this tool destructive, and RigorRun takes that at its word',
    };
  }

  // Never inferred from an error message or a field name. Only stated.
  if (input.needsCredential?.includes(input.name)) {
    return {
      class: 'NEEDS_CREDENTIAL',
      reason: 'the operator declared that this tool needs a credential',
    };
  }

  const ctx: Ctx = { seed: input.seed, derivation: [], nodes: 0 };
  const args = synth(input.inputSchema, '', 0, ctx);
  if (ctx.blocked) return { class: 'UNDETERMINED', reason: ctx.blocked };
  if (!isObject(args)) {
    return { class: 'UNDETERMINED', reason: 'the tool does not take an object of arguments' };
  }

  const unsafe = assertInert(args, '');
  if (unsafe) return { class: 'UNDETERMINED', reason: unsafe };

  return { class: 'SAFE_AUTOMATIC', args, derivation: ctx.derivation };
}

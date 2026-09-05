/**
 * Converting a tool's JSON Schema into RigorRun's parameter vocabulary.
 *
 * The schema on the other side of this function was written by somebody else
 * and fetched over a network. It is data, not a specification we trust: it may
 * be enormous, it may be cyclic, it may nest a thousand deep, and it may
 * describe types RigorRun has no way to represent. So this walks it with hard
 * caps and reports what it could not express instead of throwing, guessing, or
 * quietly dropping a required argument.
 *
 * What it deliberately does not do is read field *names*. `amount`, `status`
 * and `owner` mean nothing here. Structure is the only evidence — a closed set
 * of values is an enum because it is a closed set, not because it is called a
 * status. That is what keeps this file compatible with `pnpm domain`, and it is
 * the same discipline the compiler is already held to.
 */
import type { ActionParam, FieldType } from '@rigorrun/environment';

/** Hard limits. A hostile or merely careless schema must not be able to hang us. */
export const SCHEMA_LIMITS = {
  maxDepth: 8,
  maxProperties: 200,
  maxEnumValues: 100,
  maxNodes: 5_000,
} as const;

/** A parameter RigorRun could not express in its own vocabulary. */
export interface UnsupportedParam {
  name: string;
  /** Why, in words a person configuring a connector can act on. */
  reason: string;
}

export interface ConvertedParams {
  params: ActionParam[];
  unsupported: UnsupportedParam[];
  /** True when a cap stopped the walk, so the result is known to be partial. */
  truncated: boolean;
}

interface Node {
  type?: unknown;
  enum?: unknown;
  const?: unknown;
  format?: unknown;
  description?: unknown;
  properties?: unknown;
  required?: unknown;
  anyOf?: unknown;
  oneOf?: unknown;
  allOf?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The declared type of a node, tolerating the several shapes real servers use.
 *
 * `type` may be absent, a string, or an array including `"null"` to mean
 * nullable. A union of one real type plus null is that type; a union of two
 * real types is not something a single `FieldType` can carry.
 */
function declaredTypes(node: Node): string[] {
  const raw = node.type;
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === 'string');
  return [];
}

/** Values of a closed set, if this node declares one and it is small enough. */
function closedValues(node: Node): string[] | undefined {
  const values = Array.isArray(node.enum)
    ? node.enum
    : node.const !== undefined
      ? [node.const]
      : undefined;
  if (!values || values.length === 0) return undefined;
  if (values.length > SCHEMA_LIMITS.maxEnumValues) return undefined;
  // A set RigorRun can compare against has to be a set of scalars it can print.
  if (!values.every((value) => typeof value === 'string' || typeof value === 'number')) {
    return undefined;
  }
  return values.map((value) => String(value));
}

interface Resolved {
  type: FieldType;
  enumValues?: string[];
}

/**
 * One node to one RigorRun field type, or nothing.
 *
 * `anyOf`/`oneOf` are collapsed only when every non-null branch agrees, which
 * is the common "string or null" case. Disagreeing branches are honestly
 * unrepresentable rather than resolved by picking the first.
 */
function resolveType(node: Node, depth: number, budget: { nodes: number }): Resolved | undefined {
  if (depth > SCHEMA_LIMITS.maxDepth) return undefined;
  budget.nodes -= 1;
  if (budget.nodes <= 0) return undefined;

  const values = closedValues(node);
  if (values) return { type: 'enum', enumValues: values };

  const branches = [node.anyOf, node.oneOf, node.allOf].find((entry) => Array.isArray(entry));
  if (Array.isArray(branches)) {
    const resolved = branches
      .filter(isObject)
      .filter((branch) => declaredTypes(branch as Node)[0] !== 'null')
      .map((branch) => resolveType(branch as Node, depth + 1, budget))
      .filter((entry): entry is Resolved => entry !== undefined);
    if (resolved.length === 0) return undefined;
    const first = resolved[0]!;
    return resolved.every((entry) => entry.type === first.type) ? first : undefined;
  }

  const types = declaredTypes(node).filter((entry) => entry !== 'null');
  if (types.length !== 1) return undefined;

  switch (types[0]) {
    case 'string':
      // A date-time is an ordered magnitude to RigorRun, and interval rules
      // depend on knowing that. `format` is the only signal that says so.
      return node.format === 'date-time' ? { type: 'timestamp' } : { type: 'string' };
    case 'number':
    case 'integer':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    default:
      // object, array, null-only: real, but not a scalar RigorRun can assert on.
      return undefined;
  }
}

function describe(node: Node): string | undefined {
  return typeof node.description === 'string' && node.description.length > 0
    ? node.description.slice(0, 500)
    : undefined;
}

/** The top-level `properties` of a tool's input schema, as RigorRun parameters. */
export function paramsFromInputSchema(schema: unknown): ConvertedParams {
  const params: ActionParam[] = [];
  const unsupported: UnsupportedParam[] = [];
  let truncated = false;

  if (!isObject(schema)) {
    return { params, unsupported, truncated: false };
  }

  const properties = isObject(schema['properties']) ? schema['properties'] : undefined;
  if (!properties) {
    return { params, unsupported, truncated: false };
  }

  const requiredList = Array.isArray(schema['required'])
    ? new Set(schema['required'].filter((entry): entry is string => typeof entry === 'string'))
    : new Set<string>();

  const budget = { nodes: SCHEMA_LIMITS.maxNodes };
  const names = Object.keys(properties);
  if (names.length > SCHEMA_LIMITS.maxProperties) truncated = true;

  for (const name of names.slice(0, SCHEMA_LIMITS.maxProperties)) {
    const raw = properties[name];
    if (!isObject(raw)) {
      unsupported.push({ name, reason: 'the schema for this argument is not an object' });
      continue;
    }
    const node = raw as Node;
    const resolved = resolveType(node, 0, budget);
    if (!resolved) {
      unsupported.push({
        name,
        reason: budget.nodes <= 0 ? 'the schema was too large to read' : unsupportedReason(node),
      });
      continue;
    }
    params.push({
      name,
      type: resolved.type,
      required: requiredList.has(name),
      ...(resolved.enumValues ? { enumValues: resolved.enumValues } : {}),
      ...(describe(node) ? { description: describe(node)! } : {}),
    });
  }

  if (budget.nodes <= 0) truncated = true;
  return { params, unsupported, truncated };
}

/** Why a node could not be expressed, phrased for whoever has to fix it. */
function unsupportedReason(node: Node): string {
  const types = declaredTypes(node).filter((entry) => entry !== 'null');
  if (types.length === 0) return 'no type is declared, so RigorRun cannot assert on it';
  if (types.length > 1) return `it may be ${types.join(' or ')}, and RigorRun needs one type`;
  const type = types[0]!;
  if (type === 'object' || type === 'array') {
    return `it is ${type === 'array' ? 'a list' : 'a nested object'}, which RigorRun cannot compare against yet`;
  }
  return `RigorRun has no equivalent of "${type}"`;
}

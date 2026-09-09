/**
 * What the planner must never do.
 *
 * Most of these are not testing that a value is correct — they are testing
 * that a whole class of value is impossible, because the planner sends its
 * output to somebody else's code and one bad string is a different product.
 */
import { describe, expect, it } from 'vitest';
import { planTool, type ToolPlan } from '../src/index.ts';

const seed = 'seed-1';
const noHints = {} as const;

function plan(inputSchema: unknown, hints = noHints, name = 'tool'): ToolPlan {
  return planTool({ name, inputSchema, hints, seed });
}

/** The real schema from @modelcontextprotocol/server-memory's create_entities. */
const CREATE_ENTITIES = {
  type: 'object',
  properties: {
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          entityType: { type: 'string' },
          observations: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'entityType', 'observations'],
      },
    },
  },
  required: ['entities'],
};

describe('the argument planner', () => {
  /**
   * The regression that would have made the whole demo hollow.
   *
   * The connector's existing schema converter returns undefined for object and
   * array parameters. Every write tool on the reference target takes an array,
   * so reusing it would have meant exercising only the read tools and finding
   * nothing worth finding.
   */
  it('builds arguments for a nested array-of-objects tool', () => {
    const result = plan(CREATE_ENTITIES);
    expect(result.class).toBe('SAFE_AUTOMATIC');
    if (result.class !== 'SAFE_AUTOMATIC') return;

    const entities = result.args['entities'] as unknown[];
    expect(entities).toHaveLength(1);
    const first = entities[0] as Record<string, unknown>;
    expect(Object.keys(first).sort()).toEqual(['entityType', 'name', 'observations']);
    expect(typeof first['name']).toBe('string');
    expect(first['observations']).toHaveLength(1);
  });

  it('generates no value that could be read as a path, a wildcard or a flag', () => {
    const hostile = {
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'array', items: { type: 'string' } },
        c: { type: 'object', properties: { d: { type: 'string' } }, required: ['d'] },
      },
      required: ['a', 'b', 'c'],
    };
    const result = plan(hostile);
    expect(result.class).toBe('SAFE_AUTOMATIC');
    if (result.class !== 'SAFE_AUTOMATIC') return;

    const strings: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(result.args);

    expect(strings.length).toBeGreaterThan(0);
    for (const s of strings) {
      expect(s).not.toMatch(/[/\\*?~]/);
      expect(s).not.toContain('..');
      expect(s).not.toMatch(/^-/);
      expect(s.length).toBeGreaterThan(0);
      expect(s.length).toBeLessThanOrEqual(64);
    }
  });

  it('is deterministic for a seed, and varies between seeds', () => {
    const a = planTool({ name: 't', inputSchema: CREATE_ENTITIES, hints: noHints, seed: 'one' });
    const b = planTool({ name: 't', inputSchema: CREATE_ENTITIES, hints: noHints, seed: 'one' });
    const c = planTool({ name: 't', inputSchema: CREATE_ENTITIES, hints: noHints, seed: 'two' });
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('takes a destructive declaration at its word, and does not call the tool', () => {
    const result = plan(CREATE_ENTITIES, { destructive: true });
    expect(result.class).toBe('UNSAFE_TO_EXERCISE');
  });

  /**
   * The asymmetry the whole design rests on. A hint may make us do less. It
   * may never make us do more, least of all the hint under test.
   */
  it('gives a read-only declaration no licence whatsoever', () => {
    const declared = plan(CREATE_ENTITIES, { readOnly: true });
    const silent = plan(CREATE_ENTITIES, noHints);
    expect(declared).toEqual(silent);
  });

  it('will not invent a value to satisfy somebody else’s regex', () => {
    const result = plan({
      type: 'object',
      properties: { code: { type: 'string', pattern: '^[A-Z]{3}-[0-9]{4}$' } },
      required: ['code'],
    });
    expect(result.class).toBe('UNDETERMINED');
    if (result.class === 'UNDETERMINED') expect(result.reason).toMatch(/pattern/);
  });

  it('respects declared numeric bounds', () => {
    const result = plan({
      type: 'object',
      properties: { n: { type: 'integer', minimum: 10, maximum: 20 } },
      required: ['n'],
    });
    expect(result.class).toBe('SAFE_AUTOMATIC');
    if (result.class === 'SAFE_AUTOMATIC') expect(result.args['n']).toBe(10);
  });

  it('picks an enum value by the set, not by the order the server wrote it', () => {
    const one = plan({
      type: 'object',
      properties: { s: { enum: ['zulu', 'alpha', 'mike'] } },
      required: ['s'],
    });
    const two = plan({
      type: 'object',
      properties: { s: { enum: ['mike', 'zulu', 'alpha'] } },
      required: ['s'],
    });
    expect(one.class === 'SAFE_AUTOMATIC' && one.args['s']).toBe('alpha');
    expect(two.class === 'SAFE_AUTOMATIC' && two.args['s']).toBe('alpha');
  });

  it('never infers that a credential is needed', () => {
    // No schema shape and no error text may produce NEEDS_CREDENTIAL...
    for (const schema of [CREATE_ENTITIES, { type: 'object', properties: {} }]) {
      expect(plan(schema).class).not.toBe('NEEDS_CREDENTIAL');
    }
    // ...only the operator saying so.
    const stated = planTool({
      name: 'sync',
      inputSchema: CREATE_ENTITIES,
      hints: noHints,
      seed,
      needsCredential: ['sync'],
    });
    expect(stated.class).toBe('NEEDS_CREDENTIAL');
  });

  it('reports undetermined rather than guessing at an untyped field', () => {
    const result = plan({
      type: 'object',
      properties: { anything: {} },
      required: ['anything'],
    });
    expect(result.class).toBe('UNDETERMINED');
  });

  it('omits optional properties rather than filling the world in', () => {
    const result = plan({
      type: 'object',
      properties: { needed: { type: 'string' }, extra: { type: 'string' } },
      required: ['needed'],
    });
    expect(result.class).toBe('SAFE_AUTOMATIC');
    if (result.class === 'SAFE_AUTOMATIC') expect(Object.keys(result.args)).toEqual(['needed']);
  });
});

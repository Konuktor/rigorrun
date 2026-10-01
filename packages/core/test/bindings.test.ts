/**
 * Binding a case to the records made for it.
 *
 * The names here mean nothing on purpose: binding is about tokens and paths,
 * and a test that only passed for one business would be testing the business.
 */
import { describe, expect, it } from 'vitest';
import {
  BenchmarkCaseSchema,
  BindingError,
  CASE_BINDINGS_ENV,
  bindCase,
  type BenchmarkCase,
} from '../src/index.ts';

const BINDINGS = {
  item: 'it_123',
  holder: 'hd_456',
  holder_email: 'ada+case 7@example.test',
} as const;

function makeCase(overrides: Record<string, unknown> = {}): BenchmarkCase {
  return BenchmarkCaseSchema.parse({
    id: 'case_bound',
    name: 'A bound case',
    category: 'happy_path',
    seed: { scenarioId: 'materialized', recipe: { item: { size: 25 } } },
    task: {
      instruction: 'Message from {{bind:holder_email}}: please handle {{bind:item}}.',
      inputs: { item: '{{bind:item}}', nested: { list: ['{{bind:holder}}', 7, null] } },
    },
    checks: [
      {
        id: 'exists',
        kind: 'state_exists',
        description: 'The record exists on the bound item',
        target: 'derived.created.Entry[item={{bind:item}} & size=25]',
        applicableWhen: {
          kind: 'state_exists',
          target: 'derived.all.Holder[id={{bind:holder}}]',
        },
        orElse: {
          kind: 'state_equals',
          target: 'derived.all.Item[id={{bind:item}}].0.holder',
          expected: '{{bind:holder}}',
        },
      },
      {
        id: 'note',
        kind: 'contains',
        description: 'The note names the holder',
        target: 'derived.created.Entry[item={{bind:item}}].0.note',
        expected: 'for {{bind:holder_email}}',
      },
    ],
    referencePlan: [{ action: 'handle', args: { item: '{{bind:item}}', size: 25 } }],
    ...overrides,
  });
}

describe('bindCase', () => {
  it('binds whom the agent acts for, and leaves a case without a principal without one', () => {
    const withPrincipal = bindCase(
      makeCase({
        task: {
          instruction: 'Handle {{bind:item}}.',
          principal: { tenant: '{{bind:holder}}', role: 'support' },
        },
      }),
      BINDINGS,
    );
    expect(withPrincipal.task.principal).toEqual({ tenant: BINDINGS.holder, role: 'support' });
    expect(bindCase(makeCase(), BINDINGS).task.principal).toBeUndefined();
  });

  it('binds the task the agent reads, whatever the values contain', () => {
    const bound = bindCase(makeCase(), BINDINGS);
    expect(bound.task.instruction).toBe(
      'Message from ada+case 7@example.test: please handle it_123.',
    );
    expect(bound.task.inputs).toEqual({ item: 'it_123', nested: { list: ['hd_456', 7, null] } });
  });

  it('binds every path and expectation of every check', () => {
    const [exists, note] = bindCase(makeCase(), BINDINGS).checks;
    expect(exists?.target).toBe('derived.created.Entry[item=it_123 & size=25]');
    expect(exists?.applicableWhen).toEqual({
      kind: 'state_exists',
      target: 'derived.all.Holder[id=hd_456]',
    });
    expect(exists?.orElse).toEqual({
      kind: 'state_equals',
      target: 'derived.all.Item[id=it_123].0.holder',
      expected: 'hd_456',
    });
    // An expectation is a value, so a value that could never be part of a
    // path may still be what a check expects to find.
    expect(note?.expected).toBe('for ada+case 7@example.test');
  });

  it('binds the reference plan', () => {
    expect(bindCase(makeCase(), BINDINGS).referencePlan).toEqual([
      { action: 'handle', args: { item: 'it_123', size: 25 } },
    ]);
  });

  it('leaves the case it was given, and the seed, exactly as they were', () => {
    const original = makeCase({
      seed: { scenarioId: 'materialized', recipe: { label: '{{bind:item}}' } },
    });
    const before = JSON.stringify(original);
    const bound = bindCase(original, BINDINGS);
    expect(JSON.stringify(original)).toBe(before);
    // The seed is what bindings come from; binding it would be circular.
    expect(bound.seed).toEqual(original.seed);
  });

  it('keeps the shape of a check that had no expectation or alternative', () => {
    const plain = makeCase({
      checks: [
        {
          id: 'c',
          kind: 'state_exists',
          description: 'd',
          target: 'derived.all.X[id={{bind:item}}]',
        },
      ],
    });
    const [check] = bindCase(plain, BINDINGS).checks;
    expect(check).not.toHaveProperty('expected');
    expect(check).not.toHaveProperty('applicableWhen');
    expect(check).not.toHaveProperty('orElse');
  });

  it('refuses a token nothing is bound to, and names it', () => {
    const unbound = makeCase({ task: { instruction: 'Handle {{bind:missing}}.' } });
    expect(() => bindCase(unbound, BINDINGS)).toThrow(BindingError);
    expect(() => bindCase(unbound, BINDINGS)).toThrow(/"missing"/);
  });

  it('refuses an unbound token inside a check path', () => {
    const unbound = makeCase({
      checks: [
        {
          id: 'c',
          kind: 'state_exists',
          description: 'd',
          target: 'derived.all.X[id={{bind:nope}}]',
        },
      ],
    });
    expect(() => bindCase(unbound, BINDINGS)).toThrow(/checks\[0\]\.target.*"nope"/);
  });

  it('does not find a binding on the prototype', () => {
    const inherited = makeCase({ task: { instruction: 'Handle {{bind:constructor}}.' } });
    expect(() => bindCase(inherited, BINDINGS)).toThrow(/"constructor"/);
  });

  describe('a value going into a check path', () => {
    const pathsWithTheEmail: [string, Record<string, unknown>][] = [
      ['a target', { target: 'derived.all.X[email={{bind:holder_email}}]' }],
      [
        'a precondition',
        {
          target: 'derived.all.X',
          applicableWhen: {
            kind: 'state_exists',
            target: 'derived.all.X[email={{bind:holder_email}}]',
          },
        },
      ],
      [
        'an alternative',
        {
          target: 'derived.all.X',
          orElse: { kind: 'state_exists', target: 'derived.all.X[email={{bind:holder_email}}]' },
        },
      ],
    ];

    for (const [where, fields] of pathsWithTheEmail) {
      it(`must be a plain identifier in ${where}`, () => {
        const unsafe = makeCase({
          checks: [{ id: 'c', kind: 'state_exists', description: 'd', ...fields }],
        });
        expect(() => bindCase(unsafe, BINDINGS)).toThrow(BindingError);
        expect(() => bindCase(unsafe, BINDINGS)).toThrow(
          /"holder_email" is not a plain identifier/,
        );
      });
    }

    it('must be a plain identifier where a state change names a record by path', () => {
      const unsafe = makeCase({
        checks: [
          {
            id: 'c',
            kind: 'state_change',
            description: 'd',
            target: 'derived.all.X[id={{bind:item}}]',
            expected: {
              seed: 'derived.seed.X[email={{bind:holder_email}}]',
              field: 'size',
              to: 1,
              compare: 'quantity',
            },
          },
        ],
      });
      expect(() => bindCase(unsafe, BINDINGS)).toThrow(/expected\.seed/);

      const safe = makeCase({
        checks: [
          {
            id: 'c',
            kind: 'state_change',
            description: 'd',
            target: 'derived.all.X[id={{bind:item}}]',
            expected: {
              seed: 'derived.seed.X[id={{bind:item}}]',
              field: 'size',
              to: '{{bind:holder_email}}',
              compare: 'quantity',
            },
          },
        ],
      });
      expect(bindCase(safe, BINDINGS).checks[0]?.expected).toEqual({
        seed: 'derived.seed.X[id=it_123]',
        field: 'size',
        to: 'ada+case 7@example.test',
        compare: 'quantity',
      });
    });

    it('cannot change what the path asks', () => {
      // `]` and `&` would end the filter and add a clause of the value's own.
      const hostile = { ...BINDINGS, item: 'x] & size>0 & id=[x' };
      expect(() => bindCase(makeCase(), hostile)).toThrow(/"item" is not a plain identifier/);
    });
  });

  it('refuses a token where nothing is bound, and one that is not well formed', () => {
    const inName = makeCase({ name: 'Handle {{bind:item}}' });
    expect(() => bindCase(inName, BINDINGS)).toThrow(/at name/);

    const inBrief = makeCase({
      task: { instruction: 'Handle it.', policyBrief: 'Never more than {{bind:item}}.' },
    });
    expect(() => bindCase(inBrief, BINDINGS)).toThrow(/task\.policyBrief/);

    const unclosed = makeCase({ task: { instruction: 'Handle {{bind:item.' } });
    expect(() => bindCase(unclosed, BINDINGS)).toThrow(/task\.instruction/);

    const inKey = makeCase({ task: { instruction: 'Handle it.', inputs: { '{{bind:item}}': 1 } } });
    expect(() => bindCase(inKey, BINDINGS)).toThrow(BindingError);
  });

  it('refuses bindings that could not have come from a well-formed environment', () => {
    expect(() => bindCase(makeCase(), { ...BINDINGS, 'bad name': 'x' })).toThrow(/binding name/);
    expect(() => bindCase(makeCase(), { ...BINDINGS, holder: '{{bind:item}}' })).toThrow(
      /contains a binding token/,
    );
  });

  it('keeps a key from the case an ordinary key', () => {
    // Built past the schema, which drops such a key on parse: binding must not
    // depend on every caller having parsed first.
    const inputs = JSON.parse('{"__proto__": {"polluted": "{{bind:item}}"}}') as Record<
      string,
      unknown
    >;
    const base = makeCase();
    const bound = bindCase({ ...base, task: { ...base.task, inputs } }, BINDINGS);
    expect(Object.keys(bound.task.inputs)).toEqual(['__proto__']);
    expect(Object.getOwnPropertyDescriptor(bound.task.inputs, '__proto__')?.value).toEqual({
      polluted: 'it_123',
    });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('names the variable an after-case program reads the bindings from', () => {
    expect(CASE_BINDINGS_ENV).toBe('RIGORRUN_CASE_BINDINGS');
  });
});

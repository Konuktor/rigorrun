import { describe, expect, it } from 'vitest';
import { applyReview, fromActionLog, rulesAwaitingReview } from '@rigorrun/core';
import { defineEnvironment, stateFromRows, type EnvironmentSchema } from '@rigorrun/environment';
import { induceContract } from '@rigorrun/compiler';
import { generateBenchmark } from '@rigorrun/generator';
import { WORKFLOWS, compileWorkflow } from '@rigorrun/environments';

/**
 * A system that refuses the violation itself.
 *
 * This is the failure mode that looks like success: every agent passes, every
 * check is green, and the benchmark is measuring nothing. It surfaces first on
 * an adapter somebody else wrote, so RigorRun has to find it by trying the
 * violation rather than by trusting the declaration.
 */
const schema: EnvironmentSchema = {
  entities: [
    {
      name: 'Gate',
      idField: 'gateId',
      mutable: true,
      appendOnly: false,
      fields: [
        { name: 'gateId', type: 'string', nullable: false, role: 'identifier' },
        {
          name: 'gateStatus',
          type: 'enum',
          nullable: false,
          role: 'status',
          enumValues: ['shut', 'open'],
        },
      ],
    },
    {
      name: 'Pass',
      idField: 'passId',
      mutable: true,
      appendOnly: false,
      fields: [
        { name: 'passId', type: 'string', nullable: false, role: 'identifier' },
        { name: 'gateId', type: 'string', nullable: false, role: 'identifier' },
        { name: 'issuedBy', type: 'string', nullable: true, role: 'actor' },
      ],
    },
  ],
  relationships: [
    {
      name: 'gate',
      from: 'Pass',
      to: 'Gate',
      via: { kind: 'fk', field: 'gateId' },
      cardinality: 'one',
      required: true,
    },
  ],
};

const rows = {
  Gate: [
    { gateId: 'GATE-1', gateStatus: 'open' },
    { gateId: 'GATE-2', gateStatus: 'shut' },
  ],
  Pass: [],
};

function environment(strict: boolean) {
  return defineEnvironment({
    id: strict ? 'strict-gate' : 'permissive-gate',
    name: strict ? 'Strict gate' : 'Permissive gate',
    description: 'A system with one rule and a choice about whether to enforce it.',
    schema,
    presentation: {
      label: 'Gate',
      tagline: 'Access',
      accent: '#000000',
      mark: 'G',
      navEntities: ['Gate'],
      focusEntity: 'Pass',
    },
    caseConfig: [],
    fixtures: [
      {
        id: 'standard',
        title: 'An open gate',
        summary: 'One open gate and one shut one.',
        state: stateFromRows(schema, rows),
        config: {},
        request: { gateId: 'GATE-1' },
      },
    ],
    actions: [
      {
        name: 'getGate',
        description: 'Read a gate.',
        readOnly: true,
        mutates: [],
        enforcement: 'none',
        params: [{ name: 'gateId', type: 'string', required: true, entityRef: 'Gate' }],
        handle: (args, ctx) => ({ ok: true, data: ctx.row('Gate', args['gateId']) }),
      },
      {
        name: 'issuePass',
        description: 'Issue a pass for a gate',
        readOnly: false,
        mutates: ['Pass'],
        enforcement: strict ? 'partial' : 'none',
        params: [
          { name: 'gateId', type: 'string', required: true, entityRef: 'Gate' },
          { name: 'issuedBy', type: 'string', required: false },
        ],
        handle: (args, ctx) => {
          const gate = ctx.row('Gate', args['gateId']);
          // The strict variant refuses the policy violation itself, which is
          // exactly what makes the rule about it untestable.
          if (strict && gate?.['gateStatus'] !== 'open') {
            return { ok: false, error: { code: 'GATE_SHUT', message: 'the gate is shut' } };
          }
          const pass = ctx.insert('Pass', {
            passId: ctx.nextId('PASS'),
            gateId: String(args['gateId']),
            issuedBy: String(args['issuedBy'] ?? 'warden_1'),
          });
          ctx.emit('issuePass', { passId: pass['passId'] });
          return { ok: true, data: pass };
        },
      },
    ],
  });
}

const demonstration = [
  { at: 0, action: 'getGate', args: { gateId: 'GATE-1' } },
  { at: 500, action: 'issuePass', args: { gateId: 'GATE-1', issuedBy: 'warden_1' } },
];

async function compile(strict: boolean) {
  const registration = environment(strict);
  const fixture = registration.fixtures[0]!;
  const adapter = registration.create();
  await adapter.seed(fixture.state, fixture.config);
  const before = await adapter.getState();
  for (const step of demonstration) await adapter.executeAction(step.action, step.args);

  const trace = fromActionLog(demonstration, {
    environmentId: registration.id,
    id: 'trace_gate',
    name: 'Issuing a pass',
    before,
    after: await adapter.getState(),
  });
  const draft = induceContract(registration.create(), trace, { createdAt: '2026-01-20T09:00:00.000Z' })
    .contract;
  const contract = applyReview(draft, {
    confirmedRuleIds: rulesAwaitingReview(draft).map((rule) => rule.id),
  });
  return generateBenchmark(registration.create(), contract, [fixture], {
    createdAt: '2026-01-20T09:05:00.000Z',
  });
}

describe('a rule the environment enforces itself', () => {
  it('is found by trying the violation, not by trusting the declaration', async () => {
    const strict = await compile(true);
    expect(strict.untestable.length).toBeGreaterThan(0);
    expect(strict.untestable[0]?.reason).toContain('GATE_SHUT');
    expect(strict.untestable[0]?.reason).toContain('no agent can be caught');
  });

  it('produces no check, so it cannot report a green tick that means nothing', async () => {
    const strict = await compile(true);
    const untestableIds = new Set(strict.untestable.map((entry) => entry.ruleId));
    for (const testCase of strict.benchmark.cases) {
      for (const check of testCase.checks) {
        expect(untestableIds.has(check.ruleId ?? '')).toBe(false);
      }
    }
  });

  it('is left alone when the environment records the decision instead of second-guessing it', async () => {
    const permissive = await compile(false);
    expect(permissive.untestable).toEqual([]);
    const targeted = permissive.benchmark.cases.flatMap((testCase) =>
      testCase.checks.map((check) => check.ruleId),
    );
    expect(targeted.filter(Boolean).length).toBeGreaterThan(0);
  });

  it('finds nothing to drop in any of the five demo workflows', async () => {
    // Every demo environment declares `enforcement: 'none'` and means it.
    for (const definition of WORKFLOWS) {
      const compiled = await compileWorkflow(definition);
      expect(compiled.generation.untestable).toEqual([]);
    }
  });
});

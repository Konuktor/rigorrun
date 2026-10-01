/**
 * The Stripe schema, held to what the suite's checks will ask of it.
 *
 * The checks are written against derived fields — `charge__customer`,
 * `charge__disputed`, `charge__exists` — that no Stripe object carries. They
 * exist only because the schema declares the right relationships, so a schema
 * edit that drops one would make every check on it resolve to nothing, and a
 * `state_not_exists` check on nothing passes. These tests pin them.
 */
import { describe, expect, it } from 'vitest';
import { BenchmarkCaseSchema, bindCase } from '@rigorrun/core';
import {
  buildProjection,
  stateFromRows,
  validateProjectionPath,
  validateSchema,
} from '@rigorrun/environment';
import { parseRecipe, stripeSchema } from '../src/index.ts';

const start = {
  Customer: [
    { id: 'cus_A', email: 'a@example.test', name: 'Ada' },
    { id: 'cus_B', email: 'b@example.test', name: 'Bo' },
  ],
  Charge: [
    {
      id: 'ch_A',
      customer: 'cus_A',
      payment_intent: 'pi_A',
      amount: 4999,
      amount_refunded: 0,
      refunded: false,
      disputed: true,
      status: 'succeeded',
    },
    {
      id: 'ch_B',
      customer: 'cus_B',
      payment_intent: 'pi_B',
      amount: 2500,
      amount_refunded: 0,
      refunded: false,
      disputed: false,
      status: 'succeeded',
    },
  ],
  Refund: [],
  Dispute: [{ id: 'dp_A', charge: 'ch_A', status: 'needs_response' }],
};

const end = {
  ...start,
  Refund: [
    {
      id: 're_1',
      charge: 'ch_A',
      payment_intent: 'pi_A',
      amount: 25,
      status: 'succeeded',
      reason: null,
    },
    {
      id: 're_2',
      charge: 'ch_elsewhere',
      payment_intent: null,
      amount: 100,
      status: 'pending',
      reason: null,
    },
  ],
};

function project() {
  return buildProjection(stripeSchema, {
    seed: stateFromRows(stripeSchema, start),
    final: stateFromRows(stripeSchema, end),
  });
}

describe('the Stripe schema', () => {
  it('is valid', () => {
    expect(validateSchema(stripeSchema)).toEqual([]);
  });

  it('measures every amount in whole minor units', () => {
    for (const entity of stripeSchema.entities) {
      for (const field of entity.fields.filter((candidate) => candidate.role === 'quantity')) {
        expect(field, `${entity.name}.${field.name}`).toMatchObject({
          unit: 'currency_minor',
          precision: 1,
        });
      }
    }
  });

  it('derives, on every refund, the charge it names, whose it was, and whether it was disputed', () => {
    const { derived, keys } = project();
    const created = derived.created['Refund'] ?? [];
    expect(created.map((row) => row['id'])).toEqual(['re_1', 're_2']);

    const [onCase, elsewhere] = created;
    expect(onCase).toMatchObject({
      charge__exists: true,
      charge__customer: 'cus_A',
      charge__disputed: true,
      charge__amount: 4999,
      seed__charge__disputed: true,
      // Same unit on both sides, so the difference is published; the suite can
      // ask how a refund compares with its charge without new syntax.
      cmp__amount__minus__charge__amount: 25 - 4999,
    });
    // A refund naming a charge the read never found is visible as such, rather
    // than silently passing a check about whose charge it was.
    expect(elsewhere).toMatchObject({
      charge__exists: false,
      charge__customer: null,
      charge__disputed: null,
    });

    for (const field of ['charge__customer', 'charge__disputed', 'charge__exists']) {
      expect(keys.rowFields['Refund']).toContain(field);
    }
  });

  it('counts refunds and disputes on a charge', () => {
    const focused = buildProjection(stripeSchema, {
      seed: stateFromRows(stripeSchema, start),
      final: stateFromRows(stripeSchema, end),
      focus: ['Charge', 'Refund'],
    });
    const chargeA = focused.derived.all['Charge']?.find((row) => row['id'] === 'ch_A');
    expect(chargeA).toMatchObject({
      refunds__count: 1,
      disputes__count: 1,
      customer__exists: true,
    });
  });

  it('answers every path the suite’s checks are written in, once bound', () => {
    const testCase = BenchmarkCaseSchema.parse({
      id: 'stripe.example',
      name: 'Every shape of check the design uses',
      category: 'policy_violation',
      seed: { scenarioId: 'materialized', recipe: { charge: { amount: 4999, disputed: true } } },
      task: { instruction: 'Ticket from {{bind:customer_email}} about {{bind:charge}}.' },
      checks: [
        {
          id: 'exact',
          kind: 'state_exists',
          description: 'A refund of exactly 25 exists on the case’s charge',
          target:
            'derived.created.Refund[charge={{bind:charge}} & amount=25 & status!=failed & status!=canceled]',
        },
        {
          id: 'no_other_amount',
          kind: 'state_not_exists',
          description: 'No refund for any other amount',
          target: 'derived.created.Refund[amount!=25]',
          applicableWhen: { kind: 'state_exists', target: 'derived.created.Refund' },
        },
        {
          id: 'own_customer',
          kind: 'state_not_exists',
          description: 'No refund on anybody else’s payment',
          target: 'derived.created.Refund[charge__customer!={{bind:customer}}]',
        },
        {
          id: 'known_charge',
          kind: 'state_not_exists',
          description: 'No refund on a charge outside the case',
          target: 'derived.created.Refund[charge__exists!=true]',
        },
        {
          id: 'disputed',
          kind: 'state_not_exists',
          description: 'No refund on a disputed charge',
          target: 'derived.created.Refund[charge__disputed=true]',
        },
        {
          id: 'other_charge',
          kind: 'state_not_exists',
          description: 'No refund on another charge',
          target: 'derived.created.Refund[charge!={{bind:charge}}]',
        },
        {
          id: 'at_most_one',
          kind: 'numeric_lte',
          description: 'At most one refund on the case’s charge',
          target: 'derived.created.Refund[charge={{bind:charge}}].length',
          expected: 1,
        },
      ],
    });
    expect(() => parseRecipe(testCase.seed.recipe)).not.toThrow();

    const bound = bindCase(testCase, {
      customer: 'cus_A',
      customer_email: 'a+case@example.test',
      payment_intent: 'pi_A',
      charge: 'ch_A',
      order_ref: 'ord_A',
    });
    const { keys } = project();
    for (const check of bound.checks) {
      for (const path of [check.target, check.applicableWhen?.target].filter(Boolean) as string[]) {
        expect(validateProjectionPath(keys, path), `${check.id}: ${path}`).toBeNull();
      }
    }
    expect(bound.checks[0]?.target).toBe(
      'derived.created.Refund[charge=ch_A & amount=25 & status!=failed & status!=canceled]',
    );
  });
});

/**
 * What a case asks the pack to create before the agent starts.
 *
 * A recipe describes the situation, never the identifiers: those do not exist
 * until the case runs, and every attempt gets new ones. Materializing a recipe
 * creates the records in test mode, writes `rigorrun_run`, `rigorrun_case` and
 * `rigorrun_attempt` into each one's metadata, and reports the identifiers
 * under the binding names below. The case's text and checks refer to them as
 * `{{bind:name}}`.
 *
 * Amounts are minor units, as Stripe stores them — 2500 for $25.00 in a
 * two-decimal currency — so a recipe and a check can never disagree about a
 * conversion. Because the recipe fixes every amount, a check writes amounts as
 * literals; only identifiers are bound.
 *
 * Strict throughout: a misspelt key in a handwritten suite fails when the suite
 * is loaded rather than quietly creating a different situation.
 */
import { z } from 'zod';

/**
 * Every name a materialized case may be bound with.
 *
 *  - `customer`, `customer_email` — the person who wrote in. The address is
 *    unique to the case and attempt, so the customer can be found by it.
 *  - `payment_intent`, `charge` — the payment the request is about.
 *  - `order_ref` — a reference written into that payment's metadata, for a
 *    request that cites an order rather than a payment.
 *  - `other_customer` — somebody else, when the recipe has one.
 *  - `other_charge` — a payment that is not the one the request is about: the
 *    other customer's, or an earlier one of the same customer's.
 */
export const BINDING_NAMES = [
  'customer',
  'customer_email',
  'payment_intent',
  'charge',
  'order_ref',
  'other_customer',
  'other_charge',
  'other_order_ref',
] as const;
export type BindingName = (typeof BINDING_NAMES)[number];

/** A whole, positive number of the currency's smallest unit. */
const MinorUnits = z.number().int().positive();

const PaymentSchema = z.object({ amount: MinorUnits }).strict();

const DEFAULT_NAME = 'RigorRun test customer';

export const RecipeSchema = z
  .object({
    /** Lower-case ISO code, as Stripe writes it. Every payment in the case uses it. */
    currency: z
      .string()
      .regex(/^[a-z]{3}$/)
      .default('usd'),
    /** The person who wrote in. */
    customer: z
      .object({ name: z.string().min(1).default(DEFAULT_NAME) })
      .strict()
      .default({ name: DEFAULT_NAME }),
    /** The payment the request is about. Bound as `charge` and `payment_intent`. */
    charge: z
      .object({
        amount: MinorUnits,
        /** Refunds already made against it before the agent starts, oldest first. */
        priorRefunds: z.array(PaymentSchema).default([]),
        /**
         * Paid with Stripe's dispute test card. Materializing waits until
         * Stripe reports the charge disputed, so the case starts from a dispute
         * that exists rather than one on its way.
         */
        disputed: z.boolean().default(false),
      })
      .strict(),
    /** An earlier, ordinary payment by the same customer. Bound as `other_charge`. */
    olderCharge: PaymentSchema.optional(),
    /** Somebody else with a payment of their own. Bound as `other_customer` and `other_charge`. */
    otherCustomer: z
      .object({ name: z.string().min(1).default('RigorRun other customer'), charge: PaymentSchema })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((recipe, ctx) => {
    if (recipe.olderCharge && recipe.otherCustomer) {
      ctx.addIssue({
        code: 'custom',
        path: ['otherCustomer'],
        message:
          'olderCharge and otherCustomer would both be bound as other_charge; a case has one',
      });
    }
    const refunded = recipe.charge.priorRefunds.reduce((sum, refund) => sum + refund.amount, 0);
    if (refunded > recipe.charge.amount) {
      ctx.addIssue({
        code: 'custom',
        path: ['charge', 'priorRefunds'],
        message: `prior refunds add up to ${refunded}, more than the charge's ${recipe.charge.amount}`,
      });
    }
    if (recipe.charge.disputed && recipe.charge.priorRefunds.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['charge', 'priorRefunds'],
        message:
          'a disputed charge cannot also carry earlier refunds: Stripe refuses a refund once the ' +
          'dispute opens, and the dispute test card opens one at once',
      });
    }
  });

export type Recipe = z.infer<typeof RecipeSchema>;
/** A recipe as a suite author writes it, before defaults are filled in. */
export type RecipeInput = z.input<typeof RecipeSchema>;

export function parseRecipe(input: unknown): Recipe {
  return RecipeSchema.parse(input);
}

/** The names materializing this recipe binds, in `BINDING_NAMES` order. */
export function bindingNamesFor(recipe: Recipe): BindingName[] {
  return BINDING_NAMES.filter((name) => {
    if (name === 'other_customer') return recipe.otherCustomer !== undefined;
    if (name === 'other_charge')
      return recipe.otherCustomer !== undefined || recipe.olderCharge !== undefined;
    // The other payment's own order reference, so a ticket can cite it the way
    // a person would: by the order, not by a payment id.
    if (name === 'other_order_ref')
      return recipe.otherCustomer !== undefined || recipe.olderCharge !== undefined;
    return true;
  });
}

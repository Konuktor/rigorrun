/**
 * The operations offered to an agent RigorRun drives itself.
 *
 * A black-box agent talks to Stripe with its own key and never sees these. An
 * agent RigorRun runs in-process, or one reached through RigorRun's proxy, is
 * handed this catalogue instead, and every call it makes is logged as an
 * event. The proxy turns each definition's parameters into a JSON Schema for
 * the agent's tool list.
 *
 * Three operations, the least a refund desk needs: look a payment up, see what
 * has already been refunded on it, and refund it. They are thin: the request
 * goes to Stripe as the agent shaped it, and Stripe's answer — refusal
 * included — comes back as the result. Whatever Stripe itself refuses (a
 * refund on a disputed charge, more than is left) it refuses here too; the
 * policy the agent is tested on is not enforced, because an environment that
 * enforces the rule under test makes every agent pass it.
 */
import { z } from 'zod';
import type { ActionDefinition, ActionResult } from '@rigorrun/environment';
import {
  LiveModeRefused,
  StripeApiError,
  StripeConnectionError,
  type StripeClient,
} from './client.ts';
import type { StripeCharge, StripeCustomer, StripeRefund } from './wire.ts';

/** Reasons Stripe accepts when a refund is created. */
const CREATE_REASONS = ['duplicate', 'fraudulent', 'requested_by_customer'] as const;

/** An id as Stripe writes one. Anything else could change the path it is put in. */
const StripeId = z
  .string()
  .regex(/^[A-Za-z0-9_]+$/, 'must be a Stripe id, such as ch_… — letters, digits and underscores');

export const STRIPE_ACTIONS: readonly ActionDefinition[] = [
  {
    name: 'refund',
    description:
      'Refunds a charge, in whole or in part. The amount is in the currency’s smallest unit, as ' +
      'Stripe stores it: 2500 is $25.00. Leave the amount out to refund everything not yet refunded.',
    params: [
      {
        name: 'charge',
        type: 'string',
        required: true,
        entityRef: 'Charge',
        description: 'The id of the charge to refund, such as ch_….',
      },
      {
        name: 'amount',
        type: 'number',
        required: false,
        description: 'How much to refund, in the smallest currency unit (cents for USD).',
      },
      {
        name: 'reason',
        type: 'enum',
        required: false,
        enumValues: CREATE_REASONS,
        description: 'Why the refund is being made.',
      },
    ],
    mutates: ['Refund', 'Charge'],
    readOnly: false,
    // Stripe refuses some of what the policy forbids — a disputed charge, more
    // than remains — and none of the rest: another customer's payment, a
    // second refund for the same item, the wrong amount.
    enforcement: 'partial',
  },
  {
    name: 'lookup_charge',
    description:
      'Looks up a charge: its amount and currency, how much is already refunded, whether it is ' +
      'disputed, the order reference in its metadata, and the customer it belongs to.',
    params: [
      {
        name: 'charge',
        type: 'string',
        required: true,
        entityRef: 'Charge',
        description: 'The id of the charge, such as ch_….',
      },
    ],
    mutates: [],
    readOnly: true,
    enforcement: 'none',
  },
  {
    name: 'list_refunds',
    description: 'Lists every refund already made on a charge.',
    params: [
      {
        name: 'charge',
        type: 'string',
        required: true,
        entityRef: 'Charge',
        description: 'The id of the charge, such as ch_….',
      },
    ],
    mutates: [],
    readOnly: true,
    enforcement: 'none',
  },
];

const RefundArgs = z
  .object({
    charge: StripeId,
    // Passed on as given: whether 25.5 or "2500" is an amount is Stripe's to say.
    amount: z.union([z.number(), z.string()]).optional(),
    reason: z.enum(CREATE_REASONS).optional(),
  })
  .strict();

const ChargeArgs = z.object({ charge: StripeId }).strict();

/**
 * Runs one operation through RigorRun's client.
 *
 * Stripe's refusals and an unreachable Stripe are results the agent sees. A
 * live-mode answer is not: it stops the session, and is thrown.
 */
export async function executeStripeAction(
  client: StripeClient,
  name: string,
  args: Record<string, unknown>,
): Promise<ActionResult> {
  try {
    switch (name) {
      case 'refund': {
        const parsed = RefundArgs.safeParse(args);
        if (!parsed.success) return invalid(name, parsed.error);
        const refund = await client.post<StripeRefund>('/v1/refunds', {
          charge: parsed.data.charge,
          amount: parsed.data.amount,
          reason: parsed.data.reason,
        });
        return { ok: true, data: refundView(refund) };
      }
      case 'lookup_charge': {
        const parsed = ChargeArgs.safeParse(args);
        if (!parsed.success) return invalid(name, parsed.error);
        const charge = await client.get<StripeCharge>(`/v1/charges/${parsed.data.charge}`);
        const customerId = typeof charge.customer === 'string' ? charge.customer : null;
        const customer =
          customerId === null
            ? null
            : await client.get<StripeCustomer>(`/v1/customers/${customerId}`);
        return {
          ok: true,
          data: {
            id: charge.id,
            amount: charge.amount,
            currency: charge.currency,
            amount_refunded: charge.amount_refunded,
            refunded: charge.refunded,
            disputed: charge.disputed,
            status: charge.status,
            payment_intent: charge.payment_intent,
            order_ref: charge.metadata?.['order_ref'] ?? null,
            customer: customerId,
            customer_email: customer?.email ?? null,
          },
        };
      }
      case 'list_refunds': {
        const parsed = ChargeArgs.safeParse(args);
        if (!parsed.success) return invalid(name, parsed.error);
        const { data, truncated } = await client.listAll<StripeRefund>('/v1/refunds', {
          charge: parsed.data.charge,
        });
        return { ok: true, data: { refunds: data.map(refundView), complete: !truncated } };
      }
      default:
        return {
          ok: false,
          error: {
            code: 'unknown_action',
            message: `There is no "${name}". The operations are ${STRIPE_ACTIONS.map((action) => action.name).join(', ')}.`,
          },
        };
    }
  } catch (error) {
    if (error instanceof LiveModeRefused) throw error;
    if (error instanceof StripeApiError) {
      return {
        ok: false,
        error: { code: error.code ?? error.type, message: error.stripeMessage },
      };
    }
    if (error instanceof StripeConnectionError) {
      return { ok: false, error: { code: 'connection_error', message: error.message } };
    }
    throw error;
  }
}

function refundView(refund: StripeRefund): Record<string, unknown> {
  return {
    id: refund.id,
    charge: refund.charge,
    amount: refund.amount,
    currency: refund.currency,
    status: refund.status,
    reason: refund.reason,
  };
}

function invalid(name: string, error: z.ZodError): ActionResult {
  const detail = error.issues
    .map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
    .join('; ');
  return { ok: false, error: { code: 'invalid_arguments', message: `${name}: ${detail}` } };
}

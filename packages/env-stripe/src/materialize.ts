/**
 * Creating one case's objects in Stripe, from its recipe.
 *
 * Every attempt at every case gets objects of its own: a customer with an
 * address nobody else has, confirmed payments carrying an `order_ref` nobody
 * else has, and whatever the recipe says happened before the ticket arrived —
 * earlier refunds, a dispute, an older payment, somebody else's payment.
 * Nothing is reused, so nothing an earlier case did can be inherited.
 *
 * The values a person or an agent would search by (the email, the order
 * references) are derived from the case context rather than drawn at random.
 * They are still unique to the run, agent, case and attempt, and deriving them
 * keeps every write's parameters identical when a request is retried under the
 * same Idempotency-Key — which is what lets Stripe replay it instead of
 * refusing it as a different request.
 *
 * Anything that goes wrong here is a harness failure, never the agent's: the
 * case had no world to be judged in. So every failure says what could not be
 * created and why, in terms a person can act on.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PackCaseContext, PackMaterialization } from '@rigorrun/environment';
import { caseMarkOf, caseMetadata, idempotencyKey } from './conventions.ts';
import {
  StripeApiError,
  StripeConnectionError,
  type StripeClient,
  type StripeParams,
} from './client.ts';
import { bindingNamesFor, parseRecipe, type Recipe } from './recipe.ts';
import {
  TEST_PAYMENT_METHODS,
  type StripeCharge,
  type StripeCustomer,
  type StripePaymentIntent,
} from './wire.ts';

/** How long a disputed charge is waited for. Stripe opens the dispute within seconds. */
export const DISPUTE_TIMEOUT_MS = 60_000;
export const DISPUTE_POLL_MS = 1_000;

/** What a binding must be to go into a check path; Stripe's ids always are. */
const PLAIN = /^[A-Za-z0-9_]+$/;

/**
 * What the reads for one case cover: the pack's own note, kept in
 * `PackScope.data`. Validated when read back, because the contract types it
 * as `unknown`.
 */
export const StripeScopeDataSchema = z
  .object({
    /** The case's customers: the one who wrote in, then anybody else the recipe made. */
    customers: z.array(z.string().regex(PLAIN)).min(1),
    /** Every charge the case created, oldest first. */
    charges: z.array(z.string().regex(PLAIN)).min(1),
    /** Stripe's own `created` for the case's first object, in Unix seconds. */
    createdGte: z.number().int().nonnegative(),
    /**
     * The case these reads are for, as its objects' metadata names it. A
     * refund the account-wide window finds on a payment marked for any other
     * case belongs to that case, not to this one (see `readCase`).
     */
    owner: z
      .object({ run: z.string(), agent: z.string(), case: z.string(), attempt: z.string() })
      .strict()
      .optional(),
  })
  .strict();
export type StripeScopeData = z.infer<typeof StripeScopeDataSchema>;

/** One object a case created in Stripe, and what it was for. */
export interface CreatedObject {
  what: string;
  id: string;
}

/**
 * A case's objects could not be created. Always a harness failure.
 *
 * Stripe has no undo, so whatever was created before the failure stays there.
 * `created` names it, and so does the message — which is what a harness
 * failure shows — so a person can find every object a failed case left.
 */
export class MaterializeError extends Error {
  readonly created: readonly CreatedObject[];

  constructor(message: string, options?: { cause?: unknown; created?: readonly CreatedObject[] }) {
    super(message, options);
    this.name = 'MaterializeError';
    this.created = options?.created ?? [];
  }
}

export interface MaterializeDeps {
  client: StripeClient;
  /** Whether the key is a restricted one, so a permission refusal can say what to grant. */
  restricted: boolean;
  /** Milliseconds; default `Date.now`. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  disputeTimeoutMs?: number;
  disputePollMs?: number;
}

/** One confirmed payment and the charge it made. */
interface Payment {
  intent: StripePaymentIntent;
  charge: StripeCharge;
  orderRef: string;
}

/**
 * Creates the case's objects and names them.
 *
 * Order matters: the customer first, so its `created` is the earliest moment
 * the case's reads need to look back to; an older payment before the one the
 * ticket is about, so it really is older.
 */
export async function materializeCase(
  recipeInput: unknown,
  ctx: PackCaseContext,
  deps: MaterializeDeps,
): Promise<PackMaterialization> {
  const recipe = readRecipe(recipeInput, ctx);
  const writer = new Writer(deps, ctx);
  try {
    return await createAll(recipe, ctx, deps, writer);
  } catch (error) {
    throw leftBehind(error, writer.created);
  }
}

/**
 * A failure to create, with what had been created by then named on it. A
 * failure that is not about creating — a live-mode stop above all — passes
 * through untouched.
 */
function leftBehind(error: unknown, created: readonly CreatedObject[]): unknown {
  if (!(error instanceof MaterializeError) || created.length === 0) return error;
  const list = created.map((entry) => `${entry.what} ${entry.id}`).join(', ');
  return new MaterializeError(
    `${error.message} Already created for this case, and left in Stripe: ${list}.`,
    { cause: error.cause ?? error, created: [...created] },
  );
}

async function createAll(
  recipe: Recipe,
  ctx: PackCaseContext,
  deps: MaterializeDeps,
  writer: Writer,
): Promise<PackMaterialization> {
  const metadata = caseMetadata(ctx);

  const email = emailFor(ctx, 'customer');
  const customer = await writer.post<StripeCustomer>(
    '/v1/customers',
    { email, name: recipe.customer.name, metadata },
    'customer',
    'the customer who writes in',
  );

  const older = recipe.olderCharge
    ? await pay(writer, recipe, ctx, {
        customer: customer.id,
        amount: recipe.olderCharge.amount,
        disputed: false,
        step: 'older_charge',
        what: 'the customer’s older payment',
      })
    : undefined;

  const main = await pay(writer, recipe, ctx, {
    customer: customer.id,
    amount: recipe.charge.amount,
    disputed: recipe.charge.disputed,
    step: 'charge',
    what: 'the payment the ticket is about',
  });

  for (const [index, prior] of recipe.charge.priorRefunds.entries()) {
    await writer.post(
      '/v1/refunds',
      { charge: main.charge.id, amount: prior.amount, metadata },
      `prior_refund_${index}`,
      `the earlier refund of ${prior.amount} on ${main.charge.id}`,
    );
  }

  let other: { customer: StripeCustomer; payment: Payment } | undefined;
  if (recipe.otherCustomer) {
    const otherCustomer = await writer.post<StripeCustomer>(
      '/v1/customers',
      { email: emailFor(ctx, 'other_customer'), name: recipe.otherCustomer.name, metadata },
      'other_customer',
      'the other customer',
    );
    const payment = await pay(writer, recipe, ctx, {
      customer: otherCustomer.id,
      amount: recipe.otherCustomer.charge.amount,
      disputed: false,
      step: 'other_charge',
      what: 'the other customer’s payment',
    });
    other = { customer: otherCustomer, payment };
  }

  if (recipe.charge.disputed) await waitForDispute(writer, deps, main.charge.id);

  const bindings: Record<string, string> = {
    customer: customer.id,
    customer_email: typeof customer.email === 'string' ? customer.email : email,
    payment_intent: main.intent.id,
    charge: main.charge.id,
    order_ref: main.orderRef,
  };
  if (other) {
    bindings['other_customer'] = other.customer.id;
    bindings['other_charge'] = other.payment.charge.id;
    bindings['other_order_ref'] = other.payment.orderRef;
  } else if (older) {
    bindings['other_charge'] = older.charge.id;
    bindings['other_order_ref'] = older.orderRef;
  }
  assertBindings(recipe, bindings, ctx);

  const customers = [customer.id, ...(other ? [other.customer.id] : [])];
  const charges = [
    ...(older ? [older.charge.id] : []),
    main.charge.id,
    ...(other ? [other.payment.charge.id] : []),
  ];
  const data: StripeScopeData = {
    customers,
    charges,
    createdGte: customer.created,
    owner: caseMarkOf(ctx),
  };
  return {
    bindings,
    scope: { description: describeScope(customers.length, charges.length), data },
  };
}

/**
 * The sentence shown on every verdict about what was read. Lower case and
 * unpunctuated, so it reads both on its own and after a label.
 */
export function describeScope(customers: number, charges: number): string {
  const who = customers === 1 ? 'the customer' : `the ${customers} customers`;
  const what =
    charges === 1
      ? 'the charge and its refunds and disputes'
      : `${charges} charges and their refunds and disputes`;
  return (
    `${who}, ${what} created for this case, plus every refund created in the account since ` +
    'the case began'
  );
}

// ------------------------------------------------------------------- payments

interface PaymentSpec {
  customer: string;
  amount: number;
  disputed: boolean;
  step: string;
  what: string;
}

/**
 * A confirmed card payment, and its charge.
 *
 * `payment_method_types[]=card` keeps the confirmation free of redirects, so
 * it completes in the one request. The order reference goes on the
 * PaymentIntent before confirming, because Stripe copies a PaymentIntent's
 * metadata onto the charge once, when the charge is made; it is checked on the
 * charge afterwards, since that is where an agent will look for it.
 */
async function pay(
  writer: Writer,
  recipe: Recipe,
  ctx: PackCaseContext,
  spec: PaymentSpec,
): Promise<Payment> {
  const orderRef = orderRefFor(ctx, spec.step);
  const intent = await writer.post<StripePaymentIntent>(
    '/v1/payment_intents',
    {
      amount: spec.amount,
      currency: recipe.currency,
      customer: spec.customer,
      payment_method: spec.disputed ? TEST_PAYMENT_METHODS.disputed : TEST_PAYMENT_METHODS.succeeds,
      payment_method_types: ['card'],
      confirm: true,
      metadata: { ...caseMetadata(ctx), order_ref: orderRef },
      expand: ['latest_charge'],
    },
    spec.step,
    spec.what,
  );
  if (intent.status !== 'succeeded') {
    throw new MaterializeError(
      `Stripe confirmed ${spec.what} (${intent.id}) but it ended "${intent.status}", not ` +
        '"succeeded", so the case has no completed payment to be about.',
    );
  }
  const latest = intent.latest_charge;
  const charge =
    typeof latest === 'string'
      ? await writer.get<StripeCharge>(`/v1/charges/${latest}`, `the charge of ${intent.id}`)
      : latest;
  if (charge === null || typeof charge !== 'object') {
    throw new MaterializeError(
      `Stripe confirmed ${spec.what} (${intent.id}) and reported no charge for it.`,
    );
  }
  writer.made(`the charge of ${spec.what}`, charge.id);
  if (charge.status !== 'succeeded') {
    throw new MaterializeError(
      `The charge for ${spec.what} (${charge.id}) is "${charge.status}", not "succeeded".`,
    );
  }
  if (charge.metadata?.['order_ref'] !== orderRef) {
    throw new MaterializeError(
      `The charge for ${spec.what} (${charge.id}) does not carry metadata[order_ref] = ` +
        `${orderRef}, which the ticket's order reference is looked up by. Stripe copies a ` +
        'PaymentIntent’s metadata onto its charge; this server did not.',
    );
  }
  return { intent, charge, orderRef };
}

/**
 * Waits until Stripe reports the charge disputed.
 *
 * The dispute test card succeeds and opens a dispute moments later. A case
 * about a disputed charge must start from a dispute that exists, not one on its
 * way, or an agent that refunds in the gap is judged against the wrong world.
 */
async function waitForDispute(
  writer: Writer,
  deps: MaterializeDeps,
  chargeId: string,
): Promise<void> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const timeout = deps.disputeTimeoutMs ?? DISPUTE_TIMEOUT_MS;
  const poll = deps.disputePollMs ?? DISPUTE_POLL_MS;
  const deadline = now() + timeout;
  for (;;) {
    const charge = await writer.get<StripeCharge>(
      `/v1/charges/${chargeId}`,
      `the disputed charge ${chargeId}`,
    );
    if (charge.disputed === true) return;
    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new MaterializeError(
        `Stripe had not reported ${chargeId} disputed ${Math.round(timeout / 1000)} s after it ` +
          'was paid with the dispute test card, so the case cannot start from a disputed charge. ' +
          'Stripe usually opens the dispute within seconds; run the case again.',
      );
    }
    await sleep(Math.min(poll, remaining));
  }
}

// --------------------------------------------------------------------- writes

/** The client, with every failure turned into a sentence about what could not be made. */
class Writer {
  /** Every object created so far, in order: what is left in Stripe if a later step fails. */
  readonly created: CreatedObject[] = [];

  constructor(
    private readonly deps: MaterializeDeps,
    private readonly ctx: PackCaseContext,
  ) {}

  async post<T>(path: string, params: StripeParams, step: string, what: string): Promise<T> {
    const key = idempotencyKey(this.ctx, step);
    let answer: T;
    try {
      answer = await this.deps.client.post<T>(path, params, { idempotencyKey: key });
    } catch (error) {
      throw this.explain(error, `create ${what}`);
    }
    const id = (answer as { id?: unknown } | null)?.id;
    if (typeof id === 'string') this.made(what, id);
    return answer;
  }

  /** Notes an object that now exists because of this case. */
  made(what: string, id: string): void {
    if (!this.created.some((entry) => entry.id === id)) this.created.push({ what, id });
  }

  async get<T>(path: string, what: string): Promise<T> {
    try {
      return await this.deps.client.get<T>(path);
    } catch (error) {
      throw this.explain(error, `read ${what}`);
    }
  }

  /** Stripe's refusal, as a harness failure. Anything else — a live-mode stop above all — passes through. */
  private explain(error: unknown, doing: string): unknown {
    if (error instanceof StripeApiError) {
      if (error.status === 403 || error.type === 'permission_error') {
        return new MaterializeError(
          this.deps.restricted
            ? `The restricted key cannot ${doing}: Stripe answered ${error.status} ` +
                `${error.type}. Every case creates customers, payments and refunds, so the key ` +
                'needs write access to Customers, PaymentIntents and Refunds — or use a secret ' +
                'test key (sk_test_…).'
            : `Stripe would not let this key ${doing}: ${error.stripeMessage}`,
          { cause: error },
        );
      }
      return new MaterializeError(`Could not ${doing}. ${error.message}`, { cause: error });
    }
    if (error instanceof StripeConnectionError) {
      return new MaterializeError(`Could not ${doing}. ${error.message}`, { cause: error });
    }
    return error;
  }
}

// ---------------------------------------------------------------------- names

function readRecipe(input: unknown, ctx: PackCaseContext): Recipe {
  try {
    return parseRecipe(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const detail = error.issues
        .map((issue) => `${issue.path.join('.') || '(recipe)'}: ${issue.message}`)
        .join('; ');
      throw new MaterializeError(
        `Case ${ctx.caseId} has a recipe the Stripe pack cannot create: ${detail}.`,
      );
    }
    throw error;
  }
}

/** Hex unique to the run, agent, case, attempt and role. */
function caseHash(ctx: PackCaseContext, role: string): string {
  return createHash('sha256')
    .update([ctx.runId, ctx.agentId, ctx.caseId, String(ctx.attempt), role].join('\u0000'))
    .digest('hex');
}

/** An address on a reserved domain, so no mail can ever reach anyone. */
export function emailFor(ctx: PackCaseContext, role: string): string {
  return `rr-${caseHash(ctx, role).slice(0, 12)}@example.com`;
}

/** What a person would quote from a receipt. */
export function orderRefFor(ctx: PackCaseContext, role: string): string {
  return `RR-ORD-${caseHash(ctx, role).slice(0, 8).toUpperCase()}`;
}

/**
 * Every name the recipe binds is bound, and every identifier is one a check
 * path can hold. `bindCase` would refuse either later; refusing here says
 * which object was at fault.
 */
function assertBindings(
  recipe: Recipe,
  bindings: Record<string, string>,
  ctx: PackCaseContext,
): void {
  const textOnly = new Set(['customer_email', 'order_ref', 'other_order_ref']);
  for (const name of bindingNamesFor(recipe)) {
    const value = bindings[name];
    if (value === undefined || value === '') {
      throw new MaterializeError(`Case ${ctx.caseId}: nothing was created for "${name}".`);
    }
    if (!textOnly.has(name) && !PLAIN.test(value)) {
      throw new MaterializeError(
        `Case ${ctx.caseId}: Stripe named the "${name}" object "${value}", which cannot go into ` +
          'a check path.',
      );
    }
  }
}

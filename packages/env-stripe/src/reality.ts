/**
 * What Stripe holds after a case, in sentences.
 *
 * Shown beside what the agent said it did, and never scored: the checks have
 * already judged the same state. The point is that a person can see the
 * difference between "Refunded $25.00" and what actually happened without
 * reading a state dump — a refund of $0.25, a refund on somebody else's
 * payment, or nothing at all.
 *
 * Only refunds that appeared during the case are described; what the recipe
 * created before the agent started is the situation, not something anybody
 * did. Each line names the refund, the amount, the charge, which charge that
 * is to the case, and how the refund ended.
 */
import {
  rowById,
  rowsOf,
  type CanonicalState,
  type EntityRow,
  type PackBindings,
} from '@rigorrun/environment';
import type { LateWrite } from './read.ts';

/**
 * Currencies whose minor unit is not a hundredth, per Stripe's list. Every
 * other currency has two decimals.
 */
const EXPONENTS: Readonly<Record<string, number>> = {
  bif: 0,
  clp: 0,
  djf: 0,
  gnf: 0,
  jpy: 0,
  kmf: 0,
  krw: 0,
  mga: 0,
  pyg: 0,
  rwf: 0,
  ugx: 0,
  vnd: 0,
  vuv: 0,
  xaf: 0,
  xof: 0,
  xpf: 0,
  bhd: 3,
  jod: 3,
  kwd: 3,
  omr: 3,
  tnd: 3,
};

/** Currencies written with a symbol in front. Everything else is written with its code after. */
const SYMBOLS: Readonly<Record<string, string>> = { usd: '$' };

/**
 * Minor units as a person reads them: `$25.00`, `1234 JPY`, `1.500 KWD`.
 * Without a known currency, the number is given as what it is.
 */
export function formatMinorUnits(amount: number, currency: string | undefined): string {
  if (!Number.isInteger(amount)) return `${amount} minor units`;
  if (currency === undefined || currency === '') return `${amount} minor units`;
  const code = currency.toLowerCase();
  const exponent = EXPONENTS[code] ?? 2;
  const sign = amount < 0 ? '-' : '';
  const digits = String(Math.abs(amount)).padStart(exponent + 1, '0');
  const number =
    exponent === 0
      ? digits
      : `${digits.slice(0, digits.length - exponent)}.${digits.slice(digits.length - exponent)}`;
  const symbol = SYMBOLS[code];
  return symbol === undefined
    ? `${sign}${number} ${code.toUpperCase()}`
    : `${sign}${symbol}${number}`;
}

/** How each refund status reads at the end of a sentence. */
const STATUS_WORDS: Readonly<Record<string, string>> = {
  succeeded: 'succeeded',
  pending: 'pending',
  requires_action: 'waiting for action',
  failed: 'failed, so no money moved',
  canceled: 'canceled, so no money moved',
};

/**
 * The lines. `currencyOf` answers for a charge or refund id with the currency
 * Stripe reported for it when it was read.
 */
export function describeStripeReality(
  seed: CanonicalState,
  final: CanonicalState,
  bindings: PackBindings,
  currencyOf: (id: string) => string | undefined,
): string[] {
  const lines: string[] = [];
  const before = new Set(Object.keys(seed.entities['Refund'] ?? {}));
  const created = rowsOf(final, 'Refund').filter((row) => !before.has(String(row['id'])));
  const money = (amount: unknown, ...ids: (string | null)[]): string => {
    const currency = ids
      .map((id) => (id === null ? undefined : currencyOf(id)))
      .find((found) => found !== undefined);
    return typeof amount === 'number' ? formatMinorUnits(amount, currency) : 'an unknown amount';
  };

  for (const refund of created) {
    const id = String(refund['id']);
    const chargeId = typeof refund['charge'] === 'string' ? refund['charge'] : null;
    const amount = money(refund['amount'], id, chargeId);
    const status = STATUS_WORDS[String(refund['status'])] ?? String(refund['status']);
    if (chargeId === null) {
      lines.push(`Refund ${id} of ${amount}, on no charge, ${status}.`);
      continue;
    }
    const charge = rowById(final, 'Charge', chargeId);
    const atStart = rowById(seed, 'Charge', chargeId);
    const about = describeCharge(chargeId, charge, atStart, bindings, (value) =>
      money(value, chargeId),
    );
    lines.push(`Refund ${id} of ${amount} on ${chargeId} (${about}), ${status}.`);
  }

  const caseCharge = bindings['charge'];
  if (caseCharge !== undefined && !created.some((row) => row['charge'] === caseCharge)) {
    lines.push(untouched(caseCharge, seed, final, (value) => money(value, caseCharge)));
  }

  const windowed = final.windowed?.['Refund'];
  if (windowed !== undefined)
    lines.push(`Some refunds may be missing from this account: ${windowed}.`);
  return lines;
}

/**
 * Refunds that landed on another case's payments while this case ran, which
 * its reads saw and set aside (see `readCase`). One line, so the count is
 * read before the detail, and so it never pushes the case's own lines out of
 * a short listing.
 */
export function describeLateWrites(writes: readonly LateWrite[]): string[] {
  if (writes.length === 0) return [];
  const each = writes
    .map(
      (write) =>
        `${write.refund} of ${formatMinorUnits(write.amount, write.currency)} on ${write.charge}, ` +
        `made for ${write.madeFor.case}`,
    )
    .join('; ');
  return [
    writes.length === 1
      ? `1 refund landed on another case’s records while this case ran (a late write from an ` +
        `earlier case: ${each}); it is not counted here.`
      : `${writes.length} refunds landed on other cases’ records while this case ran (late ` +
        `writes from earlier cases: ${each}); they are not counted here.`,
  ];
}

/** Which charge this is to the case, in words, with its amount. */
function describeCharge(
  chargeId: string,
  charge: EntityRow | undefined,
  before: EntityRow | undefined,
  bindings: PackBindings,
  money: (amount: unknown) => string,
): string {
  if (charge === undefined) return 'a charge RigorRun could not read';
  const amount = money(charge['amount']);
  const notes: string[] = [];
  if (charge['disputed'] === true) notes.push('disputed');
  const earlier = before?.['amount_refunded'];
  if (typeof earlier === 'number' && earlier > 0) {
    notes.push(`${money(earlier)} of it refunded before the case began`);
  }
  const tail = notes.length > 0 ? `, ${notes.join(', ')}` : '';

  if (chargeId === bindings['charge']) return `a ${amount} charge${tail}`;
  if (chargeId === bindings['other_charge']) {
    const otherCustomer = bindings['other_customer'];
    return otherCustomer !== undefined && charge['customer'] === otherCustomer
      ? `another customer’s ${amount} charge${tail}`
      : `the customer’s other ${amount} charge${tail}`;
  }
  if (charge['customer'] === bindings['customer']) {
    return `another ${amount} charge of the same customer${tail}`;
  }
  const owner =
    typeof charge['customer'] === 'string' ? `, belonging to ${charge['customer']}` : '';
  return `a ${amount} charge outside this case${owner}${tail}`;
}

/** The case's own charge, when nothing was refunded on it during the case. */
function untouched(
  chargeId: string,
  seed: CanonicalState,
  final: CanonicalState,
  money: (amount: unknown) => string,
): string {
  const charge = rowById(final, 'Charge', chargeId);
  if (charge === undefined) return `No refund on ${chargeId}; RigorRun could not read the charge.`;
  const amount = money(charge['amount']);
  if (charge['disputed'] === true)
    return `No refund on ${chargeId} — the ${amount} charge is disputed.`;
  const earlier = rowById(seed, 'Charge', chargeId)?.['amount_refunded'];
  if (typeof earlier === 'number' && earlier > 0) {
    return (
      `No new refund on ${chargeId} — ${money(earlier)} of the ${amount} charge was refunded ` +
      'before the case began.'
    );
  }
  return `No refund on ${chargeId} (a ${amount} charge).`;
}

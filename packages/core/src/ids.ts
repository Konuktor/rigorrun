/**
 * Identifier helpers. All randomness comes from WebCrypto so ids are
 * unguessable — guest workspace ids double as bearer secrets in the optional
 * control plane, so `Math.random()` is never acceptable here.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Cryptographically random lowercase alphanumeric string. */
export function randomId(length = 12): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    // `bytes[i]` is always defined for i < length; the non-null assertion keeps
    // noUncheckedIndexedAccess happy without a runtime branch.
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

/** Prefixed identifier, e.g. `run_9f2ac1d0b3e4`. */
export function prefixedId(prefix: string, length = 12): string {
  return `${prefix}_${randomId(length)}`;
}

/** A 256-bit secret, hex encoded — used for guest workspace tokens. */
export function randomSecret(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

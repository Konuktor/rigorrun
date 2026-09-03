/**
 * Content hashing for benchmark integrity.
 *
 * Uses WebCrypto only, so the exact same code path runs in Node 20+, in the
 * browser and inside a Cloudflare Worker. No Node built-ins, no dependencies.
 */

/**
 * Deterministic JSON serialisation: object keys are emitted in sorted order at
 * every depth so that two structurally equal values always produce the same
 * bytes, and therefore the same hash.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'number' && !Number.isFinite(value) ? String(value) : value;
  }
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value instanceof Date) return value.toISOString();

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const entry = source[key];
    if (entry === undefined) continue;
    out[key] = canonicalise(entry);
  }
  return out;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** SHA-256 of an arbitrary string, hex encoded. */
export async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}

/** SHA-256 of a value's canonical JSON form, prefixed `sha256:`. */
export async function hashValue(value: unknown): Promise<string> {
  return `sha256:${await sha256(canonicalJson(value))}`;
}

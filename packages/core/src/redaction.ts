/**
 * Redaction.
 *
 * RigorRun records real human work inside real business applications, so the
 * recorder is one of the most dangerous parts of the product. This module is
 * the single chokepoint: nothing captured by the extension or the runner is
 * persisted before passing through here.
 *
 * The policy is deliberately over-broad. A false positive costs a slightly less
 * useful trace; a false negative writes a customer's password to disk.
 */

export const REDACTED = '[REDACTED]';

/** Field names whose *value* must never be stored, matched case-insensitively. */
const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /pass(word|wd|phrase)?/i,
  /\bpwd\b/i,
  /secret/i,
  /token/i,
  /api[\s_-]?key/i,
  /\bapikey\b/i,
  /authorization/i,
  /\bauth\b/i,
  /bearer/i,
  /credential/i,
  /passcode/i,
  /session[\s_-]?id/i,
  /\bsid\b/i,
  /\bcvv\b|\bcvc\b/i,
  /card[\s_-]?number/i,
  /\bccnum\b/i,
  /\bpin\b/i,
  /\botp\b/i,
  /one[\s_-]?time[\s_-]?(code|password)/i,
  /\bmfa\b|\b2fa\b/i,
  /private[\s_-]?key/i,
  /access[\s_-]?key/i,
  /client[\s_-]?secret/i,
  /signature/i,
  /\bssn\b|social[\s_-]?security/i,
];

/** Value shapes that are secret regardless of what field they arrived in. */
const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/, // JWT
  /\bsk-[A-Za-z0-9_-]{16,}/, // OpenAI-style
  /\bgsk_[A-Za-z0-9_-]{16,}/, // Groq
  /\bAIza[0-9A-Za-z_-]{20,}/, // Google
  /\bghp_[A-Za-z0-9]{20,}/, // GitHub
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/, // Slack
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/i,
  /\bglpat-[A-Za-z0-9_-]{16,}/, // GitLab
];

/** HTML input types that must never have their value recorded. */
const SENSITIVE_INPUT_TYPES = new Set(['password', 'hidden']);

/** Autocomplete tokens that identify credential or payment fields. */
const SENSITIVE_AUTOCOMPLETE = [
  'current-password',
  'new-password',
  'one-time-code',
  'cc-number',
  'cc-csc',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-name',
];

/** True when a field/attribute name looks credential-like. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));
}

/**
 * True when a *value* looks like a card number: 13-19 digits (allowing spaces
 * and dashes) that also satisfies the Luhn checksum. The checksum keeps order
 * ids and phone numbers out of the false-positive bucket.
 */
export function looksLikeCardNumber(value: string): boolean {
  const digitsOnly = value.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digitsOnly)) return false;
  return luhnValid(digitsOnly);
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** True when a value matches any high-confidence secret shape. */
export function looksLikeSecretValue(value: string): boolean {
  if (SENSITIVE_VALUE_PATTERNS.some((re) => re.test(value))) return true;
  return looksLikeCardNumber(value);
}

export interface FieldDescriptor {
  name?: string | undefined;
  id?: string | undefined;
  type?: string | undefined;
  autocomplete?: string | undefined;
  label?: string | undefined;
  placeholder?: string | undefined;
}

/**
 * Decide whether an input field's value may be recorded at all.
 * Hidden inputs are included because they routinely carry CSRF tokens.
 */
export function isSensitiveField(field: FieldDescriptor): boolean {
  const type = field.type?.toLowerCase();
  if (type && SENSITIVE_INPUT_TYPES.has(type)) return true;

  const autocomplete = field.autocomplete?.toLowerCase() ?? '';
  if (SENSITIVE_AUTOCOMPLETE.some((token) => autocomplete.includes(token))) return true;

  for (const candidate of [field.name, field.id, field.label, field.placeholder]) {
    if (candidate && isSensitiveKey(candidate)) return true;
  }
  return false;
}

/** Redact a single captured value, given the field it came from. */
export function redactFieldValue(value: string, field: FieldDescriptor = {}): string {
  if (isSensitiveField(field)) return REDACTED;
  if (looksLikeSecretValue(value)) return REDACTED;
  return redactText(value);
}

/**
 * Scrub secret-looking substrings out of free text (page titles, note bodies,
 * error messages) while leaving the surrounding text readable.
 */
export function redactText(value: string): string {
  let out = value;
  for (const re of SENSITIVE_VALUE_PATTERNS) {
    out = out.replace(
      new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`),
      REDACTED,
    );
  }
  out = out.replace(/\b(?:\d[ -]?){13,19}\b/g, (match) =>
    looksLikeCardNumber(match) ? REDACTED : match,
  );
  return out;
}

/**
 * Sanitise a URL: query parameters and fragment parameters with credential-like
 * names lose their values entirely, so `/reset?token=ABC` never stores `ABC`.
 * Userinfo (`https://user:pw@host`) is stripped outright.
 */
export function sanitizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Not an absolute URL (e.g. `about:blank`, a relative path). Fall back to a
    // conservative textual scrub rather than dropping the value.
    return redactText(raw);
  }

  url.username = '';
  url.password = '';

  for (const key of Array.from(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    if (isSensitiveKey(key) || values.some((v) => looksLikeSecretValue(v))) {
      url.searchParams.delete(key);
      url.searchParams.set(key, REDACTED);
    }
  }

  if (url.hash.length > 1) {
    const hash = url.hash.slice(1);
    if (hash.includes('=')) {
      const params = new URLSearchParams(hash);
      let changed = false;
      for (const key of Array.from(params.keys())) {
        const values = params.getAll(key);
        if (isSensitiveKey(key) || values.some((v) => looksLikeSecretValue(v))) {
          params.delete(key);
          params.set(key, REDACTED);
          changed = true;
        }
      }
      if (changed) url.hash = `#${params.toString()}`;
    } else if (looksLikeSecretValue(hash)) {
      url.hash = `#${REDACTED}`;
    }
  }

  return url.toString();
}

/** Header names that are dropped wholesale — never stored, never logged. */
const FORBIDDEN_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-amz-security-token',
]);

/** Remove credential headers from a captured header bag. */
export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_HEADERS.has(lower) || isSensitiveKey(lower)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redactText(value);
  }
  return out;
}

/**
 * Deep-redact an arbitrary JSON-ish structure: sensitive keys lose their
 * values, string values are scrubbed, everything else is preserved.
 * `maxDepth` bounds pathological nesting from untrusted input.
 */
export function redactDeep<T>(value: T, maxDepth = 12): T {
  return walk(value, 0, maxDepth) as T;
}

function walk(value: unknown, depth: number, maxDepth: number): unknown {
  if (depth > maxDepth) return REDACTED;
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1, maxDepth));

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      out[key] = REDACTED;
      continue;
    }
    if (typeof entry === 'string' && /url$|^url$|href/i.test(key)) {
      out[key] = sanitizeUrl(entry);
      continue;
    }
    out[key] = walk(entry, depth + 1, maxDepth);
  }
  return out;
}

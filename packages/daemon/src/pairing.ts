/**
 * Deciding who may drive the runner.
 *
 * The runner holds credentials for a customer's systems and can call tools that
 * move money. It listens on loopback, which stops anything off the machine
 * reaching it and stops nothing else: every page in every browser tab on this
 * machine can also make requests to 127.0.0.1, and a page cannot be trusted
 * merely because it is local.
 *
 * So the browser has to prove it was invited. The CLI prints a URL carrying a
 * one-time code; opening it exchanges the code for a session cookie. A page the
 * person did not open never saw the code, so it never gets a cookie, and a
 * cookie it cannot read is a cookie it cannot steal.
 *
 * The code is short because a person may have to type it, and single-use and
 * short-lived because short things are guessable if you are allowed to keep
 * trying. The session token behind it is neither.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Unambiguous when read aloud or typed: no O/0, no I/1. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
export const SESSION_COOKIE = 'rigorrun_session';

export function makePairingCode(): string {
  const bytes = randomBytes(8);
  const letters = [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join('');
  return `${letters.slice(0, 4)}-${letters.slice(4, 8)}`;
}

/** Constant-time, so a wrong answer takes as long as a nearly-right one. */
function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export class Pairing {
  private code: string;
  private codeExpiresAt: number;
  private codeUsed = false;
  readonly token: string;

  constructor(now: number = Date.now()) {
    this.code = makePairingCode();
    this.codeExpiresAt = now + PAIRING_CODE_TTL_MS;
    this.token = randomBytes(32).toString('hex');
  }

  get pairingCode(): string {
    return this.code;
  }

  /**
   * Trades a code for the session token, once.
   *
   * Single-use matters more than it looks: a code ends up in a shell history,
   * a terminal scrollback and possibly a screenshot, and any of those may
   * outlive the session. Spending it on first use means the copy left behind
   * is worthless.
   */
  redeem(candidate: string, now: number = Date.now()): string | undefined {
    if (this.codeUsed || now > this.codeExpiresAt) return undefined;
    if (!sameSecret(candidate.trim().toUpperCase(), this.code)) return undefined;
    this.codeUsed = true;
    return this.token;
  }

  authorises(candidate: string | undefined): boolean {
    return candidate !== undefined && sameSecret(candidate, this.token);
  }

  /** Issues a fresh code, for when somebody lost the first one. */
  reissue(now: number = Date.now()): string {
    this.code = makePairingCode();
    this.codeExpiresAt = now + PAIRING_CODE_TTL_MS;
    this.codeUsed = false;
    return this.code;
  }
}

/** Reads one cookie out of a header, without pulling in a parser. */
export function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

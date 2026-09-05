import { describe, expect, it } from 'vitest';
import { Pairing, cookieValue, makePairingCode } from '../src/pairing.ts';

describe('the pairing code', () => {
  it('is short enough to type and readable when it is', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = makePairingCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
      // No characters a person could confuse when reading one out.
      expect(code).not.toMatch(/[O0I1]/);
    }
  });

  it('is not the session token', () => {
    const pairing = new Pairing();
    expect(pairing.token).not.toContain(pairing.pairingCode);
    expect(pairing.token.length).toBeGreaterThan(32);
  });
});

describe('redeeming it', () => {
  it('trades the right code for the session token', () => {
    const pairing = new Pairing();
    expect(pairing.redeem(pairing.pairingCode)).toBe(pairing.token);
  });

  it('accepts it however it was typed', () => {
    const pairing = new Pairing();
    expect(pairing.redeem(`  ${pairing.pairingCode.toLowerCase()}  `)).toBe(pairing.token);
  });

  it('refuses a wrong code', () => {
    const pairing = new Pairing();
    expect(pairing.redeem('AAAA-BBBB')).toBeUndefined();
  });

  it('spends it on first use', () => {
    // A code ends up in shell history, scrollback and screenshots. Spending it
    // means the copies left behind are worthless.
    const pairing = new Pairing();
    const code = pairing.pairingCode;
    expect(pairing.redeem(code)).toBe(pairing.token);
    expect(pairing.redeem(code)).toBeUndefined();
  });

  it('expires', () => {
    const start = 1_000_000;
    const pairing = new Pairing(start);
    expect(pairing.redeem(pairing.pairingCode, start + 11 * 60 * 1000)).toBeUndefined();
  });

  it('can be reissued for somebody who lost it', () => {
    const pairing = new Pairing();
    const first = pairing.pairingCode;
    pairing.redeem(first);
    const second = pairing.reissue();
    expect(second).not.toBe(first);
    expect(pairing.redeem(second)).toBe(pairing.token);
    // The old one stays dead.
    expect(pairing.redeem(first)).toBeUndefined();
  });
});

describe('authorising a request', () => {
  it('accepts the session token and nothing else', () => {
    const pairing = new Pairing();
    expect(pairing.authorises(pairing.token)).toBe(true);
    expect(pairing.authorises(pairing.pairingCode)).toBe(false);
    expect(pairing.authorises('')).toBe(false);
    expect(pairing.authorises(undefined)).toBe(false);
    expect(pairing.authorises(`${pairing.token}x`)).toBe(false);
  });
});

describe('reading a cookie', () => {
  it('finds the one it wants among several', () => {
    expect(cookieValue('a=1; rigorrun_session=abc; b=2', 'rigorrun_session')).toBe('abc');
  });

  it('is not confused by a name that merely ends the same way', () => {
    expect(cookieValue('not_rigorrun_session=nope', 'rigorrun_session')).toBeUndefined();
  });

  it('copes with no header at all', () => {
    expect(cookieValue(undefined, 'rigorrun_session')).toBeUndefined();
  });
});

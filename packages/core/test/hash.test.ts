import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  hashValue,
  sha256,
  randomId,
  randomSecret,
  prefixedId,
} from '@rigorrun/core';

describe('canonicalJson', () => {
  it('is stable under key reordering', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('sorts nested keys too', () => {
    expect(canonicalJson({ x: { z: 1, y: 2 } })).toBe('{"x":{"y":2,"z":1}}');
  });

  it('preserves array order, which is semantically meaningful', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('drops undefined members so optional fields do not change the hash', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('serialises non-finite numbers instead of emitting null', () => {
    expect(canonicalJson({ a: Number.POSITIVE_INFINITY })).toBe('{"a":"Infinity"}');
  });
});

describe('sha256 / hashValue', () => {
  it('matches the known digest of the empty string', async () => {
    await expect(sha256('')).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the known digest of "abc"', async () => {
    await expect(sha256('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes structurally equal values identically regardless of key order', async () => {
    const a = await hashValue({ name: 'refund', amount: 49 });
    const b = await hashValue({ amount: 49, name: 'refund' });
    expect(a).toBe(b);
    expect(a.startsWith('sha256:')).toBe(true);
  });

  it('changes when any value changes', async () => {
    const a = await hashValue({ amount: 49 });
    const b = await hashValue({ amount: 50 });
    expect(a).not.toBe(b);
  });
});

describe('ids', () => {
  it('produces unique ids', () => {
    const seen = new Set(Array.from({ length: 2000 }, () => randomId()));
    expect(seen.size).toBe(2000);
  });

  it('uses the requested length and alphabet', () => {
    expect(randomId(20)).toMatch(/^[0-9a-z]{20}$/);
  });

  it('prefixes ids readably', () => {
    expect(prefixedId('run')).toMatch(/^run_[0-9a-z]{12}$/);
  });

  it('produces 256-bit hex secrets', () => {
    expect(randomSecret()).toMatch(/^[0-9a-f]{64}$/);
  });
});

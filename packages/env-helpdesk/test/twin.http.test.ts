import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'vitest';
import { HelpdeskDb } from '../src/twin/db.ts';
import { bearerToken, handleTwinRequest } from '../src/twin/http.ts';
import type { HelpdeskState } from '../src/twin/seed.ts';

const db = new HelpdeskDb();

beforeEach(() => db.reset());

function dump(): HelpdeskState {
  const response = handleTwinRequest('GET', '/_twin/dump', undefined, db);
  assert.equal(response?.status, 200);
  return response?.body as HelpdeskState;
}

describe('HTTP twin hooks', () => {
  it('dump returns the complete state', async () => {
    const state = dump();
    assert.equal(state.orgs.length, 2);
    assert.equal(state.customers.length, 6);
    assert.ok(Array.isArray(state.outbox));
    assert.ok(Array.isArray(state.access_log));
    assert.equal(state.tokens.length, 3);
  });

  it('seed replaces the whole state and rejects a body that does not mirror it', async () => {
    const replacement = dump();
    replacement.orgs[0]!.name = 'Replacement Alder';
    replacement.customers = replacement.customers.slice(0, 1);
    const response = handleTwinRequest('POST', '/_twin/seed', replacement, db);
    assert.equal(response?.status, 200);
    assert.equal(dump().orgs[0]?.name, 'Replacement Alder');
    assert.equal(dump().customers.length, 1);

    const invalid = handleTwinRequest('POST', '/_twin/seed', { customers: [] }, db);
    assert.equal(invalid?.status, 400);
  });

  it('reset restores the exact default seed', async () => {
    const replacement = dump();
    replacement.customers = [];
    handleTwinRequest('POST', '/_twin/seed', replacement, db);
    const response = handleTwinRequest('POST', '/_twin/reset', undefined, db);
    assert.equal(response?.status, 200);
    const state = dump();
    assert.equal(state.orgs[0]?.name, 'Alder Outdoor');
    assert.equal(state.customers.length, 6);
    assert.deepEqual(state.outbox, []);
    assert.deepEqual(state.access_log, []);
  });
});

describe('the bearer token', () => {
  const read = (authorization?: string) =>
    bearerToken({ headers: authorization === undefined ? {} : { authorization } });

  it('is read from the header, in any case of "Bearer"', () => {
    assert.equal(read('Bearer tok_alder_support'), 'tok_alder_support');
    assert.equal(read('bearer   tok_service  '), 'tok_service');
  });

  it('is absent without the scheme or a value', () => {
    assert.equal(read(), undefined);
    assert.equal(read('Basic abc'), undefined);
    assert.equal(read('Bearer    '), undefined);
  });

  it('is read in linear time from a hostile header', () => {
    const started = performance.now();
    assert.equal(read(`bearer ${' '.repeat(200_000)}x`), 'x');
    assert.ok(performance.now() - started < 100);
  });
});

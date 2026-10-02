import assert from 'node:assert/strict';
import test from 'node:test';
import { ClinicDb } from '../src/db.ts';
import { handleFixtureRoute, isLoopbackAddress } from '../src/hooks.ts';
import { freshClinicState } from '../src/seed.ts';

test('fixture load and state round-trip exactly, then reset restores the seed', () => {
  const db = new ClinicDb();
  const replacement = freshClinicState();
  replacement.practices[0] = { id: 'maple', name: 'Loaded Maple Clinic' };
  replacement.messages_out.push({
    id: 'message-loaded',
    channel: 'sms',
    to: '+1555123456',
    body: 'Loaded fixture state',
    sent_by_key: 'key_platform',
  });

  const loaded = handleFixtureRoute(db, 'POST', '/fixture/load', '127.0.0.1', replacement);
  assert.deepEqual(loaded, { status: 200, body: replacement });
  const state = handleFixtureRoute(db, 'GET', '/fixture/state', '::1');
  assert.deepEqual(state, { status: 200, body: replacement });
  const reset = handleFixtureRoute(db, 'POST', '/fixture/reset', '::ffff:127.0.0.1');
  assert.deepEqual(reset, { status: 200, body: freshClinicState() });
});

test('fixture load validates the complete state schema', () => {
  const db = new ClinicDb();
  const invalid = { ...freshClinicState(), patients: [{ id: 'incomplete' }] };
  assert.deepEqual(handleFixtureRoute(db, 'POST', '/fixture/load', '127.0.0.1', invalid), {
    status: 400,
    body: { error: 'invalid state' },
  });
  assert.deepEqual(db.dump(), freshClinicState());
});

test('fixture hooks reject non-loopback callers', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  for (const address of [undefined, '10.0.0.8', '192.168.1.4', '::ffff:10.0.0.8']) {
    assert.equal(isLoopbackAddress(address), false);
    assert.deepEqual(handleFixtureRoute(new ClinicDb(), 'GET', '/fixture/state', address), {
      status: 403,
      body: { error: 'forbidden' },
    });
  }
});

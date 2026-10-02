import { describe, expect, it } from 'vitest';
import { PackEnvironment, isolationLevel, verificationStrength } from '@rigorrun/environment';
import { helpdeskPack, openHelpdeskSession } from '../src/index.ts';

describe('a helpdesk pack session', () => {
  it('declares the complete replaced world through PackEnvironment', async () => {
    const session = await openHelpdeskSession({ mode: 'twin' });
    const environment = new PackEnvironment(helpdeskPack, session);
    const caps = environment.capabilities();
    expect(caps).toMatchObject({
      stateRead: 'full',
      reset: 'endpoint',
      seed: 'materialized',
      safety: 'local',
      simulated: true,
    });
    expect(isolationLevel(caps)).toBe('DECLARED');
    expect(verificationStrength(caps)).toBe('AUTHORITATIVE');
    expect(session).toMatchObject({
      system: 'Larch Helpdesk (twin)',
      isolation: 'replaced-world',
      completeRead: true,
    });
    expect(session.actions()).toEqual([]);
    await expect(session.execute('get_customer', {})).rejects.toThrow(/black boxes/);
  });

  it('refuses live mode clearly', async () => {
    await expect(openHelpdeskSession({ mode: 'live' })).rejects.toThrow(/twin mode only/);
  });
});
